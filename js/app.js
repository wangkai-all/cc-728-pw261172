/**
 * app.js — 页面状态与渲染
 * 任何参数变化都调用 rebuild() 从零重建分析管线；图表只消费当前 state，
 * 不存在跨参数复用的旧距离。
 */

import { SAMPLES, COMPONENTS, MULTIPLIER_PRESETS, DEFAULT_MULTIPLIER } from './data.js';
import { buildAnalysis, comparePair, stabilityReport, clusterLabels } from './analysis.js';
import {
  renderHeatmap,
  renderDendrogram,
  renderScatter,
  renderDivergingBars,
  renderCompositionBar,
  leafOrder,
  CLUSTER_COLORS,
} from './charts.js';

// ---------- 应用状态 ----------
const state = {
  multiplier: DEFAULT_MULTIPLIER,
  activeComponents: new Set(COMPONENTS.map((c) => c.id)),
  k: 3,
  selectedGroup: 0,
  pair: null, // [idA, idB]
  analysis: null,
  stabilityCache: null,
};

const STATUS_TEXT = { measured: '实测', bdl: 'BDL', zero: '确零', missing: '缺失' };
const COMP_NAME = Object.fromEntries(COMPONENTS.map((c) => [c.id, c.name]));
const sampleName = (id) => state.analysis.byId[id]?.sample.name ?? id;

/** 偏好存储封装：隐私模式等场景 localStorage 不可用时静默降级 */
const memoryStore = new Map();
const preferenceStore = {
  get(key) {
    try {
      const ls = globalThis.localStorage;
      return ls ? ls.getItem(key) : (memoryStore.has(key) ? memoryStore.get(key) : null);
    } catch {
      return memoryStore.has(key) ? memoryStore.get(key) : null;
    }
  },
  set(key, value) {
    try {
      const ls = globalThis.localStorage;
      if (ls) ls.setItem(key, value);
      else memoryStore.set(key, String(value));
    } catch {
      memoryStore.set(key, String(value));
    }
  },
};

