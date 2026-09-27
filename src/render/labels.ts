import type { SkyContext } from '../astro/sky-context';
import type { Vec3 } from '../astro/vector';
import { projectDirection, projectionScale } from './projection';
import type { SkyCamera } from './sky-camera';

export type LabelKind = 'star' | 'constellation' | 'chinese' | 'body' | 'cardinal';

export interface LabelItem {
  text: string;
  subText?: string | undefined;
  /** Direction in J2000 equatorial coordinates. */
  dirEqj: Vec3;
  kind: LabelKind;
  /** Lower is more important; used to cap the number of labels on screen. */
  priority: number;
}

const MAX_LABELS = 140;

/** HTML overlay for star names, constellation names, planet names and compass points. */
export class LabelLayer {
  private readonly pool: HTMLElement[] = [];
  private used = 0;

  constructor(private readonly container: HTMLElement) {}

  update(items: LabelItem[], context: SkyContext, camera: SkyCamera, width: number, height: number): void {
    const skyToView = camera.skyToView();
    const projScale = projectionScale(camera.fovDeg);
    const aspect = width / Math.max(height, 1);
    const sorted = [...items].sort((a, b) => a.priority - b.priority).slice(0, MAX_LABELS);

    this.used = 0;
    for (const item of sorted) {
      const sky = [
        context.skyMatrix[0] * item.dirEqj[0] +
          context.skyMatrix[1] * item.dirEqj[1] +
          context.skyMatrix[2] * item.dirEqj[2],
        context.skyMatrix[3] * item.dirEqj[0] +
          context.skyMatrix[4] * item.dirEqj[1] +
          context.skyMatrix[5] * item.dirEqj[2],
        context.skyMatrix[6] * item.dirEqj[0] +
          context.skyMatrix[7] * item.dirEqj[1] +
          context.skyMatrix[8] * item.dirEqj[2],
      ] as Vec3;
      const projected = projectDirection(sky, skyToView, projScale, aspect);
      if (projected.behind || Math.abs(projected.x) > 1.02 || Math.abs(projected.y) > 1.02) continue;
      const el = this.element();
      el.className = `sky-label is-${item.kind}`;
      const text = item.subText ? `${item.text} ${item.subText}` : item.text;
      if (el.textContent !== text) el.textContent = text;
      el.style.left = `${((projected.x + 1) / 2) * width}px`;
      el.style.top = `${((1 - projected.y) / 2) * height}px`;
      el.style.display = 'block';
    }
    for (let i = this.used; i < this.pool.length; i++) {
      this.pool[i]!.style.display = 'none';
    }
  }

  private element(): HTMLElement {
    let el = this.pool[this.used];
    if (!el) {
      el = document.createElement('div');
      this.container.append(el);
      this.pool.push(el);
    }
    this.used++;
    return el;
  }

  clear(): void {
    for (const el of this.pool) el.style.display = 'none';
    this.used = 0;
  }
}
