import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAnalysis,
  comparePair,
  stabilityReport,
  clusterLabels,
  isSupported,
} from '../js/analysis.js';
import { SAMPLES, COMPONENTS, DEFAULT_MULTIPLIER } from '../js/data.js';

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const allIds = new Set(COMPONENTS.map((c) => c.id));

function build(multiplier = DEFAULT_MULTIPLIER, active = allIds) {
  return buildAnalysis({
    samples: SAMPLES,
    components: COMPONENTS,
    activeComponentIds: active,
    multiplier,
  });
}

test('支持集合分组：确零与缺失不进支持集合，BDL 进', () => {
  const state = build();
  const sizes = state.groups.map((g) => g.members.length).sort((a, b) => b - a);
  assert.deepEqual(sizes, [7, 2, 1]);
  // 花岗岩/玄武岩主组的支持成分含 TiO2（BDL 替换后为正）
  const main = state.groups[0];
  assert.ok(main.support.includes('TiO2'));
  // 灰岩组不含 K2O（确零）与 Na2O（缺失）
  const limestone = state.groups.find((g) => g.key.includes('CaO') && !g.support.includes('Na2O'));
  assert.ok(!limestone.support.includes('K2O'));
  assert.ok(!limestone.support.includes('Na2O'));
});

test('尺度不变性：S1/S2、S4/S5、S1/S10 的 Aitchison 距离全为 0', () => {
  const state = build();
  const main = state.groups[0];
  const idx = (id) => main.members.findIndex((m) => m.id === id);
  approx(main.matrix[idx('S1')][idx('S2')], 0, 1e-12);
  approx(main.matrix[idx('S4')][idx('S5')], 0, 1e-12);
  approx(main.matrix[idx('S1')][idx('S10')], 0, 1e-12);
  // 零距离对被识别为不变对
  const pairs = main.invariantPairs.map((p) => p.join('+'));
  assert.ok(pairs.includes('S1+S2'));
  assert.ok(pairs.includes('S4+S5'));
  assert.ok(pairs.includes('S1+S10'));
});

test('等总量但配比不同的样品距离显著大于 0', () => {
  const state = build();
  const main = state.groups[0];
  const idx = (id) => main.members.findIndex((m) => m.id === id);
  assert.ok(main.matrix[idx('S1')][idx('S3')] > 0.3);
  assert.ok(main.matrix[idx('S1')][idx('S4')] > 0.5);
});

test('BDL 替换：替换值 = 检测限 × 倍数，且替换后重新闭合到总和 1', () => {
  const state = build(0.5);
  const s1 = state.byId.S1;
  const ti = s1.rows.find((r) => r.compId === 'TiO2');
  assert.equal(ti.status, 'bdl');
  approx(ti.substituted, 0.15 * 0.5);
  const sum = s1.rows.filter((r) => r.supported).reduce((s, r) => s + r.closed, 0);
  approx(sum, 1, 1e-12);
  // 切换倍数后替换值同步变化
  const stateQ = build(0.25);
  approx(stateQ.byId.S1.rows.find((r) => r.compId === 'TiO2').substituted, 0.15 * 0.25);
});

test('确零成分绝不被替换或塞进距离', () => {
  const state = build();
  const s6 = state.byId.S6;
  const k = s6.rows.find((r) => r.compId === 'K2O');
  assert.equal(k.status, 'zero');
  assert.equal(k.substituted, null);
  assert.equal(k.closed, null);
  assert.ok(!s6.support.includes('K2O'));
});

test('原始测量不被分析管线修改', () => {
  const before = SAMPLES.find((s) => s.id === 'S1').readings.TiO2;
  const snapshot = JSON.stringify(before);
  build(0.65);
  build(0.25);
  assert.equal(JSON.stringify(SAMPLES.find((s) => s.id === 'S1').readings.TiO2), snapshot);
  assert.equal(before.value, null);
  assert.equal(before.status, 'bdl');
});

test('同组完整比较：差异最大的贡献成分被排在首位，clrDiff 平方和 = 距离平方', () => {
  const state = build();
  const cmp = comparePair(state, 'S1', 'S4');
  assert.equal(cmp.comparable, true);
  assert.equal(cmp.basis, 'full');
  const sse = cmp.contributions.reduce((s, r) => s + r.clrDiff ** 2, 0);
  approx(Math.sqrt(sse), cmp.distance, 1e-12);
  assert.ok(Math.abs(cmp.contributions[0].clrDiff) >= Math.abs(cmp.contributions.at(-1).clrDiff));
});

