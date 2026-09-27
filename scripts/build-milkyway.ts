/**
 * 把 data/raw/milkyway-eso0932a.jpg（ESO/S. Brunier，CC BY 4.0）切成本地自托管的 HiPS：
 *
 *   pnpm data:milkyway
 *
 * 输出 public/data/hips/milkyway/{properties, Norder{n}/Dir0/*.jpeg}。
 * 巡天帧为银道坐标（脚本会先验证亮带位于图像水平中线），瓦片按 nested HEALPix 编号、
 * 目录与命名遵循 IVOA HiPS 约定，因此也能被任何标准 HiPS 客户端读取。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as jpeg from 'jpeg-js';

import { pixToAngNest, pixelCount } from '../src/astro/healpix';
import { RAD } from '../src/astro/vector';

const RAW = new URL('../data/raw/milkyway-eso0932a.jpg', import.meta.url);
const OUT = new URL('../public/data/hips/milkyway/', import.meta.url);

const ORDERS = [2, 3];
const TILE = 256;
const QUALITY = 82;

interface Decoded {
  width: number;
  height: number;
  data: Uint8Array;
}

function sampleBilinear(img: Decoded, u: number, v: number): [number, number, number] {
  const x = (((u % 1) + 1) % 1) * (img.width - 1);
  const y = Math.min(img.height - 1, Math.max(0, v * (img.height - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (px: number, py: number): [number, number, number] => {
    const i = (py * img.width + px) * 4;
    return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
  };
  const a = at(x0, y0);
  const b = at(x1, y0);
  const c = at(x0, y1);
  const d = at(x1, y1);
  const mix = (p: number, q: number, r: number, s: number): number =>
    p * (1 - fx) * (1 - fy) + q * fx * (1 - fy) + r * (1 - fx) * fy + s * fx * fy;
  return [mix(a[0], b[0], c[0], d[0]), mix(a[1], b[1], c[1], d[1]), mix(a[2], b[2], c[2], d[2])];
}

/** Galactic (l, b) in degrees → equirectangular image coordinates (u, v) in [0, 1]. */
function galacticToUv(lDeg: number, bDeg: number): [number, number] {
  return [(((lDeg % 360) + 360) % 360) / 360, (90 - bDeg) / 180];
}

/**
 * A galactic-framed panorama has its bright band along the horizontal centre of the image.
 * Verify that before slicing, so a wrongly framed source image fails loudly.
 */
function assertGalacticFrame(img: Decoded): void {
  const rows: number[] = [];
  for (let y = 0; y < img.height; y += 25) {
    let sum = 0;
    let n = 0;
    for (let x = 0; x < img.width; x += 25) {
      const i = (y * img.width + x) * 4;
      sum += (img.data[i]! + img.data[i + 1]! + img.data[i + 2]!) / 3;
      n++;
    }
    rows.push(sum / n);
  }
  const sorted = [...rows].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const brightest = rows.indexOf(Math.max(...rows));
  const centre = rows.length / 2;
  console.log(
    `最亮行位于 ${(((brightest * 25) / img.height) * 100).toFixed(1)}% 高度，亮度为中位数的 ${(Math.max(...rows) / median).toFixed(1)} 倍`,
  );
  if (Math.abs(brightest - centre) > rows.length * 0.05 || Math.max(...rows) < median * 3) {
    throw new Error('源图的亮带不在图像水平中线，似乎不是银道坐标全景图');
  }
}

async function main(): Promise<void> {
  const buffer = await readFile(RAW);
  const img = jpeg.decode(buffer, { maxMemoryUsageInMB: 4096, useTArray: true });
  const decoded: Decoded = { width: img.width, height: img.height, data: img.data };
  console.log(`源图 ${img.width}×${img.height}`);
  assertGalacticFrame(decoded);

  for (const order of ORDERS) {
    const dir = new URL(`Norder${order}/Dir0/`, OUT);
    await mkdir(dir, { recursive: true });
    const count = pixelCount(order);
    for (let pixel = 0; pixel < count; pixel++) {
      const rgb = new Uint8Array(TILE * TILE * 4);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const { theta, phi } = pixToAngNest(order, pixel, (x + 0.5) / TILE, (y + 0.5) / TILE);
          const [u, v] = galacticToUv(phi * RAD, 90 - theta * RAD);
          const [r, g, b] = sampleBilinear(decoded, u, v);
          const i = (y * TILE + x) * 4;
          rgb[i] = r;
          rgb[i + 1] = g;
          rgb[i + 2] = b;
          rgb[i + 3] = 255;
        }
      }
      const encoded = jpeg.encode({ width: TILE, height: TILE, data: rgb }, QUALITY);
      await writeFile(new URL(`${pixel}.jpeg`, dir), encoded.data);
    }
    console.log(`Norder${order}: ${count} 个瓦片`);
  }

  const properties = [
    'obs_title          = The Milky Way panorama (local HiPS)',
    'obs_collection     = ESO Milky Way panorama',
    'obs_copyright      = ESO/S. Brunier (CC BY 4.0)',
    'dataproduct_type   = image',
    'hips_frame         = galactic',
    `hips_order         = ${Math.max(...ORDERS)}`,
    `hips_tile_width    = ${TILE}`,
    'hips_tile_format   = jpeg',
    'hips_version       = 1.4',
    'hips_status        = private master',
    `hips_creation_date = ${new Date().toISOString()}`,
    'hips_builder       = xingtu scripts/build-milkyway.ts',
    'moc_sky_fraction   = 1',
  ].join('\n');
  await writeFile(new URL('properties', OUT), `${properties}\n`);
  console.log('完成：public/data/hips/milkyway/');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
