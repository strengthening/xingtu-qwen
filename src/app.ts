import { computeSkyContext, type SkyContext } from './astro/sky-context';
import { StatusBar } from './ui/status-bar';
import { Store } from './ui/store';

/**
 * Owns the animation loop and the single source of truth for the sky state.
 * The renderer and the UI panels are attached as the features land.
 */
export class App {
  readonly store = new Store();

  private readonly statusBar: StatusBar;
  private lastWallMs = performance.now();
  private lastStatusMs = 0;
  private context: SkyContext | null = null;

  constructor(root: HTMLElement) {
    const statusHost = document.createElement('div');
    statusHost.className = 'bottom-left';
    root.append(statusHost);
    this.statusBar = new StatusBar(statusHost);
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number): void => {
    const state = this.store.get();
    const deltaSeconds = Math.min((nowMs - this.lastWallMs) / 1000, 0.25);
    this.lastWallMs = nowMs;

    if (state.timeRate !== 0) {
      this.store.advanceTime(new Date(state.time.getTime() + deltaSeconds * 1000 * state.timeRate));
    }

    const current = this.store.get();
    this.context = computeSkyContext({
      date: current.time,
      site: this.store.site(),
      frame: current.frame,
      atmosphereDensity: current.atmosphereDensity,
      lightPollutionMag: current.lightPollutionMag,
    });

    if (nowMs - this.lastStatusMs > 200) {
      this.lastStatusMs = nowMs;
      this.statusBar.update(this.context, {
        siteName: this.store.site().nameZh,
        fovDeg: current.fovDeg,
        starCount: current.starCount,
        loadingMessage: current.loadingMessage,
      });
    }

    requestAnimationFrame(this.frame);
  };
}
