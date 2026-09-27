import type { SkyContext } from '../astro/sky-context';
import { MOON, SUN } from '../astro/bodies';
import { formatAltitude, formatAzimuth, formatFov, formatLocalTime, formatUtc } from './format';

export interface StatusExtras {
  siteName: string;
  fovDeg: number;
  starCount: number;
  loadingMessage: string | null;
}

/**
 * Bottom-left readout: where and when we are looking, plus what is above the horizon.
 * DOM writes are throttled by comparing against the previously rendered text.
 */
export class StatusBar {
  private readonly fields = new Map<string, HTMLElement>();
  private readonly root: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'status-bar';
    for (const key of ['site', 'time', 'lst', 'sun', 'moon', 'view', 'stars', 'loading']) {
      const row = document.createElement('div');
      row.className = 'status-row';
      const label = document.createElement('span');
      label.className = 'status-label';
      label.textContent = LABELS[key]!;
      const value = document.createElement('span');
      value.className = 'status-value';
      row.append(label, value);
      this.root.append(row);
      this.fields.set(key, value);
    }
    container.append(this.root);
  }

  update(context: SkyContext, extras: StatusExtras): void {
    const sun = context.bodies.find((b) => b.source.id === SUN.id)!;
    const moon = context.bodies.find((b) => b.source.id === MOON.id)!;

    this.write(
      'site',
      `${extras.siteName} · ${context.site.latitudeDeg.toFixed(2)}°, ${context.site.longitudeDeg.toFixed(2)}°`,
    );
    this.write(
      'time',
      `${formatLocalTime(context.date, context.site.longitudeDeg)} 当地 · ${formatUtc(context.date)}`,
    );
    this.write('lst', formatSidereal(context.lstHours));
    this.write('sun', `太阳 ${formatAltitude(sun.altDeg)} (${formatAzimuth(sun.azDeg)})`);
    this.write('moon', `月球 ${formatAltitude(moon.altDeg)} (${formatAzimuth(moon.azDeg)})`);
    this.write('view', `视场 ${formatFov(extras.fovDeg)}`);
    this.write('stars', `已加载 ${extras.starCount.toLocaleString('zh-CN')} 颗`);
    this.write('loading', extras.loadingMessage ?? '');
    this.root.classList.toggle('is-loading', extras.loadingMessage !== null);
  }

  private write(key: string, text: string): void {
    const node = this.fields.get(key)!;
    if (node.textContent !== text) node.textContent = text;
    node.parentElement!.classList.toggle('is-empty', text === '');
  }
}

const LABELS: Record<string, string> = {
  site: '地点',
  time: '时间',
  lst: '恒星时',
  sun: '太阳',
  moon: '月球',
  view: '视野',
  stars: '星表',
  loading: '状态',
};

function formatSidereal(hours: number): string {
  const total = hours * 3600;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}
