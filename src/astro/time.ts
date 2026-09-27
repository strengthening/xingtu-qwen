import * as Astronomy from 'astronomy-engine';

import { JD_J2000, MS_PER_DAY, wrap360 } from './vector';

export type TimeSource = Date | number;

export function toJulianDate(date: TimeSource): number {
  const ms = typeof date === 'number' ? date : date.getTime();
  return ms / MS_PER_DAY + 2440587.5;
}

export function fromJulianDate(jd: number): Date {
  return new Date((jd - 2440587.5) * MS_PER_DAY);
}

/** Days since J2000.0 in UT, the time argument astronomy-engine uses. */
export function daysSinceJ2000(date: TimeSource): number {
  return toJulianDate(date) - JD_J2000;
}

/** Julian centuries of TT since J2000.0. */
export function julianCenturiesTT(date: TimeSource): number {
  return Astronomy.MakeTime(date).tt / 36525;
}

/** Greenwich Apparent Sidereal Time, in hours [0, 24). */
export function gastHours(date: TimeSource): number {
  return Astronomy.SiderealTime(date);
}

/** Local Apparent Sidereal Time in hours [0, 24); longitude is east-positive in degrees. */
export function lastHours(date: TimeSource, longitudeDeg: number): number {
  return wrap360(gastHours(date) * 15 + longitudeDeg) / 15;
}

/** Difference between Terrestrial Time and UT1, in seconds, as modelled by astronomy-engine. */
export function deltaTSeconds(date: TimeSource): number {
  const time = Astronomy.MakeTime(date);
  return ((time.tt - time.ut) * MS_PER_DAY) / 1000;
}

export function formatIso(date: Date): string {
  return date.toISOString().replace('.000Z', 'Z');
}
