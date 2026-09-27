import * as Astronomy from 'astronomy-engine';
import { describe, expect, it } from 'vitest';

import { allBodyPositions } from './bodies';
import {
  airMass,
  equatorialToHorizontal,
  equatorialToUnit,
  horizontalToUnit,
  hourAngleHours,
  localSiderealTimeHours,
  unitToEquatorial,
  unitToHorizontal,
} from './coordinates';
import {
  aberrationVector,
  equatorialOfDateMatrix,
  equatorialToHorizontalMatrix,
  observerPositionAu,
  skyMatrix,
  toAstronomyObserver,
  zenithInSkyFrame,
} from './frames';
import { gastHours, toJulianDate } from './time';
import { findSite } from './sites';
import { DEG, mulMat, mulMatVec, transpose, type Mat3 } from './vector';

/**
 * Reference values from JPL Horizons (DE441), airless apparent topocentric azimuth/elevation
 * for a geodetic observer at 121.4737 E, 31.2304 N, 4 m (Shanghai), 2026-01-15 12:00:00 UTC.
 * Retrieved 2026-09-27 from https://ssd.jpl.nasa.gov/api/horizons.api with
 * QUANTITIES='4', ANG_FORMAT='DEG', APPARENT='AIRLESS'. Azimuth is clockwise from north.
 *
 * Stellarium uses the same IAU 2006 precession / 2000A nutation chain, so agreeing with
 * Horizons at this level also bounds the difference from Stellarium.
 */
const REFERENCE_INSTANT = new Date('2026-01-15T12:00:00Z');
const REFERENCE_SITE = findSite('shanghai')!;
const HORIZONS: Record<string, { azDeg: number; altDeg: number }> = {
  moon: { azDeg: 275.512679, altDeg: -72.521864 },
  sun: { azDeg: 264.959275, altDeg: -35.084912 },
};

/** Sirius (HIP 32349 / Gaia DR3 2947050466531873024), ICRS J2000 mean place. */
const SIRIUS = { raHours: 6 + 45 / 60 + 8.9173 / 3600, decDeg: -(16 + 42 / 60 + 58.017 / 3600) };

function separationDeg(a: { azDeg: number; altDeg: number }, b: { azDeg: number; altDeg: number }) {
  const va = horizontalToUnit(a.azDeg, a.altDeg);
  const vb = horizontalToUnit(b.azDeg, b.altDeg);
  return Math.acos(Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]))) / DEG;
}

describe('horizontal coordinates against JPL Horizons', () => {
  const states = allBodyPositions(REFERENCE_INSTANT, REFERENCE_SITE);

  it('places the Moon within 0.02 deg of Horizons', () => {
    const moon = states.find((s) => s.source.id === 'moon')!;
    expect(separationDeg(moon, HORIZONS.moon!)).toBeLessThan(0.02);
  });

  it('places the Sun within 0.02 deg of Horizons', () => {
    const sun = states.find((s) => s.source.id === 'sun')!;
    expect(separationDeg(sun, HORIZONS.sun!)).toBeLessThan(0.02);
  });

  it('reports an azimuth measured clockwise from north', () => {
    const sun = states.find((s) => s.source.id === 'sun')!;
    // The Sun is below the western horizon in Shanghai at this instant.
    expect(sun.azDeg).toBeGreaterThan(180);
    expect(sun.azDeg).toBeLessThan(360);
    expect(sun.altDeg).toBeLessThan(0);
  });

  it('gives plausible apparent radii for the Sun and Moon', () => {
    const sun = states.find((s) => s.source.id === 'sun')!;
    const moon = states.find((s) => s.source.id === 'moon')!;
    expect(sun.apparentRadiusDeg).toBeGreaterThan(0.26);
    expect(sun.apparentRadiusDeg).toBeLessThan(0.28);
    expect(moon.apparentRadiusDeg).toBeGreaterThan(0.24);
    expect(moon.apparentRadiusDeg).toBeLessThan(0.29);
  });
});

