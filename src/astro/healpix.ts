import { DEG, RAD, clamp, dot, length, wrap2Pi, type Vec3 } from './vector';

/**
 * Nested-order HEALPix.
 *
 * Derived from the HEALPix projection (Gorski et al. 2005) rather than transcribed from
 * any one implementation. In map units the sphere becomes the rectangle x ∈ [0, 4),
 * y ∈ [-2, 2] with total area 12, so each of the 12 base faces is a unit-area diamond:
 *
 *   equatorial, |z| ≤ 2/3:  x = (2/π)·φ,                   y = (3/2)·z
 *   polar,      |z| > 2/3:  x = (2/π)·φ + (1-c)·(1/2 - t),  y = sign(z)·(2-c)
 *                           c = sqrt(3·(1-|z|)),  t = frac((2/π)·φ)
 *
 * In the skewed coordinates P = x - y/2 + 1/2 and Q = x + y/2 + 1/2 every base face becomes
 * an axis-aligned unit square, which is what makes nested quadtree indexing trivial: faces
 * 4..7 lie on the diagonal (floor P = floor Q), faces 0..3 above it, faces 8..11 below.
 */

const FACE_COUNT = 12;

export function nsideForOrder(order: number): number {
  return 1 << order;
}

export function pixelCount(order: number): number {
  const n = nsideForOrder(order);
  return FACE_COUNT * n * n;
}

/** Approximate pixel side length in degrees, used for tile LOD decisions. */
export function pixelSideDeg(order: number): number {
  return Math.sqrt((4 * Math.PI) / pixelCount(order)) * RAD;
}

/** Sphere → HEALPix projection plane. z = cos(theta), phi in radians. */
export function project(z: number, phi: number): { x: number; y: number } {
  const p = wrap2Pi(phi);
  const xEquatorial = (2 / Math.PI) * p;
  const absZ = Math.abs(z);
  if (absZ <= 2 / 3) return { x: xEquatorial, y: 1.5 * z };
  const c = Math.sqrt(3 * (1 - absZ));
  const t = xEquatorial - Math.floor(xEquatorial);
  const x = (((xEquatorial + (1 - c) * (0.5 - t)) % 4) + 4) % 4;
  return { x, y: z > 0 ? 2 - c : -2 + c };
}

/** HEALPix projection plane → (z = cos theta, phi in radians). */
export function unproject(x: number, y: number): { z: number; phi: number } {
  const xWrapped = ((x % 4) + 4) % 4;
  const absY = Math.abs(y);
  if (absY <= 1) return { z: y / 1.5, phi: xWrapped * (Math.PI / 2) };
  const c = 2 - absY;
  const z = Math.sign(y) * (1 - (c * c) / 3);
  if (c <= 0) return { z, phi: xWrapped * (Math.PI / 2) };
  const shifted = xWrapped - 0.5 * (1 - c);
  const j = Math.floor(shifted);
  const t = clamp((shifted - j) / c, 0, 1);
  const xEquatorial = (((j + t) % 4) + 4) % 4;
  return { z, phi: xEquatorial * (Math.PI / 2) };
}

function spreadBits(v: number): number {
  let r = v & 0xffff;
  r = (r | (r << 8)) & 0x00ff00ff;
  r = (r | (r << 4)) & 0x0f0f0f0f;
  r = (r | (r << 2)) & 0x33333333;
  return (r | (r << 1)) & 0x55555555;
}

function compressBits(v: number): number {
  let r = v & 0x55555555;
  r = (r | (r >> 1)) & 0x33333333;
  r = (r | (r >> 2)) & 0x0f0f0f0f;
  r = (r | (r >> 4)) & 0x00ff00ff;
  return (r | (r >> 8)) & 0x0000ffff;
}

function faceAndCell(
  x: number,
  y: number,
  nside: number,
): { face: number; ix: number; iy: number } {
  const jp = Math.floor(nside * (x - 0.5 * y) + 0.5 * nside);
  const jm = Math.floor(nside * (x + 0.5 * y) + 0.5 * nside);
  const i = Math.floor(jp / nside);
  const j = Math.floor(jm / nside);
  const diff = i - j;
  let face: number;
  if (diff === 0) face = (i % 4) + 4;
  else if (diff === -1) face = ((i % 4) + 4) % 4;
  else face = (((j % 4) + 4) % 4) + 8;
  return { face, ix: jm - j * nside, iy: nside - 1 - (jp - i * nside) };
}

/** Base-face square origin in (P, Q) space, so face centres land on the right diamond. */
function faceCellOrigin(face: number): { i: number; j: number } {
  if (face >= 4 && face <= 7) return { i: face - 4, j: face - 4 };
  if (face < 4) return { i: face, j: face + 1 };
  return { i: face - 7, j: face - 8 };
}

