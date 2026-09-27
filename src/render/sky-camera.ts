import { DEG, clamp, cross, dot, normalize, type Mat3, type Vec3 } from '../astro/vector';

export const MIN_FOV_DEG = 0.4;
export const MAX_FOV_DEG = 160;

function rotateAbout(axis: Vec3, angleRad: number, v: Vec3): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const k = dot(axis, v);
  const crossed = cross(axis, v);
  return [
    v[0] * c + crossed[0] * s + axis[0] * k * (1 - c),
    v[1] * c + crossed[1] * s + axis[1] * k * (1 - c),
    v[2] * c + crossed[2] * s + axis[2] * k * (1 - c),
  ];
}

/**
 * Orientation of the virtual camera, kept as a look direction in the active sky frame plus a
 * roll angle. In the horizontal frame the natural "up" is the zenith, in the equatorial frame
 * the celestial pole, so dragging feels like panning a real alt-az or equatorial mount.
 */
export class SkyCamera {
  forward: Vec3;
  roll = 0;
  fovDeg: number;

  /** Reference "up" in the sky frame: zenith for horizontal, pole for equatorial. */
  private readonly upReference: Vec3;

  constructor(forward: Vec3, fovDeg: number, upReference: Vec3 = [0, 0, 1]) {
    this.forward = normalize(forward);
    this.fovDeg = clamp(fovDeg, MIN_FOV_DEG, MAX_FOV_DEG);
    this.upReference = upReference;
  }

  up(): Vec3 {
    let up = normalize([
      this.upReference[0] - this.forward[0] * dot(this.upReference, this.forward),
      this.upReference[1] - this.forward[1] * dot(this.upReference, this.forward),
      this.upReference[2] - this.forward[2] * dot(this.upReference, this.forward),
    ]);
    if (dot(up, up) < 1e-6) {
      up = normalize([-this.forward[1], this.forward[0], 0]);
      if (dot(up, up) < 1e-6) up = [1, 0, 0];
    }
    if (this.roll !== 0) up = normalize(rotateAbout(this.forward, this.roll, up));
    return up;
  }

  right(): Vec3 {
    return normalize(cross(this.up(), this.forward));
  }

  /** Sky frame → view frame; rows are right / up / forward. */
  skyToView(): Mat3 {
    const r = this.right();
    const u = this.up();
    const f = this.forward;
    return [r[0], r[1], r[2], u[0], u[1], u[2], f[0], f[1], f[2]];
  }

  /** Drag by (dx, dy) screen pixels; degreesPerPixel comes from the current field of view. */
  drag(dxPixels: number, dyPixels: number, degreesPerPixel: number): void {
    const yaw = -dxPixels * degreesPerPixel * DEG;
    const pitch = dyPixels * degreesPerPixel * DEG;
    const up = this.up();
    const right = this.right();
    this.forward = normalize(rotateAbout(right, pitch, rotateAbout(up, yaw, this.forward)));
  }

  rollBy(radians: number): void {
    this.roll += radians;
  }

  zoomBy(factor: number): void {
    this.fovDeg = clamp(this.fovDeg * factor, MIN_FOV_DEG, MAX_FOV_DEG);
  }

  setViewDirection(forward: Vec3): void {
    this.forward = normalize(forward);
  }

  /** Degrees of sky per screen pixel along the vertical axis. */
  degreesPerPixel(screenHeight: number): number {
    return this.fovDeg / Math.max(screenHeight, 1);
  }
}
