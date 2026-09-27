import * as THREE from 'three';

import { equatorialToGalacticMatrix, galacticToEquatorialMatrix } from '../astro/frames';
import type { SkyContext } from '../astro/sky-context';
import { pixToAngNest, pixelSideDeg, queryDiscNest } from '../astro/healpix';
import { mulMatVec, type Mat3, type Vec3 } from '../astro/vector';
import type { HipsSource } from '../data/hips';
import { SKY_GLSL } from './projection';
import type { SkyCamera } from './sky-camera';
import type { SkyUniforms } from './sky-uniforms';

const VERTEX_SHADER = /* glsl */ `
${SKY_GLSL}
attribute vec3 aDir;
attribute vec2 aUv;
varying vec2 vUv;
varying float vAlt;

void main() {
  vec3 sky = uEqjToSky * aDir;
  vAlt = altitudeDeg(sky);
  vec3 view = uSkyToView * sky;
  float w = 1.0 + view.z;
  if (w < 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(-1.0);
    return;
  }
  vUv = aUv;
  gl_Position = projectViewDir(view);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;
uniform sampler2D uMap;
uniform float uIntensity;
varying vec2 vUv;
varying float vAlt;

void main() {
  if (vUv.x < 0.0 || vAlt < -0.5) discard;
  vec3 color = texture2D(uMap, vUv).rgb;
  float fade = smoothstep(-0.5, 1.5, vAlt);
  gl_FragColor = vec4(color * uIntensity * fade, 1.0);
}
`;

const GRID = 8;

interface Tile {
  mesh: THREE.Mesh;
  texture: THREE.Texture | null;
  state: 'loading' | 'ready' | 'failed';
  lastSeenMs: number;
}

/**
 * HiPS all-sky image layer (the Milky Way background). Tiles are HEALPix pixels of a
 * galactic-framed survey; each becomes a small curved patch on the celestial sphere and is
 * projected by the same stereographic vertex math as everything else.
 */
export class MilkyWayLayer {
  private readonly tiles = new Map<string, Tile>();
  private readonly geometries = new Map<number, THREE.BufferGeometry>();
  private readonly eqjToGal: Mat3;
  private readonly galToEqj: Mat3;
  private readonly group = new THREE.Group();
  private readonly intensity: THREE.IUniform<number> = { value: 0.8 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly uniforms: SkyUniforms,
    private readonly source: HipsSource,
  ) {
    this.eqjToGal = equatorialToGalacticMatrix();
    this.galToEqj = galacticToEquatorialMatrix();
    this.group.renderOrder = 2;
    this.scene.add(this.group);
  }

  /** Per-tile material: shares the global sky uniforms by reference, owns only uMap. */
  private makeMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...(this.uniforms as unknown as { [uniform: string]: THREE.IUniform }),
        uMap: { value: null },
        uIntensity: this.intensity,
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  update(context: SkyContext, camera: SkyCamera, visible: boolean, nowMs: number): void {
    this.group.visible = visible;
    if (!visible) return;
    const order =
      camera.fovDeg > 60 ? Math.min(2, this.source.properties.order) : this.source.properties.order;
    const viewGal = mulMatVec(this.eqjToGal, camera.forward);
    const radius = camera.fovDeg / 2 + pixelSideDeg(order) * 1.2;
    const intensity =
      0.85 *
      (1 - context.atmosphere.daylight) *
      (1 - 0.6 * context.atmosphere.twilightGlow) *
      (0.35 + 0.65 * Math.max(0, 1 - context.lightPollutionMag / 4));
    this.intensity.value = Math.max(0, intensity);

    const wanted = new Set<string>();
    for (const pixel of queryDiscNest(order, viewGal, radius)) {
      const key = `${order}:${pixel}`;
      wanted.add(key);
      let tile = this.tiles.get(key);
      if (!tile) tile = this.createTile(order, pixel, key);
      tile.lastSeenMs = nowMs;
      if (tile.mesh.parent !== this.group && tile.state === 'ready') this.group.add(tile.mesh);
    }
    for (const [key, tile] of this.tiles) {
      if (!wanted.has(key) && tile.mesh.parent === this.group) this.group.remove(tile.mesh);
    }
  }

  private createTile(order: number, pixel: number, key: string): Tile {
    const geometry = this.tileGeometry(order, pixel);
    const material = this.makeMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.matrixAutoUpdate = false;
    const tile: Tile = { mesh, texture: null, state: 'loading', lastSeenMs: 0 };
    this.tiles.set(key, tile);
    void this.loadTexture(order, pixel, tile, material);
    return tile;
  }

  private async loadTexture(
    order: number,
    pixel: number,
    tile: Tile,
    material: THREE.ShaderMaterial,
  ): Promise<void> {
    try {
      const response = await fetch(this.source.tileUrl(order, pixel));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      const texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      tile.texture = texture;
      material.uniforms.uMap!.value = texture;
      tile.state = 'ready';
    } catch {
      tile.state = 'failed';
    }
  }

  /** Curved patch: a (GRID+1)² grid of sphere directions following the HEALPix cell edges. */
  private tileGeometry(order: number, pixel: number): THREE.BufferGeometry {
    const cached = this.geometries.get(order * 100000 + pixel);
    if (cached) return cached;
    const positions: number[] = [];
    const uvs: number[] = [];
    for (let j = 0; j <= GRID; j++) {
      for (let i = 0; i <= GRID; i++) {
        const { theta, phi } = pixToAngNest(order, pixel, i / GRID, j / GRID);
        const s = Math.sin(theta);
        const gal: Vec3 = [s * Math.cos(phi), s * Math.sin(phi), Math.cos(theta)];
        const eqj = mulMatVec(this.galToEqj, gal);
        positions.push(eqj[0], eqj[1], eqj[2]);
        uvs.push(i / GRID, 1 - j / GRID);
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = j * (GRID + 1) + i;
        const b = a + 1;
        const c = a + GRID + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('aDir', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aUv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
    this.geometries.set(order * 100000 + pixel, geometry);
    return geometry;
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const tile of this.tiles.values()) {
      tile.texture?.dispose();
      (tile.mesh.material as THREE.Material).dispose();
    }
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.tiles.clear();
    this.geometries.clear();
  }
}