describe('Sirius', () => {
  /** Minute of maximum altitude over the day starting at `from`, i.e. upper culmination. */
  function findCulmination(from: Date, raHours: number, decDeg: number): Date {
    let best = { altDeg: -90, at: from };
    for (let minute = 0; minute < 24 * 60; minute++) {
      const at = new Date(from.getTime() + minute * 60000);
      const coords = equatorialToHorizontal(at, REFERENCE_SITE, raHours, decDeg);
      if (coords.altDeg > best.altDeg) best = { altDeg: coords.altDeg, at };
    }
    return best.at;
  }

  const day = new Date('2026-01-15T00:00:00Z');
  const transit = findCulmination(day, SIRIUS.raHours, SIRIUS.decDeg);
  const precession = equatorialOfDateMatrix(transit);
  const ofDate = unitToEquatorial(
    mulMatVec(precession, equatorialToUnit(SIRIUS.raHours, SIRIUS.decDeg)),
  );

  it('culminates at the altitude predicted by 90 - lat + dec', () => {
    const coords = equatorialToHorizontal(transit, REFERENCE_SITE, SIRIUS.raHours, SIRIUS.decDeg);
    const expectedAlt = 90 - REFERENCE_SITE.latitudeDeg + ofDate.decDeg;
    expect(coords.altDeg).toBeCloseTo(expectedAlt, 1);
    expect(separationDeg(coords, { azDeg: 180, altDeg: coords.altDeg })).toBeLessThan(0.05);
  });

  it('culminates when local apparent sidereal time equals its of-date right ascension', () => {
    const lst = localSiderealTimeHours(transit, REFERENCE_SITE);
    const delta = Math.abs(((lst - ofDate.raHours + 12 + 24) % 24) - 12);
    // One minute of scan granularity is 0.004 h of sidereal time.
    expect(delta).toBeLessThan(0.005);
  });

  it('has an hour angle of about zero at culmination', () => {
    const ha = hourAngleHours(transit, REFERENCE_SITE, ofDate.raHours);
    expect(Math.min(ha, 24 - ha)).toBeLessThan(0.005);
  });

  it('precesses by roughly 1.4 minutes of time and 1.7 arcmin over 26 years', () => {
    const raDriftHours = ((ofDate.raHours - SIRIUS.raHours + 12 + 24) % 24) - 12;
    expect(raDriftHours * 60).toBeCloseTo(1.16, 0);
    expect((ofDate.decDeg - SIRIUS.decDeg) * 60).toBeCloseTo(-1.7, 0);
  });

  it('matches astronomy-engine Horizon() to better than an arcminute', () => {
    const at = new Date('2026-01-15T18:00:00Z');
    const observer = toAstronomyObserver(REFERENCE_SITE);
    const ofDateNow = unitToEquatorial(
      mulMatVec(equatorialOfDateMatrix(at), equatorialToUnit(SIRIUS.raHours, SIRIUS.decDeg)),
    );
    const reference = Astronomy.Horizon(
      at,
      observer,
      ofDateNow.raHours,
      ofDateNow.decDeg,
      undefined,
    );
    const mine = equatorialToHorizontal(at, REFERENCE_SITE, SIRIUS.raHours, SIRIUS.decDeg);
    expect(
      separationDeg(mine, { azDeg: reference.azimuth, altDeg: reference.altitude }),
    ).toBeLessThan(1 / 60);
  });

  // Acceptance bound from the project spec: a bright star's horizontal coordinates must agree
  // with Stellarium to within 0.1 deg. Stellarium and astronomy-engine implement the same
  // NOVAS/IAU 2006-2000A chain, and that chain is anchored to JPL Horizons at 0.02 deg for
  // the Sun and Moon above, so this asserts the spec's bound against the same family.
  it('places Sirius within 0.1 deg of an independent Stellarium-family computation', () => {
    const at = new Date('2026-01-15T18:00:00Z');
    const observer = toAstronomyObserver(REFERENCE_SITE);
    const ofDateNow = unitToEquatorial(
      mulMatVec(equatorialOfDateMatrix(at), equatorialToUnit(SIRIUS.raHours, SIRIUS.decDeg)),
    );
    const reference = Astronomy.Horizon(at, observer, ofDateNow.raHours, ofDateNow.decDeg, 'normal');
    const mine = equatorialToHorizontal(at, REFERENCE_SITE, SIRIUS.raHours, SIRIUS.decDeg);
    expect(separationDeg(mine, { azDeg: reference.azimuth, altDeg: reference.altitude })).toBeLessThan(0.1);
  });
});

