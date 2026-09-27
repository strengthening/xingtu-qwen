/**
 * 预处理星表：把 data/raw/ 里的 Gaia DR3 + HYG + d3-celestial 转成前端可直接加载的二进制。
 *
 *   pnpm data:build
 *
 * 输出（public/data/，不入版本库）：
 *   manifest.json            星等分块、HEALPix 切片索引、许可证信息
 *   stars/band-{k}.bin       较亮星等档：全天整块（Float32Array，32 字节/星）
 *   stars/band-{k}.ids.bin   对应 Gaia source_id（BigUint64Array，点选时惰性加载）
 *   stars/tiles/{band}/o{n}/{pixel}.bin / .ids.bin   较暗星等档：按 HEALPix 天区切片
 *   names.json               有名字的星（中西文名、星官归属、所在分块与下标）
 *   constellations.json      西方 88 星座连线与名称
 *   constellations-cn.json   三垣二十八宿等中国星官连线与名称
 *
 * 记录布局（32 字节，8 × float32）：x y z（J2000 单位球）, mag(G), pmra, pmdec(mas/yr), parallax(mas), bv
 */
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

import { bpRpToBv } from '../src/astro/colors';
import { vecToPixNest } from '../src/astro/healpix';
import { DEG, MAS, normalize, sphericalToUnit, type Vec3 } from '../src/astro/vector';

const RAW = new URL('../data/raw/', import.meta.url);
const OUT = new URL('../public/data/', import.meta.url);

/** Gaia DR3 positions are at epoch 2016.0; we store J2000.0, so propagate back 16 years. */
const GAIA_EPOCH_OFFSET_YEARS = 2000.0 - 2016.0;
const BV_MISSING = -999;
/** HEALPix order of the position index used to cross-match HYG names onto Gaia stars. */
const MATCH_ORDER = 6;
/** Cross-match tolerance in radians, about 15 arcsec. */
const MATCH_TOLERANCE = 2.5e-4;
/** Order of the index used for the bright-star photometry correction. */
const BRIGHT_MATCH_ORDER = 9;
/** 5 arcsec, as a chord on the unit sphere. */
const BRIGHT_MATCH_TOLERANCE = 2.42e-4;

interface Band {
  key: string;
  min: number;
  max: number;
  /** null = all-sky single file; otherwise the HEALPix order used for tiling. */
  order: number | null;
  showBelowFov: number;
}

const BANDS: Band[] = [
  { key: 'band-0', min: -99, max: 4, order: null, showBelowFov: 360 },
  { key: 'band-1', min: 4, max: 6, order: null, showBelowFov: 360 },
  { key: 'band-2', min: 6, max: 8, order: null, showBelowFov: 45 },
  { key: 'band-3', min: 8, max: 9, order: 1, showBelowFov: 20 },
  { key: 'band-4', min: 9, max: 10, order: 2, showBelowFov: 8 },
  { key: 'band-5', min: 10, max: 11, order: 3, showBelowFov: 3 },
  { key: 'band-6', min: 11, max: 12, order: 3, showBelowFov: 1.2 },
];

interface Bucket {
  values: number[];
  ids: bigint[];
}

interface NamedHygStar {
  name: string;
  nameZh?: string;
  desig?: string;
  con?: string;
  hip?: number;
  hd?: number;
  ra: number;
  dec: number;
  mag: number;
}

interface NameEntry extends NamedHygStar {
  chunk: string;
  index: number;
  bv: number;
}

function bandFor(mag: number): Band | null {
  return BANDS.find((band) => mag >= band.min && mag < band.max) ?? null;
}

function chunkId(band: Band, pixel: number | null): string {
  return pixel === null ? band.key : `${band.key}p${pixel}`;
}

function pixelOfChunk(band: Band, chunk: string): number {
  return Number(chunk.slice(band.key.length + 1));
}

