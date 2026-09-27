import * as Astronomy from 'astronomy-engine';

import { computeAtmosphere, type AtmosphereModel } from './atmosphere';
import { MOON, allBodyPositions, type BodyPosition } from './bodies';
import { localSiderealTimeHours } from './coordinates';
import {
  aberrationVector,
  observerPositionAu,
  skyMatrix,
  zenithInSkyFrame,
  type ObserverSite,
  type SkyFrame,
} from './frames';
import { daysSinceJ2000 } from './time';
import { mulMatVec, type Mat3, type Vec3 } from './vector';

/**
 * Everything the renderer and the UI need for one instant, computed once per frame.
 * Kept as plain data so the render layer never calls astronomy-engine directly.
 */
export interface SkyContext {
  date: Date;
  site: ObserverSite;
  frame: SkyFrame;
  /** J2000 equatorial → the frame the sky is drawn in. */
  skyMatrix: Mat3;
  /** Zenith expressed in the sky frame, so shaders can derive altitude for extinction. */
  zenithInSky: Vec3;
  /** Observer position relative to the Sun in AU, for stellar parallax. */
  earthPositionAu: Vec3;
  /** Observer velocity / c, for annual aberration. */
  aberration: Vec3;
  /** Days since J2000.0, the epoch of the star positions stored in the binary chunks. */
  daysSinceJ2000: number;
  lstHours: number;
  bodies: BodyPosition[];
  atmosphere: AtmosphereModel;
}

export interface SkyContextParams {
  date: Date;
  site: ObserverSite;
  frame: SkyFrame;
  atmosphereDensity: number;
  lightPollutionMag: number;
}

export function computeSkyContext(params: SkyContextParams): SkyContext {
  const { date, site, frame } = params;
  const equToHor = skyMatrix(date, site, 'horizontal');
  const bodies = allBodyPositions(date, site);
  const sun = bodies[0]!;
  const moon = bodies[1]!;
  const moonIllumination = Astronomy.Illumination(MOON.body, date);

  return {
    date,
    site,
    frame,
    skyMatrix: frame === 'horizontal' ? equToHor : skyMatrix(date, site, 'equatorial'),
    zenithInSky: zenithInSkyFrame(date, site, frame),
    earthPositionAu: observerPositionAu(date, site),
    aberration: aberrationVector(date, site),
    daysSinceJ2000: daysSinceJ2000(date),
    lstHours: localSiderealTimeHours(date, site),
    bodies,
    atmosphere: computeAtmosphere({
      sunAltDeg: sun.altDeg,
      sunDirHor: mulMatVec(equToHor, sun.directionEqj),
      moonAltDeg: moon.altDeg,
      moonDirHor: mulMatVec(equToHor, moon.directionEqj),
      moonPhase: clamp01(moonIllumination.phase_fraction),
      elevationM: site.elevationM,
      lightPollutionMag: params.lightPollutionMag,
      density: params.atmosphereDensity,
    }),
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
