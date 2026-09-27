export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const ARCSEC = DEG / 3600;
export const MAS = ARCSEC / 1000;
export const JD_J2000 = 2451545.0;
export const JD_J2016 = 2457388.5;
export const MS_PER_DAY = 86400000;
export const AU_KM = 149597870.7;
/** Speed of light in AU per day. */
export const C_AU_PER_DAY = 173.1446326846693;

export type Vec3 = [number, number, number];

/** 3x3 matrix stored row-major: m[row * 3 + col]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const vec3 = (x: number, y: number, z: number): Vec3 => [x, y, z];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len === 0) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function identity(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

/** v' = m · v with m row-major. */
export function mulMatVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Result applies b first, then a: (a·b)·v = a·(b·v). */
export function mulMat(a: Mat3, b: Mat3): Mat3 {
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = a;
  const [b00, b01, b02, b10, b11, b12, b20, b21, b22] = b;
  return [
    a00 * b00 + a01 * b10 + a02 * b20,
    a00 * b01 + a01 * b11 + a02 * b21,
    a00 * b02 + a01 * b12 + a02 * b22,
    a10 * b00 + a11 * b10 + a12 * b20,
    a10 * b01 + a11 * b11 + a12 * b21,
    a10 * b02 + a11 * b12 + a12 * b22,
    a20 * b00 + a21 * b10 + a22 * b20,
    a20 * b01 + a21 * b11 + a22 * b21,
    a20 * b02 + a21 * b12 + a22 * b22,
  ];
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Rotation about the x axis, right-handed, angle in radians. */
export function rotX(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

export function rotY(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

export function rotZ(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Column-major copy, the layout WebGL and THREE.Matrix3.fromArray expect. */
export function toColumnMajor(m: Mat3): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Wrap degrees into [0, 360). */
export function wrap360(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Wrap radians into [0, 2π). */
export function wrap2Pi(rad: number): number {
  const r = rad % (2 * Math.PI);
  return r < 0 ? r + 2 * Math.PI : r;
}

export function wrapPi(rad: number): number {
  const r = (rad + Math.PI) % (2 * Math.PI);
  return (r < 0 ? r + 2 * Math.PI : r) - Math.PI;
}

/** Great-circle distance in degrees between two unit vectors. */
export function angularSeparationDeg(a: Vec3, b: Vec3): number {
  return Math.atan2(length(cross(a, b)), dot(a, b)) * RAD;
}

/** Spherical (ra, dec) in degrees to a unit vector; x → ra 0 / dec 0, z → north pole. */
export function sphericalToUnit(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cosDec = Math.cos(dec);
  return [Math.cos(ra) * cosDec, Math.sin(ra) * cosDec, Math.sin(dec)];
}

export function unitToSpherical(v: Vec3): { raDeg: number; decDeg: number } {
  return {
    raDeg: wrap360(Math.atan2(v[1], v[0]) * RAD),
    decDeg: Math.asin(clamp(v[2], -1, 1)) * RAD,
  };
}
