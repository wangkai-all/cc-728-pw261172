/**
 * math.js — 成分数据分析（Compositional Data Analysis）纯数学层
 *
 * 约定：
 * - 成分向量以普通数组表示，索引与成分名数组对齐
 * - 所有函数均为纯函数，不修改入参
 * - 仅处理严格正值；零值/缺失的语义由 analysis.js 先行处理
 */

/** 闭合到总和为 c（默认 1） */
export function closure(x, c = 1) {
  const s = x.reduce((a, b) => a + b, 0);
  if (!(s > 0)) throw new Error('闭合要求总和为正');
  return x.map((v) => (v * c) / s);
}

/** 自然对数逐元素 */
export function logVec(x) {
  return x.map((v) => {
    if (!(v > 0)) throw new Error('对数仅接受严格正值');
    return Math.log(v);
  });
}

/**
 * 等距对数比变换 CLR（centered log-ratio）
 * clr(x) = [ln(x_i / g(x))]，结果向量总和恒为 0
 */
export function clr(x) {
  const lx = logVec(x);
  const meanLog = lx.reduce((a, b) => a + b, 0) / lx.length;
  return lx.map((v) => v - meanLog);
}

/**
 * Aitchison 距离（成分数据的标准欧氏距离，定义在单纯形上）
 * d_A(x, y) = || clr(x) - clr(y) ||_2
 * 天然具备尺度不变性：x 与 kx 的结果一致（内部抵消，不依赖浮点重闭合）
 */
export function aitchisonDistance(x, y) {
  if (x.length !== y.length) throw new Error('两份成分维度不一致');
  const cx = clr(x);
  const cy = clr(y);
  let acc = 0;
  for (let i = 0; i < cx.length; i++) {
    const d = cx[i] - cy[i];
    acc += d * d;
  }
  return Math.sqrt(acc);
}

/** 两向量欧氏距离（用于 PCoA 空间等普通欧氏场景） */
export function euclideanDistance(a, b) {
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    acc += d * d;
  }
  return Math.sqrt(acc);
}

/**
 * 对称矩阵的 Jacobi 特征分解
 * @returns {{values:number[], vectors:number[][]}} vectors 的每一列为一个特征向量
 */
export function jacobiEigen(A, maxSweeps = 100, eps = 1e-12) {
  const n = A.length;
  const a = A.map((row) => row.slice());
  // V 初始为单位矩阵
  const v = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let offDiag = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) offDiag += a[p][q] * a[p][q];
    }
    if (offDiag < eps) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-15) continue;
        const app = a[p][p];
        const aqq = a[q][q];
        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        // 旋转 A
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        // 累积旋转到 V
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const values = a.map((row, i) => row[i]);
  // 按特征值降序排列，特征向量列同步排序
  const order = values.map((_, i) => i).sort((i, j) => values[j] - values[i]);
  const sortedValues = order.map((i) => values[i]);
  const sortedVectors = Array.from({ length: n }, (_, row) =>
    order.map((col) => v[row][col]),
  );
  return { values: sortedValues, vectors: sortedVectors };
}

/**
 * 经典多维标度（classical MDS / PCoA）
 * 由距离矩阵返回前 maxDims 个主坐标（特征值非正的轴返回 0 坐标）
 */
export function mds(D, maxDims = 2) {
  const n = D.length;
  if (n === 1) return { points: [[0, 0].slice(0, maxDims)], eigenvalues: [] };

  const H = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - 1 / n),
  );
  // B = -1/2 H D^(2) H
  const D2 = D.map((row) => row.map((d) => d * d));
  const B = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let k = 0; k < n; k++) {
        for (let l = 0; l < n; l++) {
          acc += H[i][k] * D2[k][l] * H[l][j];
        }
      }
      B[i][j] = -0.5 * acc;
    }
  }

  const { values, vectors } = jacobiEigen(B);
  const dims = Math.min(maxDims, n - 1);
  const points = Array.from({ length: n }, () => Array(dims).fill(0));
  for (let ax = 0; ax < dims; ax++) {
    const lambda = values[ax];
    if (lambda > 0) {
      const scale = Math.sqrt(lambda);
      for (let i = 0; i < n; i++) points[i][ax] = vectors[i][ax] * scale;
    }
  }
  return { points, eigenvalues: values };
}

/**
 * UPGMA 凝聚层次聚类（类平均法），基于距离矩阵
 * @returns 树节点 {id, left?, right?, height, leaves:number[], size:number}
 *          叶节点 id 为原始索引，内部节点 id 为 n、n+1、…
 */
