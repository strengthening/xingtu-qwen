import * as Astronomy from 'astronomy-engine';

import { equatorialToUnit, unitToHorizontal } from './coordinates';
import { skyMatrix, toAstronomyObserver, type ObserverSite } from './frames';
import { AU_KM, RAD, clamp, mulMatVec, normalize, type Mat3, type Vec3 } from './vector';

export interface SolarSystemBody {
  id: string;
  nameZh: string;
  nameEn: string;
  body: Astronomy.Body;
  /** Mean equatorial radius in km, used for the apparent disc size. */
  radiusKm: number;
}

export const SUN: SolarSystemBody = {
  id: 'sun',
  nameZh: '太阳',
  nameEn: 'Sun',
  body: Astronomy.Body.Sun,
  radiusKm: 695700,
};

export const MOON: SolarSystemBody = {
  id: 'moon',
  nameZh: '月球',
  nameEn: 'Moon',
  body: Astronomy.Body.Moon,
  radiusKm: 1737.4,
};

export const PLANETS: SolarSystemBody[] = [
  {
    id: 'mercury',
    nameZh: '水星',
    nameEn: 'Mercury',
    body: Astronomy.Body.Mercury,
    radiusKm: 2439.7,
  },
  { id: 'venus', nameZh: '金星', nameEn: 'Venus', body: Astronomy.Body.Venus, radiusKm: 6051.8 },
  { id: 'mars', nameZh: '火星', nameEn: 'Mars', body: Astronomy.Body.Mars, radiusKm: 3389.5 },
  {
    id: 'jupiter',
    nameZh: '木星',
    nameEn: 'Jupiter',
    body: Astronomy.Body.Jupiter,
    radiusKm: 69911,
  },
  { id: 'saturn', nameZh: '土星', nameEn: 'Saturn', body: Astronomy.Body.Saturn, radiusKm: 58232 },
  {
    id: 'uranus',
    nameZh: '天王星',
    nameEn: 'Uranus',
    body: Astronomy.Body.Uranus,
    radiusKm: 25362,
  },
  {
    id: 'neptune',
    nameZh: '海王星',
    nameEn: 'Neptune',
    body: Astronomy.Body.Neptune,
    radiusKm: 24622,
  },
];

export const ALL_BODIES: SolarSystemBody[] = [SUN, MOON, ...PLANETS];

/** Per-frame position only: cheap enough to recompute for all nine bodies every frame. */
export interface BodyPosition {
  source: SolarSystemBody;
  /** Apparent topocentric direction in J2000 equatorial coordinates, the star catalog's frame. */
  directionEqj: Vec3;
  distanceAu: number;
  raHours: number;
  decDeg: number;
  azDeg: number;
  altDeg: number;
  apparentRadiusDeg: number;
  magnitude: number;
  phaseFraction: number | null;
}

/** Everything the info card needs, including the expensive rise/set search. */
export interface BodyDetail extends BodyPosition {
  sunSeparationDeg: number;
  rise: Date | null;
  set: Date | null;
}

const photometryCache = new Map<string, { magnitude: number; phaseFraction: number | null }>();

/** Memoized photometry: apparent magnitudes drift over hours, not per frame. */
export function photometryCached(
  body: SolarSystemBody,
  date: Date,
  distanceAu: number,
): { magnitude: number; phaseFraction: number | null } {
  const key = `${body.id}@${Math.floor(date.getTime() / 600000)}`;
  const cached = photometryCache.get(key);
  if (cached) return cached;
  const value = photometry(body, date, distanceAu);
  if (photometryCache.size > 512) photometryCache.clear();
  photometryCache.set(key, value);
  return value;
}

/**
 * Apparent position of one body. astronomy-engine applies light-time, annual aberration and
 * (for the Moon) topocentric parallax, so the direction can go through the same sky matrix
 * as the star catalog.
 *
 * @param equToHor J2000 equatorial → horizontal matrix for this instant, see {@link skyMatrix}.
 */
export function bodyPosition(
  body: SolarSystemBody,
  date: Date,
  site: ObserverSite,
  equToHor: Mat3,
): BodyPosition {
  const equ = Astronomy.Equator(body.body, date, toAstronomyObserver(site), false, true);
  const directionEqj = normalize(equatorialToUnit(equ.ra, equ.dec));
  const distanceAu = Math.max(equ.dist, 1e-12);
  const horizontal = unitToHorizontal(mulMatVec(equToHor, directionEqj));
  const { magnitude, phaseFraction } = photometryCached(body, date, distanceAu);
  return {
    source: body,
    directionEqj,
    distanceAu,
    raHours: equ.ra,
    decDeg: equ.dec,
    azDeg: horizontal.azDeg,
    altDeg: horizontal.altDeg,
    apparentRadiusDeg: Math.asin(clamp(body.radiusKm / (distanceAu * AU_KM), -1, 1)) * RAD || 0,
    magnitude,
    phaseFraction,
  };
}

export function allBodyPositions(date: Date, site: ObserverSite): BodyPosition[] {
  const equToHor = skyMatrix(date, site, 'horizontal');
  return ALL_BODIES.map((body) => bodyPosition(body, date, site, equToHor));
}

export function findBody(id: string): SolarSystemBody | undefined {
  return ALL_BODIES.find((body) => body.id === id);
}

/** Visual magnitude and illuminated fraction; the Sun is scaled from its magnitude at 1 AU. */
export function photometry(
  body: SolarSystemBody,
  date: Date,
  distanceAu: number,
): {
  magnitude: number;
  phaseFraction: number | null;
} {
  if (body.body === Astronomy.Body.Sun) {
    return { magnitude: -26.74 - 5 * Math.log10(distanceAu), phaseFraction: null };
  }
  const illumination = Astronomy.Illumination(body.body, date);
  return {
    magnitude: illumination.mag,
    phaseFraction: Number.isFinite(illumination.phase_fraction)
      ? illumination.phase_fraction
      : null,
  };
}

/** Next rise and set after `date`, or null when the body never crosses the horizon. */
export function riseSet(
  body: SolarSystemBody,
  date: Date,
  site: ObserverSite,
  limitDays = 2,
): { rise: Date | null; set: Date | null } {
  const observer = toAstronomyObserver(site);
  const rise = Astronomy.SearchRiseSet(body.body, observer, +1, date, limitDays);
  const set = Astronomy.SearchRiseSet(body.body, observer, -1, date, limitDays);
  return { rise: rise ? rise.date : null, set: set ? set.date : null };
}

/** Full description for the info card. Deliberately not part of the per-frame path. */
export function describeBody(body: SolarSystemBody, date: Date, site: ObserverSite): BodyDetail {
  const equToHor = skyMatrix(date, site, 'horizontal');
  const position = bodyPosition(body, date, site, equToHor);
  const sun = Astronomy.Equator(Astronomy.Body.Sun, date, toAstronomyObserver(site), false, true);
  const sunDirection = equatorialToUnit(sun.ra, sun.dec);
  const sunSeparationDeg =
    Math.acos(
      clamp(
        sunDirection[0] * position.directionEqj[0] +
          sunDirection[1] * position.directionEqj[1] +
          sunDirection[2] * position.directionEqj[2],
        -1,
        1,
      ),
    ) * RAD;
  return { ...position, sunSeparationDeg, ...riseSet(body, date, site) };
}
