import type { SkyFrame } from '../astro/frames';
import { DEFAULT_SITE_ID, customSite, findSite, type Site } from '../astro/sites';

/** Selection of a star, for the info card. */
export interface StarSelection {
  kind: 'star';
  /** Chunk id and index inside that chunk, used to look up the catalog id lazily. */
  chunkId: string;
  index: number;
  raHours: number;
  decDeg: number;
  magnitude: number;
  bv: number;
  parallaxMas: number;
  pmRa: number;
  pmDec: number;
  name?: string;
}

export interface BodySelection {
  kind: 'body';
  bodyId: string;
}

export type Selection = StarSelection | BodySelection;

/** Seconds of simulated time per second of wall-clock time. */
export const TIME_RATES = [
  { label: '暂停', value: 0 },
  { label: '实时', value: 1 },
  { label: '1 分/秒', value: 60 },
  { label: '10 分/秒', value: 600 },
  { label: '1 时/秒', value: 3600 },
  { label: '1 天/秒', value: 86400 },
] as const;

export interface Toggles {
  equatorialGrid: boolean;
  horizontalGrid: boolean;
  constellations: boolean;
  constellationLabels: boolean;
  starLabels: boolean;
  milkyWay: boolean;
  horizon: boolean;
  cardinalPoints: boolean;
  solarSystem: boolean;
}

export interface AppState {
  siteId: string;
  latitudeDeg: number;
  longitudeDeg: number;
  elevationM: number;
  lightPollutionMag: number;
  /** Simulation time. */
  time: Date;
  /** Simulated seconds per wall-clock second; 0 pauses time. */
  timeRate: number;
  /** View direction in the active sky frame: azimuth/altitude, or RA/Dec when equatorial. */
  viewAzDeg: number;
  viewAltDeg: number;
  fovDeg: number;
  frame: SkyFrame;
  atmosphereDensity: number;
  toggles: Toggles;
  selection: Selection | null;
  /** Set while star data is still loading; drives the status line. */
  loadingMessage: string | null;
  starCount: number;
  shareUrl: string | null;
}

export function initialState(): AppState {
  const site = defaultSiteValue();
  return {
    siteId: site.id,
    latitudeDeg: site.latitudeDeg,
    longitudeDeg: site.longitudeDeg,
    elevationM: site.elevationM,
    lightPollutionMag: site.lightPollutionMag,
    time: new Date(),
    timeRate: 1,
    viewAzDeg: 180,
    viewAltDeg: 30,
    fovDeg: 60,
    frame: 'horizontal',
    atmosphereDensity: 0.55,
    toggles: {
      equatorialGrid: false,
      horizontalGrid: false,
      constellations: true,
      constellationLabels: false,
      starLabels: true,
      milkyWay: true,
      horizon: true,
      cardinalPoints: true,
      solarSystem: true,
    },
    selection: null,
    loadingMessage: '正在初始化…',
    starCount: 0,
    shareUrl: null,
  };
}

function defaultSiteValue(): Site {
  return findSite(DEFAULT_SITE_ID) ?? customSite(31.2304, 121.4737);
}

export type Listener = () => void;

/** Minimal observable store: the whole app state lives in one object. */
export class Store {
  private listeners = new Set<Listener>();

  state: AppState = initialState();

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /**
   * Moves the simulation clock forward without notifying subscribers. The render loop calls
   * this every frame; emitting would wake every listener 60 times a second. Widgets that
   * display the clock are refreshed from the frame loop instead.
   */
  advanceTime(time: Date): void {
    this.state.time = time;
  }

  setToggle(key: keyof Toggles, value: boolean): void {
    this.state = { ...this.state, toggles: { ...this.state.toggles, [key]: value } };
    this.emit();
  }

  setSite(site: Site): void {
    this.set({
      siteId: site.id,
      latitudeDeg: site.latitudeDeg,
      longitudeDeg: site.longitudeDeg,
      elevationM: site.elevationM,
      lightPollutionMag: site.lightPollutionMag,
    });
  }

  setCoordinates(latitudeDeg: number, longitudeDeg: number, elevationM: number): void {
    this.set({
      siteId: 'custom',
      latitudeDeg,
      longitudeDeg,
      elevationM,
      lightPollutionMag: findSite('custom')?.lightPollutionMag ?? 0,
    });
  }

  site(): Site {
    const preset = findSite(this.state.siteId);
    if (preset) return preset;
    return customSite(this.state.latitudeDeg, this.state.longitudeDeg, this.state.elevationM);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
