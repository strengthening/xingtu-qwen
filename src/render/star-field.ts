import * as THREE from 'three';

import type { SkyContext } from '../astro/sky-context';
import type { Vec3 } from '../astro/vector';
import type { StarCatalog, StarChunk } from '../data/star-chunks';
import { RECORD_FLOATS } from '../data/star-chunks';
import { SKY_GLSL, projectDirection, projectionScale } from './projection';
import type { SkyCamera } from './sky-camera';
import type { SkyUniforms } from './sky-uniforms';

const VERTEX_SHADER = /* glsl */ `
${SKY_GLSL}
attribute vec4 aPosMag;
attribute vec4 aAstro;
uniform float uPixelRatio;
uniform float uFovZoom;
uniform float uExtinctionK;
uniform float uStarDimming;
uniform float uMagZero;
varying vec3 vColor;
varying float vBrightness;

vec3 bvToRgb(float bv) {
  if (bv < -900.0) return vec3(1.0);
  float b = clamp(bv, -0.4, 2.5);
  float t = 4600.0 * (1.0 / (0.92 * b + 1.7) + 1.0 / (0.92 * b + 0.62));
  float k = clamp(t, 1000.0, 40000.0) / 100.0;
  float r = k <= 66.0 ? 255.0 : clamp(329.7 * pow(k - 60.0, -0.1332), 0.0, 255.0);
  float g = k <= 66.0 ? clamp(99.47 * log(max(k, 1.0)) - 161.12, 0.0, 255.0)
                      : clamp(288.12 * pow(k - 60.0, -0.0755), 0.0, 255.0);
  float bl = k <= 19.0 ? 0.0
           : (k <= 66.0 ? clamp(138.52 * log(max(k - 10.0, 1.0)) - 305.04, 0.0, 255.0) : 255.0);
  return vec3(r, g, bl) / 255.0;
}

void main() {
  vec3 p = correctStarPosition(aPosMag.xyz, aAstro);
  vec3 sky = uEqjToSky * p;
  float alt = altitudeDeg(sky);
  vec3 view = uSkyToView * sky;
  float w = 1.0 + view.z;
  if (w < 0.05 || alt < -2.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vBrightness = 0.0;
    vColor = vec3(0.0);
    return;
  }
  vec4 clip = projectViewDir(view);
  if (any(greaterThan(abs(clip.xy), vec2(1.2)))) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vBrightness = 0.0;
    vColor = vec3(0.0);
    return;
  }
  float airmass = alt > 0.0
    ? 1.0 / (sin(radians(alt)) + 0.50572 * pow(max(96.07995 - alt, 1.0), -1.6364))
    : 40.0;
  float mag = aPosMag.w + uExtinctionK * min(airmass, 38.0) + uStarDimming;
  float flux = pow(10.0, -0.4 * (mag - uMagZero));
  float horizonFade = smoothstep(-1.2, 0.6, alt);
  vBrightness = clamp(0.1 * pow(max(flux, 0.0), 0.5), 0.0, 1.8) * horizonFade;
  vColor = bvToRgb(aAstro.w);
  gl_PointSize = clamp(0.7 + 1.1 * pow(max(flux, 0.0), 0.33) * uFovZoom, 0.6, 48.0)
    * uPixelRatio * horizonFade;
  gl_Position = clip;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vBrightness;

void main() {
  if (vBrightness <= 0.002) discard;
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q) * 2.0;
  if (d > 1.0) discard;
  // Additive blending multiplies by alpha again, so keep the colour un-premultiplied.
  float shape = pow(max(0.0, 1.0 - d), 2.4) + exp(-d * d * 6.0) * 0.25;
  gl_FragColor = vec4(vColor, shape * vBrightness);
}
`;

export interface PickedStar {
  chunk: StarChunk;
  index: number;
  magnitude: number;
  bv: number;
  parallaxMas: number;
  pmRa: number;
  pmDec: number;
  directionEqj: Vec3;
}

export class StarField {
  readonly material: THREE.ShaderMaterial;

  private readonly points = new Map<string, THREE.Points>();
  private readonly loadQueue: StarChunk[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly catalog: StarCatalog,
    private readonly uniforms: SkyUniforms,
  ) {
    this.material = new THREE.ShaderMaterial({
      uniforms: uniforms as unknown as { [uniform: string]: THREE.IUniform },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  /** Attach points for the visible chunks and queue fetches for the ones still missing. */
  update(visible: StarChunk[]): void {
    const visibleIds = new Set(visible.map((chunk) => chunk.id));
    for (const chunk of visible) {
      if (chunk.state === 'ready' && chunk.geometry) {
        if (!this.points.has(chunk.id)) {
          const points = new THREE.Points(chunk.geometry, this.material);
          points.frustumCulled = false;
          points.renderOrder = 10;
          points.matrixAutoUpdate = false;
          this.scene.add(points);
          this.points.set(chunk.id, points);
        }
      } else if (chunk.state === 'pending' && !this.loadQueue.includes(chunk)) {
        this.loadQueue.push(chunk);
      }
    }
    for (const [id, points] of this.points) {
      if (!visibleIds.has(id)) {
        this.scene.remove(points);
        this.points.delete(id);
      }
    }
    const batch = this.loadQueue.splice(0, 6);
    for (const chunk of batch) {
      void this.catalog.load(chunk).catch(() => undefined);
    }
  }

  /** Nearest loaded star within `toleranceNdc` of a point in NDC, or null. */
  pick(
    ndcX: number,
    ndcY: number,
    toleranceNdc: number,
    context: SkyContext,
    camera: SkyCamera,
  ): PickedStar | null {
    const aspect = this.uniforms.uAspect.value;
    const projScale = projectionScale(camera.fovDeg);
    const skyToView = camera.skyToView();
    const eqjToSky = context.skyMatrix;
    let best: PickedStar | null = null;
    let bestDistance = toleranceNdc;
    for (const chunk of this.catalog.chunks.values()) {
      if (chunk.state !== 'ready' || !chunk.geometry) continue;
      const attribute = chunk.geometry.getAttribute('aPosMag') as THREE.InterleavedBufferAttribute;
      const floats = attribute.data.array as Float32Array;
      for (let i = 0; i < floats.length; i += RECORD_FLOATS) {
        const sky: Vec3 = [
          eqjToSky[0] * floats[i]! + eqjToSky[1] * floats[i + 1]! + eqjToSky[2] * floats[i + 2]!,
          eqjToSky[3] * floats[i]! + eqjToSky[4] * floats[i + 1]! + eqjToSky[5] * floats[i + 2]!,
          eqjToSky[6] * floats[i]! + eqjToSky[7] * floats[i + 1]! + eqjToSky[8] * floats[i + 2]!,
        ];
        const projected = projectDirection(sky, skyToView, projScale, aspect);
        if (projected.behind) continue;
        const distance = Math.hypot(projected.x - ndcX, projected.y - ndcY);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = {
            chunk,
            index: i / RECORD_FLOATS,
            magnitude: floats[i + 3]!,
            bv: floats[i + 7]!,
            parallaxMas: floats[i + 6]!,
            pmRa: floats[i + 4]!,
            pmDec: floats[i + 5]!,
            directionEqj: [floats[i]!, floats[i + 1]!, floats[i + 2]!],
          };
        }
      }
    }
    return best;
  }

  get visibleStarCount(): number {
    let count = 0;
    for (const points of this.points.values()) {
      count += points.geometry.getAttribute('aPosMag').count;
    }
    return count;
  }

  dispose(): void {
    for (const points of this.points.values()) this.scene.remove(points);
    this.points.clear();
    this.material.dispose();
  }
}
