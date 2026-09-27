export interface TileManifest {
  pixel: number;
  stars: number;
  bytes: number;
}

export interface BandManifest {
  id: string;
  min: number;
  max: number;
  kind: 'allsky' | 'tiles';
  order?: number;
  dir?: string;
  file?: string;
  idsFile?: string;
  tiles?: TileManifest[];
  /** The band is drawn (and fetched) only while the field of view is narrower than this. */
  showBelowFov: number;
  stars: number;
  bytes: number;
}

export interface Manifest {
  version: number;
  generatedAt: string;
  epoch: string;
  frame: string;
  recordStrideBytes: number;
  fields: string[];
  bvMissing: number;
  maxMag: number;
  healpixScheme: 'nested';
  bands: BandManifest[];
  names: { file: string; count: number };
  licenses: Record<string, string>;
}

export interface StarName {
  name: string;
  nameZh?: string;
  desig?: string;
  con?: string;
  hip?: number;
  hd?: number;
  chunk: string;
  index: number;
  ra: number;
  dec: number;
  mag: number;
  bv: number;
}

export interface ConstellationItem {
  id: string;
  name: string;
  nameZh?: string;
  nameEn?: string;
  pinyin?: string;
  label: [number, number];
  lines: number[][][];
}

export interface ConstellationFile {
  license: string;
  items: ConstellationItem[];
}

const BASE = import.meta.env.BASE_URL;

export function dataUrl(path: string): string {
  return `${BASE}data/${path}`;
}

export async function loadManifest(): Promise<Manifest> {
  const response = await fetch(dataUrl('manifest.json'));
  if (!response.ok) throw new Error(`manifest.json 加载失败：HTTP ${response.status}`);
  return (await response.json()) as Manifest;
}

export async function loadNames(): Promise<StarName[]> {
  const response = await fetch(dataUrl('names.json'));
  if (!response.ok) return [];
  return (await response.json()) as StarName[];
}

export async function loadConstellations(): Promise<{
  western: ConstellationFile;
  chinese: ConstellationFile;
}> {
  const [western, chinese] = await Promise.all([
    fetch(dataUrl('constellations.json')).then((r) => r.json() as Promise<ConstellationFile>),
    fetch(dataUrl('constellations-cn.json')).then((r) => r.json() as Promise<ConstellationFile>),
  ]);
  return { western, chinese };
}