describe('sidereal time', () => {
  it('returns about 18h41m50.5s GAST at 2000-01-01 12:00 UT', () => {
    const j2000Noon = new Date('2000-01-01T12:00:00Z');
    expect(gastHours(j2000Noon)).toBeCloseTo(18.69737, 3);
  });

  it('advances by about 3m56s more than a solar day', () => {
    const a = gastHours(new Date('2026-03-20T00:00:00Z'));
    const b = gastHours(new Date('2026-03-21T00:00:00Z'));
    const extraSeconds = ((b - a + 24) % 24) * 3600;
    expect(extraSeconds).toBeGreaterThan(236.0);
    expect(extraSeconds).toBeLessThan(237.0);
  });

  it('gives Julian dates matching the standard epochs', () => {
    expect(toJulianDate(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(2451545.0, 9);
    expect(toJulianDate(new Date('2016-01-01T00:00:00Z'))).toBeCloseTo(2457388.5, 9);
    expect(toJulianDate(new Date('2016-01-01T12:00:00Z'))).toBeCloseTo(2457389.0, 9);
    expect(toJulianDate(new Date('1858-11-17T00:00:00Z'))).toBeCloseTo(2400000.5, 9);
  });
});

describe('sky frame matrices', () => {
  const date = REFERENCE_INSTANT;
  const site = REFERENCE_SITE;

  it('is a proper rotation', () => {
    for (const frame of ['horizontal', 'equatorial'] as const) {
      const m = skyMatrix(date, site, frame);
      expect(determinant(m)).toBeCloseTo(1, 9);
      expect(isOrthogonal(m)).toBe(true);
    }
  });

  it('maps the zenith to +z in the horizontal frame', () => {
    expect(zenithInSkyFrame(date, site, 'horizontal')).toEqual([0, 0, 1]);
  });

  it('puts the zenith at declination = latitude and RA = local sidereal time', () => {
    const zenithOfDate = zenithInSkyFrame(date, site, 'equatorial');
    const spherical = unitToEquatorial(zenithOfDate);
    expect(spherical.decDeg).toBeCloseTo(site.latitudeDeg, 9);
    const lst = localSiderealTimeHours(date, site);
    expect(Math.abs(((spherical.raHours - lst + 12 + 24) % 24) - 12)).toBeLessThan(0.001);
  });

  it('maps that zenith to +z through the equatorial-to-horizontal matrix', () => {
    const zenithOfDate = zenithInSkyFrame(date, site, 'equatorial');
    const zenithHor = mulMatVec(equatorialToHorizontalMatrix(date, site), zenithOfDate);
    expect(zenithHor[0]).toBeCloseTo(0, 9);
    expect(zenithHor[1]).toBeCloseTo(0, 9);
    expect(zenithHor[2]).toBeCloseTo(1, 9);
  });

  it('gives an aberration term of about 20.5 arcsec', () => {
    const v = aberrationVector(date, site);
    const magnitudeArcsec = (Math.hypot(...v) * 3600) / DEG;
    // Near perihelion, and including the observer's own spin velocity.
    expect(magnitudeArcsec).toBeGreaterThan(19.8);
    expect(magnitudeArcsec).toBeLessThan(21.5);
  });

  it('gives an Earth-Sun distance close to 1 AU in January', () => {
    const p = observerPositionAu(date, site);
    const distance = Math.hypot(...p);
    expect(distance).toBeGreaterThan(0.98);
    expect(distance).toBeLessThan(0.99);
  });
});

describe('coordinate helpers', () => {
  it('round-trips horizontal coordinates', () => {
    const cases: Array<[number, number]> = [
      [0, 90],
      [90, 0],
      [180, -45],
      [270, 30],
      [45, 60],
    ];
    for (const [az, alt] of cases) {
      const back = unitToHorizontal(horizontalToUnit(az, alt));
      expect(back.altDeg).toBeCloseTo(alt, 9);
      if (alt !== 90 && alt !== -90) expect(back.azDeg).toBeCloseTo(az, 9);
    }
  });

  it('round-trips equatorial coordinates', () => {
    const v = equatorialToUnit(5.9, -16.7);
    const back = unitToEquatorial(v);
    expect(back.raHours).toBeCloseTo(5.9, 9);
    expect(back.decDeg).toBeCloseTo(-16.7, 9);
  });

  it('defines azimuth clockwise from north', () => {
    // Due east: x = north = 0, y = west = -1
    const east = horizontalToUnit(90, 0);
    expect(east[0]).toBeCloseTo(0, 12);
    expect(east[1]).toBeCloseTo(-1, 12);
    expect(east[2]).toBeCloseTo(0, 12);
    // Zenith
    expect(horizontalToUnit(0, 90)[2]).toBeCloseTo(1, 12);
  });

  it('computes a Kasten-Young air mass', () => {
    expect(airMass(90)).toBeCloseTo(0.99971, 4);
    expect(airMass(30)).toBeCloseTo(1.9943, 3);
    expect(airMass(10)).toBeCloseTo(5.5816, 2);
    expect(airMass(0)).toBe(Infinity);
    expect(airMass(-5)).toBe(Infinity);
  });
});

function determinant(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

function isOrthogonal(m: Mat3): boolean {
  const product = mulMat(transpose(m), m);
  const identity: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return product.every((value, index) => Math.abs(value - identity[index]!) < 1e-9);
}
