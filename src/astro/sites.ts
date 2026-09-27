import type { ObserverSite } from './frames';

export interface Site extends ObserverSite {
  id: string;
  nameZh: string;
  nameEn: string;
  country: string;
  hemisphere: 'north' | 'south';
  /** Extra sky brightness from light pollution, in magnitudes subtracted from a dark site. */
  lightPollutionMag: number;
  note?: string;
}

const site = (
  id: string,
  nameZh: string,
  nameEn: string,
  country: string,
  latitudeDeg: number,
  longitudeDeg: number,
  elevationM: number,
  lightPollutionMag: number,
  note?: string,
): Site => ({
  id,
  nameZh,
  nameEn,
  country,
  latitudeDeg,
  longitudeDeg,
  elevationM,
  lightPollutionMag,
  hemisphere: latitudeDeg >= 0 ? 'north' : 'south',
  ...(note ? { note } : {}),
});

export const DEFAULT_SITE_ID = 'shanghai';

/** 北半球：中国城市精简到几个有代表性的，其余取各大洲代表点。 */
export const NORTHERN_SITES: Site[] = [
  site('shanghai', '上海', 'Shanghai', '中国', 31.2304, 121.4737, 4, 2.2, '默认观测点'),
  site('beijing', '北京', 'Beijing', '中国', 39.9042, 116.4074, 44, 2.4),
  site('guangzhou', '广州', 'Guangzhou', '中国', 23.1291, 113.2644, 21, 2.0),
  site(
    'urumqi',
    '乌鲁木齐',
    'Ürümqi',
    '中国',
    43.8256,
    87.6168,
    918,
    1.5,
    '与上海地方时相差约 2 小时',
  ),
  site('lhasa', '拉萨', 'Lhasa', '中国', 29.652, 91.1721, 3656, 0.7, '高海拔，大气消光小'),
  site('tokyo', '东京', 'Tokyo', '日本', 35.6762, 139.6503, 40, 2.5),
  site(
    'singapore',
    '新加坡',
    'Singapore',
    '新加坡',
    1.3521,
    103.8198,
    15,
    2.2,
    '近赤道，可见全天大部分天区',
  ),
  site('mumbai', '孟买', 'Mumbai', '印度', 19.076, 72.8777, 14, 2.3),
  site('dubai', '迪拜', 'Dubai', '阿联酋', 25.2048, 55.2708, 5, 2.1),
  site('cairo', '开罗', 'Cairo', '埃及', 30.0444, 31.2357, 75, 2.3),
  site('athens', '雅典', 'Athens', '希腊', 37.9838, 23.7275, 70, 2.0),
  site('london', '伦敦', 'London', '英国', 51.5072, -0.1276, 11, 2.4),
  site('paris', '巴黎', 'Paris', '法国', 48.8566, 2.3522, 35, 2.4),
  site('reykjavik', '雷克雅未克', 'Reykjavík', '冰岛', 64.1466, -21.9426, 30, 1.0),
  site(
    'tromso',
    '特罗姆瑟',
    'Tromsø',
    '挪威',
    69.6492,
    18.9553,
    10,
    0.8,
    '北极圈内，可见极光与极夜',
  ),
  site('moscow', '莫斯科', 'Moscow', '俄罗斯', 55.7558, 37.6173, 156, 2.3),
  site('newyork', '纽约', 'New York', '美国', 40.7128, -74.006, 10, 2.5),
  site('losangeles', '洛杉矶', 'Los Angeles', '美国', 34.0522, -118.2437, 71, 2.5),
  site('chicago', '芝加哥', 'Chicago', '美国', 41.8781, -87.6298, 181, 2.4),
  site(
    'maunakea',
    '莫纳克亚',
    'Mauna Kea',
    '美国',
    19.8207,
    -155.4681,
    4205,
    0.2,
    '北半球顶级天文台',
  ),
  site(
    'lapalma',
    '拉帕尔马',
    'La Palma',
    '西班牙',
    28.7543,
    -17.8892,
    2396,
    0.2,
    ' Roque de los Muchachos 天文台',
  ),
];

