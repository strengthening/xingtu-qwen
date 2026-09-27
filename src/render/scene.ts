import * as THREE from 'three';

import type { SkyContext } from '../astro/sky-context';
import { ALL_BODIES } from '../astro/bodies';
import { horizontalToEquatorialMatrix } from '../astro/frames';
import type { Toggles } from '../ui/store';
import type { StarCatalog, StarChunk } from '../data/star-chunks';
import type { ConstellationItem } from '../data/manifest';
import type { HipsSource } from '../data/hips';
import { ConstellationLines } from './constellation-lines';
import { Grids } from './grids';
import { LabelLayer, type LabelItem } from './labels';
import { MilkyWayLayer } from './milky-way';
import { projectionScale } from './projection';
import type { SkyCamera } from './sky-camera';
import { createSkyUniforms, updateSkyUniforms, type SkyUniforms } from './sky-uniforms';
import { SkyBackground } from './sky-background';
import { SolarSystemLayer } from './solar-system';
import { StarField, type PickedStar } from './star-field';
import { mulMatVec, transpose, type Vec3 } from '../astro/vector';

export interface RenderOptions {
  context: SkyContext;
  camera: SkyCamera;
  toggles: Toggles;
  width: number;
  height: number;
  nowMs: number;
}

/** Owns the WebGL renderer and every sky layer; the app drives it once per frame. */
export class SkyScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly uniforms: SkyUniforms;
  readonly starField: StarField;
  readonly labels: LabelLayer;

  private readonly background: SkyBackground;
  private readonly grids: Grids;
  private readonly solar: SolarSystemLayer;
  private constellations: ConstellationLines | null = null;
  private milkyWay: MilkyWayLayer | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly catalog: StarCatalog,
    labelContainer: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x05070f, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.uniforms = createSkyUniforms();
    this.background = new SkyBackground(this.scene, this.uniforms);
    this.starField = new StarField(this.scene, this.catalog, this.uniforms);
    this.grids = new Grids(this.scene, this.uniforms);
    this.solar = new SolarSystemLayer(
      this.scene,
      this.uniforms,
      ALL_BODIES.map((body) => body.id),
    );
    this.labels = new LabelLayer(labelContainer);
  }

  attachConstellations(western: ConstellationItem[], chinese: ConstellationItem[]): void {
    this.constellations?.dispose(this.scene);
    this.constellations = new ConstellationLines(this.scene, this.uniforms, western, chinese);
  }

  attachMilkyWay(source: HipsSource): void {
    this.milkyWay?.dispose();
    this.milkyWay = new MilkyWayLayer(this.scene, this.uniforms, source);
  }

  get constellationLabels(): ConstellationLines | null {
    return this.constellations;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  render(options: RenderOptions): StarChunk[] {
    const { context, camera, toggles, width, height } = options;
    const skyToView = camera.skyToView();
    const viewDirEqj = mulMatVec(transpose(context.skyMatrix), camera.forward);

    const sun = context.bodies[0]!;
    const moon = context.bodies[1]!;
    updateSkyUniforms(this.uniforms, {
      eqjToSky: context.skyMatrix,
      skyToView,
      zenithInSky: context.zenithInSky,
      camera,
      aspect: width / Math.max(height, 1),
      daysSinceJ2000: context.daysSinceJ2000,
      earthPositionAu: context.earthPositionAu,
      aberration: context.aberration,
      pixelRatio: this.renderer.getPixelRatio(),
      atmosphere: context.atmosphere,
      sunDirSky: mulMatVec(context.skyMatrix, sun.directionEqj),
      moonDirSky: mulMatVec(context.skyMatrix, moon.directionEqj),
      horizonEnabled: toggles.horizon,
    });

    const visible = this.catalog.visibleChunks(camera.fovDeg, viewDirEqj, options.nowMs);
    this.starField.update(visible);
    this.grids.update(context, toggles.equatorialGrid, toggles.horizontalGrid);
    this.constellations?.update(context, toggles.constellations, true);
    this.milkyWay?.update(context, camera, toggles.milkyWay, options.nowMs);
    this.solar.update(
      context,
      camera,
      height * this.renderer.getPixelRatio(),
      width / Math.max(height, 1),
      toggles.solarSystem,
    );

    this.renderer.render(this.scene, cameraObject());
    return visible;
  }

  pickStar(
    ndcX: number,
    ndcY: number,
    context: SkyContext,
    camera: SkyCamera,
    tolerancePixels: number,
    height: number,
  ): PickedStar | null {
    const toleranceNdc = (tolerancePixels * 2) / Math.max(height, 1);
    return this.starField.pick(ndcX, ndcY, toleranceNdc, context, camera);
  }

  /** Cardinal compass points as label items, expressed in J2000 equatorial coordinates. */
  cardinalLabels(context: SkyContext): LabelItem[] {
    const horToEqj = transpose(horizontalToEquatorialMatrix(context.date, context.site));
    const points: Array<[string, number]> = [
      ['北 N', 0],
      ['东 E', 90],
      ['南 S', 180],
      ['西 W', 270],
    ];
    return points.map(([text, az]) => {
      const azRad = (az * Math.PI) / 180;
      const hor: Vec3 = [Math.cos(azRad), -Math.sin(azRad), 0];
      return { text, dirEqj: mulMatVec(horToEqj, hor), kind: 'cardinal', priority: -10 };
    });
  }

  dispose(): void {
    this.background.dispose(this.scene);
    this.starField.dispose();
    this.grids.dispose(this.scene);
    this.solar.dispose(this.scene);
    this.constellations?.dispose(this.scene);
    this.renderer.dispose();
  }
}

/** The projection is entirely in the shaders, so Three.js only needs a placeholder camera. */
let placeholder: THREE.Camera | null = null;
function cameraObject(): THREE.Camera {
  if (!placeholder) {
    placeholder = new THREE.Camera();
    placeholder.matrixAutoUpdate = false;
  }
  return placeholder;
}

export { projectionScale };
