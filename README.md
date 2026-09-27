# 星图 · Xingtu

浏览器端星空 / 天象仪：以 **Gaia DR3**（约 300 万颗，G < 12）为星表，用 **Three.js** 做
**方位立体投影**（Stellarium 默认投影）的天球渲染，用 **astronomy-engine** 做天文计算。
打开 `pnpm dev` 即看到当前时刻、默认上海上空的天空；拖拽转视角、滚轮缩放（改视场角），
放大后能一直看到比肉眼极限暗得多的星。

## 快速开始

```bash
pnpm install

# 1) 下载原始数据到 data/raw/（不入版本库；Gaia 约 480 MB，首次约 10-30 分钟）
pnpm data:download            # 默认 G < 12；试跑可用 pnpm data:download -- --max-mag 9

# 2) 预处理：星等分块 + HEALPix 切片 + 星名 + 星座连线 → public/data/
pnpm data:build

# 3) 生成自托管的 HiPS 银河瓦片（ESO 全景图 → public/data/hips/milkyway/）
pnpm data:milkyway

# 4) 启动开发服务器
pnpm dev
```

其它命令：

| 命令 | 作用 |
| --- | --- |
| `pnpm build` / `pnpm preview` | 类型检查 + 打包 / 预览产物 |
| `pnpm test` | Vitest 单测（astro 层） |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | 质量门禁 |
| `pnpm check` | lint + typecheck + test |

> 白天打开看到的是带大气散射的白昼天空；把时间调到当地夜间（或用时间流速快进）即见星空。
> 若 `public/data/` 缺失，页面状态栏会提示先运行上述数据命令。

## 功能

- **天球视角**：相机位于球心；鼠标拖拽转视角，滚轮改变视场角（0.4°–160°）。
- **立体投影**：顶点着色器实现方位立体投影，宽视场下不变形；拾取/标签用同一投影的解析逆变换。
- **星点渲染**：自定义 `ShaderMaterial` 点精灵；亮度按视星等压缩映射并带柔和光晕，
  颜色按 B-V 色指数→色温→RGB；按视场角决定加载与显示哪几档星等（见下）。
- **位置精度**：星表位置存 J2000 单位球向量；自行、周年光行差、周年视差在 GPU 按观测时刻推算，
  岁差+章动+地平转换由 CPU 每帧合成一个 3×3 矩阵传入。与 **JPL Horizons (DE441)** 对照，
  月/日的地平坐标差 < 0.02°（单测断言），即与 Stellarium 同量级模型下远小于 0.1°。
- **观测者**：经纬度 + 海拔 + 时间；预设地点分「北半球 / 南半球」两组（中国城市精简为
  上海/北京/广州/乌鲁木齐/拉萨，上海为默认；南半球含帕拉纳尔、ALMA、萨瑟兰、赛丁泉、
  特卡波湖、中山站、南极点站等 24 个点）；时间可暂停 / 倍速（1 分/秒 … 1 天/秒）/ 回到现在。
- **地平坐标系**：地平线、地平线以下近黑地面遮挡、东南西北方位标记。
- **太阳系天体**：太阳、月亮、八大行星的位置与视圆面（含月相晨昏线）。
- **标签**：亮星名默认只显示 mag < 2，随缩放逐步放宽；星座名 / 中国星官名可开关。
- **网格**：赤道网格与地平网格各自可开关。
- **星座连线**：西方 88 星座 + 中国三垣二十八宿等 312 组星官（d3-celestial，BSD-3）。
- **银河背景**：自托管 HiPS（ESO 全景图，CC BY 4.0），按视场选 order、按视锥取瓦片。
- **大气**：消光（随天顶距、海拔）、晨光/昏影、月光天光散射；「大气浓度」滑块 0–100%
  （默认 55%，夜间只留一层薄天光，不会盖住星星）；天光越亮星点对比度越低（星等补偿）。
- **信息卡**：点选星或天体，显示名称（中西文）、Gaia source_id、星等、色指数、距离、自行、
  赤道/地平坐标、大气质量、升落时间等。
- **分享**：URL 编码时间、地点、朝向（J2000 赤经赤纬）、视场、坐标架、大气与开关；
  「复制当前视角与时间链接」按钮 + 地址栏实时同步。

## 架构

```
src/
  astro/    纯计算，不依赖 Three.js，可单测
            time / frames(岁差章动光行差矩阵) / coordinates / bodies /
            atmosphere / colors / healpix(nested, 自实现) / sites / sky-context
  data/     manifest / star-chunks(按 FOV 选档与天区) / hips(HiPS 客户端)
  render/   projection(立体投影 GLSL+TS) / sky-camera / sky-uniforms /
            star-field / sky-background / grids / constellation-lines /
            solar-system / milky-way / labels / scene
  ui/       store / controls / status-bar / info-card / url / format
scripts/
  download-data.ts   原始数据下载（Gaia TAP 分片、HYG LFS、d3-celestial、ESO 图）
  build-stars.ts     星表预处理（分块/切片/星名/统计）
  build-milkyway.ts  全景图 → 本地 HiPS 瓦片
```

约定：

