/**
 * 下载原始数据到 data/raw/（不入版本库）。
 *
 *   pnpm data:download                 # Gaia G<12（约 310 万行）+ HYG + d3-celestial + 银河图
 *   pnpm data:download -- --max-mag 9  # 快速试跑：只下 G<9
 *
 * 数据来源与许可证见 README「数据来源与许可证」。
 */
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const RAW_DIR = new URL('../data/raw/', import.meta.url);

interface CliOptions {
  maxMag: number;
  raSlices: number;
  force: boolean;
  skipGaia: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { maxMag: 12, raSlices: 12, force: false, skipGaia: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--max-mag') options.maxMag = Number(argv[++i]);
    else if (arg === '--ra-slices') options.raSlices = Number(argv[++i]);
    else if (arg === '--force') options.force = true;
    else if (arg === '--skip-gaia') options.skipGaia = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

async function exists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.size > 0;
  } catch {
    return false;
  }
}

async function download(url: string, target: string, options: CliOptions): Promise<void> {
  const file = new URL(target, RAW_DIR);
  if (!options.force && (await exists(file.pathname))) {
    console.log(`跳过（已存在） ${target}`);
    return;
  }
  console.log(`下载 ${url}`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(file));
      const info = await stat(file);
      console.log(`  → ${target}  ${(info.size / 1e6).toFixed(1)} MB`);
      return;
    } catch (error) {
      console.warn(`  第 ${attempt} 次失败：${(error as Error).message}`);
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    }
  }
}

/** Gaia DR3 via the ESA TAP sync service, sliced in right ascension to stay under row caps. */
async function downloadGaia(options: CliOptions): Promise<void> {
  const sliceWidth = 360 / options.raSlices;
  for (let slice = 0; slice < options.raSlices; slice++) {
    const raMin = slice * sliceWidth;
    const raMax = raMin + sliceWidth;
    const query = [
      'SELECT source_id, ra, dec, parallax, pmra, pmdec,',
      ' phot_g_mean_mag, phot_bp_mean_mag, phot_rp_mean_mag, ref_epoch, ruwe',
      'FROM gaiadr3.gaia_source',
      `WHERE phot_g_mean_mag < ${options.maxMag}`,
      ` AND ra >= ${raMin} AND ra < ${raMax}`,
      'ORDER BY source_id',
    ].join(' ');
    const body = new URLSearchParams({
      REQUEST: 'doQuery',
      LANG: 'ADQL',
      FORMAT: 'csv',
      QUERY: query,
    });
    const target = `gaia-dr3-g${options.maxMag}-slice${String(slice).padStart(2, '0')}.csv`;
    const file = new URL(target, RAW_DIR);
    if (!options.force && (await exists(file.pathname))) {
      console.log(`跳过（已存在） ${target}`);
      continue;
    }
    console.log(`Gaia TAP 分片 ${slice + 1}/${options.raSlices}  ra ∈ [${raMin}, ${raMax})`);
    await postStream('https://gea.esac.esa.int/tap-server/tap/sync', body, target);
  }
}

async function postStream(url: string, body: URLSearchParams, target: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { method: 'POST', body });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const file = new URL(target, RAW_DIR);
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(file));
      const info = await stat(file);
      console.log(`  → ${target}  ${(info.size / 1e6).toFixed(1)} MB`);
      return;
    } catch (error) {
      console.warn(`  第 ${attempt} 次失败：${(error as Error).message}`);
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10000 * attempt));
    }
  }
}

const HYG_RAW_URL = 'https://codeberg.org/astronexus/hyg/raw/branch/main/data/hyg/CURRENT/hyg_v44.csv.gz';
const HYG_REPO = 'https://codeberg.org/astronexus/hyg';

/**
 * HYG lives in Git LFS on Codeberg: the raw URL yields a ~130 byte pointer, so resolve the
 * object through the repository's LFS batch API and stream the real file.
 */
async function downloadHyg(options: CliOptions): Promise<void> {
  const target = 'hyg_v44.csv.gz';
  const file = new URL(target, RAW_DIR);
  if (!options.force && (await exists(file.pathname)) && (await stat(file.pathname)).size > 10000) {
    console.log(`跳过（已存在） ${target}`);
    return;
  }
  console.log(`下载 ${HYG_RAW_URL}（Git LFS）`);
  const pointer = await (await fetch(HYG_RAW_URL)).text();
  const oid = /oid sha256:([0-9a-f]{64})/.exec(pointer)?.[1];
  const size = Number(/size (\d+)/.exec(pointer)?.[1] ?? 0);
  if (!oid || !size) throw new Error('HYG 原始文件不是 LFS 指针，无法解析');
  const batch = await fetch(`${HYG_REPO}.git/info/lfs/objects/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.git-lfs+json',
      Accept: 'application/vnd.git-lfs+json',
    },
    body: JSON.stringify({
      operation: 'download',
      transfers: ['basic'],
      objects: [{ oid, size }],
    }),
  });
  const payload = (await batch.json()) as {
    objects?: Array<{ actions?: { download?: { href?: string } } }>;
  };
  const href = payload.objects?.[0]?.actions?.download?.href;
  if (!href) throw new Error('LFS batch API 未返回下载地址');
  await download(href, target, { ...options, force: true });
}

const D3_CELESTIAL_BASE = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/';
const D3_CELESTIAL_FILES = [
  'constellations.json',
  'constellations.cn.json',
  'constellations.lines.json',
  'constellations.lines.cn.json',
  'constellations.bounds.json',
  'constellations.borders.cn.json',
  'starnames.json',
  'starnames.cn.json',
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(new URL('.', RAW_DIR), { recursive: true });
  await mkdir(new URL('d3-celestial/', RAW_DIR), { recursive: true });

  if (!options.skipGaia) await downloadGaia(options);

  await downloadHyg(options);

  for (const name of D3_CELESTIAL_FILES) {
    await download(`${D3_CELESTIAL_BASE}${name}`, `d3-celestial/${name}`, options);
  }

  await download('https://cdn.eso.org/images/large/eso0932a.jpg', 'milkyway-eso0932a.jpg', options);

  console.log('下载完成。下一步：pnpm data:build');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
