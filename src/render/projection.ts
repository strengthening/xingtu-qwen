import { DEG, clamp, type Mat3, type Vec3 } from '../astro/vector';

/**
 * Azimuthal stereographic projection, Stellarium's default: circles stay circles and shapes
 * near the edge of a wide field are not stretched the way a perspective projection stretches
 * them. Implemented in the vertex/fragment shaders; the CPU only supplies the scale.
 *
 * For a unit view direction v (camera looks along +z), θ = angle from the view axis and
 *   ndc = (1 / tan(fov/4)) · v.xy / (1 + v.z),   ndc.x divided by the aspect ratio.
 */

export function projectionScale(fovDeg: number): number {
  return 1 / Math.tan((clamp(fovDeg, 0.5, 179) * DEG) / 4);
}

/** GLSL shared by every sky material. */
export const SKY_GLSL = /* glsl */ `
uniform mat3 uEqjToSky;
uniform mat3 uSkyToView;
uniform vec3 uZenithInSky;
uniform float uProjScale;
uniform float uAspect;
uniform float uDaysSinceJ2000;
uniform vec3 uEarthPosAu;
uniform vec3 uAberration;

const float MAS_RAD = 4.84813681109536e-9;

vec3 correctStarPosition(vec3 position, vec4 astro) {
  vec3 p = position;
  vec3 east = cross(vec3(0.0, 0.0, 1.0), p);
  float eastLength = length(east);
  east = eastLength > 1e-8 ? east / eastLength : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(p, east);
  float years = uDaysSinceJ2000 / 365.25;
  p += (east * astro.x + north * astro.y) * (years * MAS_RAD);
  p -= uEarthPosAu * (astro.z * MAS_RAD);
  return normalize(normalize(p) + uAberration);
}

float altitudeDeg(vec3 skyDir) {
  return degrees(asin(clamp(dot(skyDir, uZenithInSky), -1.0, 1.0)));
}

vec4 projectViewDir(vec3 viewDir) {
  float w = max(1.0 + viewDir.z, 0.02);
  vec2 ndc = uProjScale * viewDir.xy / w;
  return vec4(ndc.x / uAspect, ndc.y, 0.0, 1.0);
}

vec3 viewDirFromNdc(vec2 ndc) {
  vec2 r = vec2(ndc.x * uAspect, ndc.y) / uProjScale;
  float t2 = dot(r, r);
  float k = (1.0 - t2) / (1.0 + t2);
  return vec3(r * (2.0 / (1.0 + t2)), k);
}

vec3 skyDirFromNdc(vec2 ndc) {
  vec3 v = viewDirFromNdc(ndc);
  // GLSL ES 1.00 has no transpose(); mat3 indexing yields columns, so M^T·v is the
  // vector of dot products with each column.
  return vec3(dot(uSkyToView[0], v), dot(uSkyToView[1], v), dot(uSkyToView[2], v));
}
`;

/** CPU mirror of the shader projection, used for picking and label placement. */
export function projectDirection(
  dirSky: Vec3,
  skyToView: Mat3,
  projScale: number,
  aspect: number,
): { x: number; y: number; behind: boolean } {
  const vx = skyToView[0] * dirSky[0] + skyToView[1] * dirSky[1] + skyToView[2] * dirSky[2];
  const vy = skyToView[3] * dirSky[0] + skyToView[4] * dirSky[1] + skyToView[5] * dirSky[2];
  const vz = skyToView[6] * dirSky[0] + skyToView[7] * dirSky[1] + skyToView[8] * dirSky[2];
  const w = Math.max(1 + vz, 0.02);
  return { x: (projScale * vx) / w / aspect, y: (projScale * vy) / w, behind: vz < -0.98 };
}

/** CPU mirror of viewDirFromNdc: screen NDC → unit direction in the sky frame. */
export function unprojectNdc(
  ndcX: number,
  ndcY: number,
  skyToView: Mat3,
  projScale: number,
  aspect: number,
): Vec3 {
  const rx = (ndcX * aspect) / projScale;
  const ry = ndcY / projScale;
  const t2 = rx * rx + ry * ry;
  const k = (1 - t2) / (1 + t2);
  const s = 2 / (1 + t2);
  const view: Vec3 = [rx * s, ry * s, k];
  // sky = skyToViewᵀ · view (the inverse of a rotation is its transpose)
  return [
    skyToView[0] * view[0] + skyToView[3] * view[1] + skyToView[6] * view[2],
    skyToView[1] * view[0] + skyToView[4] * view[1] + skyToView[7] * view[2],
    skyToView[2] * view[0] + skyToView[5] * view[1] + skyToView[8] * view[2],
  ];
}
