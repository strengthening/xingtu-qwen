import * as THREE from 'three';

import { sphericalToUnit } from '../astro/vector';
import { SKY_GLSL } from './projection';
import type { SkyUniforms } from './sky-uniforms';

const VERTEX_SHADER = /* glsl */ `
${SKY_GLSL}
attribute vec3 aDir;
uniform mat3 uDirToSky;
uniform float uClipHorizon;
varying float vFade;

void main() {
  vec3 sky = uDirToSky * aDir;
  float alt = altitudeDeg(sky);
  vec3 view = uSkyToView * sky;
  float w = 1.0 + view.z;
  if (w < 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vFade = 0.0;
    return;
  }
  vFade = uClipHorizon > 0.5 ? smoothstep(-0.8, 0.4, alt) : 1.0;
  gl_Position = projectViewDir(view);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;

void main() {
  float a = uOpacity * vFade;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/**
 * Great-circle polylines on the celestial sphere: coordinate grids and constellation figures.
 * Vertices are unit directions in whatever frame `dirToSky` maps into the active sky frame.
 */
export class SkyLines {
  readonly object: THREE.LineSegments;

  private readonly material: THREE.ShaderMaterial;
  private readonly dirToSky: THREE.IUniform<THREE.Matrix3>;

  constructor(
    scene: THREE.Scene,
    uniforms: SkyUniforms,
    segments: Float32Array,
    options: {
      color: THREE.ColorRepresentation;
      opacity: number;
      clipHorizon: boolean;
      renderOrder: number;
    },
  ) {
    this.dirToSky = { value: new THREE.Matrix3() };
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...(uniforms as unknown as { [uniform: string]: THREE.IUniform }),
        uDirToSky: this.dirToSky,
        uColor: { value: new THREE.Color(options.color) },
        uOpacity: { value: options.opacity },
        uClipHorizon: { value: options.clipHorizon ? 1 : 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('aDir', new THREE.BufferAttribute(segments, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
    this.object = new THREE.LineSegments(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = options.renderOrder;
    this.object.matrixAutoUpdate = false;
    scene.add(this.object);
  }

  setDirToSky(matrix: THREE.Matrix3): void {
    this.dirToSky.value.copy(matrix);
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.object);
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

/** Build a line-segment buffer from a list of polylines of (ra, dec) pairs in degrees. */
export function segmentsFromPolylines(polylines: number[][][]): Float32Array {
  const points: number[] = [];
  for (const line of polylines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [raA, decA] = line[i]!;
      const [raB, decB] = line[i + 1]!;
      points.push(...sphericalToUnit(raA!, decA!), ...sphericalToUnit(raB!, decB!));
    }
  }
  return Float32Array.from(points);
}