test('跨支持集合：仅在共同成分上做子成分比较，并给出降维说明', () => {
  const state = build();
  const cmp = comparePair(state, 'S1', 'S6');
  assert.equal(cmp.sameGroup, false);
  assert.equal(cmp.basis, 'subcomposition');
  assert.ok(cmp.common.length >= 2);
  assert.ok(!cmp.common.includes('K2O')); // S6 确零
  assert.ok(!cmp.common.includes('Na2O')); // S6 缺失
  assert.ok(cmp.onlyA.includes('Na2O'));
  assert.ok(cmp.onlyB.length === 0 || cmp.onlyB.every((id) => !cmp.common.includes(id)));
  assert.equal(typeof cmp.distance, 'number');
});

test('共同正成分少于 2 时判定不可直接比较', () => {
  // 删除成分，构造只剩一个共同支持成分的情形
  const active = new Set(['CaO', 'K2O', 'Na2O']);
  const state = build(0.5, active);
  const cmp = comparePair(state, 'S1', 'S6');
  // 共同支持成分只有 CaO（K2O 在 S6 确零，Na2O 缺失）
  assert.deepEqual(cmp.common, ['CaO']);
  assert.equal(cmp.comparable, false);
  assert.equal(cmp.distance, null);
});

test('删除成分：距离在保留成分上重新闭合计算，不沿用旧距离', () => {
  const full = build();
  const reduced = build(0.5, new Set(['SiO2', 'Al2O3', 'Fe2O3', 'MgO']));
  const mainFull = full.groups[0];
  const mainRed = reduced.groups[0];
  const iFull = mainFull.members.findIndex((m) => m.id === 'S1');
  const jFull = mainFull.members.findIndex((m) => m.id === 'S3');
  const iRed = mainRed.members.findIndex((m) => m.id === 'S1');
  const jRed = mainRed.members.findIndex((m) => m.id === 'S3');
  assert.ok(Math.abs(mainFull.matrix[iFull][jFull] - mainRed.matrix[iRed][jRed]) > 1e-6);
  // 但等比例对的距离仍为 0（尺度不变性在子成分上继续成立）
  approx(mainRed.matrix[iRed][mainRed.members.findIndex((m) => m.id === 'S2')], 0, 1e-12);
});

test('删除成分使支持集合重新分组', () => {
  const state = build(0.5, new Set(['SiO2', 'Al2O3', 'Fe2O3', 'MgO', 'CaO', 'TiO2']));
  // K2O/Na2O 被删除后，S6/S7 与主组的支持差异消失，组合并
  const keys = state.groups.map((g) => g.key);
  assert.equal(new Set(keys).size, state.groups.length);
  const merged = state.groups.find((g) => g.members.some((m) => m.id === 'S1') &&
    g.members.some((m) => m.id === 'S6'));
  assert.ok(merged);
});

test('稳定性报告：倍数变化时距离序高度一致、分组 ARI 为 1', () => {
  const report = stabilityReport({
    samples: SAMPLES,
    components: COMPONENTS,
    activeComponentIds: allIds,
    multipliers: [0.25, 0.5, 0.65, 1.0],
    k: 3,
  });
  assert.equal(report.multipliers.length, 4);
  const main = report.reports[0];
  for (const row of main.spearmanMatrix) {
    for (const rho of row) assert.ok(rho > 0.95, `Spearman ${rho} 过低`);
  }
  for (const ari of main.ariVsFirst) approx(ari, 1, 1e-9);
  assert.ok(main.pairCV.every((p) => Number.isFinite(p.cv)));
});

test('簇标签稳定且簇数受成员数约束', () => {
  const state = build();
  const main = state.groups[0];
  const labels = clusterLabels(main, 3);
  assert.equal(labels.length, main.members.length);
  assert.equal(new Set(labels).size, 3);
  // S1 与其比例相同的 S2、复检 S9 同簇
  const idx = (id) => main.members.findIndex((m) => m.id === id);
  assert.equal(labels[idx('S1')], labels[idx('S2')]);
});

test('isSupported 语义', () => {
  assert.equal(isSupported({ status: 'measured' }), true);
  assert.equal(isSupported({ status: 'bdl' }), true);
  assert.equal(isSupported({ status: 'zero' }), false);
  assert.equal(isSupported({ status: 'missing' }), false);
});
