import type { AppState } from './store';
import { sphericalToUnit, unitToSpherical, type Vec3 } from '../astro/vector';

/**
 * View + time + observer encoded in the query string so a sky can be shared by URL.
 * The look direction is stored in J2000 equatorial coordinates, which makes it independent
 * of the observer and of the mount, so the same link reproduces the same patch of sky.
 */
export function encodeState(state: AppState, viewDirEqj: Vec3): string {
  const spherical = unitToSpherical(viewDirEqj);
  const params = new URLSearchParams();
  params.set('t', state.time.toISOString().replace(/\.\d+Z$/, 'Z'));
  params.set('site', state.siteId);
  if (state.siteId === 'custom') {
    params.set('lat', state.latitudeDeg.toFixed(4));
    params.set('lon', state.longitudeDeg.toFixed(4));
    params.set('ele', String(Math.round(state.elevationM)));
  }
  params.set('ra', spherical.raDeg.toFixed(4));
  params.set('dec', spherical.decDeg.toFixed(4));
  params.set('fov', state.fovDeg.toFixed(2));
  params.set('frame', state.frame);
  params.set('den', String(Math.round(state.atmosphereDensity * 100)));
  params.set('tg', encodeToggles(state));
  return params.toString();
}

export interface UrlState {
  patch: Partial<AppState>;
  viewDirEqj: Vec3 | null;
}

export function decodeState(search: string): UrlState | null {
  const params = new URLSearchParams(search);
  if (![...params.keys()].length) return null;
  const patch: Partial<AppState> = {};
  let viewDirEqj: Vec3 | null = null;

  // Number(null) is 0, so every parameter must be presence-checked before parsing.
  const num = (key: string): number | null => {
    const raw = params.get(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const time = params.get('t');
  if (time) {
    const date = new Date(time);
    if (!Number.isNaN(date.getTime())) patch.time = date;
  }
  const site = params.get('site');
  if (site) patch.siteId = site;
  const lat = num('lat');
  const lon = num('lon');
  if (lat !== null && lon !== null) {
    patch.siteId = 'custom';
    patch.latitudeDeg = lat;
    patch.longitudeDeg = lon;
    const ele = num('ele');
    if (ele !== null) patch.elevationM = ele;
  }
  const ra = num('ra');
  const dec = num('dec');
  if (ra !== null && dec !== null) {
    viewDirEqj = sphericalToUnit(((ra % 360) + 360) % 360, Math.max(-90, Math.min(90, dec)));
  }
  const fov = num('fov');
  if (fov !== null) patch.fovDeg = Math.max(0.4, Math.min(160, fov));
  const frame = params.get('frame');
  if (frame === 'equatorial' || frame === 'horizontal') patch.frame = frame;
  const den = num('den');
  if (den !== null) patch.atmosphereDensity = Math.max(0, Math.min(100, den)) / 100;
  const toggles = params.get('tg');
  if (toggles) patch.toggles = decodeToggles(toggles);
  return { patch, viewDirEqj };
}

const TOGGLE_KEYS = [
  'equatorialGrid',
  'horizontalGrid',
  'constellations',
  'constellationLabels',
  'starLabels',
  'milkyWay',
  'horizon',
  'cardinalPoints',
  'solarSystem',
] as const;

function encodeToggles(state: AppState): string {
  let bits = 0;
  TOGGLE_KEYS.forEach((key, index) => {
    if (state.toggles[key]) bits |= 1 << index;
  });
  return bits.toString(36);
}

function decodeToggles(value: string): AppState['toggles'] {
  const bits = Number.parseInt(value, 36);
  const base: AppState['toggles'] = {
    equatorialGrid: false,
    horizontalGrid: false,
    constellations: true,
    constellationLabels: false,
    starLabels: true,
    milkyWay: true,
    horizon: true,
    cardinalPoints: true,
    solarSystem: true,
  };
  if (!Number.isFinite(bits)) return base;
  TOGGLE_KEYS.forEach((key, index) => {
    base[key] = (bits & (1 << index)) !== 0;
  });
  return base;
}
