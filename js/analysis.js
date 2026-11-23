/**
 * analysis.js — 分析管线
 *
 * 分层原则：data.js 的原始测量永不被修改；本模块的全部输出（替换值、闭合值、
 * CLR、距离、分组）都在独立的分析状态对象上。任何参数变化（替换倍数、删除
 * 成分）都从零重建管线，距离矩阵不会沿用旧结果。
 */

import {
  closure,
  clr,
  aitchisonDistance,
  upgma,
  cutTree,
  cutTreeK,
  mds,
  spearman,
  upperTriangular,
  adjustedRandIndex,
  coeffOfVariation,
} from './math.js';

/** 支持集合的纳入条件：实测值或低于检测限（替换后为正）；确零与缺失不纳入 */
export function isSupported(reading) {
  return reading.status === 'measured' || reading.status === 'bdl';
}

/** BDL 替换值：检测限 × 倍数 */
export function substituteBDL(reading, multiplier) {
  if (reading.status !== 'bdl') return reading.value;
  return reading.detectionLimit * multiplier;
}

/**
 * 构建完整分析状态（纯函数）
 * @param {object} opts
 * @param {Array}  opts.samples        data.js 的样品（只读）
 * @param {Array}  opts.components     全局成分定义
 * @param {Set<string>} opts.activeComponentIds 保留的成分 id（删除成分即移除）
 * @param {number} opts.multiplier     BDL 替换倍数
 */
export function buildAnalysis({ samples, components, activeComponentIds, multiplier }) {
  const active = components.filter((c) => activeComponentIds.has(c.id));

  // ---- 逐样品：支持集合 + 替换后原始向量 + 重闭合 + CLR ----
  const perSample = samples.map((sample) => {
    const rows = active.map((comp) => {
      const reading = sample.readings[comp.id];
      const supported = isSupported(reading);
      const substituted = supported ? substituteBDL(reading, multiplier) : null;
      return {
        compId: comp.id,
        compName: comp.name,
        status: reading.status,
        rawValue: reading.value,
        detectionLimit: reading.detectionLimit,
        supported,
        substituted, // 替换后、闭合前的原始量纲值；确零/缺失为 null
      };
    });
    const support = rows.filter((r) => r.supported).map((r) => r.compId);
    const supportKey = support.join('|');
    const subVector = rows.filter((r) => r.supported).map((r) => r.substituted);
    const totalRaw = subVector.reduce((a, b) => a + b, 0);
    const closedVector = subVector.length ? closure(subVector, 1) : [];
    const clrVector = closedVector.length >= 2 ? clr(closedVector) : [];

    // 把闭合值/CLR 写回行（仅分析侧）
    let ci = 0;
    for (const row of rows) {
      if (row.supported) {
        row.closed = closedVector[ci];
        row.clr = clrVector[ci];
        ci++;
      } else {
        row.closed = null;
        row.clr = null;
      }
    }
    return {
      id: sample.id,
      sample,
      rows,
      support,
      supportKey,
      totalRaw,
      unit: sample.unit,
      clrByComp: Object.fromEntries(
        rows.filter((r) => r.supported).map((r) => [r.compId, r.clr]),
      ),
      closedByComp: Object.fromEntries(
        rows.filter((r) => r.supported).map((r) => [r.compId, r.closed]),
      ),
      substitutedByComp: Object.fromEntries(
        rows.filter((r) => r.supported).map((r) => [r.compId, r.substituted]),
      ),
    };
  });

  // ---- 按支持集合分组 ----
  const groupMap = new Map();
  for (const ps of perSample) {
    if (!groupMap.has(ps.supportKey)) {
      groupMap.set(ps.supportKey, {
        key: ps.supportKey,
        support: ps.support,
        members: [],
      });
    }
    groupMap.get(ps.supportKey).members.push(ps);
  }
  const groups = [...groupMap.values()].sort(
    (a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key),
  );
  groups.forEach((g, gi) => {
    g.index = gi;
    g.lowSupport = g.support.length < 3;
    for (const ps of g.members) ps.groupIndex = gi;
  });

  // ---- 组内距离矩阵、UPGMA、PCoA ----
  for (const g of groups) {
    const n = g.members.length;
    g.matrix = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = aitchisonDistance(
          g.members[i].rows.filter((r) => r.supported).map((r) => r.closed),
          g.members[j].rows.filter((r) => r.supported).map((r) => r.closed),
        );
        g.matrix[i][j] = d;
        g.matrix[j][i] = d;
      }
    }
    g.tree = n >= 2 ? upgma(g.matrix) : null;
    g.mds = n >= 2 ? mds(g.matrix, 2) : { points: [[0, 0]], eigenvalues: [] };
    g.invariantPairs = findInvariantPairs(g);
  }

  return {
    active,
    perSample,
    groups,
    multiplier,
    byId: Object.fromEntries(perSample.map((ps) => [ps.id, ps])),
  };
}

/** 组内距离为 0（数值容差内）的样品对：整组同乘一个倍数时应命中 */
function findInvariantPairs(group) {
  const out = [];
  for (let i = 0; i < group.members.length; i++) {
    for (let j = i + 1; j < group.members.length; j++) {
      if (group.matrix[i][j] < 1e-9) {
        out.push([group.members[i].id, group.members[j].id]);
      }
    }
  }
  return out;
}