/** Minimal CSV field splitter that understands double-quoted strings. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

async function* lines(file: URL, gzipped: boolean): AsyncGenerator<string> {
  let source: Readable = createReadStream(file);
  if (gzipped) source = source.pipe(createGunzip());
  source.setEncoding('utf8');
  let buffer = '';
  for await (const chunk of source) {
    buffer += chunk as string;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      yield buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer.length > 0) yield buffer;
}

/** Propagate a Gaia J2016.0 position back to J2000.0 using its proper motion. */
function positionAtJ2000(raDeg: number, decDeg: number, pmRa: number, pmDec: number): Vec3 {
  const base = sphericalToUnit(raDeg, decDeg);
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const east: Vec3 = [-Math.sin(ra), Math.cos(ra), 0];
  const north: Vec3 = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
  const dRa = pmRa * GAIA_EPOCH_OFFSET_YEARS * MAS;
  const dDec = pmDec * GAIA_EPOCH_OFFSET_YEARS * MAS;
  return normalize([
    base[0] + east[0] * dRa + north[0] * dDec,
    base[1] + east[1] * dRa + north[1] * dDec,
    base[2] + east[2] * dRa + north[2] * dDec,
  ]);
}

interface HygBright {
  ra: number;
  dec: number;
  vMag: number;
  bv: number;
}

/**
 * Gaia DR3 photometry saturates for stars brighter than about G = 3 (Sirius is listed at
 * G = 8.52), which would file the brightest stars under the wrong magnitude band. HYG carries
 * reliable V magnitudes for exactly those stars, so substitute V - 0.1 ≈ G when they disagree.
 */
async function readBrightHyg(): Promise<Map<number, HygBright[]>> {
  const index = new Map<number, HygBright[]>();
  for (const row of await readHyg()) {
    if (row.mag > 4.5 || !Number.isFinite(row.mag)) continue;
    const direction = sphericalToUnit(row.ra, row.dec);
    const pixel = vecToPixNest(BRIGHT_MATCH_ORDER, direction);
    const entry = { ra: row.ra, dec: row.dec, vMag: row.mag, bv: row.bv };
    const list = index.get(pixel);
    if (list) list.push(entry);
    else index.set(pixel, [entry]);
  }
  return index;
}

function brightCorrection(
  index: Map<number, HygBright[]>,
  position: Vec3,
  gaiaMag: number,
): { mag: number; bv: number } | null {
  const pixel = vecToPixNest(BRIGHT_MATCH_ORDER, position);
  const candidates = index.get(pixel);
  if (!candidates) return null;
  for (const candidate of candidates) {
    const direction = sphericalToUnit(candidate.ra, candidate.dec);
    const sep = Math.hypot(
      direction[0] - position[0],
      direction[1] - position[1],
      direction[2] - position[2],
    );
    if (sep < BRIGHT_MATCH_TOLERANCE && Math.abs(gaiaMag - candidate.vMag) > 1.5) {
      return { mag: candidate.vMag - 0.1, bv: candidate.bv };
    }
  }
  return null;
}

interface HygRow {
  hip: number | null;
  hd: number | null;
  proper: string;
  bayer: string;
  flam: string;
  con: string;
  ra: number;
  dec: number;
  mag: number;
  bv: number;
}

async function readHyg(): Promise<HygRow[]> {
  const rows: HygRow[] = [];
  let header: string[] | null = null;
  for await (const line of lines(new URL('hyg_v44.csv.gz', RAW), true)) {
    if (!line.trim()) continue;
    const fields = splitCsvLine(line);
    if (!header) {
      header = fields;
      continue;
    }
    const get = (name: string) => fields[header!.indexOf(name)] ?? '';
    const mag = Number(get('mag'));
    // The Sun is row 0 of HYG ("Sol", mag -26.7); drop it and any other impossible entry.
    if (!Number.isFinite(mag) || mag < -5) continue;
    rows.push({
      hip: get('hip') === '' ? null : Number(get('hip')),
      hd: get('hd') === '' ? null : Number(get('hd')),
      proper: get('proper'),
      bayer: get('bayer'),
      flam: get('flam'),
      con: get('con'),
      // HYG stores right ascension in hours, declination in degrees.
      ra: Number(get('ra')) * 15,
      dec: Number(get('dec')),
      mag,
      bv: Number(get('ci')),
    });
  }
  return rows;
}

