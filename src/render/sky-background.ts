import * as THREE from 'three';

import { SKY_GLSL } from './projection';
import type { SkyUniforms } from './sky-uniforms';

const VERTEX_SHADER = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
${SKY_GLSL}
varying vec2 vNdc;
uniform vec3 uSkyColor;
uniform float uSkyIntensity;
uniform vec3 uSunDirSky;
uniform vec3 uMoonDirSky;
uniform vec3 uMoonGlowColor;
uniform float uDaylight;
uniform float uTwilightGlow;
uniform float uMoonGlow;
uniform float uHorizonEnabled;

void main() {
  vec3 sky = skyDirFromNdc(vNdc);
  float alt = altitudeDeg(sky);

  vec3 night = mix(vec3(0.055, 0.075, 0.125), vec3(0.028, 0.042, 0.085), smoothstep(0.0, 40.0, alt));
  vec3 day = mix(vec3(0.62, 0.74, 0.92), vec3(0.17, 0.37, 0.74), smoothstep(0.0, 55.0, alt));
  vec3 color = mix(night, day, uDaylight);

  float sunCos = clamp(dot(sky, uSunDirSky), -1.0, 1.0);
  float twilightAmount = uTwilightGlow * pow(max(sunCos, 0.0), 2.0);
  color = mix(color, vec3(0.62, 0.28, 0.13) * (1.0 - 0.5 * smoothstep(0.0, 30.0, alt)), twilightAmount);
  color = mix(color, uSkyColor, 0.25 * uDaylight);

  float moonCos = clamp(dot(sky, uMoonDirSky), -1.0, 1.0);
  float separation = degrees(acos(moonCos));
  float glow = uMoonGlow * (1.8 / (1.0 + pow(separation / 24.0, 1.7)));
  color += uMoonGlowColor * glow * 0.05;

  color *= uSkyIntensity;

  if (uHorizonEnabled > 0.5 && alt < 0.0) {
    vec3 ground = mix(vec3(0.006, 0.008, 0.011), vec3(0.002, 0.003, 0.004), smoothstep(0.0, -25.0, alt));
    ground += vec3(0.10, 0.12, 0.15) * uDaylight * (1.0 - smoothstep(0.0, -20.0, alt));
    color = ground;
  }

  if (uHorizonEnabled > 0.5) {
    float line = exp(-pow(alt / 0.30, 2.0));
    color += vec3(0.30, 0.40, 0.55) * line * (0.28 + 0.35 * uDaylight);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * Full-screen sky: atmospheric gradient, twilight and moonlight glow, the ground below the
 * horizon and the horizon line. Drawn first, opaquely, with no depth interaction.
 */
export class SkyBackground {
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, uniforms: SkyUniforms) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    const material = new THREE.ShaderMaterial({
      uniforms: uniforms as unknown as { [uniform: string]: THREE.IUniform },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
