import * as THREE from 'three';

import type { AtmosphereModel } from '../astro/atmosphere';
import type { Mat3, Vec3 } from '../astro/vector';
import { projectionScale } from './projection';
import type { SkyCamera } from './sky-camera';

export interface SkyUniforms {
  uEqjToSky: THREE.IUniform<THREE.Matrix3>;
  uSkyToView: THREE.IUniform<THREE.Matrix3>;
  uZenithInSky: THREE.IUniform<THREE.Vector3>;
  uProjScale: THREE.IUniform<number>;
  uAspect: THREE.IUniform<number>;
  uDaysSinceJ2000: THREE.IUniform<number>;
  uEarthPosAu: THREE.IUniform<THREE.Vector3>;
  uAberration: THREE.IUniform<THREE.Vector3>;
  uPixelRatio: THREE.IUniform<number>;
  uExtinctionK: THREE.IUniform<number>;
  uStarDimming: THREE.IUniform<number>;
  uMagZero: THREE.IUniform<number>;
  uFovZoom: THREE.IUniform<number>;
  uSkyColor: THREE.IUniform<THREE.Vector3>;
  uSkyIntensity: THREE.IUniform<number>;
  uMoonDirSky: THREE.IUniform<THREE.Vector3>;
  uMoonGlow: THREE.IUniform<number>;
  uMoonGlowColor: THREE.IUniform<THREE.Vector3>;
  uSunDirSky: THREE.IUniform<THREE.Vector3>;
  uDaylight: THREE.IUniform<number>;
  uTwilightGlow: THREE.IUniform<number>;
  uHorizonEnabled: THREE.IUniform<number>;
}

export function createSkyUniforms(): SkyUniforms {
  return {
    uEqjToSky: { value: new THREE.Matrix3() },
    uSkyToView: { value: new THREE.Matrix3() },
    uZenithInSky: { value: new THREE.Vector3(0, 0, 1) },
    uProjScale: { value: projectionScale(60) },
    uAspect: { value: 1 },
    uDaysSinceJ2000: { value: 0 },
    uEarthPosAu: { value: new THREE.Vector3() },
    uAberration: { value: new THREE.Vector3() },
    uPixelRatio: { value: 1 },
    uExtinctionK: { value: 0.2 },
    uStarDimming: { value: 0 },
    uMagZero: { value: 6.2 },
    uFovZoom: { value: 1 },
    uSkyColor: { value: new THREE.Vector3() },
    uSkyIntensity: { value: 0 },
    uMoonDirSky: { value: new THREE.Vector3(0, 0, 1) },
    uMoonGlow: { value: 0 },
    uMoonGlowColor: { value: new THREE.Vector3(0.55, 0.58, 0.66) },
    uSunDirSky: { value: new THREE.Vector3(0, 0, 1) },
    uDaylight: { value: 0 },
    uTwilightGlow: { value: 0 },
    uHorizonEnabled: { value: 1 },
  };
}

function setMat3(target: THREE.Matrix3, m: Mat3): void {
  // THREE.Matrix3.set() takes row-major arguments, matching our Mat3 layout.
  target.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
}

export interface SkyUniformInputs {
  eqjToSky: Mat3;
  skyToView: Mat3;
  zenithInSky: Vec3;
  camera: SkyCamera;
  aspect: number;
  daysSinceJ2000: number;
  earthPositionAu: Vec3;
  aberration: Vec3;
  pixelRatio: number;
  atmosphere: AtmosphereModel;
  sunDirSky: Vec3;
  moonDirSky: Vec3;
  horizonEnabled: boolean;
}

export function updateSkyUniforms(uniforms: SkyUniforms, inputs: SkyUniformInputs): void {
  setMat3(uniforms.uEqjToSky.value, inputs.eqjToSky);
  setMat3(uniforms.uSkyToView.value, inputs.skyToView);
  uniforms.uZenithInSky.value.set(...inputs.zenithInSky);
  uniforms.uProjScale.value = projectionScale(inputs.camera.fovDeg);
  uniforms.uAspect.value = inputs.aspect;
  uniforms.uDaysSinceJ2000.value = inputs.daysSinceJ2000;
  uniforms.uEarthPosAu.value.set(...inputs.earthPositionAu);
  uniforms.uAberration.value.set(...inputs.aberration);
  uniforms.uPixelRatio.value = inputs.pixelRatio;
  uniforms.uExtinctionK.value = inputs.atmosphere.extinctionPerAirmass[1];
  uniforms.uStarDimming.value = inputs.atmosphere.starDimming;
  uniforms.uFovZoom.value = Math.pow(60 / inputs.camera.fovDeg, 0.3);
  uniforms.uSkyColor.value.set(...inputs.atmosphere.skyColor);
  uniforms.uSkyIntensity.value = inputs.atmosphere.skyIntensity;
  uniforms.uMoonDirSky.value.set(...inputs.moonDirSky);
  uniforms.uMoonGlow.value = inputs.atmosphere.moonGlowIntensity;
  uniforms.uMoonGlowColor.value.set(...inputs.atmosphere.moonGlowColor);
  uniforms.uSunDirSky.value.set(...inputs.sunDirSky);
  uniforms.uDaylight.value = inputs.atmosphere.daylight;
  uniforms.uTwilightGlow.value = inputs.atmosphere.twilightGlow;
  uniforms.uHorizonEnabled.value = inputs.horizonEnabled ? 1 : 0;
}
