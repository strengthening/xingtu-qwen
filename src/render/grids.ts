import * as THREE from 'three';

import type { SkyContext } from '../astro/sky-context';
import { horizontalToEquatorialMatrix } from '../astro/frames';
import { SkyLines, segmentsFromPolylines } from './sky-lines';
import type { SkyUniforms } from './sky-uniforms';

function equatorialGridSegments(): Float32Array {
  const polylines: number[][][] = [];
  for (let hour = 0; hour < 24; hour += 2) {
    const ra = hour * 15;
    const line: number[][] = [];
    for (let dec = -90; dec <= 90; dec += 5) line.push([ra, dec]);
    polylines.push(line);
  }
  for (let dec = -75; dec <= 75; dec += 15) {
    const line: number[][] = [];
    for (let ra = 0; ra <= 360; ra += 5) line.push([ra, dec]);
    polylines.push(line);
  }
  return segmentsFromPolylines(polylines);
}

function horizontalGridSegments(): Float32Array {
  const polylines: number[][][] = [];
  for (let az = 0; az < 360; az += 15) {
    const line: number[][] = [];
    for (let alt = 0; alt <= 90; alt += 5) line.push([az, alt]);
    polylines.push(line);
  }
  for (let alt = 10; alt <= 80; alt += 10) {
    const line: number[][] = [];
    for (let az = 0; az <= 360; az += 5) line.push([az, alt]);
    polylines.push(line);
  }
  return segmentsFromPolylines(polylines);
}

export class Grids {
  readonly equatorial: SkyLines;
  readonly horizontal: SkyLines;

  constructor(scene: THREE.Scene, uniforms: SkyUniforms) {
    this.equatorial = new SkyLines(scene, uniforms, equatorialGridSegments(), {
      color: 0x3f6f4f,
      opacity: 0.5,
      clipHorizon: true,
      renderOrder: 4,
    });
    this.horizontal = new SkyLines(scene, uniforms, horizontalGridSegments(), {
      color: 0x6f5a3f,
      opacity: 0.45,
      clipHorizon: true,
      renderOrder: 4,
    });
  }

  update(context: SkyContext, showEquatorial: boolean, showHorizontal: boolean): void {
    this.equatorial.setVisible(showEquatorial);
    this.horizontal.setVisible(showHorizontal);
    if (!showEquatorial && !showHorizontal) return;
    const sky = new THREE.Matrix3().set(...context.skyMatrix);
    this.equatorial.setDirToSky(sky);
    if (context.frame === 'horizontal') {
      this.horizontal.setDirToSky(new THREE.Matrix3().set(1, 0, 0, 0, 1, 0, 0, 0, 1));
    } else {
      const horToEqu = horizontalToEquatorialMatrix(context.date, context.site);
      this.horizontal.setDirToSky(new THREE.Matrix3().set(...horToEqu));
    }
  }

  dispose(scene: THREE.Scene): void {
    this.equatorial.dispose(scene);
    this.horizontal.dispose(scene);
  }
}