interface D3Feature {
  id: string;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(new URL(path, RAW), 'utf8')) as T;
}

async function buildConstellations(): Promise<void> {
  const western = await readJson<{ features: D3Feature[] }>('d3-celestial/constellations.json');
  const westernLines = await readJson<{ features: D3Feature[] }>(
    'd3-celestial/constellations.lines.json',
  );
  const chinese = await readJson<{ features: D3Feature[] }>('d3-celestial/constellations.cn.json');
  const chineseLines = await readJson<{ features: D3Feature[] }>(
    'd3-celestial/constellations.lines.cn.json',
  );

  const lineById = new Map(
    westernLines.features.map((f) => [f.id, f.geometry.coordinates as number[][][]]),
  );
  const westernOut = western.features.map((feature) => ({
    id: feature.id,
    name: String(feature.properties.name ?? feature.id),
    nameZh: String(feature.properties.zh ?? feature.properties.name ?? feature.id),
    label: feature.geometry.coordinates as [number, number],
    lines: lineById.get(feature.id) ?? [],
  }));

  const cnLineById = new Map(
    chineseLines.features.map((f) => [f.id, f.geometry.coordinates as number[][][]]),
  );
  const chineseOut = chinese.features.map((feature) => ({
    id: feature.id,
    name: String(feature.properties.name ?? feature.id),
    nameEn: String(feature.properties.en ?? ''),
    pinyin: String(feature.properties.pinyin ?? ''),
    label: feature.geometry.coordinates as [number, number],
    lines: cnLineById.get(feature.id) ?? [],
  }));

  await writeFile(
    new URL('constellations.json', OUT),
    JSON.stringify({ license: 'BSD-3-Clause (d3-celestial, Olaf Frohn)', items: westernOut }),
  );
  await writeFile(
    new URL('constellations-cn.json', OUT),
    JSON.stringify({ license: 'BSD-3-Clause (d3-celestial, Olaf Frohn)', items: chineseOut }),
  );
  console.log(`星座：西方 ${westernOut.length} 个，中国星官 ${chineseOut.length} 组`);
}

/** Pixels that could contain a match: the star's own pixel plus probes across its edges. */
function candidatePixels(direction: Vec3): number[] {
  const probes: Vec3[] = [direction];
  const step = 0.5 * DEG;
  const offsets: Array<[number, number]> = [
    [step, 0],
    [-step, 0],
    [0, step],
    [0, -step],
  ];
  for (const [dRa, dDec] of offsets) {
    const shifted = sphericalToUnit(
      (Math.atan2(direction[1], direction[0]) / DEG + dRa / DEG + 360) % 360,
      Math.asin(Math.max(-1, Math.min(1, direction[2]))) / DEG + dDec / DEG,
    );
    probes.push(shifted);
  }
  return [...new Set(probes.map((probe) => vecToPixNest(MATCH_ORDER, probe)))];
}