/** (theta, phi) in radians → nested pixel index; theta is colatitude from the +z pole. */
export function angToPixNest(order: number, theta: number, phi: number): number {
  const nside = nsideForOrder(order);
  const { x, y } = project(Math.cos(theta), phi);
  const { face, ix, iy } = faceAndCell(x, y, nside);
  return face * nside * nside + ((spreadBits(ix) << 1) | spreadBits(iy));
}

/**
 * Nested pixel index → (theta, phi). `offsetU` / `offsetV` are in [0, 1] within the cell,
 * so (0.5, 0.5) is the centre and the extremes are corners.
 */
export function pixToAngNest(
  order: number,
  pixel: number,
  offsetU = 0.5,
  offsetV = 0.5,
): { theta: number; phi: number } {
  const nside = nsideForOrder(order);
  const perFace = nside * nside;
  const face = Math.floor(pixel / perFace);
  const inner = pixel - face * perFace;
  const ix = compressBits(inner >> 1);
  const iy = compressBits(inner & 0x55555555);
  const jpCell = nside - 1 - iy;
  const { i, j } = faceCellOrigin(face);
  const p = i + (jpCell + offsetU) / nside;
  const q = j + (ix + offsetV) / nside;
  const { z, phi } = unproject((p + q) / 2 - 0.5, q - p);
  return { theta: Math.acos(clamp(z, -1, 1)), phi: wrap2Pi(phi) };
}

export function vecToPixNest(order: number, v: Vec3): number {
  const norm = length(v) || 1;
  return angToPixNest(order, Math.acos(clamp(v[2] / norm, -1, 1)), Math.atan2(v[1], v[0]));
}

export function pixToVecNest(order: number, pixel: number): Vec3 {
  const { theta, phi } = pixToAngNest(order, pixel);
  const s = Math.sin(theta);
  return [s * Math.cos(phi), s * Math.sin(phi), Math.cos(theta)];
}

/** The same sky position expressed at a different order. */
export function nestToOrder(orderFrom: number, pixel: number, orderTo: number): number {
  if (orderFrom === orderTo) return pixel;
  return orderTo < orderFrom
    ? pixel >> (2 * (orderFrom - orderTo))
    : pixel << (2 * (orderTo - orderFrom));
}

let boundsCache: { order: number; centers: Float64Array; radii: Float32Array } | null = null;

/**
 * All pixel centres plus their circumradius at `order`, cached. Callers answer
 * "which tiles touch this field of view" with one dot product per tile.
 */
export function tileBounds(order: number): { centers: Float64Array; radii: Float32Array } {
  if (boundsCache?.order === order)
    return { centers: boundsCache.centers, radii: boundsCache.radii };
  const count = pixelCount(order);
  const centers = new Float64Array(count * 3);
  const radii = new Float32Array(count);
  for (let pixel = 0; pixel < count; pixel++) {
    const center = pixToVecNest(order, pixel);
    centers[pixel * 3] = center[0];
    centers[pixel * 3 + 1] = center[1];
    centers[pixel * 3 + 2] = center[2];
    let minCos = 1;
    for (const u of [0, 1]) {
      for (const v of [0, 1]) {
        minCos = Math.min(minCos, dot(center, pixToVecNestAt(order, pixel, u, v)));
      }
    }
    radii[pixel] = Math.acos(clamp(minCos, -1, 1)) * RAD;
  }
  boundsCache = { order, centers, radii };
  return { centers: boundsCache.centers, radii: boundsCache.radii };
}

function pixToVecNestAt(order: number, pixel: number, offsetU: number, offsetV: number): Vec3 {
  const { theta, phi } = pixToAngNest(order, pixel, offsetU, offsetV);
  const s = Math.sin(theta);
  return [s * Math.cos(phi), s * Math.sin(phi), Math.cos(theta)];
}

/** Nested pixels at `order` whose area intersects a disc of `radiusDeg` around `dir`. */
export function queryDiscNest(order: number, dir: Vec3, radiusDeg: number): number[] {
  const { centers, radii } = tileBounds(order);
  const count = pixelCount(order);
  const norm = length(dir) || 1;
  const axis: Vec3 = [dir[0] / norm, dir[1] / norm, dir[2] / norm];
  const hits: number[] = [];
  for (let pixel = 0; pixel < count; pixel++) {
    const cosDistance =
      centers[pixel * 3]! * axis[0] +
      centers[pixel * 3 + 1]! * axis[1] +
      centers[pixel * 3 + 2]! * axis[2];
    const cosLimit = Math.cos(clamp(radiusDeg + radii[pixel]!, 0, 180) * DEG);
    if (cosDistance >= cosLimit) hits.push(pixel);
  }
  return hits;
}
