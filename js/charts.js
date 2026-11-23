/**
 * charts.js — 纯 SVG 图表渲染
 * 设计依据 dataviz 规范：顺序色用蓝色单色 ramp、发散用蓝/红对、簇色取前三个
 * 分类槽位（all-pairs 安全）+ 形状辅助编码；文字一律文本 token；
 * 标签与提示均用 textContent，不拼 innerHTML；每个标记带悬停提示与放大命中区。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const CLUSTER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#e87ba4'];
const BLUE_RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281'];
const DIVERGING_NEG = '#2a78d6'; // 蓝：A 相对占优
const DIVERGING_POS = '#e34948'; // 红：B 相对占优

function el(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** 全局浮动提示（单例），所有图表共用 */
let tooltipEl = null;
function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'chart-tooltip';
    tooltipEl.hidden = true;
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function attachTip(target, lines) {
  const show = (evt) => {
    const tip = ensureTooltip();
    tip.replaceChildren();
    lines.forEach((line, i) => {
      const div = document.createElement('div');
      div.className = i === 0 ? 'tip-title' : 'tip-row';
      div.textContent = line;
      tip.appendChild(div);
    });
    tip.hidden = false;
    moveTip(evt);
  };
  const moveTip = (evt) => {
    const tip = ensureTooltip();
    const pad = 14;
    const rect = tip.getBoundingClientRect();
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hide = () => {
    ensureTooltip().hidden = true;
  };
  target.addEventListener('pointermove', moveTip);
  target.addEventListener('pointerenter', show);
  target.addEventListener('pointerleave', hide);
  target.addEventListener('focus', show);
  target.addEventListener('blur', hide);
}

function rampColor(t) {
  const idx = Math.max(0, Math.min(BLUE_RAMP.length - 1, Math.round(t * (BLUE_RAMP.length - 1))));
  return BLUE_RAMP[idx];
}

/**
 * Aitchison 距离热图（对称矩阵，对角线留空）
 * @param onCell (i,j) 点击回调，用于直接选样品对
 */
export function renderHeatmap(container, { labels, matrix, selectedPair, onCell }) {
  container.replaceChildren();
  const n = labels.length;
  const cell = 44;
  const labelW = 108;
  const labelH = 108;
  const size = n * cell;
  const svg = el('svg', {
    width: labelW + size,
    height: labelH + size + 28,
    viewBox: `0 0 ${labelW + size} ${labelH + size + 28}`,
    role: 'img',
  });
  svg.setAttribute('aria-label', 'Aitchison 距离热图');

  const maxD = Math.max(...matrix.flat().filter((d) => d > 0), 1e-9);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = labelW + j * cell;
      const y = labelH + i * cell;
      if (i === j) {
        svg.appendChild(el('rect', { x, y, width: cell, height: cell, fill: 'var(--grid)', rx: 2 }));
        continue;
      }
      const d = matrix[i][j];
      const isSel = selectedPair &&
        ((selectedPair[0] === i && selectedPair[1] === j) || (selectedPair[0] === j && selectedPair[1] === i));
      const rect = el('rect', {
        x: x + 1.5, y: y + 1.5, width: cell - 3, height: cell - 3,
        fill: rampColor(d / maxD), rx: 3,
        stroke: isSel ? 'var(--accent)' : 'none',
        'stroke-width': isSel ? 2.5 : 0,
        tabindex: 0,
        role: 'button',
        cursor: 'pointer',
      });
      rect.appendChild(el('title', {}, `${labels[i]} × ${labels[j]}`));
      // 深蓝格固定白字，浅蓝格用主墨色（明/暗主题下均保持对比）
      const ink = d / maxD > 0.55 ? '#ffffff' : 'var(--ink-primary)';
      const txt = el('text', {
        x: x + cell / 2, y: y + cell / 2 + 4,
        'text-anchor': 'middle', 'font-size': 11,
        fill: ink, 'pointer-events': 'none',
      }, d.toFixed(2));
      svg.appendChild(rect);
      svg.appendChild(txt);
      attachTip(rect, [`${labels[i]} ↔ ${labels[j]}`, `Aitchison 距离 ${d.toFixed(3)}`, '点击查看成分级差异']);
      rect.addEventListener('click', () => onCell(i, j));
      rect.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCell(i, j);
        }
      });
    }
    // 行标签
    const rowLabel = el('text', {
      x: labelW - 8, y: labelH + i * cell + cell / 2 + 4,
      'text-anchor': 'end', 'font-size': 12, fill: 'var(--ink-secondary)',
    }, labels[i]);
    svg.appendChild(rowLabel);
  }
  // 列标签（旋转，独立循环）
  for (let j = 0; j < n; j++) {
    const cx = labelW + j * cell + cell / 2;
    const colLabel = el('text', {
      x: cx, y: labelH - 8,
      'text-anchor': 'end', 'font-size': 12, fill: 'var(--ink-secondary)',
      transform: `rotate(-45 ${cx} ${labelH - 8})`,
    }, labels[j]);
    svg.appendChild(colLabel);
  }

  // 色阶图例
  const legendY = labelH + size + 16;
  const legendW = 160;
  const legendX = labelW;
  for (let s = 0; s < legendW; s++) {
    svg.appendChild(el('rect', {
      x: legendX + s, y: legendY, width: 1.2, height: 8,
      fill: rampColor(s / legendW),
    }));
  }
  svg.appendChild(el('text', { x: legendX, y: legendY + 22, 'font-size': 11, fill: 'var(--ink-muted)' }, '0'));
  svg.appendChild(el('text', { x: legendX + legendW, y: legendY + 22, 'font-size': 11, fill: 'var(--ink-muted)', 'text-anchor': 'end' }, maxD.toFixed(2)));
  container.appendChild(svg);
}