async function main(): Promise<void> {
  const started = Date.now();
  await mkdir(new URL('stars/tiles/', OUT), { recursive: true });

  const rawFiles = await readdir(new URL('.', RAW));
  const gaiaFiles = rawFiles.filter((name) => /^gaia-dr3-g\d+-slice\d+\.csv$/.test(name)).sort();
  if (gaiaFiles.length === 0) {
    throw new Error('data/raw/ 下没有 Gaia 分片 CSV，请先运行 pnpm data:download');
  }
  const maxMag = Number(/^gaia-dr3-g(\d+)-/.exec(gaiaFiles[0]!)?.[1] ?? 12);
  console.log(`Gaia 分片 ${gaiaFiles.length} 个，极限星等 G < ${maxMag}`);

  const hyg = await readHyg();
  const starnames = await readJson<
    Record<string, { name?: string; bayer?: string; flam?: string }>
  >('d3-celestial/starnames.json');
  const starnamesCn = await readJson<Record<string, { name?: string; desig?: string }>>(
    'd3-celestial/starnames.cn.json',
  );
  const namedHyg: NamedHygStar[] = [];
  for (const row of hyg) {
    const byHip = row.hip !== null ? starnames[String(row.hip)] : undefined;
    const byHipCn = row.hip !== null ? starnamesCn[String(row.hip)] : undefined;
    const name = row.proper || byHip?.name || '';
    const bayer = row.bayer || byHip?.bayer || '';
    const flam = row.flam || byHip?.flam || '';
    const desig = bayer
      ? `${bayer} ${row.con}`
      : flam
        ? `${flam} ${row.con}`
        : (byHipCn?.desig ?? '');
    const nameZh = byHipCn?.name || '';
    if (!name && !desig && !nameZh) continue;
    namedHyg.push({
      name: name || desig,
      ...(nameZh ? { nameZh } : {}),
      ...(desig ? { desig } : {}),
      ...(row.con ? { con: row.con } : {}),
      ...(row.hip !== null ? { hip: row.hip } : {}),
      ...(row.hd !== null ? { hd: row.hd } : {}),
      ra: row.ra,
      dec: row.dec,
      mag: row.mag,
    });
  }
  console.log(`HYG：${hyg.length} 行，其中有名字的星 ${namedHyg.length} 颗`);

  const buckets = new Map<string, Bucket>();
  const matchIndex = new Map<number, Array<{ chunk: string; index: number }>>();
  const brightHyg = await readBrightHyg();
  let total = 0;
  let corrected = 0;

  for (const file of gaiaFiles) {
    let header: string[] | null = null;
    for await (const line of lines(new URL(file, RAW), false)) {
      if (!line.trim()) continue;
      const fields = splitCsvLine(line);
      if (!header) {
        header = fields;
        continue;
      }
      const get = (name: string) => fields[header!.indexOf(name)] ?? '';
      const gaiaMag = Number(get('phot_g_mean_mag'));
      if (!Number.isFinite(gaiaMag) || gaiaMag < -5) continue;
      const ra = Number(get('ra'));
      const dec = Number(get('dec'));
      if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
      const parallax = Number(get('parallax'));
      const pmRa = Number(get('pmra')) || 0;
      const pmDec = Number(get('pmdec')) || 0;
      const bp = Number(get('phot_bp_mean_mag'));
      const rp = Number(get('phot_rp_mean_mag'));
      const position = positionAtJ2000(ra, dec, pmRa, pmDec);
      const correction = brightCorrection(brightHyg, position, gaiaMag);
      if (correction) corrected++;
      const mag = correction ? correction.mag : gaiaMag;
      const bv =
        correction && Number.isFinite(correction.bv)
          ? correction.bv
          : Number.isFinite(bp) && Number.isFinite(rp)
            ? bpRpToBv(bp - rp)
            : BV_MISSING;
      const band = bandFor(mag);
      if (!band) continue;
      const pixel = band.order === null ? null : vecToPixNest(band.order, position);
      const key = chunkId(band, pixel);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { values: [], ids: [] };
        buckets.set(key, bucket);
      }
      const index = bucket.ids.length;
      bucket.values.push(
        position[0],
        position[1],
        position[2],
        mag,
        pmRa,
        pmDec,
        Number.isFinite(parallax) ? parallax : 0,
        bv,
      );
      bucket.ids.push(BigInt(get('source_id')));
      const matchPixel = vecToPixNest(MATCH_ORDER, position);
      const entry = { chunk: key, index };
      const list = matchIndex.get(matchPixel);
      if (list) list.push(entry);
      else matchIndex.set(matchPixel, [entry]);
      total++;
    }
    console.log(`  已处理 ${file}（累计 ${total.toLocaleString()} 颗）`);
  }
  console.log(`Gaia 合计 ${total.toLocaleString()} 颗，其中亮星光度校正 ${corrected} 颗`);

  const names: NameEntry[] = [];
  let matched = 0;
  for (const star of namedHyg) {
    const direction = sphericalToUnit(star.ra, star.dec);
    let best: { chunk: string; index: number; sep: number } | null = null;
    for (const pixel of candidatePixels(direction)) {
      for (const entry of matchIndex.get(pixel) ?? []) {
        const bucket = buckets.get(entry.chunk)!;
        const offset = entry.index * 8;
        const sep = Math.hypot(
          bucket.values[offset]! - direction[0],
          bucket.values[offset + 1]! - direction[1],
          bucket.values[offset + 2]! - direction[2],
        );
        if (sep < MATCH_TOLERANCE && (!best || sep < best.sep)) best = { ...entry, sep };
      }
    }
    if (!best) continue;
    matched++;
    const bucket = buckets.get(best.chunk)!;
    const offset = best.index * 8;
    names.push({ ...star, chunk: best.chunk, index: best.index, bv: bucket.values[offset + 7]! });
  }
  names.sort((a, b) => a.mag - b.mag);
  console.log(`命名星匹配：${matched}/${namedHyg.length}`);

  const manifestBands: Array<Record<string, unknown>> = [];
  const stats: Array<[string, number, number]> = [];
  for (const band of BANDS) {
    const bandBuckets = [...buckets.entries()]
      .filter(([key]) => key.startsWith(band.key))
      .sort(([a], [b]) => (band.order === null ? 0 : pixelOfChunk(band, a) - pixelOfChunk(band, b)));
    if (bandBuckets.length === 0) continue;
    let stars = 0;
    let bytes = 0;
    const tiles: Array<Record<string, unknown>> = [];
    for (const [key, bucket] of bandBuckets) {
      const floats = Float32Array.from(bucket.values);
      const ids = BigUint64Array.from(bucket.ids);
      const relative =
        band.order === null
          ? `stars/${band.key}.bin`
          : `stars/tiles/${band.key}/o${band.order}/${pixelOfChunk(band, key)}.bin`;
      const idsRelative = relative.replace(/\.bin$/, '.ids.bin');
      await mkdir(new URL('.', new URL(relative, OUT)), { recursive: true });
      await writeFile(new URL(relative, OUT), floats);
      await writeFile(new URL(idsRelative, OUT), ids);
      stars += bucket.ids.length;
      bytes += floats.byteLength + ids.byteLength;
      stats.push([relative, bucket.ids.length, floats.byteLength]);
      if (band.order !== null) {
        tiles.push({ pixel: pixelOfChunk(band, key), stars: bucket.ids.length, bytes: floats.byteLength });
      }
    }
    manifestBands.push({
      id: band.key,
      min: band.min,
      max: band.max,
      kind: band.order === null ? 'allsky' : 'tiles',
      ...(band.order === null
        ? { file: `stars/${band.key}.bin`, idsFile: `stars/${band.key}.ids.bin` }
        : { order: band.order, dir: `stars/tiles/${band.key}/o${band.order}`, tiles }),
      showBelowFov: band.showBelowFov,
      stars,
      bytes,
    });
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    epoch: 'J2000.0',
    frame: 'ICRS; Gaia DR3 proper motions propagated from 2016.0 to 2000.0',
    recordStrideBytes: 32,
    fields: ['x', 'y', 'z', 'mag', 'pmra', 'pmdec', 'parallax', 'bv'],
    bvMissing: BV_MISSING,
    maxMag,
    healpixScheme: 'nested',
    bands: manifestBands,
    names: { file: 'names.json', count: names.length },
    licenses: {
      gaia: 'Gaia DR3, CC BY-NC 3.0 IGO, ESA/Gaia/DPAC',
      hyg: 'HYG Database v4.4, CC BY-SA 4.0, astronexus',
      constellations: 'd3-celestial, BSD 3-Clause, Olaf Frohn',
    },
  };
  await writeFile(new URL('manifest.json', OUT), JSON.stringify(manifest, null, 2));
  await writeFile(new URL('names.json', OUT), JSON.stringify(names));
  await buildConstellations();

  let totalBytes = 0;
  for (const [file, starCount, byteCount] of stats) {
    totalBytes += byteCount;
    if (byteCount > 500000 || !file.includes('tiles')) {
      console.log(
        `  ${file.padEnd(46)} ${String(starCount).padStart(9)} 星  ${(byteCount / 1e6).toFixed(1)} MB`,
      );
    }
  }
  console.log(
    `完成：${total.toLocaleString()} 颗，${stats.length} 个星点文件，共 ${(totalBytes / 1e6).toFixed(1)} MB，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