const fmt = (v, digits = 3) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(2)}%`);

// ---------- 主题 ----------
function initTheme() {
  const saved = preferenceStore.get('mineral-theme');
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  const prefersDark = Boolean(mq?.matches);
  setTheme(saved ?? (prefersDark ? 'dark' : 'light'));
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    preferenceStore.set('mineral-theme', next);
  });
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById('themeToggle').textContent = theme === 'dark' ? '切换亮色' : '切换暗色';
  if (state.analysis) renderAll(); // 图表中的 currentColor/CSS 变量需要重绘
}

// ---------- 控制行 ----------
function initControls() {
  const seg = document.getElementById('multiplierSeg');
  MULTIPLIER_PRESETS.forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.value = String(m);
    btn.textContent = `δ=${m}`;
    btn.addEventListener('click', () => {
      state.multiplier = m;
      document.getElementById('customMultiplier').value = '';
      rebuild();
    });
    seg.appendChild(btn);
  });
  const custom = document.getElementById('customMultiplier');
  custom.addEventListener('change', () => {
    const v = parseFloat(custom.value);
    if (Number.isFinite(v) && v > 0) {
      state.multiplier = v;
      rebuild();
    }
  });

  const chips = document.getElementById('componentChips');
  COMPONENTS.forEach((comp, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.id = comp.id;
    chip.setAttribute('aria-pressed', 'true');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
    chip.append(dot, document.createTextNode(comp.name));
    chip.addEventListener('click', () => {
      if (state.activeComponents.has(comp.id)) {
        if (state.activeComponents.size <= 2) return; // 至少保留两个成分
        state.activeComponents.delete(comp.id);
        chip.setAttribute('aria-pressed', 'false');
      } else {
        state.activeComponents.add(comp.id);
        chip.setAttribute('aria-pressed', 'true');
      }
      rebuild();
    });
    chips.appendChild(chip);
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    state.multiplier = DEFAULT_MULTIPLIER;
    state.activeComponents = new Set(COMPONENTS.map((c) => c.id));
    state.k = 3;
    state.pair = null;
    custom.value = '';
    chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'true'));
    rebuild();
  });

  document.getElementById('kSelect').addEventListener('change', (e) => {
    state.k = parseInt(e.target.value, 10);
    rebuild();
  });
}

function syncControls() {
  document.querySelectorAll('#multiplierSeg button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(parseFloat(btn.dataset.value)) === String(state.multiplier) ? 'true' : 'false');
  });
  const kSel = document.getElementById('kSelect');
  const maxK = Math.max(...state.analysis.groups.map((g) => g.members.length));
  const options = Array.from({ length: Math.max(2, maxK) }, (_, i) => i + 1)
    .map((k) => `<option value="${k}">${k}</option>`)
    .join('');
  kSel.innerHTML = options;
  kSel.value = String(Math.min(state.k, maxK));
}

// ---------- 重建管线 ----------
function rebuild() {
  state.stabilityCache = null; // 参数变化：稳定性结果与距离一起作废
  state.analysis = buildAnalysis({
    samples: SAMPLES,
    components: COMPONENTS,
    activeComponentIds: state.activeComponents,
    multiplier: state.multiplier,
  });
  state.selectedGroup = Math.min(state.selectedGroup, state.analysis.groups.length - 1);
  // 选中样品对若已不可用则清空
  if (state.pair) {
    const [a, b] = state.pair;
    if (!state.analysis.byId[a] || !state.analysis.byId[b]) state.pair = null;
  }
  syncControls();
  renderAll();
}

function renderAll() {
  renderInvariants();
  renderRawTable();
  renderGroupNotices();
  renderGroupTabs();
  renderActiveGroup();
  syncPairSelects();
  renderPair();
  renderStability();
}

// ---------- 尺度不变性自检 ----------
function renderInvariants() {
  const row = document.getElementById('invariantRow');
  row.replaceChildren();
  const groups = state.analysis.groups;
  const allPairs = groups.flatMap((g) => g.invariantPairs);
  const expectedPairs = [
    ['S1', 'S2'], ['S4', 'S5'], ['S1', 'S10'],
  ].filter(([a, b]) => state.analysis.byId[a] && state.analysis.byId[b]);

  const tile = (label, value, note, cls) => {
    const t = document.createElement('div');
    t.className = `stat-tile ${cls}`;
    t.innerHTML = '';
    const l = document.createElement('div');
    l.className = 'label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'value';
    v.textContent = value;
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = note;
    t.append(l, v, n);
    return t;
  };

  const allZero = expectedPairs.every(([a, b]) =>
    allPairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a)));
  row.appendChild(tile(
    '等比例样品对距离 = 0',
    allZero ? `${expectedPairs.length}/${expectedPairs.length} 通过` : '存在偏差',
    'S1/S2 稀释、S4/S5 浓缩、S1/S10 换单位：倍数不变性',
    allZero ? 'ok' : 'warn',
  ));

  const main = groups[0];
  const i1 = main.members.findIndex((m) => m.id === 'S1');
  const i3 = main.members.findIndex((m) => m.id === 'S3');
  const d13 = i1 >= 0 && i3 >= 0 ? main.matrix[i1][i3] : undefined;
  row.appendChild(tile(
    '等总量不同配比 S1↔S3',
    d13 === undefined ? '—' : d13.toFixed(3),
    '总量接近但配方不同，距离应明显大于 0',
    d13 !== undefined && d13 > 0.2 ? 'ok' : 'warn',
  ));

  const bdlRow = state.analysis.byId.S1.rows.find((r) => r.status === 'bdl');
  if (bdlRow) {
    row.appendChild(tile(
      `当前 BDL 替换值（δ=${state.multiplier}）`,
      fmt(bdlRow.substituted, 4),
      `${bdlRow.compName} 检测限 ${bdlRow.detectionLimit} × ${state.multiplier}，闭合份额 ${pct(bdlRow.closed)}`,
      'ok',
    ));
  } else {
    row.appendChild(tile(
      `当前替换倍数 δ=${state.multiplier}`,
      String(state.multiplier),
      '保留成分中没有 BDL 读数，替换规则处于空闲状态',
      'ok',
    ));
  }

  row.appendChild(tile(
    '支持集合组数量',
    String(groups.length),
    groups.map((g) => `${g.members.length} 份 · ${g.support.length} 成分`).join('；'),
    groups.length > 1 ? 'warn' : 'ok',
  ));
}

// ---------- 原始数据表 ----------
function renderRawTable() {
  const host = document.getElementById('rawTable');
  host.replaceChildren();
  const active = state.analysis.active;
  const table = document.createElement('table');
  table.className = 'data';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['样品', '单位', ...active.map((c) => c.name), '原始总量'].forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  state.analysis.perSample.forEach((ps) => {
    const tr = document.createElement('tr');
    tr.className = 'selectable';
    if (state.pair && state.pair.includes(ps.id)) tr.classList.add('selected');
    const nameTd = document.createElement('td');
    nameTd.textContent = `${ps.id} · ${ps.sample.name}`;
    const unitTd = document.createElement('td');
    unitTd.textContent = ps.unit;
    tr.append(nameTd, unitTd);
    ps.rows.forEach((r) => {
      const td = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `status-badge status-${r.status}`;
      badge.textContent = STATUS_TEXT[r.status];
      td.appendChild(badge);
      if (r.status === 'measured') {
        const sub = document.createElement('span');
        sub.className = 'cell-sub';
        sub.textContent = fmt(r.rawValue, 4);
        td.appendChild(sub);
      } else if (r.status === 'bdl') {
        const sub = document.createElement('span');
        sub.className = 'cell-sub';
        sub.textContent = `DL ${fmt(r.detectionLimit, 4)}`;
        td.appendChild(sub);
      }
      tr.appendChild(td);
    });
    const totalTd = document.createElement('td');
    totalTd.textContent = fmt(ps.totalRaw, 2);
    tr.appendChild(totalTd);
    tr.addEventListener('click', () => selectSample(ps.id));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  host.appendChild(table);
}

// ---------- 选择样品对 ----------
function selectSample(id) {
  if (!state.pair || state.pair.length === 2) {
    state.pair = [id];
  } else if (state.pair[0] === id) {
    state.pair = null;
  } else {
    state.pair = [state.pair[0], id];
  }
  renderAll();
  if (state.pair?.length === 2) {
    document.getElementById('pairCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/** 跨组下拉选择器：支持集合不同的样品也能直接配对 */
function initPairSelects() {
  const selA = document.getElementById('pairSelectA');
  const selB = document.getElementById('pairSelectB');
  const onChange = () => {
    const a = selA.value;
    const b = selB.value;
    state.pair = a && b && a !== b ? [a, b] : a ? [a] : null;
    renderAll();
  };
  selA.addEventListener('change', onChange);
  selB.addEventListener('change', onChange);
}

function syncPairSelects() {
  const selA = document.getElementById('pairSelectA');
  const selB = document.getElementById('pairSelectB');
  const fill = (sel, chosen) => {
    const prev = chosen ?? sel.value;
    sel.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '选择样品…';
    sel.appendChild(placeholder);
    state.analysis.perSample.forEach((ps) => {
      const opt = document.createElement('option');
      opt.value = ps.id;
      opt.textContent = `${ps.id} · ${ps.sample.name}（组 ${ps.groupIndex + 1}）`;
      sel.appendChild(opt);
    });
    if (prev && state.analysis.byId[prev]) sel.value = prev;
  };
  fill(selA, state.pair?.[0]);
  fill(selB, state.pair?.[1]);
}

// ---------- 支持集合提示与组页签 ----------
function renderGroupNotices() {
  const host = document.getElementById('groupNotice');
  host.replaceChildren();
  const groups = state.analysis.groups;
  if (groups.length <= 1) return;
  const notice = document.createElement('div');
  notice.className = 'notice warning';
  const names = groups
    .map((g) => `组 ${g.index + 1}（${g.members.map((m) => m.id).join('、')}，支持 ${g.support.length} 成分）`)
    .join(' 与 ');
  notice.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = '支持集合不同，不可直接混入同一总榜：';
  notice.appendChild(strong);
  notice.appendChild(document.createTextNode(` ${names}。组内使用完整 Aitchison 距离；跨组仅在共同正成分上做子成分比较并明确标注。`));
  groups.filter((g) => g.lowSupport).forEach((g) => {
    const w = document.createElement('div');
    w.style.marginTop = '6px';
    w.textContent = `⚠ 组 ${g.index + 1} 仅 ${g.support.length} 个支持成分（${g.support.map((id) => COMP_NAME[id]).join('、')}），对数比结果维度低，解释需谨慎。`;
    notice.appendChild(w);
  });
  host.appendChild(notice);
}

function renderGroupTabs() {
  const tabs = document.getElementById('groupTabs');
  tabs.replaceChildren();
  state.analysis.groups.forEach((g) => {
    const btn = document.createElement('button');
    btn.className = 'group-tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(g.index === state.selectedGroup));
    const title = document.createElement('div');
    title.className = 'gt-title';
    title.textContent = `组 ${g.index + 1} · ${g.members.length} 份样品`;
    const meta = document.createElement('div');
    meta.className = 'gt-meta';
    meta.textContent = `支持成分：${g.support.map((id) => COMP_NAME[id]).join('、')}${g.lowSupport ? '（低维）' : ''}`;
    btn.append(title, meta);
    btn.addEventListener('click', () => {
      state.selectedGroup = g.index;
      renderAll();
    });
    tabs.appendChild(btn);
  });
}

// ---------- 当前组：树、热图、PCoA、样品表 ----------
function renderActiveGroup() {
  const a = state.analysis;
  const g = a.groups[state.selectedGroup];
  document.getElementById('groupTitle').textContent = `组 ${g.index + 1} 分析（${g.members.length} 份样品）`;
  document.getElementById('groupSubtitle').textContent =
    `基于 ${g.support.length} 个共同支持成分，δ=${state.multiplier} 替换并重新闭合后计算；切换 δ 或删除成分将整体重算。`;

  const labels = g.members.map((m) => m.id);
  const cLabels = clusterLabels(g, state.k);
  const order = leafOrder(g.tree, g.members.length);
  const orderedLabels = order.map((i) => labels[i]);
  const orderedMatrix = order.map((i) => order.map((j) => g.matrix[i][j]));

  renderDendrogram(document.getElementById('dendrogram'), {
    root: g.tree,
    leafCount: g.members.length,
    labels,
    clusterLabels: cLabels,
  });

  renderHeatmap(document.getElementById('heatmap'), {
    labels: orderedLabels,
    matrix: orderedMatrix,
    selectedPair: state.pair
      ? (() => {
          const i = orderedLabels.indexOf(state.pair[0]);
          const j = orderedLabels.indexOf(state.pair[1]);
          return i >= 0 && j >= 0 ? [i, j] : null;
        })()
      : null,
    onCell: (i, j) => {
      state.pair = [orderedLabels[i], orderedLabels[j]];
      renderAll();
      document.getElementById('pairCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });

  // PCoA 解释方差比
  const eigen = g.mds.eigenvalues;
  const positive = eigen.filter((v) => v > 0);
  const totalEigen = positive.reduce((s, v) => s + v, 0) || 1;
  const varianceRatio = positive.length >= 2 ? [positive[0] / totalEigen, positive[1] / totalEigen] : null;
  renderScatter(document.getElementById('pcoa'), {
    points: g.mds.points,
    labels,
    clusterLabels: cLabels,
    varianceRatio,
  });

  // 簇图例
  const legend = document.getElementById('clusterLegend');
  legend.replaceChildren();
  const kUsed = new Set(cLabels).size;
  for (let c = 0; c < kUsed; c++) {
    const key = document.createElement('span');
    key.className = 'key';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = CLUSTER_COLORS[c % CLUSTER_COLORS.length];
    key.append(sw, document.createTextNode(`簇 ${c + 1}（${cLabels.filter((x) => x === c).length} 份）`));
    legend.appendChild(key);
  }

  // 组内样品表
  const host = document.getElementById('groupTable');
  host.replaceChildren();
  const table = document.createElement('table');
  table.className = 'data';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  ['样品', '簇', '原始总量', '构成段条'].forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  g.members.forEach((m, i) => {
    const tr = document.createElement('tr');
    tr.className = 'selectable';
    if (state.pair && state.pair.includes(m.id)) tr.classList.add('selected');
    const tdName = document.createElement('td');
    tdName.textContent = `${m.id} · ${m.sample.name}`;
    const tdCluster = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'status-badge';
    badge.style.background = CLUSTER_COLORS[cLabels[i] % CLUSTER_COLORS.length];
    badge.style.color = '#fff';
    badge.textContent = `簇 ${cLabels[i] + 1}`;
    tdCluster.appendChild(badge);
    const tdTotal = document.createElement('td');
    tdTotal.textContent = `${fmt(m.totalRaw, 2)} ${m.unit}`;
    const tdBar = document.createElement('td');
    tdBar.style.minWidth = '180px';
    renderCompositionBar(tdBar, { rows: m.rows });
    tr.append(tdName, tdCluster, tdTotal, tdBar);
    tr.addEventListener('click', () => selectSample(m.id));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  host.appendChild(table);
}

// ---------- 成对比较 ----------
function renderPair() {
  const body = document.getElementById('pairBody');
  body.replaceChildren();
  if (!state.pair || state.pair.length < 2) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = state.pair?.length === 1
      ? `已选 ${state.pair[0]}，再点一份样品完成配对。`
      : '在上方热图、样品表或数据管理表中选择两份样品。';
    body.appendChild(p);
    return;
  }

  const [idA, idB] = state.pair;
  const cmp = comparePair(state.analysis, idA, idB);
  const nameA = `${idA} · ${sampleName(idA)}`;
  const nameB = `${idB} · ${sampleName(idB)}`;

  const header = document.createElement('div');
  header.className = 'pair-header';
  const h3 = document.createElement('h3');
  h3.textContent = `${nameA}  ↔  ${nameB}`;
  header.appendChild(h3);
  body.appendChild(header);

  if (!cmp.comparable) {
    const err = document.createElement('div');
    err.className = 'notice error';
    err.textContent = `不可直接比较：两份样品的共同正成分只有 ${cmp.common.length} 个（${cmp.common.map((id) => COMP_NAME[id]).join('、') || '无'}），对数比至少需要 2 个共同成分。差异来自不同的成分支持集合而非单纯配比。`;
    body.appendChild(err);
    appendPairMeta(body, cmp);
    return;
  }

  const basis = document.createElement('div');
  basis.className = `notice ${cmp.sameGroup ? 'info' : 'warning'}`;
  if (cmp.sameGroup) {
    basis.textContent = `同一支持集合，在全部 ${cmp.common.length} 个共同成分上完整比较。`;
  } else {
    const s = document.createElement('strong');
    s.textContent = '跨支持集合的受限比较：';
    basis.appendChild(s);
    basis.appendChild(document.createTextNode(
      ` 仅在 ${cmp.common.length} 个共同正成分（${cmp.common.map((id) => COMP_NAME[id]).join('、')}）上重新闭合做子成分比较；` +
      `${cmp.onlyA.length ? idA + ' 独有的 ' + cmp.onlyA.map((id) => COMP_NAME[id]).join('、') : ''}` +
      `${cmp.onlyA.length && cmp.onlyB.length ? '；' : ''}` +
      `${cmp.onlyB.length ? idB + ' 独有的 ' + cmp.onlyB.map((id) => COMP_NAME[id]).join('、') : ''}` +
      ' 不参与距离。',
    ));
    if (cmp.weak) {
      const w = document.createElement('div');
      w.style.marginTop = '6px';
      w.textContent = '⚠ 共同成分不足 3 个，子成分维度低，距离仅供参考。';
      basis.appendChild(w);
    }
  }
  body.appendChild(basis);

  const distLine = document.createElement('div');
  distLine.style.margin = '10px 0';
  const dl = document.createElement('span');
  dl.className = 'pair-distance';
  dl.textContent = cmp.distance.toFixed(4);
  const cap = document.createElement('span');
  cap.style.color = 'var(--ink-muted)';
  cap.style.marginLeft = '8px';
  cap.textContent = 'Aitchison 距离（0 = 配方完全相同）';
  distLine.append(dl, cap);
  body.appendChild(distLine);

  // 发散条形图：clr 差异
  const barTitle = document.createElement('p');
  barTitle.className = 'panel-title';
  barTitle.textContent = '成分级 CLR 差（按贡献排序，条形越长对总距离贡献越大）';
  body.appendChild(barTitle);
  const barHost = document.createElement('div');
  renderDivergingBars(barHost, { rows: cmp.contributions, nameA, nameB });
  body.appendChild(barHost);

  // 明细表
  appendPairTable(body, cmp, nameA, nameB);
  appendPairMeta(body, cmp);
}

function appendPairTable(host, cmp, nameA, nameB) {
  const table = document.createElement('table');
  table.className = 'data';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  ['成分', `${nameA} 状态`, `${nameB} 状态`, 'A 闭合份额', 'B 闭合份额', 'CLR 差', '贡献占比'].forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  const sse = cmp.contributions.reduce((s, r) => s + r.clrDiff ** 2, 0) || 1;
  cmp.rows
    .slice()
    .sort((x, y) => (y.inCommon - x.inCommon) || Math.abs(y.clrDiff ?? -1) - Math.abs(x.clrDiff ?? -1))
    .forEach((r) => {
      const tr = document.createElement('tr');
      if (!r.inCommon) tr.style.opacity = '0.55';
      const tdName = document.createElement('td');
      tdName.textContent = r.compName;
      const tdSA = document.createElement('td');
      tdSA.appendChild(statusCell(r.statusA, r.rawA, r.dlA, r.replacedA));
      const tdSB = document.createElement('td');
      tdSB.appendChild(statusCell(r.statusB, r.rawB, r.dlB, r.replacedB));
      const tdCA = document.createElement('td');
      tdCA.textContent = r.inCommon ? pct(r.closedA) : '不参与';
      const tdCB = document.createElement('td');
      tdCB.textContent = r.inCommon ? pct(r.closedB) : '不参与';
      const tdDiff = document.createElement('td');
      tdDiff.textContent = r.inCommon ? (r.clrDiff >= 0 ? '+' : '') + r.clrDiff.toFixed(3) : '—';
      if (r.inCommon && Math.abs(r.clrDiff) > 0.5) tdDiff.style.fontWeight = '650';
      const tdContrib = document.createElement('td');
      tdContrib.textContent = r.inCommon ? pct(r.clrDiff ** 2 / sse) : '—';
      tr.append(tdName, tdSA, tdSB, tdCA, tdCB, tdDiff, tdContrib);
      tbody.appendChild(tr);
    });
  table.appendChild(tbody);
  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  wrap.style.marginTop = '14px';
  wrap.appendChild(table);
  host.appendChild(wrap);
}

function statusCell(status, raw, dl, replaced) {
  const frag = document.createDocumentFragment();
  const badge = document.createElement('span');
  badge.className = `status-badge status-${status}`;
  badge.textContent = STATUS_TEXT[status];
  frag.appendChild(badge);
  if (status === 'measured') {
    const sub = document.createElement('span');
    sub.className = 'cell-sub';
    sub.textContent = `原值 ${fmt(raw, 4)}`;
    frag.appendChild(sub);
  } else if (status === 'bdl') {
    const sub = document.createElement('span');
    sub.className = 'cell-sub';
    sub.textContent = `DL ${fmt(dl, 4)} → 替换 ${fmt(replaced, 4)}`;
    frag.appendChild(sub);
  }
  return frag;
}

function appendPairMeta(host, cmp) {
  const note = document.createElement('p');
  note.className = 'footer-note';
  note.style.marginTop = '12px';
  const parts = [];
  parts.push(`比较基准：${cmp.basis === 'full' ? '完整支持集合' : '共同成分子成分（重新闭合）'}`);
  parts.push(`当前 δ=${state.multiplier}`);
  parts.push(`保留成分 ${state.analysis.active.length} 个`);
  note.textContent = parts.join(' · ');
  host.appendChild(note);
}

// ---------- 稳定性 ----------
function renderStability() {
  const host = document.getElementById('stabilityBody');
  host.replaceChildren();
  if (!state.stabilityCache) {
    state.stabilityCache = stabilityReport({
      samples: SAMPLES,
      components: COMPONENTS,
      activeComponentIds: state.activeComponents,
      multipliers: MULTIPLIER_PRESETS,
      k: state.k,
    });
  }
  const report = state.stabilityCache;

  report.reports.forEach((rg) => {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '22px';
    const title = document.createElement('p');
    title.className = 'panel-title';
    title.textContent = `组：${rg.ids.join('、')}（${rg.support.length} 支持成分）`;
    wrap.appendChild(title);

    // Spearman 矩阵
    const t1 = document.createElement('table');
    t1.className = 'data stab';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    const th0 = document.createElement('th');
    th0.textContent = 'Spearman ρ';
    hr.appendChild(th0);
    report.multipliers.forEach((m) => {
      const th = document.createElement('th');
      th.textContent = `δ=${m}`;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t1.appendChild(thead);
    const tbody = document.createElement('tbody');
    rg.spearmanMatrix.forEach((row, i) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = `δ=${report.multipliers[i]}`;
      tr.appendChild(th);
      row.forEach((v) => {
        const td = document.createElement('td');
        td.textContent = v.toFixed(3);
        td.style.color = v >= 0.95 ? 'var(--good)' : v >= 0.8 ? 'var(--warning)' : 'var(--critical)';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    t1.appendChild(tbody);
    wrap.appendChild(t1);

    // ARI 与 CV 摘要
    const summary = document.createElement('div');
    summary.style.display = 'flex';
    summary.style.gap = '18px';
    summary.style.flexWrap = 'wrap';
    summary.style.margin = '10px 0';
    const ariTile = document.createElement('div');
    ariTile.className = `stat-tile ${rg.ariVsFirst.every((v) => v > 0.999) ? 'ok' : 'warn'}`;
    ariTile.style.minWidth = '200px';
    ariTile.innerHTML = '<div class="label">分组 ARI（对 δ=0.25）</div>';
    const v = document.createElement('div');
    v.className = 'value';
    v.textContent = rg.ariVsFirst.map((x) => x.toFixed(2)).join(' / ');
    ariTile.appendChild(v);
    const n2 = document.createElement('div');
    n2.className = 'note';
    n2.textContent = '1.00 = 所有 δ 下簇划分完全一致';
    ariTile.appendChild(n2);
    summary.appendChild(ariTile);

    const maxCV = rg.pairCV[0];
    if (maxCV) {
      const cvTile = document.createElement('div');
      cvTile.className = `stat-tile ${maxCV.cv < 0.15 ? 'ok' : 'warn'}`;
      cvTile.style.minWidth = '240px';
      cvTile.innerHTML = '<div class="label">最敏感样品对距离 CV</div>';
      const cv = document.createElement('div');
      cv.className = 'value';
      cv.textContent = `${maxCV.pair.join(' ↔ ')}：${(maxCV.cv * 100).toFixed(1)}%`;
      cvTile.appendChild(cv);
      const cn = document.createElement('div');
      cn.className = 'note';
      cn.textContent = `各 δ 距离：${maxCV.values.map((x) => x.toFixed(3)).join('、')}`;
      cvTile.appendChild(cn);
      summary.appendChild(cvTile);
    }
    wrap.appendChild(summary);
    host.appendChild(wrap);
  });

  const note = document.createElement('p');
  note.className = 'footer-note';
  note.textContent = '判读：Spearman ρ ≥ 0.95 且 ARI = 1.00 表示距离排序与分组在替换量变化下稳定；CV 衡量单个距离的绝对漂移。BDL 占比越高的样品对 CV 越大。';
  host.appendChild(note);
}

// ---------- 启动 ----------
initTheme();
initControls();
initPairSelects();
rebuild();
