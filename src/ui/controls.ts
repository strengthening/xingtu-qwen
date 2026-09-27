import { NORTHERN_SITES, SOUTHERN_SITES, type Site } from '../astro/sites';
import { TIME_RATES, type Store, type Toggles } from './store';

interface Elements {
  siteSelect: HTMLSelectElement;
  latitude: HTMLInputElement;
  longitude: HTMLInputElement;
  elevation: HTMLInputElement;
  timeInput: HTMLInputElement;
  rateSelect: HTMLSelectElement;
  nowButton: HTMLButtonElement;
  frameSelect: HTMLSelectElement;
  density: HTMLInputElement;
  densityOut: HTMLOutputElement;
  toggles: Partial<Record<keyof Toggles, HTMLInputElement>>;
  shareButton: HTMLButtonElement;
}

const TOGGLE_LABELS: Array<[keyof Toggles, string]> = [
  ['constellations', '星座连线（含三垣二十八宿）'],
  ['constellationLabels', '星座名称'],
  ['starLabels', '亮星名称'],
  ['equatorialGrid', '赤道网格'],
  ['horizontalGrid', '地平网格'],
  ['horizon', '地平线与地面'],
  ['cardinalPoints', '东南西北方位'],
  ['solarSystem', '太阳 / 月亮 / 行星'],
  ['milkyWay', '银河背景'],
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function panel(title: string): [HTMLElement, HTMLElement] {
  const box = el('section', 'panel');
  box.append(el('h2', '', title));
  const body = el('div', 'panel-body');
  box.append(body);
  return [box, body];
}

function row(label: string): [HTMLElement, HTMLElement] {
  const r = el('div', 'row');
  r.append(el('label', '', label));
  const field = el('div', 'field');
  r.append(field);
  return [r, field];
}

/** Local civil time approximated from longitude (whole-hour zones), for the datetime input. */
function zoneOffsetHours(longitudeDeg: number): number {
  return Math.round(longitudeDeg / 15);
}

export class ControlPanel {
  private readonly elements: Elements;

  constructor(
    private readonly leftColumn: HTMLElement,
    private readonly rightColumn: HTMLElement,
    private readonly store: Store,
    private readonly onShare: () => void,
  ) {
    this.elements = this.build();
    this.sync();
    store.subscribe(() => this.sync());
  }

  private build(): Elements {
    // ---- left: observer & time ----
    const [sitePanel, siteBody] = panel('观测者');
    const [siteRow, siteField] = row('预设地点');
    const siteSelect = el('select', '');
    const northGroup = el('optgroup', '');
    northGroup.label = '北半球';
    const southGroup = el('optgroup', '');
    southGroup.label = '南半球';
    for (const site of NORTHERN_SITES) northGroup.append(optionFor(site));
    for (const site of SOUTHERN_SITES) southGroup.append(optionFor(site));
    const customOption = el('option', '', '自定义位置…');
    customOption.value = 'custom';
    siteSelect.append(northGroup, southGroup, customOption);
    siteField.append(siteSelect);
    siteBody.append(siteRow);

    const [latRow, latField] = row('纬度 °');
    const latitude = numberInput(-90, 90, 0.01);
    latField.append(latitude);
    latRow.append(latField);
    const [lonRow, lonField] = row('经度 °');
    const longitude = numberInput(-180, 180, 0.01);
    lonField.append(longitude);
    lonRow.append(lonField);
    const [elevRow, elevField] = row('海拔 m');
    const elevation = numberInput(-500, 9000, 1);
    elevField.append(elevation);
    elevRow.append(elevField);
    siteBody.append(latRow, lonRow, elevRow);
    siteBody.append(
      el('p', 'hint', '南半球的星空与北半球不同：切到南半球预设点看看南天极与麦哲伦云方向。'),
    );

    const [timePanel, timeBody] = panel('时间');
    const [timeRow, timeField] = row('当地时间');
    const timeInput = el('input', '');
    timeInput.type = 'datetime-local';
    timeInput.step = '60';
    timeField.append(timeInput);
    timeRow.append(timeField);
    const [rateRow, rateField] = row('时间流速');
    const rateSelect = el('select', '');
    for (const rate of TIME_RATES) {
      const option = el('option', '', rate.label);
      option.value = String(rate.value);
      rateSelect.append(option);
    }
    rateField.append(rateSelect);
    rateRow.append(rateField);
    const nowButton = el('button', '', '回到现在');
    timeBody.append(timeRow, rateRow, nowButton);

    this.leftColumn.append(sitePanel, timePanel);

    // ---- right: display ----
    const [displayPanel, displayBody] = panel('显示');
    const [frameRow, frameField] = row('坐标架');
    const frameSelect = el('select', '');
    const frameOptions: Array<[string, string]> = [
      ['horizontal', '地平坐标（随时间转动）'],
      ['equatorial', '赤道坐标（跟随天球）'],
    ];
    for (const [value, label] of frameOptions) {
      const option = el('option', '', label);
      option.value = value;
      frameSelect.append(option);
    }
    frameField.append(frameSelect);
    frameRow.append(frameField);
    displayBody.append(frameRow);

    const toggles: Partial<Record<keyof Toggles, HTMLInputElement>> = {};
    for (const [key, label] of TOGGLE_LABELS) {
      const wrap = el('label', 'toggle');
      const input = el('input', '');
      input.type = 'checkbox';
      wrap.append(input, el('span', '', label));
      toggles[key] = input;
      displayBody.append(wrap);
    }

    const [atmoPanel, atmoBody] = panel('大气');
    const sliderRow = el('div', 'slider-row');
    const density = el('input', '');
    density.type = 'range';
    density.min = '0';
    density.max = '100';
    density.step = '1';
    const densityOut = el('output', '');
    sliderRow.append(density, densityOut);
    atmoBody.append(sliderRow);
    atmoBody.append(el('p', 'hint', '控制大气消光、天光与月光散射的强弱；0% 为无大气的太空视角。'));

    const [sharePanel, shareBody] = panel('分享');
    const shareButton = el('button', '', '复制当前视角与时间链接');
    shareBody.append(shareButton);
    shareBody.append(
      el('p', 'hint', '链接包含时间、地点、朝向与视场，可直接发给别人复现同一片天空。'),
    );

    this.rightColumn.append(displayPanel, atmoPanel, sharePanel);

    this.wire(
      siteSelect,
      latitude,
      longitude,
      elevation,
      timeInput,
      rateSelect,
      nowButton,
      frameSelect,
      density,
      toggles,
      shareButton,
    );

    return {
      siteSelect,
      latitude,
      longitude,
      elevation,
      timeInput,
      rateSelect,
      nowButton,
      frameSelect,
      density,
      densityOut,
      toggles,
      shareButton,
    };
  }

  private wire(
    siteSelect: HTMLSelectElement,
    latitude: HTMLInputElement,
    longitude: HTMLInputElement,
    elevation: HTMLInputElement,
    timeInput: HTMLInputElement,
    rateSelect: HTMLSelectElement,
    nowButton: HTMLButtonElement,
    frameSelect: HTMLSelectElement,
    density: HTMLInputElement,
    toggles: Partial<Record<keyof Toggles, HTMLInputElement>>,
    shareButton: HTMLButtonElement,
  ): void {
    const store = this.store;
    siteSelect.addEventListener('change', () => {
      const id = siteSelect.value;
      if (id === 'custom') return;
      const site = [...NORTHERN_SITES, ...SOUTHERN_SITES].find((s) => s.id === id);
      if (site) store.setSite(site);
    });
    const applyCoordinates = () => {
      store.setCoordinates(
        clampNumber(latitude.valueAsNumber, -90, 90),
        clampNumber(longitude.valueAsNumber, -180, 180),
        clampNumber(elevation.valueAsNumber, -500, 9000),
      );
    };
    latitude.addEventListener('change', applyCoordinates);
    longitude.addEventListener('change', applyCoordinates);
    elevation.addEventListener('change', applyCoordinates);

    timeInput.addEventListener('change', () => {
      const value = timeInput.value;
      if (!value) return;
      const local = new Date(`${value}:00Z`);
      if (Number.isNaN(local.getTime())) return;
      const offsetMs = zoneOffsetHours(store.get().longitudeDeg) * 3600000;
      store.set({ time: new Date(local.getTime() - offsetMs) });
    });
    rateSelect.addEventListener('change', () => {
      store.set({ timeRate: Number(rateSelect.value) });
    });
    nowButton.addEventListener('click', () => store.set({ time: new Date(), timeRate: 1 }));
    frameSelect.addEventListener('change', () => {
      store.set({ frame: frameSelect.value === 'equatorial' ? 'equatorial' : 'horizontal' });
    });
    density.addEventListener('input', () => {
      store.set({ atmosphereDensity: Number(density.value) / 100 });
    });
    for (const [key, input] of Object.entries(toggles)) {
      input!.addEventListener('change', () =>
        store.setToggle(key as keyof Toggles, input!.checked),
      );
    }
    shareButton.addEventListener('click', () => this.onShare());
  }

  /** Push store state into the widgets (called on subscribe and after URL restore). */
  sync(): void {
    const state = this.store.get();
    const e = this.elements;
    if (e.siteSelect.value !== state.siteId) e.siteSelect.value = state.siteId;
    if (document.activeElement !== e.latitude) e.latitude.value = String(state.latitudeDeg);
    if (document.activeElement !== e.longitude) e.longitude.value = String(state.longitudeDeg);
    if (document.activeElement !== e.elevation) e.elevation.value = String(state.elevationM);
    if (document.activeElement !== e.timeInput) {
      const offsetMs = zoneOffsetHours(state.longitudeDeg) * 3600000;
      const local = new Date(state.time.getTime() + offsetMs);
      e.timeInput.value = local.toISOString().slice(0, 16);
    }
    if (e.rateSelect.value !== String(state.timeRate)) e.rateSelect.value = String(state.timeRate);
    if (e.frameSelect.value !== state.frame) e.frameSelect.value = state.frame;
    if (document.activeElement !== e.density) {
      e.density.value = String(Math.round(state.atmosphereDensity * 100));
    }
    e.densityOut.textContent = `${Math.round(state.atmosphereDensity * 100)}%`;
    for (const [key, input] of Object.entries(e.toggles)) {
      const wanted = state.toggles[key as keyof Toggles];
      if (input && input.checked !== wanted) input.checked = wanted;
    }
  }
}

function optionFor(site: Site): HTMLOptionElement {
  const option = el('option', '', `${site.nameZh} ${site.nameEn}`);
  option.value = site.id;
  return option;
}

function numberInput(min: number, max: number, step: number): HTMLInputElement {
  const input = el('input', '');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  return input;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