/** 南半球：南天星空与北半球不同，因此多给一些点，含多个暗空台址与南极站。 */
export const SOUTHERN_SITES: Site[] = [
  site('sydney', '悉尼', 'Sydney', '澳大利亚', -33.8688, 151.2093, 58, 2.4),
  site('melbourne', '墨尔本', 'Melbourne', '澳大利亚', -37.8136, 144.9631, 31, 2.3),
  site('perth', '珀斯', 'Perth', '澳大利亚', -31.9505, 115.8605, 20, 1.9),
  site(
    'coonabarabran',
    '赛丁泉',
    'Siding Spring',
    '澳大利亚',
    -31.2733,
    149.0611,
    1165,
    0.3,
    '南半球暗空天文台',
  ),
  site('auckland', '奥克兰', 'Auckland', '新西兰', -36.8485, 174.7633, 10, 2.0),
  site('christchurch', '基督城', 'Christchurch', '新西兰', -43.5321, 172.6362, 15, 1.7),
  site(
    'lakeTekapo',
    '特卡波湖',
    'Lake Tekapo',
    '新西兰',
    -44.0044,
    170.4783,
    710,
    0.1,
    '国际暗天保护区',
  ),
  site('capetown', '开普敦', 'Cape Town', '南非', -33.9249, 18.4241, 25, 2.1),
  site(
    'sutherland',
    '萨瑟兰',
    'Sutherland',
    '南非',
    -32.3783,
    20.8114,
    1770,
    0.1,
    'SAAO 天文台，南天极附近',
  ),
  site('johannesburg', '约翰内斯堡', 'Johannesburg', '南非', -26.2041, 28.0473, 1753, 2.0),
  site('windhoek', '温得和克', 'Windhoek', '纳米比亚', -22.5609, 17.0658, 1655, 1.0),
  site('saopaulo', '圣保罗', 'São Paulo', '巴西', -23.5505, -46.6333, 760, 2.5),
  site('rio', '里约热内卢', 'Rio de Janeiro', '巴西', -22.9068, -43.1729, 35, 2.4),
  site('buenosaires', '布宜诺斯艾利斯', 'Buenos Aires', '阿根廷', -34.6037, -58.3816, 25, 2.4),
  site('santiago', '圣地亚哥', 'Santiago', '智利', -33.4489, -70.6693, 520, 2.2),
  site(
    'paranal',
    '帕拉纳尔',
    'Paranal',
    '智利',
    -24.6272,
    -70.4042,
    2635,
    0.0,
    'ESO VLT，世界上最暗的台址之一',
  ),
  site('alma', 'ALMA', 'ALMA', '智利', -23.0235, -67.7532, 5058, 0.0, '海拔 5 千米'),
  site('lima', '利马', 'Lima', '秘鲁', -12.0464, -77.0428, 13, 2.3),
  site('easternIsland', '复活节岛', 'Easter Island', '智利', -27.1127, -109.3497, 60, 0.4),
  site('papeete', '帕皮提', 'Papeete', '法属波利尼西亚', -17.5516, -149.5585, 5, 1.2),
  site('suva', '苏瓦', 'Suva', '斐济', -18.1248, 178.4501, 10, 1.3),
  site('antananarivo', '塔那那利佛', 'Antananarivo', '马达加斯加', -18.8792, 47.5079, 1276, 1.6),
  site(
    'zhongshan',
    '中山站',
    'Zhongshan Station',
    '南极',
    -69.3711,
    76.3742,
    15,
    0.0,
    '中国南极中山站，极昼极夜',
  ),
  site(
    'amundsenScott',
    '南极点站',
    'Amundsen–Scott',
    '南极',
    -90,
    0,
    2835,
    0.0,
    '南天极在天顶，星空不升不落',
  ),
];

export const SITES: Site[] = [...NORTHERN_SITES, ...SOUTHERN_SITES];

export function findSite(id: string): Site | undefined {
  return SITES.find((s) => s.id === id);
}

export function defaultSite(): Site {
  return findSite(DEFAULT_SITE_ID) ?? NORTHERN_SITES[0]!;
}

/** Custom observer position, for the latitude/longitude inputs. */
export function customSite(latitudeDeg: number, longitudeDeg: number, elevationM = 0): Site {
  return {
    id: 'custom',
    nameZh: '自定义位置',
    nameEn: 'Custom',
    country: '—',
    latitudeDeg,
    longitudeDeg,
    elevationM,
    lightPollutionMag: 0,
    hemisphere: latitudeDeg >= 0 ? 'north' : 'south',
  };
}
