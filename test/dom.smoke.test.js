/**
 * dom.smoke.test.js — jsdom 冒烟测试：加载真实 index.html + app.js，
 * 验证首屏渲染、参数切换、成分删除、成对比较等完整交互链路。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let dom;
let window;
let document;

before(async () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  window = dom.window;
  document = window.document;
  // jsdom 不实现这些 API，提供最小桩
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));
  window.getComputedStyle = window.getComputedStyle || (() => ({ getPropertyValue: () => '#000' }));
  if (!window.localStorage) {
    const store = new Map();
    window.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  }
  // 应用模块以浏览器全局为前提：把 jsdom 的 DOM 注入 Node 全局
  globalThis.window = window;
  globalThis.document = document;
  globalThis.matchMedia = window.matchMedia;
  globalThis.localStorage = window.localStorage;
  globalThis.Event = window.Event;
  globalThis.Node = window.Node;
  globalThis.getComputedStyle = window.getComputedStyle;

  // 让模块脚本的相对导入可从文件系统加载
  const { pathToFileURL } = await import('node:url');
  await import(pathToFileURL(join(root, 'js/app.js')).href);
  await new Promise((resolve) => window.setTimeout(resolve, 50));
});

after(() => dom.window.close());

test('首屏：所有主要面板都有内容', () => {
  assert.ok(document.querySelectorAll('#rawTable table tr').length > 10, '原始数据表渲染多行');
  assert.ok(document.querySelectorAll('#groupTabs .group-tab').length >= 2, '出现多个支持集合组页签');
  assert.ok(document.querySelector('#heatmap svg'), '热图 SVG 渲染');
  assert.ok(document.querySelector('#dendrogram svg'), '树状图 SVG 渲染');
  assert.ok(document.querySelector('#pcoa svg'), 'PCoA SVG 渲染');
  assert.ok(document.querySelectorAll('#stabilityBody table').length >= 1, '稳定性表格渲染');
  assert.ok(document.querySelectorAll('#invariantRow .stat-tile').length === 4, '四个自检瓦片');
});

test('树状图包含有效路径与全部叶标签，且无 NaN 坐标', () => {
  const svg = document.querySelector('#dendrogram svg');
  const path = svg.querySelector('path');
  assert.ok(path && path.getAttribute('d').length > 10);
  assert.ok(!path.getAttribute('d').includes('NaN'), '树路径无 NaN');
  const labelTexts = [...svg.querySelectorAll('text')].map((t) => t.textContent);
  const mainGroupSize = 7;
  const leafIds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S9', 'S10'];
  for (const id of leafIds) assert.ok(labelTexts.includes(id), `叶标签含 ${id}`);
  assert.equal(svg.querySelectorAll('circle, rect, path').length > mainGroupSize, true);
});

test('热图单元格数量与组规模一致且数值合法', () => {
  const cells = document.querySelectorAll('#heatmap svg rect');
  assert.ok(cells.length >= 49, '7×7 热图含足够单元格');
  const texts = [...document.querySelectorAll('#heatmap svg text')].map((t) => t.textContent);
  assert.ok(texts.some((t) => t === '0.00'), '等比例对显示 0.00');
});

test('尺度不变性自检通过', () => {
  const tiles = [...document.querySelectorAll('#invariantRow .stat-tile')];
  assert.ok(tiles[0].classList.contains('ok'), tiles[0].textContent);
  assert.ok(tiles[1].classList.contains('ok'), tiles[1].textContent);
});

test('切换 δ 倍数后 BDL 替换值与热图同步更新', () => {
  const before = document.querySelectorAll('#invariantRow .stat-tile')[2].textContent;
  const btn = [...document.querySelectorAll('#multiplierSeg button')].find((b) => b.dataset.value === '1');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  const after = document.querySelectorAll('#invariantRow .stat-tile')[2].textContent;
  assert.notEqual(before, after);
  assert.ok(after.includes('δ=1'));
  // 热图重绘
  assert.ok(document.querySelector('#heatmap svg'));
});

test('删除成分后距离重算且页签重组，再恢复', () => {
  const tabsBefore = document.querySelectorAll('#groupTabs .group-tab').length;
  const chip = document.querySelector('.chip[data-id="K2O"]');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(chip.getAttribute('aria-pressed'), 'false');
  const tabsAfter = document.querySelectorAll('#groupTabs .group-tab').length;
  assert.ok(tabsAfter < tabsBefore, '删除 K2O 后支持集合组合并');
  // 恢复
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
});

test('点两份样品：成对比较渲染发散条形图与明细表，跨组给受限说明', () => {
  // 同组：S1 与 S4
  clickRawRow('S1');
  clickRawRow('S4');
  assert.ok(document.querySelector('#pairBody .diverging'), '发散条形图渲染');
  const dist = document.querySelector('.pair-distance').textContent;
  assert.ok(parseFloat(dist) > 0.3, `同组不同配方距离应较大，实际 ${dist}`);
  const detailRows = document.querySelectorAll('#pairBody table.data tbody tr');
  assert.equal(detailRows.length, 8);

  // 跨支持集合：S4 与 S6（先点 S6 开始新配对，再点 S4 补全）
  clickRawRow('S6');
  clickRawRow('S4');
  const pair = document.querySelector('#pairBody .pair-header h3').textContent;
  assert.ok(pair.includes('S4') && pair.includes('S6'));
  const warn = document.querySelector('#pairBody .notice.warning');
  assert.ok(warn && warn.textContent.includes('跨支持集合'));
});

test('等比例样品对距离显示为 0.0000', () => {
  clickRawRow('S1');
  clickRawRow('S2');
  const dist = document.querySelector('.pair-distance').textContent;
  assert.equal(parseFloat(dist), 0);
});

test('共同成分不足时给出不可比较说明', () => {
  // 删到只剩 CaO / K2O / Na2O
  for (const id of ['SiO2', 'Al2O3', 'Fe2O3', 'MgO', 'TiO2']) {
    document.querySelector(`.chip[data-id="${id}"]`).dispatchEvent(new window.Event('click', { bubbles: true }));
  }
  clickRawRow('S1');
  clickRawRow('S6');
  const err = document.querySelector('#pairBody .notice.error');
  assert.ok(err && err.textContent.includes('不可直接比较'));
  // 恢复全部成分
  for (const id of ['SiO2', 'Al2O3', 'Fe2O3', 'MgO', 'TiO2']) {
    document.querySelector(`.chip[data-id="${id}"]`).dispatchEvent(new window.Event('click', { bubbles: true }));
  }
});

test('跨组下拉框可直接配对并给出受限比较说明', () => {
  const selA = document.getElementById('pairSelectA');
  const selB = document.getElementById('pairSelectB');
  selA.value = 'S8';
  selA.dispatchEvent(new window.Event('change', { bubbles: true }));
  selB.value = 'S6';
  selB.dispatchEvent(new window.Event('change', { bubbles: true }));
  const header = document.querySelector('#pairBody .pair-header h3').textContent;
  assert.ok(header.includes('S8') && header.includes('S6'));
  const warn = document.querySelector('#pairBody .notice.warning');
  assert.ok(warn.textContent.includes('跨支持集合'));
});

test('稳定性面板给出 Spearman 与 ARI', () => {
  const rhoCells = document.querySelectorAll('#stabilityBody table.stab tbody td');
  assert.ok(rhoCells.length >= 16);
  const firstMatrix = [...rhoCells].slice(0, 16).map((c) => parseFloat(c.textContent));
  assert.ok(firstMatrix.every((v) => v >= 0.9), '距离序高度稳定');
});

function clickRawRow(sampleId) {
  const rows = [...document.querySelectorAll('#rawTable table tbody tr')];
  const row = rows.find((r) => r.textContent.includes(sampleId));
  assert.ok(row, `找到 ${sampleId} 行`);
  row.dispatchEvent(new window.Event('click', { bubbles: true }));
}
