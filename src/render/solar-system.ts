import * as THREE from 'three';

import type { SkyContext } from '../astro/sky-context';
import { projectDirection, projectionScale, SKY_GLSL } from './projection';
import type { SkyCamera } from './sky-camera';
import type { SkyUniforms } from './sky-uniforms';

/**
 * One point sprite per body, using the same interleaved vec4+vec4 attribute layout as the
 * star field (the pipeline proven to draw points here):
 *   aPosMag = x, y, z (J2000 direction), apparent magnitude
 *   aBody   = apparent radius (deg), isMoon flag, unused, unused
 * Nine draw calls is nothing, and it gives every body its own colour and phase uniforms.
 */
const STRIDE = 8;

const VERTEX_SHADER = /* glsl */ `
${SKY_GLSL}
attribute vec4 aPosMag;
attribute vec4 aBody;
uniform float uScreenHeight;
varying float vBrightness;
varying float vHasDisc;
varying float vIsMoon;

void main() {
  vec3 sky = uEqjToSky * aPosMag.xyz;
  float alt = altitudeDeg(sky);
  vec3 view = uSkyToView * sky;
  float w = 1.0 + view.z;
  if (w < 0.05 || alt < -2.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vBrightness = 0.0;
    vHasDisc = 0.0;
    vIsMoon = 0.0;
    return;
  }
  gl_Position = projectViewDir(view);
  float radiusPx = radians(aBody.x) * (uProjScale * 0.5) * uScreenHeight * 0.5;
  vHasDisc = radiusPx > 1.5 ? 1.0 : 0.0;
  gl_PointSize = clamp(max(radiusPx * 2.0, 5.0), 5.0, uScreenHeight);
  float flux = pow(10.0, -0.4 * (aPosMag.w - 4.0));
  vBrightness = clamp(0.35 * pow(max(flux, 1e-6), 0.18), 0.55, 2.2);
  vIsMoon = aBody.y;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;
uniform float uMoonPhase;
uniform vec2 uMoonAxis;
uniform vec3 uBodyColor;
varying float vBrightness;
varying float vHasDisc;
varying float vIsMoon;

void main() {
  if (vBrightness <= 0.002) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float disc = 1.0 - smoothstep(0.9, 1.0, r);
  float glow = exp(-r * r * 3.0) * 0.5;

  float shade = 1.0;
  if (vHasDisc > 0.5) {
    if (vIsMoon > 0.5) {
      float x = dot(p, uMoonAxis);
      float y = dot(p, vec2(-uMoonAxis.y, uMoonAxis.x));
      float edge = sqrt(max(0.0, 1.0 - y * y));
      float s = 2.0 * uMoonPhase - 1.0;
      shade = mix(0.05, 1.0, smoothstep(-0.04, 0.04, x + s * edge));
    } else {
      shade = mix(1.0, 0.72, r * r);
    }
  }

  float a = (disc * shade + glow * 0.55) * vBrightness;
  gl_FragColor = vec4(uBodyColor * shade, a);
}
`;

const BODY_COLORS: Record<string, [number, number, number]> = {
  sun: [1.0, 0.93, 0.78],
  moon: [0.92, 0.92, 0.9],
  mercury: [0.78, 0.74, 0.7],
  venus: [0.98, 0.88, 0.62],
  mars: [0.93, 0.45, 0.28],
  jupiter: [0.88, 0.78, 0.62],
  saturn: [0.93, 0.83, 0.58],
  uranus: [0.62, 0.86, 0.92],
  neptune: [0.42, 0.58, 0.96],
};

interface BodySprite {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  data: Float32Array;
  interleaved: THREE.InterleavedBuffer;
}

/** Sun, Moon and the eight planets as shaded discs, or glowing dots when their disc is tiny. */
export class SolarSystemLayer {
  private readonly sprites: BodySprite[] = [];

  constructor(scene: THREE.Scene, uniforms: SkyUniforms, bodyIds: string[]) {
    for (const id of bodyIds) {
      const data = new Float32Array(STRIDE);
      const interleaved = new THREE.InterleavedBuffer(data, STRIDE);
      interleaved.setUsage(THREE.DynamicDrawUsage);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('aPosMag', new THREE.InterleavedBufferAttribute(interleaved, 4, 0));
      geometry.setAttribute('aBody', new THREE.InterleavedBufferAttribute(interleaved, 4, 4));
      // No `position` attribute here, so three cannot infer the vertex count on its own.
      geometry.setDrawRange(0, 1);
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
      const color = BODY_COLORS[id] ?? [1, 1, 1];
      const material = new THREE.ShaderMaterial({
        uniforms: {
          ...(uniforms as unknown as { [uniform: string]: THREE.IUniform }),
          uScreenHeight: { value: 480 },
          uMoonPhase: { value: 0.5 },
          uMoonAxis: { value: new THREE.Vector2(1, 0) },
          uBodyColor: { value: new THREE.Vector3(color[0], color[1], color[2]) },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = 20;
      points.matrixAutoUpdate = false;
      scene.add(points);
      this.sprites.push({ points, material, data, interleaved });
    }
  }

  update(
    context: SkyContext,
    camera: SkyCamera,
    screenHeight: number,
    aspect: number,
    visible: boolean,
  ): void {
    const moonIndex = context.bodies.findIndex((b) => b.source.id === 'moon');
    let moonAxis: [number, number] = [1, 0];
    if (moonIndex >= 0) {
      const moon = context.bodies[moonIndex]!;
      const sun = context.bodies[0]!;
      const projScale = projectionScale(camera.fovDeg);
      const skyToView = camera.skyToView();
      const moonNdc = projectDirection(moon.directionEqj, skyToView, projScale, aspect);
      const sunNdc = projectDirection(sun.directionEqj, skyToView, projScale, aspect);
      const dx = sunNdc.x - moonNdc.x;
      const dy = sunNdc.y - moonNdc.y;
      const len = Math.hypot(dx, dy) || 1;
      moonAxis = [dx / len, dy / len];
    }
    context.bodies.forEach((body, i) => {
      const sprite = this.sprites[i];
      if (!sprite) return;
      sprite.points.visible = visible;
      if (!visible) return;
      sprite.data[0] = body.directionEqj[0];
      sprite.data[1] = body.directionEqj[1];
      sprite.data[2] = body.directionEqj[2];
      sprite.data[3] = body.magnitude;
      sprite.data[4] = body.apparentRadiusDeg;
      sprite.data[5] = body.source.id === 'moon' ? 1 : 0;
      sprite.interleaved.needsUpdate = true;
      sprite.material.uniforms.uScreenHeight!.value = screenHeight;
      sprite.material.uniforms.uMoonPhase!.value = context.moonPhase;
      (sprite.material.uniforms.uMoonAxis!.value as THREE.Vector2).set(moonAxis[0], moonAxis[1]);
    });
  }

  dispose(scene: THREE.Scene): void {
    for (const sprite of this.sprites) {
      scene.remove(sprite.points);
      sprite.points.geometry.dispose();
      sprite.material.dispose();
    }
    this.sprites.length = 0;
  }
}
