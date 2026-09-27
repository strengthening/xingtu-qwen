import * as THREE from 'three';

import type { SkyContext } from '../astro/sky-context';
import type { ConstellationItem } from '../data/manifest';
import { SkyLines, segmentsFromPolylines } from './sky-lines';
import type { SkyUniforms } from './sky-uniforms';

export interface ConstellationLabel {
  text: string;
  subText?: string;
  ra: number;
  dec: number;
}

/** Western 88 constellations plus the Chinese 三垣二十八宿 asterisms, drawn as line figures. */
export class ConstellationLines {
  readonly western: SkyLines;
  readonly chinese: SkyLines;
  readonly westernLabels: ConstellationLabel[] = [];
  readonly chineseLabels: ConstellationLabel[] = [];

  constructor(
    scene: THREE.Scene,
    uniforms: SkyUniforms,
    western: ConstellationItem[],
    chinese: ConstellationItem[],
  ) {
    this.western = new SkyLines(scene, uniforms, segmentsFromPolylines(western.flatMap((c) => c.lines)), {
      color: 0x4a6fa8,
      opacity: 0.55,
      clipHorizon: true,
      renderOrder: 5,
    });
    this.chinese = new SkyLines(scene, uniforms, segmentsFromPolylines(chinese.flatMap((c) => c.lines)), {
      color: 0xa86f4a,
      opacity: 0.5,
      clipHorizon: true,
      renderOrder: 5,
    });
    for (const item of western) {
      this.westernLabels.push(label(item.nameZh ?? item.name, item.name, item.label));
    }
    for (const item of chinese) {
      this.chineseLabels.push(label(item.name, item.pinyin || item.nameEn || undefined, item.label));
    }
  }

  update(context: SkyContext, showLines: boolean, showChinese: boolean): void {
    const sky = new THREE.Matrix3().set(...context.skyMatrix);
    this.western.setDirToSky(sky);
    this.chinese.setDirToSky(sky);
    this.western.setVisible(showLines);
    this.chinese.setVisible(showLines && showChinese);
  }

  dispose(scene: THREE.Scene): void {
    this.western.dispose(scene);
    this.chinese.dispose(scene);
  }
}

function label(text: string, subText: string | undefined, anchor: [number, number]): ConstellationLabel {
  const sub = subText && subText !== text ? subText : undefined;
  return {
    text,
    ...(sub ? { subText: sub } : {}),
    ra: anchor[0],
    dec: anchor[1],
  };
}
