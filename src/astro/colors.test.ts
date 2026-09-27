import { describe, expect, it } from 'vitest';

import {
  bpRpToBv,
  bvToRgb,
  bvToTemperature,
  packRgb8,
  temperatureToRgb,
  unpackRgb8,
} from './colors';

describe('colour temperature', () => {
  const relative = (value: number, expected: number) => Math.abs(value - expected) / expected;

  it('gives the solar temperature for the solar colour index', () => {
    expect(relative(bvToTemperature(0.656), 5772)).toBeLessThan(0.01);
  });

  it('is monotonically decreasing in B-V', () => {
    let previous = bvToTemperature(-0.4);
    for (let bv = -0.35; bv <= 2.0; bv += 0.05) {
      const next = bvToTemperature(bv);
      expect(next).toBeLessThan(previous);
      previous = next;
    }
  });

  it('tracks the O to M sequence within a few percent', () => {
    // Ballesteros' fit is a rendering approximation: it saturates near 18000 K for the
    // hottest stars rather than reaching the true 30000-40000 K, which only affects hue.
    expect(bvToTemperature(-0.33)).toBeGreaterThan(15000); // O/B
    expect(relative(bvToTemperature(0.0), 9600)).toBeLessThan(0.08); // A0V
    expect(relative(bvToTemperature(0.82), 5400)).toBeLessThan(0.08); // G5V
    expect(relative(bvToTemperature(1.4), 4200)).toBeLessThan(0.08); // K5V
    expect(bvToTemperature(1.9)).toBeLessThan(3800); // M3V
  });
});

describe('Gaia BP-RP to B-V', () => {
  const anchors: Array<[number, number]> = [
    [-0.34, -0.33],
    [0.0, 0.0],
    [0.82, 0.656],
    [1.45, 1.15],
    [2.2, 1.52],
    [3.2, 1.9],
  ];

  it('reproduces the standard sequence to within 0.05 mag', () => {
    for (const [bpRp, bv] of anchors) {
      expect(Math.abs(bpRpToBv(bpRp) - bv)).toBeLessThan(0.05);
    }
  });

  it('clamps outside the calibrated range', () => {
    expect(bpRpToBv(-5)).toBe(bpRpToBv(-0.6));
    expect(bpRpToBv(20)).toBe(bpRpToBv(5.5));
  });
});

describe('blackbody RGB', () => {
  it('is white-hot in the middle of the range', () => {
    const [r, g, b] = temperatureToRgb(6500);
    expect(r).toBeGreaterThan(0.99);
    expect(g).toBeGreaterThan(0.95);
    expect(b).toBeGreaterThan(0.9);
  });

  it('goes blue for hot stars and red for cool ones', () => {
    const hot = bvToRgb(-0.3);
    const cool = bvToRgb(1.9);
    expect(hot[2]).toBeGreaterThan(hot[0]);
    expect(cool[0]).toBeGreaterThan(cool[2]);
  });

  it('never leaves [0, 1]', () => {
    for (let bv = -0.5; bv <= 3; bv += 0.05) {
      for (const c of bvToRgb(bv)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('falls back to white for a missing colour index', () => {
    expect(bvToRgb(Number.NaN)).toEqual([1, 1, 1]);
  });
});

describe('rgb packing', () => {
  it('round-trips', () => {
    for (const rgb of [
      [1, 1, 1],
      [0, 0, 0],
      [0.5, 0.25, 0.75],
    ] as Array<[number, number, number]>) {
      const back = unpackRgb8(packRgb8(rgb));
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(back[i]! - rgb[i]!)).toBeLessThan(1 / 255);
      }
    }
  });
});
