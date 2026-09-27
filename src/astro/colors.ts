import { clamp } from './vector';

/** B-V → effective temperature (K), Ballesteros (2012); valid roughly for -0.4 < B-V < 2.0. */
export function bvToTemperature(bv: number): number {
  const b = clamp(bv, -0.4, 2.5);
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}

/**
 * Gaia (BP-RP) → Johnson B-V. Cubic least-squares fit over the dwarf sequence
 * (B0V, A0V, F0V, G2V/Sun, K0V, K5V, M0V, M3V, M5V and redder anchors); worst-case
 * residual ≈ 0.04 mag, far finer than a colour lookup for rendering needs.
 */
export function bpRpToBv(bpRp: number): number {
  const x = clamp(bpRp, -0.6, 5.5);
  return -0.00557 + 0.95331 * x - 0.14269 * x * x + 0.00999 * x * x * x;
}

function channelR(t: number): number {
  const k = t / 100;
  if (k <= 66) return 255;
  return clamp(329.7 * Math.pow(k - 60, -0.1332), 0, 255);
}

function channelG(t: number): number {
  const k = t / 100;
  if (k <= 0) return 0;
  if (k <= 66) return clamp(99.47 * Math.log(k) - 161.12, 0, 255);
  return clamp(288.12 * Math.pow(k - 60, -0.0755), 0, 255);
}

function channelB(t: number): number {
  const k = t / 100;
  if (k <= 19) return 0;
  if (k <= 66) return clamp(138.52 * Math.log(k - 10) - 305.04, 0, 255);
  return 255;
}

/** Blackbody colour from temperature (K), returned as sRGB-ish components in [0, 1]. */
export function temperatureToRgb(t: number): [number, number, number] {
  const k = clamp(t, 1000, 40000);
  return [channelR(k) / 255, channelG(k) / 255, channelB(k) / 255];
}

/** Colour index → RGB in [0, 1]. A non-finite B-V yields neutral white. */
export function bvToRgb(bv: number): [number, number, number] {
  if (!Number.isFinite(bv)) return [1, 1, 1];
  return temperatureToRgb(bvToTemperature(bv));
}

/** Pack an RGB triple into a 24-bit integer for the binary star chunks. */
export function packRgb8(rgb: [number, number, number]): number {
  const r = Math.round(clamp(rgb[0], 0, 1) * 255);
  const g = Math.round(clamp(rgb[1], 0, 1) * 255);
  const b = Math.round(clamp(rgb[2], 0, 1) * 255);
  return (r << 16) | (g << 8) | b;
}

export function unpackRgb8(packed: number): [number, number, number] {
  return [((packed >> 16) & 0xff) / 255, ((packed >> 8) & 0xff) / 255, (packed & 0xff) / 255];
}
