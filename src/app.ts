import { describeBody, findBody } from './astro/bodies';
import { skyMatrix } from './astro/frames';
import { computeSkyContext, type SkyContext } from './astro/sky-context';
import { mulMatVec, sphericalToUnit, transpose, type Vec3 } from './astro/vector';
import { StarCatalog } from './data/star-chunks';
import { loadConstellations, loadManifest, loadNames, type StarName } from './data/manifest';
import { projectDirection, projectionScale } from './render/projection';
import { SkyCamera } from './render/sky-camera';
import { SkyScene } from './render/scene';
import type { LabelItem } from './render/labels';
import type { PickedStar } from './render/star-field';
import { ControlPanel } from './ui/controls';
import { formatFov } from './ui/format';
import { InfoCard } from './ui/info-card';
import { StatusBar } from './ui/status-bar';
import { Store, TIME_RATES, type StarSelection } from './ui/store';
import { decodeState, encodeState } from './ui/url';

const LABEL_INTERVAL_MS = 1000 / 8;
const STATUS_INTERVAL_MS = 1000 / 5;
const URL_INTERVAL_MS = 2000;

/** Wires the store, the renderer and the DOM together and drives the animation loop. */
export class App {
  readonly store = new Store();

  private readonly canvas: HTMLCanvasElement;
  private readonly statusBar: StatusBar;
  private readonly infoCard: InfoCard;

  private scene: SkyScene | null = null;
  private catalog: StarCatalog | null = null;
  private names: StarName[] = [];
  private namesByChunkIndex = new Map<string, StarName>();
  private camera: SkyCamera;
  private context: SkyContext | null = null;
  private visibleStars = 0;

  private lastWallMs = performance.now();
  private lastLabelMs = 0;
  private lastStatusMs = 0;
  private lastUrlMs = 0;
  private drag: { x: number; y: number; moved: number } | null = null;
  private pendingViewDir: Vec3 | null = null;
  private previousFrame = this.store.get().frame;

