import { wrap360 } from '../astro/vector';

/** 06h 45m 09s */
export function formatRa(raHours: number): string {
  const total = (((raHours % 24) + 24) % 24) * 3600;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}h ${pad(m)}m ${s.toFixed(1).padStart(4, '0')}s`;
}

/** +41° 16′ 09″ */
export function formatDec(decDeg: number): string {
  const sign = decDeg < 0 ? '−' : '+';
  const total = Math.abs(decDeg) * 3600;
  const d = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.round(total % 60);
  return `${sign}${pad(d)}° ${pad(m)}′ ${pad(s)}″`;
}

/** 123.4° 东 */
export function formatAzimuth(azDeg: number): string {
  const names: Record<string, string> = {
    N: '北',
    NE: '东北',
    E: '东',
    SE: '东南',
    S: '南',
    SW: '西南',
    W: '西',
    NW: '西北',
  };
  const keys = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(wrap360(azDeg) / 45) % 8;
  return `${wrap360(azDeg).toFixed(1)}° ${names[keys[index]!]}`;
}

export function formatAltitude(altDeg: number): string {
  return `${altDeg >= 0 ? '+' : ''}${altDeg.toFixed(1)}°`;
}

export function formatMagnitude(mag: number): string {
  if (!Number.isFinite(mag)) return '—';
  return mag.toFixed(2);
}

export function formatDegrees(deg: number, digits = 2): string {
  return `${deg.toFixed(digits)}°`;
}

export function formatFov(fovDeg: number): string {
  if (fovDeg >= 1) return `${fovDeg.toFixed(1)}°`;
  return `${(fovDeg * 60).toFixed(0)}′`;
}

/** Local civil time at the observer's longitude, approximated as UTC + longitude/15. */
export function formatLocalTime(date: Date, longitudeDeg: number): string {
  const offsetHours = longitudeDeg / 15;
  const local = new Date(date.getTime() + offsetHours * 3600000);
  const hhmm = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  const ymd = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  return `${ymd} ${hhmm}`;
}

export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatHoursFromNow(date: Date | null, now: Date): string {
  if (!date) return '—';
  const hours = (date.getTime() - now.getTime()) / 3600000;
  const sign = hours < 0 ? '−' : '+';
  const abs = Math.abs(hours);
  return `${sign}${Math.floor(abs)}h ${pad(Math.round((abs % 1) * 60))}m`;
}

export function formatDistance(distanceAu: number): string {
  if (!Number.isFinite(distanceAu) || distanceAu <= 0) return '—';
  const km = distanceAu * 149597870.7;
  if (distanceAu < 0.01) return `${Math.round(km).toLocaleString('zh-CN')} km`;
  return `${distanceAu.toFixed(4)} AU`;
}

export function formatParallaxDistance(parallaxMas: number): string {
  if (!Number.isFinite(parallaxMas) || parallaxMas <= 0.01) return '—';
  const pc = 1000 / parallaxMas;
  return pc < 1000
    ? `${pc.toFixed(1)} pc (${(pc * 3.26156).toFixed(1)} 光年)`
    : `${(pc / 1000).toFixed(2)} kpc`;
}

export function formatProperMotion(pmRa: number, pmDec: number): string {
  if (!Number.isFinite(pmRa) && !Number.isFinite(pmDec)) return '—';
  return `${(pmRa / 1000).toFixed(3)}″/年, ${(pmDec / 1000).toFixed(3)}″/年`;
}

function pad(value: number): string {
  return String(Math.trunc(value)).padStart(2, '0');
}
