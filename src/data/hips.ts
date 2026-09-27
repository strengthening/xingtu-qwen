import { dataUrl } from './manifest';

export interface HipsProperties {
  order: number;
  tileWidth: number;
  format: string;
  frame: 'galactic' | 'equatorial';
  copyright: string;
}

/** HiPS tile path: Norder<n>/Dir<d>/<pixel>.<format> with d = floor(pixel / 10000) * 10000. */
export function hipsTilePath(order: number, pixel: number, format: string): string {
  const dir = Math.floor(pixel / 10000) * 10000;
  return `Norder${order}/Dir${dir}/${pixel}.${format}`;
}

export function parseHipsProperties(text: string): HipsProperties {
  const get = (key: string): string => {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm').exec(text);
    return match?.[1] ?? '';
  };
  return {
    order: Number(get('hips_order') || 0),
    tileWidth: Number(get('hips_tile_width') || 512),
    format: get('hips_tile_format') || 'jpeg',
    frame: get('hips_frame') === 'equatorial' ? 'equatorial' : 'galactic',
    copyright: get('obs_copyright'),
  };
}

/**
 * Minimal HiPS client: knows how to address tiles of a survey directory. The Milky Way
 * background ships as a locally generated survey (scripts/build-milkyway.ts), but any
 * CORS-enabled HiPS server can be pointed at by changing the base path.
 */
export class HipsSource {
  constructor(
    readonly basePath: string,
    readonly properties: HipsProperties,
  ) {}

  static async load(basePath: string): Promise<HipsSource> {
    const response = await fetch(dataUrl(`${basePath}properties`));
    if (!response.ok) throw new Error(`HiPS properties 加载失败：HTTP ${response.status}`);
    return new HipsSource(basePath, parseHipsProperties(await response.text()));
  }

  tileUrl(order: number, pixel: number): string {
    return dataUrl(`${this.basePath}${hipsTilePath(order, pixel, this.properties.format)}`);
  }
}
