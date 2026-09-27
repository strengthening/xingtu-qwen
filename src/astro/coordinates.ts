import * as Astronomy from 'astronomy-engine';

import { gastHours } from './time';
import { DEG, RAD, clamp, mulMatVec, wrap360, type Vec3 } from './vector';
import { equatorialToHorizontalMatrix, toMat3, type ObserverSite } from './frames';

export interface EquatorialCoords {
  /** Right ascension in hours [0, 24). */
  raHours: number;
  /** Declination in degrees [-90, 90]. */
  decDeg: number;
}

export interface HorizontalCoords {
  /** Azimuth in degrees, measured eastward from north [0, 360). */
  azDeg: number;
  /** Altitude in degrees [-90, 90]; negative means below the horizon. */
  altDeg: number;
}

/**
 * Horizontal unit vector in astronomy-engine's HOR frame: x = north, y = west, z = zenith.
 * Azimuth is measured eastward from north, so west is the negative y direction.
 */
export function horizontalToUnit(azDeg: number, altDeg: number): Vec3 {
  const az = azDeg * DEG;
  const alt = altDeg * DEG;
  const cosAlt = Math.cos(alt);
  return [Math.cos(az) * cosAlt, -Math.sin(az) * cosAlt, Math.sin(alt)];
}

export function unitToHorizontal(v: Vec3): HorizontalCoords {
  return {
    azDeg: wrap360(Math.atan2(-v[1], v[0]) * RAD),
    altDeg: Math.asin(clamp(v[2], -1, 1)) * RAD,
  };
}

export function equatorialToUnit(raHours: number, decDeg: number): Vec3 {
  const ra = raHours * 15 * DEG;
  const dec = decDeg * DEG;
  const cosDec = Math.cos(dec);
  return [Math.cos(ra) * cosDec, Math.sin(ra) * cosDec, Math.sin(dec)];
}

export function unitToEquatorial(v: Vec3): EquatorialCoords {
  return {
    raHours: wrap360(Math.atan2(v[1], v[0]) * RAD) / 15,
    decDeg: Math.asin(clamp(v[2], -1, 1)) * RAD,
  };
}

/** J2000 equatorial unit vector → horizontal coordinates of date, via the sky matrix. */
export function equatorialToHorizontal(
  date: Date,
  site: ObserverSite,
  raHours: number,
  decDeg: number,
): HorizontalCoords {
  const equToHor = equatorialToHorizontalMatrix(date, site);
  const equToOfDate = toMat3(Astronomy.Rotation_EQJ_EQD(date));
  const hor = mulMatVec(equToHor, mulMatVec(equToOfDate, equatorialToUnit(raHours, decDeg)));
  return unitToHorizontal(hor);
}

/** Hour angle in hours [0, 24), west positive. */
export function hourAngleHours(date: Date, site: ObserverSite, raHours: number): number {
  return wrap360((gastHours(date) + site.longitudeDeg / 15 - raHours) * 15) / 15;
}

/** Kasten & Young (1989) relative air mass; Infinity at or below the horizon. */
export function airMass(altDeg: number): number {
  if (altDeg <= 0) return Infinity;
  const z = 90 - altDeg;
  return 1 / (Math.cos(z * DEG) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

export function localSiderealTimeHours(date: Date, site: ObserverSite): number {
  return wrap360(gastHours(date) * 15 + site.longitudeDeg) / 15;
}
