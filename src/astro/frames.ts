import * as Astronomy from 'astronomy-engine';

import { C_AU_PER_DAY, add, mulMat, normalize, scale, type Mat3, type Vec3 } from './vector';

export interface ObserverSite {
  /** Geodetic latitude, north positive, degrees. */
  latitudeDeg: number;
  /** Longitude, east positive, degrees. */
  longitudeDeg: number;
  /** Elevation above sea level, metres. */
  elevationM: number;
}

/** Which frame the sky is drawn in. */
export type SkyFrame = 'horizontal' | 'equatorial';

export function toAstronomyObserver(site: ObserverSite): Astronomy.Observer {
  return new Astronomy.Observer(site.latitudeDeg, site.longitudeDeg, site.elevationM);
}

/**
 * astronomy-engine stores `rot` transposed with respect to the usual convention: its internal
 * rotate() computes v' = rotᵀ · v. Our Mat3 is row-major with v' = M · v, so transpose here.
 */
export function toMat3(rotation: Astronomy.RotationMatrix): Mat3 {
  const r = rotation.rot;
  return [
    r[0]![0]!,
    r[1]![0]!,
    r[2]![0]!,
    r[0]![1]!,
    r[1]![1]!,
    r[2]![1]!,
    r[0]![2]!,
    r[1]![2]!,
    r[2]![2]!,
  ];
}

/** EQJ (J2000 mean equator and equinox) → EQD (equatorial of date). */
export function equatorialOfDateMatrix(date: Date): Mat3 {
  return toMat3(Astronomy.Rotation_EQJ_EQD(date));
}

/** EQD → HOR, with x = north, y = west, z = zenith. */
export function equatorialToHorizontalMatrix(date: Date, site: ObserverSite): Mat3 {
  return toMat3(Astronomy.Rotation_EQD_HOR(date, toAstronomyObserver(site)));
}

/** HOR → EQD. */
export function horizontalToEquatorialMatrix(date: Date, site: ObserverSite): Mat3 {
  return toMat3(Astronomy.Rotation_HOR_EQD(date, toAstronomyObserver(site)));
}

/**
 * Single matrix applied to catalog positions in the shader: J2000 equatorial → the
 * frame the sky is currently drawn in. Star coordinates stay on the unit sphere, so all
 * per-star work (proper motion, parallax, aberration) happens on the GPU.
 */
export function skyMatrix(date: Date, site: ObserverSite, frame: SkyFrame): Mat3 {
  const precession = equatorialOfDateMatrix(date);
  if (frame === 'equatorial') return precession;
  return mulMat(equatorialToHorizontalMatrix(date, site), precession);
}

/** Zenith direction expressed in the sky frame, so shaders can derive altitude. */
export function zenithInSkyFrame(date: Date, site: ObserverSite, frame: SkyFrame): Vec3 {
  if (frame === 'horizontal') return [0, 0, 1];
  const horToEqu = horizontalToEquatorialMatrix(date, site);
  return normalize([horToEqu[2], horToEqu[5], horToEqu[8]]);
}

/** Observer position relative to the Sun, in AU, J2000 equatorial. */
export function observerPositionAu(date: Date, site: ObserverSite): Vec3 {
  const earth = Astronomy.HelioVector(Astronomy.Body.Earth, date);
  const geocentric = Astronomy.ObserverVector(date, toAstronomyObserver(site), false);
  return [earth.x + geocentric.x, earth.y + geocentric.y, earth.z + geocentric.z];
}

/** Observer velocity relative to the solar-system barycentre, in AU/day, J2000 equatorial. */
export function observerVelocityAuPerDay(date: Date, site: ObserverSite): Vec3 {
  const h = 0.05;
  const before = Astronomy.HelioVector(
    Astronomy.Body.Earth,
    new Date(date.getTime() - h * 86400000),
  );
  const after = Astronomy.HelioVector(
    Astronomy.Body.Earth,
    new Date(date.getTime() + h * 86400000),
  );
  const orbital: Vec3 = [
    (after.x - before.x) / (2 * h),
    (after.y - before.y) / (2 * h),
    (after.z - before.z) / (2 * h),
  ];
  const spin = Astronomy.ObserverState(date, toAstronomyObserver(site), false);
  return add(orbital, [spin.vx, spin.vy, spin.vz]);
}

/** Annual + diurnal aberration term v/c added to the unit direction on the GPU. */
export function aberrationVector(date: Date, site: ObserverSite): Vec3 {
  return scale(observerVelocityAuPerDay(date, site), 1 / C_AU_PER_DAY);
}