/** 计算树的叶序与每条横线的绘制坐标 */
function treeLayout(root, leafCount) {
  const leafX = new Map();
  let cursor = 0;
  const assign = (node) => {
    if (!node.left) {
      leafX.set(node.id, cursor++);
      return;
    }
    assign(node.left);
    assign(node.right);
  };
  assign(root);
  return { leafX };
}

/** UPGMA 树状图（高度轴 = 合并距离），叶序与热图对齐 */
export function renderDendrogram(container, { root, leafCount, labels, clusterLabels: labelsArr }) {
  container.replaceChildren();
  if (!root) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = '组内样品不足，无法聚类。';
    container.appendChild(p);
    return;
  }
  const { leafX } = treeLayout(root, leafCount);
  const maxH = root.height || 1;
  const rowH = 40;
  const labelW = 64;   // 左侧样品标签
  const markW = 22;    // 簇标记
  const axisH = 26;    // 底部高度轴
  const plotW = Math.max(160, leafCount * 52);
  const plotH = leafCount * rowH;
  const x0 = labelW + markW;
  const svgW = x0 + plotW + 8;
  const svgH = plotH + axisH;
  const svg = el('svg', {
    width: svgW,
    height: svgH,
    viewBox: `0 0 ${svgW} ${svgH}`,
    role: 'img',
  });
  svg.setAttribute('aria-label', 'UPGMA 层次聚类树状图');
  const xOf = (h) => x0 + (h / maxH) * plotW;
  const yOfLeaf = (leaf) => leafX.get(leaf) * rowH + rowH / 2;
  // 任意节点（含内部节点）的纵向中心 = 两支中心的中点
  const yCenter = (node) =>
    node.left ? (yCenter(node.left) + yCenter(node.right)) / 2 : yOfLeaf(node.id);

  const edges = [];
  const walk = (node) => {
    if (!node.left) return;
    walk(node.left);
    walk(node.right);
    const lx = xOf(node.left.height);
    const rx = xOf(node.right.height);
    const cx = xOf(node.height);
    const yL = yCenter(node.left);
    const yR = yCenter(node.right);
    edges.push(`M${lx},${yL} H${cx} V${yR} H${rx}`);
  };
  walk(root);
  svg.appendChild(el('path', {
    d: edges.join(' '), fill: 'none', stroke: 'var(--ink-secondary)',
    'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  // 叶节点：样品标签 + 簇色/形状标记
  for (const [leafId] of leafX) {
    const leafIdx = leafId;
    const color = CLUSTER_COLORS[(labelsArr?.[leafIdx] ?? 0) % CLUSTER_COLORS.length];
    const shape = (labelsArr?.[leafIdx] ?? 0) % 3;
    const cy = yOfLeaf(leafId);
    const markX = labelW + 8;
    if (shape === 0) {
      svg.appendChild(el('circle', { cx: markX, cy, r: 5, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
    } else if (shape === 1) {
      svg.appendChild(el('rect', { x: markX - 5, y: cy - 5, width: 10, height: 10, rx: 2, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
    } else {
      svg.appendChild(el('path', { d: `M${markX},${cy - 6} L${markX + 6},${cy + 5} L${markX - 6},${cy + 5} Z`, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
    }
    svg.appendChild(el('text', {
      x: labelW - 8, y: cy + 4, 'text-anchor': 'end',
      'font-size': 12, fill: 'var(--ink-secondary)',
    }, labels[leafIdx]));
  }

  // 高度轴刻度
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const h = (maxH * t) / ticks;
    const x = xOf(h);
    svg.appendChild(el('line', { x1: x, y1: plotH, x2: x, y2: plotH + 5, stroke: 'var(--axis)', 'stroke-width': 1 }));
    svg.appendChild(el('text', { x, y: plotH + 18, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--ink-muted)' }, h.toFixed(2)));
  }
  container.appendChild(svg);
}

/** 叶序（供热图重排，保证树与热图对齐） */
export function leafOrder(root, memberCount) {
  if (!root) return Array.from({ length: memberCount }, (_, i) => i);
  const { leafX } = treeLayout(root, memberCount);
  return [...leafX.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

/** PCoA 二维散点（簇色 + 形状，>=24px 命中区，直接标签） */
export function renderScatter(container, { points, labels, clusterLabels: cLabels, varianceRatio }) {
  container.replaceChildren();
  const W = 460;
  const H = 380;
  const m = { top: 24, right: 20, bottom: 48, left: 52 };
  const svg = el('svg', { width: '100%', viewBox: `0 0 ${W} ${H}`, role: 'img' });
  svg.setAttribute('aria-label', '主坐标分析 PCoA 散点图');

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1] ?? 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const pad = 0.12;
  const sx = (v) => m.left + ((v - minX) / spanX) * (W - m.left - m.right) * (1 - 2 * pad) + (W - m.left - m.right) * pad;
  const sy = (v) => H - m.bottom - ((v - minY) / spanY) * (H - m.top - m.bottom) * (1 - 2 * pad) - (H - m.top - m.bottom) * pad;

  // 网格与 0 轴
  for (let t = 0; t <= 4; t++) {
    const gx = m.left + ((W - m.left - m.right) * t) / 4;
    svg.appendChild(el('line', { x1: gx, y1: m.top, x2: gx, y2: H - m.bottom, stroke: 'var(--grid)', 'stroke-width': 1 }));
    const gy = m.top + ((H - m.top - m.bottom) * t) / 4;
    svg.appendChild(el('line', { x1: m.left, y1: gy, x2: W - m.right, y2: gy, stroke: 'var(--grid)', 'stroke-width': 1 }));
  }

  points.forEach((p, i) => {
    const cx = sx(p[0]);
    const cy = sy(p[1] ?? 0);
    const color = CLUSTER_COLORS[(cLabels?.[i] ?? 0) % CLUSTER_COLORS.length];
    const shape = (cLabels?.[i] ?? 0) % 3;
    const hit = el('circle', { cx, cy, r: 13, fill: 'transparent', tabindex: 0, cursor: 'pointer' });
    let mark;
    if (shape === 0) {
      mark = el('circle', { cx, cy, r: 6, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2 });
    } else if (shape === 1) {
      mark = el('rect', { x: cx - 5.5, y: cy - 5.5, width: 11, height: 11, rx: 2, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2 });
    } else {
      mark = el('path', { d: `M${cx},${cy - 7} L${cx + 7},${cy + 5.5} L${cx - 7},${cy + 5.5} Z`, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2 });
    }
    const label = el('text', { x: cx + 10, y: cy + 4, 'font-size': 11, fill: 'var(--ink-secondary)' }, labels[i]);
    svg.appendChild(hit);
    svg.appendChild(mark);
    svg.appendChild(label);
    attachTip(hit, [labels[i], `PC1 ${p[0].toFixed(3)} · PC2 ${(p[1] ?? 0).toFixed(3)}`, `簇 ${(cLabels?.[i] ?? 0) + 1}`]);
  });

  const xTitle = varianceRatio
    ? `PC1（解释方差 ${(varianceRatio[0] * 100).toFixed(1)}%）`
    : 'PC1';
  const yTitle = varianceRatio
    ? `PC2（${(varianceRatio[1] * 100).toFixed(1)}%）`
    : 'PC2';
  svg.appendChild(el('text', { x: W / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink-secondary)' }, xTitle));
  svg.appendChild(el('text', { x: 14, y: H / 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink-secondary)', transform: `rotate(-90 14 ${H / 2})` }, yTitle));
  container.appendChild(svg);
}

/**
 * 成对差异发散条形图（HTML 实现，天然可聚焦/换行）
 * 左蓝 = A 相对占优（clrDiff<0），右红 = B 相对占优
 */
export function renderDivergingBars(container, { rows, nameA, nameB }) {
  container.replaceChildren();
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.clrDiff)), 1e-9);
  const wrap = document.createElement('div');
  wrap.className = 'diverging';

  const header = document.createElement('div');
  header.className = 'diverging-header';
  const hA = document.createElement('span');
  hA.className = 'diverging-side side-a';
  hA.textContent = `← ${nameA} 占优`;
  const hB = document.createElement('span');
  hB.className = 'diverging-side side-b';
  hB.textContent = `${nameB} 占优 →`;
  header.append(hA, hB);
  wrap.appendChild(header);

  rows.forEach((r) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'diverging-row';
    const nameEl = document.createElement('div');
    nameEl.className = 'diverging-label';
    nameEl.textContent = r.compName;
    const track = document.createElement('div');
    track.className = 'diverging-track';
    const zero = document.createElement('div');
    zero.className = 'diverging-zero';
    track.appendChild(zero);
    const w = (Math.abs(r.clrDiff) / maxAbs) * 50;
    const bar = document.createElement('div');
    bar.className = 'diverging-bar';
    bar.style.width = `${w}%`;
    // 数值标签放在条外，使用文本 token 而非压在数据色上
    const val = document.createElement('div');
    val.className = 'diverging-value';
    val.textContent = (r.clrDiff >= 0 ? '+' : '') + r.clrDiff.toFixed(3);
    if (r.clrDiff < 0) {
      bar.style.left = `${50 - w}%`;
      bar.style.background = DIVERGING_NEG;
      val.style.right = `${50 + w + 1}%`;
      val.style.textAlign = 'right';
    } else {
      bar.style.left = '50%';
      bar.style.background = DIVERGING_POS;
      val.style.left = `${50 + w + 1}%`;
    }
    track.appendChild(bar);
    track.appendChild(val);
    track.tabIndex = 0;
    attachTip(track, [
      r.compName,
      `CLR 差 ${r.clrDiff.toFixed(4)}`,
      `闭合份额：${nameA} ${(r.closedA * 100).toFixed(2)}% · ${nameB} ${(r.closedB * 100).toFixed(2)}%`,
    ]);
    rowEl.append(nameEl, track);
    wrap.appendChild(rowEl);
  });
  container.appendChild(wrap);
}

/** 单样品成分构成的细分段条（part-to-whole，8px、圆角、2px 表面间隙） */
export function renderCompositionBar(container, { rows }) {
  container.replaceChildren();
  const supported = rows.filter((r) => r.supported);
  const bar = document.createElement('div');
  bar.className = 'comp-bar';
  supported.forEach((r, i) => {
    const seg = document.createElement('div');
    seg.className = 'comp-seg';
    seg.style.width = `${r.closed * 100}%`;
    seg.style.background = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
    seg.tabIndex = 0;
    attachTip(seg, [
      r.compName,
      `闭合份额 ${(r.closed * 100).toFixed(2)}%`,
      r.status === 'bdl'
        ? `BDL 替换值 ${r.substituted.toPrecision(3)}（检测限 ${r.detectionLimit}）`
        : `测量值 ${r.rawValue}`,
    ]);
    bar.appendChild(seg);
  });
  container.appendChild(bar);
}
