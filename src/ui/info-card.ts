import type { BodyDetail } from '../astro/bodies';
import type { SkyContext } from '../astro/sky-context';
import { airMass, equatorialToHorizontal, unitToEquatorial } from '../astro/coordinates';
import { mulMatVec } from '../astro/vector';
import type { StarName } from '../data/manifest';
import type { PickedStar } from '../render/star-field';
import {
  formatAltitude,
  formatAzimuth,
  formatDec,
  formatDistance,
  formatHoursFromNow,
  formatMagnitude,
  formatParallaxDistance,
  formatProperMotion,
  formatRa,
} from './format';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Point-and-read card for a star or a solar-system body. */
export class InfoCard {
  private readonly root: HTMLElement;

  constructor(private readonly onClose: () => void) {
    this.root = el('div', 'info-card');
    this.root.hidden = true;
  }

  mount(container: HTMLElement): void {
    container.append(this.root);
  }

  hide(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  showStar(star: PickedStar, name: StarName | undefined, context: SkyContext, gaiaId: bigint | null): void {
    const ofDate = unitToEquatorial(mulMatVec(context.skyMatrix, star.directionEqj));
    const horizontal = equatorialToHorizontal(
      context.date,
      context.site,
      ofDate.raHours,
      ofDate.decDeg,
    );
    const rows: Array<[string, string]> = [
      ['视星等 (G)', formatMagnitude(star.magnitude)],
      ['色指数 B−V', Number.isFinite(star.bv) && star.bv > -900 ? star.bv.toFixed(3) : '—'],
      ['赤经 / 赤纬', `${formatRa(ofDate.raHours)} / ${formatDec(ofDate.decDeg)}`],
      ['方位 / 高度', `${formatAzimuth(horizontal.azDeg)} / ${formatAltitude(horizontal.altDeg)}`],
      ['大气质量', Number.isFinite(airMass(horizontal.altDeg)) ? airMass(horizontal.altDeg).toFixed(2) : '地平线下'],
      ['距离', formatParallaxDistance(star.parallaxMas)],
      ['自行', formatProperMotion(star.pmRa, star.pmDec)],
    ];
    if (gaiaId !== null) rows.push(['Gaia DR3', gaiaId.toString()]);
    if (name?.hip) rows.push(['HIP', String(name.hip)]);
    if (name?.con) rows.push(['星座', name.con]);
    this.render(name?.nameZh ?? name?.name ?? '未命名恒星', name?.nameZh ? name.name : name?.desig, rows);
  }

  showBody(body: BodyDetail, context: SkyContext): void {
    const rows: Array<[string, string]> = [
      ['视星等', formatMagnitude(body.magnitude)],
      ['相位', body.phaseFraction === null ? '—' : `${(body.phaseFraction * 100).toFixed(0)}%`],
      ['视半径', body.apparentRadiusDeg >= 0.01 ? `${(body.apparentRadiusDeg * 60).toFixed(1)}′` : `${(body.apparentRadiusDeg * 3600).toFixed(1)}″`],
      ['赤经 / 赤纬', `${formatRa(body.raHours)} / ${formatDec(body.decDeg)}`],
      ['方位 / 高度', `${formatAzimuth(body.azDeg)} / ${formatAltitude(body.altDeg)}`],
      ['距离', formatDistance(body.distanceAu)],
      ['距太阳角', `${body.sunSeparationDeg.toFixed(1)}°`],
      ['升起', formatHoursFromNow(body.rise, context.date)],
      ['落下', formatHoursFromNow(body.set, context.date)],
    ];
    this.render(body.source.nameZh, body.source.nameEn, rows);
  }

  private render(title: string, subtitle: string | undefined, rows: Array<[string, string]>): void {
    this.root.replaceChildren();
    this.root.hidden = false;
    const close = el('button', 'close');
    close.textContent = '×';
    close.title = '关闭';
    close.addEventListener('click', () => this.onClose());
    const h3 = el('h3');
    h3.textContent = title;
    this.root.append(close, h3);
    if (subtitle) {
      const sub = el('p', 'subtitle');
      sub.textContent = subtitle;
      this.root.append(sub);
    }
    const dl = el('dl');
    for (const [key, value] of rows) {
      const dt = el('dt');
      dt.textContent = key;
      const dd = el('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    }
    this.root.append(dl);
  }
}
