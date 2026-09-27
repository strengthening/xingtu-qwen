import * as THREE from 'three';

import { pixelSideDeg, queryDiscNest } from '../astro/healpix';
import type { Vec3 } from '../astro/vector';
import { dataUrl, type BandManifest, type Manifest } from '../data/manifest';

export type ChunkState = 'pending' | 'loading' | 'ready' | 'failed';

export interface StarChunk {
  id: string;
  band: BandManifest;
  pixel: number | null;
  file: string;
  idsFile: string;
  stars: number;
  state: ChunkState;
  geometry: THREE.BufferGeometry | null;
  ids: BigUint64Array | null;
  /** Wall-clock ms of the last frame this chunk was inside the field of view. */
  lastSeenMs: number;
}

export const RECORD_FLOATS = 8;

/**
 * Loads star chunks on demand: the bright magnitude bands are single all-sky files, the faint
 * ones are HEALPix tiles of which only the ones touching the current field of view are fetched.
 */
export class StarCatalog {
  readonly chunks = new Map<string, StarChunk>();
  readonly bands: BandManifest[];

  private loadedBytes = 0;
  private readonly byteBudget = 512 * 1024 * 1024;

  constructor(manifest: Manifest) {
    this.bands = manifest.bands;
    for (const band of manifest.bands) {
      if (band.kind === 'allsky') {
        this.chunks.set(band.id, {
          id: band.id,
          band,
          pixel: null,
          file: band.file!,
          idsFile: band.idsFile!,
          stars: band.stars,
          state: 'pending',
          geometry: null,
          ids: null,
          lastSeenMs: 0,
        });
      } else {
        for (const tile of band.tiles ?? []) {
          const id = `${band.id}p${tile.pixel}`;
          this.chunks.set(id, {
            id,
            band,
            pixel: tile.pixel,
            file: `${band.dir}/${tile.pixel}.bin`,
            idsFile: `${band.dir}/${tile.pixel}.ids.bin`,
            stars: tile.stars,
            state: 'pending',
            geometry: null,
            ids: null,
            lastSeenMs: 0,
          });
        }
      }
    }
  }

  /** Chunks that should be on screen for this field of view and look direction (J2000). */
  visibleChunks(fovDeg: number, viewDirEqj: Vec3, nowMs: number): StarChunk[] {
    const visible: StarChunk[] = [];
    for (const band of this.bands) {
      if (fovDeg > band.showBelowFov) continue;
      if (band.kind === 'allsky') {
        const chunk = this.chunks.get(band.id)!;
        chunk.lastSeenMs = nowMs;
        visible.push(chunk);
        continue;
      }
      const radius = fovDeg / 2 + pixelSideDeg(band.order!);
      for (const pixel of queryDiscNest(band.order!, viewDirEqj, radius)) {
        const chunk = this.chunks.get(`${band.id}p${pixel}`);
        if (!chunk) continue;
        chunk.lastSeenMs = nowMs;
        visible.push(chunk);
      }
    }
    return visible;
  }

  load(chunk: StarChunk): Promise<void> {
    if (chunk.state === 'ready') return Promise.resolve();
    if (chunk.state === 'loading') return chunkPending(chunk);
    chunk.state = 'loading';
    const promise = (async () => {
      const response = await fetch(dataUrl(chunk.file));
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${chunk.file}`);
      const buffer = await response.arrayBuffer();
      chunk.geometry = buildGeometry(new Float32Array(buffer));
      chunk.state = 'ready';
      this.loadedBytes += buffer.byteLength;
      this.evictIfOverBudget();
    })();
    setPending(chunk, promise);
    return promise.catch((error) => {
      chunk.state = 'failed';
      throw error;
    });
  }

  async loadIds(chunk: StarChunk): Promise<BigUint64Array | null> {
    if (chunk.ids) return chunk.ids;
    const response = await fetch(dataUrl(chunk.idsFile));
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    chunk.ids = new BigUint64Array(buffer);
    return chunk.ids;
  }

  get loadedStarCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.state === 'ready') count += chunk.stars;
    }
    return count;
  }

  /** Drop the least recently seen tiles when the GPU-side budget is exceeded. */
  private evictIfOverBudget(): void {
    if (this.loadedBytes <= this.byteBudget) return;
    const candidates = [...this.chunks.values()]
      .filter((chunk) => chunk.state === 'ready' && chunk.band.kind === 'tiles')
      .sort((a, b) => a.lastSeenMs - b.lastSeenMs);
    for (const chunk of candidates) {
      if (this.loadedBytes <= this.byteBudget * 0.7) break;
      chunk.geometry?.dispose();
      chunk.geometry = null;
      chunk.ids = null;
      chunk.state = 'pending';
      this.loadedBytes -= chunk.stars * RECORD_FLOATS * 4;
    }
  }
}

function buildGeometry(floats: Float32Array): THREE.BufferGeometry {
  const interleaved = new THREE.InterleavedBuffer(floats, RECORD_FLOATS);
  interleaved.setUsage(THREE.StaticDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aPosMag', new THREE.InterleavedBufferAttribute(interleaved, 4, 0));
  geometry.setAttribute('aAstro', new THREE.InterleavedBufferAttribute(interleaved, 4, 4));
  geometry.setDrawRange(0, floats.length / RECORD_FLOATS);
  // Positions live on the unit sphere and are projected in the shader, so culling is off.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
  return geometry;
}

const pendingLoads = new WeakMap<StarChunk, Promise<void>>();

function chunkPending(chunk: StarChunk): Promise<void> {
  return pendingLoads.get(chunk) ?? Promise.resolve();
}

function setPending(chunk: StarChunk, promise: Promise<void>): void {
  pendingLoads.set(chunk, promise);
}
