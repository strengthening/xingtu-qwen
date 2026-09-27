import { describe, expect, it } from 'vitest';

import {
  angToPixNest,
  nestToOrder,
  pixToAngNest,
  pixToVecNest,
  pixelCount,
  pixelSideDeg,
  project,
  queryDiscNest,
  tileBounds,
  unproject,
  vecToPixNest,
} from './healpix';
import { DEG, RAD, type Vec3 } from './vector';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDirections(count: number, seed = 42): Vec3[] {
  const rand = mulberry32(seed);
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const z = 2 * rand() - 1;
    const phi = 2 * Math.PI * rand();
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    out.push([s * Math.cos(phi), s * Math.sin(phi), z]);
  }
  return out;
}

describe('healpix projection', () => {
  it('maps the equator onto y = 0 with x spanning [0, 4)', () => {
    expect(project(0, 0)).toEqual({ x: 0, y: 0 });
    expect(project(0, Math.PI / 2).x).toBeCloseTo(1, 12);
    expect(project(0, Math.PI).x).toBeCloseTo(2, 12);
    expect(project(0, (7 * Math.PI) / 4).x).toBeCloseTo(3.5, 12);
  });

  it('maps the band boundary |z| = 2/3 onto |y| = 1', () => {
    expect(project(2 / 3, 1.234).y).toBeCloseTo(1, 12);
    expect(project(-2 / 3, 1.234).y).toBeCloseTo(-1, 12);
  });

  it('maps both poles to the apexes of the four polar faces', () => {
    for (const quadrant of [0, 1, 2, 3]) {
      const phi = quadrant * (Math.PI / 2) + 0.3;
      expect(project(1, phi).y).toBeCloseTo(2, 12);
      expect(project(1, phi).x).toBeCloseTo(quadrant + 0.5, 9);
      expect(project(-1, phi).y).toBeCloseTo(-2, 12);
      expect(project(-1, phi).x).toBeCloseTo(quadrant + 0.5, 9);
    }
  });

  it('is continuous across the equatorial/polar boundary', () => {
    for (const phi of [0.1, 1.0, 2.5, 4.0, 5.9]) {
      const below = project(2 / 3 - 1e-9, phi);
      const above = project(2 / 3 + 1e-9, phi);
      expect(Math.abs(below.y - above.y)).toBeLessThan(1e-6);
      const wrapped = (a: number, b: number) => Math.min(Math.abs(a - b), 4 - Math.abs(a - b));
      expect(wrapped(below.x, above.x)).toBeLessThan(1e-6);
    }
  });

  it('round-trips through unproject', () => {
    for (const v of randomDirections(2000, 7)) {
      const z = v[2];
      const phi = Math.atan2(v[1], v[0]);
      const { x, y } = project(z, phi);
      const back = unproject(x, y);
      expect(back.z).toBeCloseTo(z, 9);
      const dPhi = Math.abs(((back.phi - phi + Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(Math.min(dPhi, 2 * Math.PI - dPhi)).toBeLessThan(1e-9);
    }
  });

  it('is equal-area: the projected Jacobian is 3/pi in both branches', () => {
    const shoelace = (pts: Array<{ x: number; y: number }>) => {
      let sum = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        sum += a.x * b.y - b.x * a.y;
      }
      return Math.abs(sum) / 2;
    };
    const jacobianAt = (z0: number, phi0: number) => {
      const dz = 1e-5;
      const dphi = 1e-5;
      const area = shoelace([
        project(z0 - dz, phi0 - dphi),
        project(z0 - dz, phi0 + dphi),
        project(z0 + dz, phi0 + dphi),
        project(z0 + dz, phi0 - dphi),
      ]);
      return area / (2 * dz * 2 * dphi);
    };
    expect(jacobianAt(0.0, 1.0)).toBeCloseTo(3 / Math.PI, 6);
    expect(jacobianAt(0.6, 2.0)).toBeCloseTo(3 / Math.PI, 6);
    expect(jacobianAt(0.9, 0.4)).toBeCloseTo(3 / Math.PI, 5);
    expect(jacobianAt(-0.95, 5.0)).toBeCloseTo(3 / Math.PI, 5);
  });
});

describe('healpix nested indexing', () => {
  it('has 12 base pixels whose centres sit on the expected diamonds', () => {
    expect(pixelCount(0)).toBe(12);
    const centres = Array.from({ length: 12 }, (_, p) => pixToAngNest(0, p));
    // faces 4..7: equatorial, centred at x = 0,1,2,3 → phi = 0, 90, 180, 270 deg
    for (let k = 0; k < 4; k++) {
      expect(centres[4 + k]!.theta).toBeCloseTo(Math.PI / 2, 12);
      expect(centres[4 + k]!.phi).toBeCloseTo((k * Math.PI) / 2, 12);
    }
    // faces 0..3: north, z = 2/3 at x = 0.5,1.5,2.5,3.5
    for (let k = 0; k < 4; k++) {
      expect(Math.cos(centres[k]!.theta)).toBeCloseTo(2 / 3, 12);
      expect(centres[k]!.phi).toBeCloseTo(((k + 0.5) * Math.PI) / 2, 12);
    }
    // faces 8..11: south, mirrored
    for (let k = 0; k < 4; k++) {
      expect(Math.cos(centres[8 + k]!.theta)).toBeCloseTo(-2 / 3, 12);
      expect(centres[8 + k]!.phi).toBeCloseTo(((k + 0.5) * Math.PI) / 2, 12);
    }
  });

  it('puts the north pole at the shared apex of the four northern faces', () => {
    for (let face = 0; face < 4; face++) {
      expect(pixToAngNest(0, face, 0, 1).theta).toBeCloseTo(0, 12);
    }
    for (let face = 8; face < 12; face++) {
      expect(pixToAngNest(0, face, 1, 0).theta).toBeCloseTo(Math.PI, 12);
    }
  });

  it('round-trips pixel → angle → pixel for every pixel up to order 5', () => {
    for (let order = 0; order <= 5; order++) {
      const count = pixelCount(order);
      for (let pixel = 0; pixel < count; pixel++) {
        const { theta, phi } = pixToAngNest(order, pixel);
        expect(angToPixNest(order, theta, phi), `order ${order} pixel ${pixel}`).toBe(pixel);
      }
    }
  });

  it('round-trips angle → pixel → angle to within a fraction of a pixel', () => {
    for (const order of [0, 2, 4]) {
      const pixelScale = pixelSideDeg(order) * DEG;
      for (const v of randomDirections(5000, order)) {
        const theta = Math.acos(v[2]);
        const phi = Math.atan2(v[1], v[0]);
        const pixel = angToPixNest(order, theta, phi);
        const center = pixToAngNest(order, pixel);
        const cosSeparation =
          Math.sin(theta) * Math.sin(center.theta) * Math.cos(phi - center.phi) +
          Math.cos(theta) * Math.cos(center.theta);
        expect(Math.acos(Math.min(1, Math.max(-1, cosSeparation)))).toBeLessThan(pixelScale);
      }
    }
  });

  it('keeps the interior of a cell inside that cell', () => {
    const order = 3;
    const count = pixelCount(order);
    for (const pixel of [0, 5, 63, 64, 100, 255, 300, 511, 700, count - 1]) {
      for (const u of [0.01, 0.5, 0.99]) {
        for (const v of [0.01, 0.5, 0.99]) {
          const { theta, phi } = pixToAngNest(order, pixel, u, v);
          expect(angToPixNest(order, theta, phi), `pixel ${pixel} at (${u}, ${v})`).toBe(pixel);
        }
      }
    }
  });

  it('is equal-area: a low-discrepancy lattice spreads evenly over pixels', () => {
    const order = 3;
    const count = pixelCount(order);
    const hits = new Uint32Array(count);
    const samples = count * 200;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < samples; i++) {
      const z = 1 - (2 * (i + 0.5)) / samples;
      const phi = (golden * i) % (2 * Math.PI);
      const s = Math.sqrt(Math.max(0, 1 - z * z));
      const pixel = vecToPixNest(order, [s * Math.cos(phi), s * Math.sin(phi), z]);
      hits[pixel] = (hits[pixel] ?? 0) + 1;
    }
    const expected = samples / count;
    let maxDeviation = 0;
    for (let pixel = 0; pixel < count; pixel++) {
      maxDeviation = Math.max(maxDeviation, Math.abs(hits[pixel]! - expected) / expected);
    }
    expect(maxDeviation).toBeLessThan(0.05);
  });

  it('never produces a face index outside 0..11', () => {
    for (const v of randomDirections(20000, 3)) {
      const pixel = vecToPixNest(4, v);
      expect(pixel).toBeGreaterThanOrEqual(0);
      expect(pixel).toBeLessThan(pixelCount(4));
    }
  });

  it('agrees across orders', () => {
    for (const v of randomDirections(3000, 5)) {
      const fine = vecToPixNest(5, v);
      const coarse = vecToPixNest(3, v);
      expect(nestToOrder(5, fine, 3)).toBe(coarse);
    }
  });

  it('converts unit vectors consistently with spherical coordinates', () => {
    const v: Vec3 = [0.2, 0.5, -0.84];
    const theta = Math.acos(v[2] / Math.hypot(...v));
    const phi = Math.atan2(v[1], v[0]);
    expect(vecToPixNest(4, v)).toBe(angToPixNest(4, theta, phi));
    const back = pixToVecNest(4, vecToPixNest(4, v));
    expect(Math.hypot(back[0], back[1], back[2])).toBeCloseTo(1, 12);
  });
});

describe('healpix tile bounds and disc queries', () => {
  it('reports pixel sizes that shrink by a factor of two per order', () => {
    expect(pixelSideDeg(1) / pixelSideDeg(2)).toBeCloseTo(2, 9);
    expect(pixelSideDeg(3)).toBeCloseTo(Math.sqrt((4 * 180 * 180) / (Math.PI * 768)), 9);
  });

  it('gives every pixel a circumradius of roughly one pixel side', () => {
    const order = 3;
    const { radii } = tileBounds(order);
    const side = pixelSideDeg(order);
    for (let pixel = 0; pixel < radii.length; pixel++) {
      expect(radii[pixel]!).toBeGreaterThan(side * 0.5);
      expect(radii[pixel]!).toBeLessThan(side * 1.3);
    }
  });

  it('finds exactly one pixel for a zero-radius disc on a pixel centre', () => {
    const order = 3;
    for (const pixel of [0, 17, 300, 767]) {
      const hits = queryDiscNest(order, pixToVecNest(order, pixel), 0);
      expect(hits).toEqual([pixel]);
    }
  });

  it('returns a contiguous patch that grows with radius', () => {
    const order = 4;
    const dir = pixToVecNest(order, 1000);
    const small = queryDiscNest(order, dir, 2).length;
    const medium = queryDiscNest(order, dir, 10).length;
    const large = queryDiscNest(order, dir, 45).length;
    expect(small).toBeGreaterThanOrEqual(1);
    expect(medium).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(medium);
    expect(queryDiscNest(order, dir, 180).length).toBe(pixelCount(order));
  });

  it('never misses a pixel whose centre is well inside the disc', () => {
    const order = 4;
    const dir = pixToVecNest(order, 500);
    const radius = 8;
    const hits = new Set(queryDiscNest(order, dir, radius));
    for (let pixel = 0; pixel < pixelCount(order); pixel++) {
      const center = pixToVecNest(order, pixel);
      const cosDistance = center[0] * dir[0] + center[1] * dir[1] + center[2] * dir[2];
      const distance = (Math.acos(Math.min(1, cosDistance)) * RAD) / DEG;
      if (distance < radius - pixelSideDeg(order)) {
        expect(hits.has(pixel), `pixel ${pixel} at ${distance} deg`).toBe(true);
      }
    }
  });
});
