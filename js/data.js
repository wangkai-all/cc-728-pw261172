/**
 * data.js — 本地矿物样本数据
 *
 * 读数状态四分类（原始测量语义，分析端永不覆盖）：
 *   measured  实测值（> 0）
 *   bdl       below detection limit，低于检测限：保留检测限，替换值由分析规则计算
 *   zero      确零：该成分确实不存在，不参与任何加常数替换
 *   missing   缺失：未测/无数据，既不是零也不是小值
 *
 * 每个读数保留 detectionLimit（检测限）与原始记录，单位记录在样品级。
 */

export const COMPONENTS = [
  { id: 'SiO2', name: 'SiO₂' },
  { id: 'Al2O3', name: 'Al₂O₃' },
  { id: 'Fe2O3', name: 'Fe₂O₃' },
  { id: 'MgO', name: 'MgO' },
  { id: 'CaO', name: 'CaO' },
  { id: 'Na2O', name: 'Na₂O' },
  { id: 'K2O', name: 'K₂O' },
  { id: 'TiO2', name: 'TiO₂' },
];

const m = (value) => ({ status: 'measured', value, detectionLimit: null });
const bdl = (detectionLimit) => ({ status: 'bdl', value: null, detectionLimit });
const zero = () => ({ status: 'zero', value: 0, detectionLimit: null });
const missing = () => ({ status: 'missing', value: null, detectionLimit: null });

export const SAMPLES = [
  {
    id: 'S1',
    name: '花岗岩 A',
    unit: 'wt%',
    note: '基准样品',
    readings: {
      SiO2: m(72.0), Al2O3: m(14.0), Fe2O3: m(2.5), MgO: m(0.6),
      CaO: m(1.8), Na2O: m(3.2), K2O: m(5.4), TiO2: bdl(0.15),
    },
  },
  {
    id: 'S2',
    name: '花岗岩 A · 稀释复测',
    unit: 'wt%',
    note: 'S1 全部读数精确减半：比例关系与 S1 完全相同，总量不同',
    readings: {
      SiO2: m(36.0), Al2O3: m(7.0), Fe2O3: m(1.25), MgO: m(0.3),
      CaO: m(0.9), Na2O: m(1.6), K2O: m(2.7), TiO2: bdl(0.075),
    },
  },
  {
    id: 'S3',
    name: '花岗岩 B',
    unit: 'wt%',
    note: '与 S1 总量接近但配比不同（富钠贫钾），用于等总量对照',
    readings: {
      SiO2: m(68.5), Al2O3: m(15.2), Fe2O3: m(3.4), MgO: m(0.9),
      CaO: m(2.6), Na2O: m(3.8), K2O: m(4.7), TiO2: m(0.35),
    },
  },
  {
    id: 'S4',
    name: '玄武岩 C',
    unit: 'wt%',
    note: '铁镁质配方，总量 99.2',
    readings: {
      SiO2: m(49.0), Al2O3: m(16.0), Fe2O3: m(11.0), MgO: m(7.5),
      CaO: m(9.8), Na2O: m(3.1), K2O: m(1.2), TiO2: m(1.6),
    },
  },
  {
    id: 'S5',
    name: '玄武岩 C · 浓缩读数',
    unit: 'wt%',
    note: 'S4 全部读数 ×1.25：比例完全相同、总量 124，距离应为 0',
    readings: {
      SiO2: m(61.25), Al2O3: m(20.0), Fe2O3: m(13.75), MgO: m(9.375),
      CaO: m(12.25), Na2O: m(3.875), K2O: m(1.5), TiO2: m(2.0),
    },
  },
  {
    id: 'S6',
    name: '灰岩 D',
    unit: 'wt%',
    note: 'K₂O 确零、Na₂O 缺失：支持集合不同，不与硅酸盐样品混排',
    readings: {
      SiO2: m(8.0), Al2O3: m(2.0), Fe2O3: m(1.0), MgO: m(2.5),
      CaO: m(84.0), Na2O: missing(), K2O: zero(), TiO2: bdl(0.08),
    },
  },
  {
    id: 'S7',
    name: '白云岩 E',
    unit: 'wt%',
    note: '与 S6 同一支持集合（无 K₂O、无 Na₂O 读数），可同组比较',
    readings: {
      SiO2: m(3.0), Al2O3: m(1.0), Fe2O3: m(0.8), MgO: m(21.0),
      CaO: m(72.0), Na2O: missing(), K2O: zero(), TiO2: bdl(0.06),
    },
  },
  {
    id: 'S8',
    name: '橄榄岩 F',
    unit: 'wt%',
    note: 'K₂O 确零但其余成分齐全：自成一个支持集合组',
    readings: {
      SiO2: m(44.0), Al2O3: m(3.5), Fe2O3: m(12.0), MgO: m(33.0),
      CaO: m(4.5), Na2O: m(0.8), K2O: zero(), TiO2: m(0.9),
    },
  },
  {
    id: 'S9',
    name: '花岗岩 A · 平行复检',
    unit: 'wt%',
    note: 'S1 加测量噪声后的平行样，应与 S1 聚在一簇',
    readings: {
      SiO2: m(71.2), Al2O3: m(14.5), Fe2O3: m(2.7), MgO: m(0.55),
      CaO: m(1.9), Na2O: m(3.0), K2O: m(5.6), TiO2: bdl(0.14),
    },
  },
  {
    id: 'S10',
    name: '富硅矿浆 G',
    unit: 'mg/kg',
    note: '单位不同但配比与 S1 完全相同（含检测限等比换算），闭合后距离应为 0',
    readings: {
      SiO2: m(360000), Al2O3: m(70000), Fe2O3: m(12500), MgO: m(3000),
      CaO: m(9000), Na2O: m(16000), K2O: m(27000), TiO2: bdl(750),
    },
  },
];

/** 替换量预设：BDL 读数按 检测限 × 倍数 做小量替换 */
export const MULTIPLIER_PRESETS = [0.25, 0.5, 0.65, 1.0];
export const DEFAULT_MULTIPLIER = 0.5;
