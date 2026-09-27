import { DEG, clamp, type Vec3 } from './vector';

/**
 * A deliberately simple, tunable atmosphere model: enough physics to make the sky behave
 * (extinction near the horizon, twilight colours, moonlight washing out faint stars) while
 * staying cheap enough to evaluate once per frame on the CPU and once per pixel on the GPU.
 */

/** Pristine dark-sky zenith brightness, mag/arcsec². */
export const DARK_SKY_MAG = 21.8;

/** Extinction in magnitudes per unit airmass at sea level, per RGB channel. */
export const SEA_LEVEL_EXTINCTION: [number, number, number] = [0.28, 0.2, 0.15];

/** Scale height of the atmosphere in metres, for the elevation dependence of extinction. */
const SCALE_HEIGHT_M = 8000;

export interface SkyInputs {
  /** Sun altitude in degrees. */
  sunAltDeg: number;
  /** Sun direction in the horizontal frame (x = north, y = west, z = zenith). */
  sunDirHor: Vec3;
  moonAltDeg: number;
  moonDirHor: Vec3;
  /** Illuminated fraction of the lunar disc, 0..1. */
  moonPhase: number;
  /** Observer elevation in metres. */
  elevationM: number;
  /** Extra sky brightness from light pollution, in mag/arcsec² subtracted from the dark value. */
  lightPollutionMag?: number;
  /** Atmosphere strength from the UI slider, 0..1. */
  density: number;
}

export interface AtmosphereModel {
  density: number;
  /** Extinction in magnitudes per unit airmass, per RGB channel, already scaled by density. */
  extinctionPerAirmass: [number, number, number];
  /** 0 = astronomical night, 1 = full daylight. */
  daylight: number;
  /** Zenith sky brightness in mag/arcsec² after twilight, moonlight and light pollution. */
  zenithBrightness: number;
  /** Magnitudes added to every star to emulate contrast loss against a bright sky. */
  starDimming: number;
  skyColor: [number, number, number];
  skyIntensity: number;
  moonGlowColor: [number, number, number];
  moonGlowIntensity: number;
  sunDirHor: Vec3;
  moonDirHor: Vec3;
  /** Horizon glow strength at twilight, 0..1. */
  twilightGlow: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function magToFlux(mag: number): number {
  return Math.pow(10, -0.4 * mag);
}

function fluxToMag(flux: number): number {
  return flux <= 0 ? Infinity : -2.5 * Math.log10(flux);
}

/**
 * Zenith sky brightness in mag/arcsec². Contributions from darkness, light pollution,
 * twilight/daylight and moonlight are summed as fluxes, then converted back.
 */
export function zenithBrightnessMag(inputs: SkyInputs): number {
  const { sunAltDeg, moonAltDeg, moonPhase, lightPollutionMag = 0 } = inputs;

  const base = DARK_SKY_MAG - lightPollutionMag;

  // Empirical twilight curve: the sky reaches roughly -5 mag/arcsec² in broad daylight.
  const twilight = 27 * smoothstep(-18, 12, sunAltDeg);

  // Full Moon high in the sky brings a dark site down to about 18 mag/arcsec².
  const moon = moonAltDeg > 0 ? 3.8 * moonPhase * Math.sin(moonAltDeg * DEG) : 0;

  return fluxToMag(magToFlux(base - twilight) + magToFlux(base - moon) - magToFlux(base));
}

/** Extinction per airmass, thinned by elevation and scaled by the density slider. */
export function extinctionPerAirmass(inputs: SkyInputs): [number, number, number] {
  const pressure = Math.exp(-inputs.elevationM / SCALE_HEIGHT_M) * inputs.density;
  return SEA_LEVEL_EXTINCTION.map((k) => k * pressure) as [number, number, number];
}

/** Magnitudes of dimming applied to stars, from the loss of contrast against a bright sky. */
export function starDimmingMag(zenithMag: number, density: number): number {
  if (density <= 0) return 0;
  return clamp(0.9 * (DARK_SKY_MAG - zenithMag), 0, 14) * density;
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const NIGHT_SKY: [number, number, number] = [0.012, 0.02, 0.045];
const TWILIGHT_SKY: [number, number, number] = [0.42, 0.2, 0.16];
const DAY_SKY: [number, number, number] = [0.28, 0.47, 0.85];

export function computeAtmosphere(inputs: SkyInputs): AtmosphereModel {
  const density = clamp(inputs.density, 0, 1);
  const daylight = smoothstep(-18, 8, inputs.sunAltDeg);
  const twilightGlow =
    smoothstep(-14, -2, inputs.sunAltDeg) * (1 - smoothstep(-2, 8, inputs.sunAltDeg));
  const zenith = zenithBrightnessMag(inputs);

  const nightToTwilight = mix(NIGHT_SKY, TWILIGHT_SKY, twilightGlow);
  const skyColor = mix(nightToTwilight, DAY_SKY, daylight);

  const moonAbove = inputs.moonAltDeg > 0 ? Math.sin(inputs.moonAltDeg * DEG) : 0;
  const moonGlowIntensity = density * inputs.moonPhase * moonAbove * (1 - 0.7 * daylight);

  return {
    density,
    extinctionPerAirmass: extinctionPerAirmass(inputs),
    daylight,
    zenithBrightness: zenith,
    starDimming: starDimmingMag(zenith, density),
    skyColor,
    skyIntensity: clamp(density * (0.35 + 0.65 * daylight + 0.5 * twilightGlow), 0, 1),
    moonGlowColor: [0.55, 0.58, 0.66],
    moonGlowIntensity,
    sunDirHor: inputs.sunDirHor,
    moonDirHor: inputs.moonDirHor,
    twilightGlow,
  };
}

/**
 * Sky brightness in mag/arcsec² for an arbitrary viewing direction, used for the info card
 * and for choosing which magnitude bands are worth drawing. The GPU evaluates the same
 * angular terms per pixel.
 */
export function skyBrightnessAt(model: AtmosphereModel, viewDirHor: Vec3, altDeg: number): number {
  if (model.density <= 0) return Infinity;
  const zenithFlux = magToFlux(model.zenithBrightness);
  const horizonExtra = zenithFlux * 0.9 * (1 - smoothstep(0, 25, altDeg));
  const sunCos = clamp(
    viewDirHor[0] * model.sunDirHor[0] +
      viewDirHor[1] * model.sunDirHor[1] +
      viewDirHor[2] * model.sunDirHor[2],
    -1,
    1,
  );
  const moonCos = clamp(
    viewDirHor[0] * model.moonDirHor[0] +
      viewDirHor[1] * model.moonDirHor[1] +
      viewDirHor[2] * model.moonDirHor[2],
    -1,
    1,
  );
  const separation = Math.acos(moonCos) / DEG;
  const moonFlux =
    magToFlux(model.zenithBrightness) * model.moonGlowIntensity * (2 / (1 + separation / 25));
  const sunFlux = zenithFlux * model.daylight * Math.pow(Math.max(0, sunCos), 3) * 0.6;
  return fluxToMag(zenithFlux + horizonExtra + moonFlux + sunFlux);
}