export function upgma(D) {
  const n = D.length;
  const nodes = new Map();
  const active = new Set();
  for (let i = 0; i < n; i++) {
    nodes.set(i, { id: i, height: 0, leaves: [i], size: 1 });
    active.add(i);
  }
  const dist = D.map((row) => row.slice());
  let nextId = n;

  while (active.size > 1) {
    let bestI = null;
    let bestJ = null;
    let bestD = Infinity;
    for (const i of active) {
      for (const j of active) {
        if (i < j && dist[i][j] < bestD) {
          bestD = dist[i][j];
          bestI = i;
          bestJ = j;
        }
      }
    }
    const a = nodes.get(bestI);
    const b = nodes.get(bestJ);
    const merged = {
      id: nextId++,
      left: a,
      right: b,
      height: bestD / 2, // 二叉高度：两支在 bestD/2 处相接
      leaves: [...a.leaves, ...b.leaves],
      size: a.size + b.size,
    };
    nodes.set(merged.id, merged);
    // 按类大小加权的平均距离
    for (const k of active) {
      if (k === bestI || k === bestJ) continue;
      const d =
        (dist[bestI][k] * a.size + dist[bestJ][k] * b.size) /
        (a.size + b.size);
      dist[merged.id] ??= [];
      dist[merged.id][k] = d;
      dist[k] ??= [];
      dist[k][merged.id] = d;
    }
    dist[merged.id] ??= [];
    dist[merged.id][merged.id] = 0;
    active.delete(bestI);
    active.delete(bestJ);
    active.add(merged.id);
  }

  const rootId = [...active][0];
  return nodes.get(rootId);
}

/** 在给定高度切树，返回若干叶索引分组（按组内最小原索引排序，结果稳定） */
export function cutTree(root, height) {
  const groups = [];
  const walk = (node) => {
    if (node.left === undefined || node.height <= height) {
      groups.push(node.leaves.slice());
    } else {
      walk(node.left);
      walk(node.right);
    }
  };
  walk(root);
  return groups
    .map((g) => g.slice().sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0]);
}

/**
 * 切成恰好 k 个组：等价于在并查集上按合并高度依次合并 n-k 次
 * （同高度并列时按节点 id 打破平局，结果确定）
 */
export function cutTreeK(root, k) {
  const leaves = root.leaves;
  const n = leaves.length;
  const kk = Math.max(1, Math.min(k, n));
  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let cur = x;
    while (cur !== r) {
      const next = parent.get(cur);
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  for (const leaf of leaves) parent.set(leaf, leaf);
  const internals = [];
  const collect = (node) => {
    if (node.left !== undefined) {
      internals.push(node);
      parent.set(node.id, node.id);
      collect(node.left);
      collect(node.right);
    }
  };
  collect(root);
  internals.sort((a, b) => a.height - b.height || a.id - b.id);
  const merges = n - kk;
  for (let t = 0; t < merges; t++) {
    const node = internals[t];
    // 内部节点作为并查集新根：两支的根都指向它
    parent.set(find(node.left.id), node.id);
    parent.set(find(node.right.id), node.id);
  }
  const groupsMap = new Map();
  for (const leaf of leaves) {
    const rootId = find(leaf);
    if (!groupsMap.has(rootId)) groupsMap.set(rootId, []);
    groupsMap.get(rootId).push(leaf);
  }
  return [...groupsMap.values()]
    .map((g) => g.sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0]);
}

/** 平均秩（并列取平均），用于 Spearman 相关 */
export function rank(values) {
  const n = values.length;
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = Array(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Pearson 相关系数 */
export function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 1; // 常量向量：无分歧，视为完全一致
  return cov / Math.sqrt(va * vb);
}

/** Spearman 秩相关（距离矩阵稳定性用） */
export function spearman(a, b) {
  return pearson(rank(a), rank(b));
}

/** 取矩阵上三角（不含对角）的一维序列，保证两矩阵顺序一致 */
export function upperTriangular(M) {
  const out = [];
  for (let i = 0; i < M.length; i++) {
    for (let j = i + 1; j < M.length; j++) out.push(M[i][j]);
  }
  return out;
}

/** 两种分组划分之间的调整兰德指数（ARI），衡量分组一致性 */
export function adjustedRandIndex(labelsA, labelsB) {
  const n = labelsA.length;
  const cont = new Map();
  const rowSum = new Map();
  const colSum = new Map();
  for (let i = 0; i < n; i++) {
    const key = `${labelsA[i]}|${labelsB[i]}`;
    cont.set(key, (cont.get(key) ?? 0) + 1);
    rowSum.set(labelsA[i], (rowSum.get(labelsA[i]) ?? 0) + 1);
    colSum.set(labelsB[i], (colSum.get(labelsB[i]) ?? 0) + 1);
  }
  const choose2 = (x) => (x * (x - 1)) / 2;
  let index = 0;
  for (const v of cont.values()) index += choose2(v);
  let sumA = 0;
  for (const v of rowSum.values()) sumA += choose2(v);
  let sumB = 0;
  for (const v of colSum.values()) sumB += choose2(v);
  const expected = (sumA * sumB) / choose2(n);
  const maxIndex = 0.5 * (sumA + sumB);
  const denom = maxIndex - expected;
  if (denom === 0) return 1;
  return (index - expected) / denom;
}

/** 均值 */
export function mean(x) {
  return x.reduce((a, b) => a + b, 0) / x.length;
}

/** 样本标准差（n-1） */
export function std(x) {
  if (x.length < 2) return 0;
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1));
}

/** 变异系数 CV = std / mean（无量纲，跨 δ 比较距离漂移用） */
export function coeffOfVariation(x) {
  const m = mean(x);
  if (m === 0) return 0;
  return std(x) / m;
}