- 星点坐标只存**单位球**上的 J2000 赤道 xyz（float32 精度约 0.01″），距离信息只以视差形式参与方向修正；
  坐标转换全部在着色器里用 uniform 矩阵完成，CPU 每帧只算一个 3×3 矩阵与少量天体。
- 二进制记录 32 字节/星：`x y z mag pmra pmdec parallax bv`（两个 vec4 交错属性）。
- 星等分档与加载策略（`manifest.json` 的 `showBelowFov`）：

  | 档 | 星等 | 形态 | 视场角小于 |
  | --- | --- | --- | --- |
  | band-0/1 | < 6 | 全天整块，启动即载 | 始终 |
  | band-2 | 6–8 | 全天整块 | 45° |
  | band-3 | 8–9 | HEALPix order 1 切片 | 20° |
  | band-4 | 9–10 | order 2 切片 | 8° |
  | band-5 | 10–11 | order 3 切片 | 3° |
  | band-6 | 11–12 | order 3 切片 | 1.2° |

  G < 12 共约 297 万颗、95 MB（含 source_id 旁路文件）；宽视场只载约 2 MB。

## 数据来源与许可证

代码为 **MIT**（见 `LICENSE`）。数据各自遵循原始许可证，**不随仓库分发**，
由脚本下载/生成；网页页脚与本页同时注明：

| 数据 | 许可证 | 出处 |
| --- | --- | --- |
| Gaia DR3 星表 | **CC BY-NC 3.0 IGO（非商用）** | ESA/Gaia/DPAC，<https://www.cosmos.esa.int/web/gaia/dr3> |
| 亮星名 / 星等 / B-V | CC BY-SA 4.0 | HYG Database v4.4，astronexus，<https://codeberg.org/astronexus/hyg> |
| 星座连线、中国星官连线与名称、IAU 边界 | BSD 3-Clause | d3-celestial（Olaf Frohn），<https://github.com/ofrohn/d3-celestial> |
| 银河全景图 | CC BY 4.0 | ESO/S. Brunier（eso0932a），<https://www.eso.org/public/images/eso0932a/> |
| 天文计算库 | MIT | Astronomy Engine，<https://github.com/cosinekitty/astronomy> |
| 渲染库 | MIT | three.js |
| 位置基准（仅单测对照） | 公共领域（美国政府作品） | JPL Horizons，<https://ssd.jpl.nasa.gov/horizons/> |

Gaia 署名要求原文：*This work has made use of data from the European Space Agency (ESA)
mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and
Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium).*

> ⚠️ **Gaia DR3 为 CC BY-NC（非商业）许可**。本项目代码虽为 MIT，但若将站点用于商业目的，
> 需另行取得 ESA 授权，或改用 `pnpm data:download -- --max-mag 6` + 仅 HYG 的许可兼容组合。

## 精度与测试

`pnpm test`（52 项）覆盖：

- **天狼星**：上中天高度 = 90° − φ + δ（误差 < 0.05°）、中天时恒星时 = 当日视赤经、
  与 astronomy-engine `Horizon()` 差 < 1′；26 年岁差漂移量级正确。
- **日/月地平坐标**：2026-01-15 12:00 UTC 上海，对照 JPL Horizons（DE441，无折射）差 < 0.02°
  ——Stellarium 使用同一套 IAU 2006/2000A + VSOP/ELP 模型，故与 Stellarium 的差异同量级（< 0.1°）。
- **HEALPix**：投影等面积（Jacobian = 3/π）、nested 索引双射、像素中心/角点自洽、
  低差异采样下各像素计数偏差 < 5%、视锥查询不漏像素。
- **色温/颜色**：Ballesteros 公式对太阳给 5772 K ±1%，BP-RP→B-V 拟合残差 < 0.05 mag。

已知限制：未做引力光线偏折（太阳边缘处约 1.75″）；Gaia 对 G < 3 的亮星光度饱和，
预处理已用 HYG 的 V 星等校正（181 颗）；UT1-UTC 采用模型值，与 IERS 实测差 < 0.9 s（< 0.004°）。

## 下一阶段建议

1. **深空天体**：Messier / NGC / IC 面状天体（星云、星系、星团）符号与轮廓，数据可用
   CC BY 的 OpenNGC 或 NASA 公共领域图像。
2. **更深的星表与增量更新**：G < 14（约 740 万颗）分片 + Service Worker 离线缓存 +
   Brotli 压缩二进制；星表版本化 manifest 以支持增量下载。
3. **人造天体与历象**：ISS/TLE 卫星、流星雨辐射点、日月食与凌合事件的时间轴提示。
4. **渲染增强**：MSAA/_hdr 辉光后处理、星座图形艺术图（skyculture art）、
   月面/行星纹理与土星环、大气折射对地平附近天体的抬升。
5. **交互**：搜索框（星名/编号跳转并跟踪）、时间轴 scrubber、键盘漫游、
   移动端双指缩放与陀螺仪；WebGPU 后端以支撑 G < 15。
6. **公共 HiPS 接入**：CDS/Alasky 等公共 HiPS 瓦片服务恢复后，可在设置里切换
   「本地银河 / 远程巡天（DSS、2MASS…）」，客户端已按标准 HiPS 寻址实现。
