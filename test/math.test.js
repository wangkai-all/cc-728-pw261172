import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  closure,
  clr,
  aitchisonDistance,
  euclideanDistance,
  jacobiEigen,
  mds,
  upgma,
  cutTreeK,
  rank,
  pearson,
  spearman,
  adjustedRandIndex,
  upperTriangular,
} from '../js/math.js';

const approx = (a, b, eps = 1e-10) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

test('闭合向量总和为目标值且保持比例', () => {
  const c = closure([2, 3, 5], 1);
  approx(c.reduce((a, b) => a + b, 0), 1);
  approx(c[0] / c[1], 2 / 3);
  const c100 = closure([2, 3, 5], 100);
  approx(c100.reduce((a, b) => a + b, 0), 100);
});

test('CLR 结果分量和恒为 0', () => {
  const z = clr([0.1, 0.4, 0.5]);
  approx(z.reduce((a, b) => a + b, 0), 0);
});

test('Aitchison 距离的已知两成分解析值', () => {
  // d_A = (1/√2) · | ln((x1/x2)/(y1/y2)) |
  const expected = Math.abs(Math.log((0.3 / 0.7) / (0.4 / 0.6))) / Math.sqrt(2);
  approx(aitchisonDistance([0.3, 0.7], [0.4, 0.6]), expected, 1e-12);
});

test('尺度不变性：整组乘任意正倍数距离为 0，无需依赖重闭合', () => {
  const x = [12, 3, 7, 0.4];
  for (const k of [0.001, 0.5, 2, 37, 5000]) {
    approx(aitchisonDistance(x, x.map((v) => v * k)), 0, 1e-12);
  }
});

test('闭合后不同总量的等比例样品距离为 0', () => {
  const a = closure([72, 14, 2.5, 0.6]);
  const b = closure([36, 7, 1.25, 0.3]);
  approx(aitchisonDistance(a, b), 0, 1e-12);
});

test('Jacobi 特征分解：特征值降序、正交、可重构原矩阵', () => {
  const A = [
    [2, 1, 0],
    [1, 3, 1],
    [0, 1, 4],
  ];
  const { values, vectors } = jacobiEigen(A);
  assert.ok(values[0] >= values[1] && values[1] >= values[2]);
  approx(values[0] + values[1] + values[2], 9, 1e-10); // 迹守恒
  // V 正交
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let dot = 0;
      for (let r = 0; r < 3; r++) dot += vectors[r][i] * vectors[r][j];
      approx(dot, i === j ? 1 : 0, 1e-9);
    }
  }
});

test('MDS：低维嵌入保持输入距离', () => {
  // 4 个点的欧氏距离矩阵（本质维 2）
  const pts = [
    [0, 0],
    [1, 0],
    [0, 2],
    [3, 1],
  ];
  const D = pts.map((p) => pts.map((q) => euclideanDistance(p, q)));
  const { points } = mds(D, 2);
  const D2 = points.map((p) => points.map((q) => euclideanDistance(p, q)));
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) approx(D2[i][j], D[i][j], 1e-9);
  }
});

test('UPGMA：最近的两类先合并，cutTreeK 返回指定簇数', () => {
  const D = [
    [0, 1, 5, 5],
    [1, 0, 5, 5],
    [5, 5, 0, 2],
    [5, 5, 2, 0],
  ];
  const tree = upgma(D);
  // 两小类之间的平均距离 (5+5+5+5)/4 = 5，根半高 2.5
  approx(tree.height, 2.5, 1e-12);
  const parts2 = cutTreeK(tree, 2);
  assert.equal(parts2.length, 2);
  assert.deepEqual(parts2, [
    [0, 1],
    [2, 3],
  ]);
  const parts3 = cutTreeK(tree, 3);
  assert.equal(parts3.length, 3);
  const parts1 = cutTreeK(tree, 1);
  assert.equal(parts1.length, 1);
});

test('并列秩取平均', () => {
  assert.deepEqual(rank([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
});

test('Pearson / Spearman：完全正相关与完全逆序', () => {
  approx(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  approx(spearman([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  approx(spearman([3, 1, 4, 1, 5], [30, 10, 40, 10, 50]), 1);
});

test('ARI：相同划分=1，常量退化=1', () => {
  approx(adjustedRandIndex([0, 0, 1, 1], [2, 2, 3, 3]), 1);
  approx(adjustedRandIndex([0, 0, 0, 0], [1, 1, 1, 1]), 1);
  assert.ok(adjustedRandIndex([0, 0, 1, 1], [0, 1, 0, 1]) < 0);
});

test('上三角展平顺序稳定', () => {
  assert.deepEqual(
    upperTriangular([
      [0, 1, 2],
      [1, 0, 3],
      [2, 3, 0],
    ]),
    [1, 2, 3],
  );
});