/** 按目标簇数切组内的树，返回每个成员的簇标签（0..k-1，按叶序稳定编号） */
export function clusterLabels(group, k) {
  const n = group.members.length;
  const kk = Math.max(1, Math.min(k, n));
  const partitions = cutTreeK(group.tree, kk);
  const labels = Array(n).fill(0);
  partitions.forEach((part, label) => {
    for (const leaf of part) labels[leaf] = label;
  });
  return labels;
}

/**
 * 两份样品的成对比较
 * - 同支持集合：在完整支持成分上比较
 * - 不同支持集合：仅在共同正成分上做子成分比较；共同成分 < 2 时不可直接比较
 * 全部基于当前分析状态实时计算，不读取缓存距离。
 */
export function comparePair(state, idA, idB) {
  const a = state.byId[idA];
  const b = state.byId[idB];
  const sameGroup = a.groupIndex === b.groupIndex;

  const setA = new Set(a.support);
  const setB = new Set(b.support);
  const common = state.active
    .map((c) => c.id)
    .filter((id) => setA.has(id) && setB.has(id));
  const onlyA = a.support.filter((id) => !setB.has(id));
  const onlyB = b.support.filter((id) => !setA.has(id));

  const comparable = common.length >= 2;
  const weak = comparable && common.length < 3;

  let distance = null;
  let clrA = null;
  let clrB = null;
  if (comparable) {
    // 子成分：仅取共同成分并重新闭合——删除/缺成分时比例在保留成分间重新建立
    const va = common.map((id) => a.substitutedByComp[id]);
    const vb = common.map((id) => b.substitutedByComp[id]);
    const ca = closure(va, 1);
    const cb = closure(vb, 1);
    clrA = clr(ca);
    clrB = clr(cb);
    distance = aitchisonDistance(ca, cb);
  }

  const rows = state.active.map((comp) => {
    const ra = a.sample.readings[comp.id];
    const rb = b.sample.readings[comp.id];
    const inCommon = common.includes(comp.id);
    const idx = common.indexOf(comp.id);
    return {
      compId: comp.id,
      compName: comp.name,
      statusA: ra.status,
      statusB: rb.status,
      dlA: ra.detectionLimit,
      dlB: rb.detectionLimit,
      rawA: ra.value,
      rawB: rb.value,
      replacedA: inCommon ? a.substitutedByComp[comp.id] : null,
      replacedB: inCommon ? b.substitutedByComp[comp.id] : null,
      closedA: null,
      closedB: null,
      clrDiff: inCommon && comparable ? clrA[idx] - clrB[idx] : null,
      inCommon,
    };
  });
  // 闭合份额用更直接的方式重算，避免上面的反推
  if (comparable) {
    const ca = closure(common.map((id) => a.substitutedByComp[id]), 1);
    const cb = closure(common.map((id) => b.substitutedByComp[id]), 1);
    rows.forEach((r) => {
      if (r.inCommon) {
        const idx = common.indexOf(r.compId);
        r.closedA = ca[idx];
        r.closedB = cb[idx];
      }
    });
  }
  const contributions = rows
    .filter((r) => r.inCommon)
    .sort((x, y) => Math.abs(y.clrDiff) - Math.abs(x.clrDiff));

  return {
    idA,
    idB,
    sameGroup,
    comparable,
    weak,
    basis: sameGroup ? 'full' : 'subcomposition',
    common,
    onlyA,
    onlyB,
    distance,
    rows,
    contributions,
  };
}

/**
 * 替换量稳定性评估：在多个倍数下各重建一次管线，比较距离序与分组
 * @returns 每个组的 Spearman 矩阵、ARI 序列、逐对距离 CV
 */
export function stabilityReport({ samples, components, activeComponentIds, multipliers, k }) {
  const runs = multipliers.map((multiplier) =>
    buildAnalysis({ samples, components, activeComponentIds, multiplier }),
  );
  // 组成员在不同倍数下不变（支持集合与倍数无关），以首个运行为准对齐
  const base = runs[0];
  const reports = base.groups.map((group, gi) => {
    const n = group.members.length;
    const ids = group.members.map((m) => m.id);
    const vectors = runs.map((run) =>
      upperTriangular(run.groups[gi].matrix),
    );
    const spearmanMatrix = vectors.map((va) =>
      vectors.map((vb) => (va.length >= 2 ? spearman(va, vb) : 1)),
    );
    const labelsPerRun = runs.map((run) =>
      n >= 2 ? clusterLabels(run.groups[gi], Math.min(k, n)) : [0],
    );
    const ariVsFirst = labelsPerRun.map((labels) =>
      adjustedRandIndex(labelsPerRun[0], labels),
    );
    // 逐样品对跨倍数的变异系数
    const pairCV = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const series = runs.map((run) => run.groups[gi].matrix[i][j]);
        pairCV.push({
          pair: [ids[i], ids[j]],
          cv: coeffOfVariation(series),
          mean: series.reduce((a, b) => a + b, 0) / series.length,
          values: series,
        });
      }
    }
    pairCV.sort((a, b) => b.cv - a.cv);
    return {
      groupIndex: gi,
      ids,
      support: group.support,
      spearmanMatrix,
      ariVsFirst,
      pairCV,
    };
  });
  return { multipliers, reports };
}

export { cutTree, cutTreeK };