  constructor(root: HTMLElement) {
    this.canvas = root.querySelector<HTMLCanvasElement>('#sky')!;
    const ui = root.querySelector<HTMLElement>('#ui')!;

    const left = el('div', 'column-left');
    const right = el('div', 'column-right');
    const centerBottom = el('div', 'center-bottom');
    const statusHost = el('div', 'bottom-left');
    ui.append(left, right, centerBottom, statusHost);

    const labelHost = el('div', 'label-layer');
    root.append(labelHost);

    this.statusBar = new StatusBar(statusHost);
    this.infoCard = new InfoCard(() => this.store.set({ selection: null }));
    this.infoCard.mount(root);

    const restored = decodeState(window.location.search);
    if (restored) {
      this.store.set(restored.patch);
      this.pendingViewDir = restored.viewDirEqj;
    }

    const state = this.store.get();
    this.camera = new SkyCamera(this.initialForward(state.frame), state.fovDeg);

    new ControlPanel(left, right, this.store, () => void this.share());
    centerBottom.append(this.buildTimeControls());
    root.append(this.buildFooter());

    this.bindPointer();
    this.store.subscribe(() => this.onStateChange());
    void this.load(labelHost);
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private initialForward(frame: 'horizontal' | 'equatorial'): Vec3 {
    const state = this.store.get();
    if (this.pendingViewDir) {
      return mulMatVec(skyMatrix(state.time, this.store.site(), frame), this.pendingViewDir);
    }
    const az = (state.viewAzDeg * Math.PI) / 180;
    const alt = (state.viewAltDeg * Math.PI) / 180;
    return [Math.cos(az) * Math.cos(alt), -Math.sin(az) * Math.cos(alt), Math.sin(alt)];
  }

  private async load(labelHost: HTMLElement): Promise<void> {
    try {
      this.store.set({ loadingMessage: '正在读取星表索引…' });
      const manifest = await loadManifest();
      this.catalog = new StarCatalog(manifest);
      const [names, constellations] = await Promise.all([loadNames(), loadConstellations()]);
      this.names = names;
      this.namesByChunkIndex = new Map(names.map((n) => [`${n.chunk}:${n.index}`, n]));
      this.scene = new SkyScene(this.canvas, this.catalog, labelHost);
      this.scene.attachConstellations(constellations.western.items, constellations.chinese.items);
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.store.set({ loadingMessage: null });
    } catch (error) {
      this.store.set({
        loadingMessage: `星表加载失败：${error instanceof Error ? error.message : String(error)}（请先运行 pnpm data:download 与 pnpm data:build）`,
      });
    }
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.scene?.resize(width, height);
  }

  private buildTimeControls(): HTMLElement {
    const bar = el('div', 'time-controls');
    const pause = el('button', '');
    pause.textContent = '⏸ 暂停';
    pause.addEventListener('click', () => this.store.set({ timeRate: 0 }));
    const play = el('button', '');
    play.textContent = '▶ 实时';
    play.addEventListener('click', () => this.store.set({ timeRate: 1 }));
    const rate = el('select', '');
    for (const option of TIME_RATES) {
      const node = el('option', '');
      node.value = String(option.value);
      node.textContent = option.label;
      rate.append(node);
    }
    rate.value = String(this.store.get().timeRate);
    rate.addEventListener('change', () => this.store.set({ timeRate: Number(rate.value) }));
    const now = el('button', '');
    now.textContent = '现在';
    now.addEventListener('click', () => this.store.set({ time: new Date(), timeRate: 1 }));
    const fov = el('span', 'hint');
    bar.append(pause, play, rate, now, fov);
    this.store.subscribe(() => {
      const state = this.store.get();
      pause.classList.toggle('is-active', state.timeRate === 0);
      play.classList.toggle('is-active', state.timeRate === 1);
      if (rate.value !== String(state.timeRate)) rate.value = String(state.timeRate);
      fov.textContent = `视场 ${formatFov(this.camera.fovDeg)}`;
    });
    return bar;
  }

  private buildFooter(): HTMLElement {
    const footer = el('footer', 'footer');
    footer.innerHTML =
      '星表：<a href="https://www.cosmos.esa.int/web/gaia/dr3" target="_blank" rel="noopener">Gaia DR3</a>（CC BY-NC 3.0 IGO，ESA/Gaia/DPAC）· ' +
      '亮星名：<a href="https://codeberg.org/astronexus/hyg" target="_blank" rel="noopener">HYG v4.4</a>（CC BY-SA 4.0）· ' +
      '星座连线：<a href="https://github.com/ofrohn/d3-celestial" target="_blank" rel="noopener">d3-celestial</a>（BSD 3-Clause）· ' +
      '银河：<a href="https://www.eso.org/public/images/eso0932a/" target="_blank" rel="noopener">ESO/S. Brunier</a>（CC BY 4.0）· ' +
      '计算：<a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noopener">Astronomy Engine</a>（MIT）';
    return footer;
  }

  private bindPointer(): void {
    this.canvas.addEventListener('pointerdown', (event) => {
      this.drag = { x: event.clientX, y: event.clientY, moved: 0 };
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.classList.add('is-dragging');
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.camera.drag(dx, dy, this.camera.degreesPerPixel(this.canvas.clientHeight || 1));
      this.store.set({ fovDeg: this.camera.fovDeg });
    });
    this.canvas.addEventListener('pointerup', (event) => {
      const wasClick = this.drag !== null && this.drag.moved < 5;
      this.drag = null;
      this.canvas.classList.remove('is-dragging');
      if (wasClick) void this.pickAt(event.clientX, event.clientY);
    });
    this.canvas.addEventListener('pointercancel', () => {
      this.drag = null;
      this.canvas.classList.remove('is-dragging');
    });
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.camera.zoomBy(Math.exp(event.deltaY * 0.0012));
        this.store.set({ fovDeg: this.camera.fovDeg });
      },
      { passive: false },
    );
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space' && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        this.store.set({ timeRate: this.store.get().timeRate === 0 ? 1 : 0 });
      }
    });
  }

  private async pickAt(clientX: number, clientY: number): Promise<void> {
    const scene = this.scene;
    const context = this.context;
    if (!scene || !context) return;
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;

    if (this.store.get().toggles.solarSystem) {
      const bodyId = this.pickBody(ndcX, ndcY, rect.height, context);
      if (bodyId) {
        this.store.set({ selection: { kind: 'body', bodyId } });
        return;
      }
    }
    const star = scene.pickStar(ndcX, ndcY, context, this.camera, 10, rect.height);
    if (!star) {
      this.store.set({ selection: null });
      return;
    }
    this.store.set({ selection: starSelection(star) });
    const name = this.namesByChunkIndex.get(`${star.chunk.id}:${star.index}`);
    const ids = await this.catalog?.loadIds(star.chunk);
    this.infoCard.showStar(star, name, context, ids ? (ids[star.index] ?? null) : null);
  }

  private pickBody(ndcX: number, ndcY: number, height: number, context: SkyContext): string | null {
    const skyToView = this.camera.skyToView();
    const projScale = projectionScale(this.camera.fovDeg);
    const aspect = (this.canvas.clientWidth || 1) / Math.max(height, 1);
    const tolerance = 24 / Math.max(height, 1);
    let best: { id: string; distance: number } | null = null;
    for (const body of context.bodies) {
      if (body.altDeg < -2) continue;
      const projected = projectDirection(body.directionEqj, skyToView, projScale, aspect);
      if (projected.behind) continue;
      const distance = Math.hypot(projected.x - ndcX, projected.y - ndcY);
      const radius = Math.max(body.apparentRadiusDeg / this.camera.fovDeg, tolerance / 2);
      if (distance < radius && (!best || distance < best.distance)) {
        best = { id: body.source.id, distance };
      }
    }
    return best?.id ?? null;
  }

  private onStateChange(): void {
    const state = this.store.get();
    if (state.frame !== this.previousFrame && this.context) {
      const oldMatrix = skyMatrix(state.time, this.store.site(), this.previousFrame);
      const newMatrix = skyMatrix(state.time, this.store.site(), state.frame);
      const dirEqj = mulMatVec(transpose(oldMatrix), this.camera.forward);
      this.camera = new SkyCamera(mulMatVec(newMatrix, dirEqj), state.fovDeg);
      this.previousFrame = state.frame;
    }
    if (state.selection === null) this.infoCard.hide();
    if (state.selection?.kind === 'body' && this.context) {
      const body = findBody(state.selection.bodyId);
      if (body) this.infoCard.showBody(describeBody(body, state.time, this.store.site()), this.context);
    }
  }

  private async share(): Promise<void> {
    const context = this.context;
    if (!context) return;
    const query = encodeState(this.store.get(), this.viewDirEqj(context));
    this.store.set({ shareUrl: `${location.origin}${location.pathname}?${query}` });
    await navigator.clipboard?.writeText(`${location.origin}${location.pathname}?${query}`).catch(() => undefined);
    history.replaceState(null, '', `?${query}`);
  }

  private viewDirEqj(context: SkyContext): Vec3 {
    return mulMatVec(transpose(context.skyMatrix), this.camera.forward);
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

    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;

    try {
      if (this.scene && this.catalog) {
        const visible = this.scene.render({
          context: this.context,
          camera: this.camera,
          toggles: current.toggles,
          width,
          height,
          nowMs,
        });
        this.visibleStars = visible.reduce((sum, chunk) => sum + chunk.stars, 0);
        if (nowMs - this.lastLabelMs > LABEL_INTERVAL_MS) {
          this.lastLabelMs = nowMs;
          this.scene.labels.update(
            this.buildLabels(this.context),
            this.context,
            this.camera,
            width,
            height,
          );
        }
      }
    } catch (error) {
      this.reportFrameError(error);
    }

    if (nowMs - this.lastStatusMs > STATUS_INTERVAL_MS) {
      this.lastStatusMs = nowMs;
      this.statusBar.update(this.context, {
        siteName: this.store.site().nameZh,
        fovDeg: this.camera.fovDeg,
        starCount: this.visibleStars,
        loadingMessage: current.loadingMessage,
      });
    }
    if (nowMs - this.lastUrlMs > URL_INTERVAL_MS) {
      this.lastUrlMs = nowMs;
      history.replaceState(null, '', `?${encodeState(current, this.viewDirEqj(this.context))}`);
    }

    requestAnimationFrame(this.frame);
  };

  private frameErrorReported = false;

  private reportFrameError(error: unknown): void {
    if (this.frameErrorReported) return;
    this.frameErrorReported = true;
    console.error('渲染帧出错：', error);
    this.store.set({ loadingMessage: `渲染出错：${error instanceof Error ? error.message : String(error)}` });
  }

  private buildLabels(context: SkyContext): LabelItem[] {
    const state = this.store.get();
    const items: LabelItem[] = [];
    if (state.toggles.cardinalPoints && this.scene) items.push(...this.scene.cardinalLabels(context));
    if (state.toggles.solarSystem) {
      for (const body of context.bodies) {
        if (body.altDeg < -3) continue;
        items.push({ text: body.source.nameZh, dirEqj: body.directionEqj, kind: 'body', priority: -5 });
      }
    }
    if (state.toggles.starLabels) {
      const limit = Math.min(8.5, Math.max(1.5, 2 + 2.5 * Math.log10(60 / this.camera.fovDeg)));
      for (const name of this.names) {
        if (name.mag > limit) break; // names.json is sorted by magnitude
        items.push({
          text: name.nameZh ?? name.name,
          subText: name.nameZh ? name.name : undefined,
          dirEqj: sphericalToUnit(name.ra, name.dec),
          kind: 'star',
          priority: name.mag,
        });
      }
    }
    const constellations = this.scene?.constellationLabels;
    if (state.toggles.constellationLabels && constellations) {
      for (const label of constellations.westernLabels) {
        items.push({
          text: label.text,
          subText: label.subText,
          dirEqj: sphericalToUnit(label.ra, label.dec),
          kind: 'constellation',
          priority: 40,
        });
      }
      if (state.toggles.constellations) {
        for (const label of constellations.chineseLabels) {
          items.push({
            text: label.text,
            subText: label.subText,
            dirEqj: sphericalToUnit(label.ra, label.dec),
            kind: 'chinese',
            priority: 45,
          });
        }
      }
    }
    return items;
  }
}

function starSelection(star: PickedStar): StarSelection {
  return {
    kind: 'star',
    chunkId: star.chunk.id,
    index: star.index,
    raHours: 0,
    decDeg: 0,
    magnitude: star.magnitude,
    bv: star.bv,
    parallaxMas: star.parallaxMas,
    pmRa: star.pmRa,
    pmDec: star.pmDec,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
