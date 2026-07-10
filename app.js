/* ================= データ準備 ================= */
const DAYS = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'];
const DAY_SHORT = ['月', '火', '水', '木', '金', '土', '日'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
// dayCountsが無いデータ（期間を自動判定できなかった場合）は日数補正機能を無効化
const HAS_DAY_COUNTS = !!RAW.dayCounts;
const TOTAL_DAYS = HAS_DAY_COUNTS ? Object.values(RAW.dayCounts).reduce((a, b) => a + b, 0) : null;

// cell[day][hour] = {imp, clicks, cost, conv}
const cell = {};
DAYS.forEach(d => { cell[d] = {}; });
RAW.rows.forEach(r => { cell[r.day][r.hour] = r; });

function sumCells(list) {
  const a = { imp: 0, clicks: 0, cost: 0, conv: 0, actions: {} };
  list.forEach(r => {
    a.imp += r.imp; a.clicks += r.clicks; a.cost += r.cost; a.conv += r.conv;
    Object.entries(r.actions || {}).forEach(([k, v]) => { a.actions[k] = (a.actions[k] || 0) + v; });
  });
  return a;
}
const TOTAL = sumCells(RAW.rows);
const hourAgg = HOURS.map(h => sumCells(RAW.rows.filter(r => r.hour === h)));
const dayAgg = {};
DAYS.forEach(d => { dayAgg[d] = sumCells(RAW.rows.filter(r => r.day === d)); });

/* ================= CVアクション（内訳）================= */
const ACTION_LABEL = k => k.replace(/（Lad追加金額）|（Lad）|（アフピル）/g, '');
// 期間合計が0より大きいアクションのみ、多い順に
const ACTIONS = Object.entries(TOTAL.actions)
  .filter(([, v]) => v > 0)
  .sort((a, b) => b[1] - a[1])
  .map(([k]) => k);

/* ================= 指標定義 ================= */
const fmtInt = v => Math.round(v).toLocaleString('ja-JP');
const fmtDec = v => v.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtYen = v => '¥' + Math.round(v).toLocaleString('ja-JP');
const fmtPct = v => v.toFixed(2) + '%';
function fmtCompact(v) { // 軸ラベル用（万・億）
  if (v >= 1e8) return trim(v / 1e8) + '億';
  if (v >= 1e4) return trim(v / 1e4) + '万';
  return Math.round(v).toLocaleString('ja-JP');
  function trim(x) { return (Math.round(x * 10) / 10).toLocaleString('ja-JP'); }
}

const METRICS = {
  imp:    { label: '表示回数',       sum: true,  fmt: fmtInt, axis: fmtCompact },
  clicks: { label: 'クリック数',     sum: true,  fmt: fmtInt, axis: fmtCompact },
  cost:   { label: '費用',           sum: true,  fmt: fmtYen, axis: fmtCompact },
  conv:   { label: 'コンバージョン', sum: true,  fmt: fmtDec, axis: fmtCompact },
  ctr:    { label: 'CTR',  sum: false, fmt: fmtPct, axis: v => v.toFixed(1) + '%' },
  cpc:    { label: 'CPC',  sum: false, fmt: fmtYen, axis: fmtCompact },
  cvr:    { label: 'CVR',  sum: false, fmt: fmtPct, axis: v => v.toFixed(1) + '%' },
  cpa:    { label: 'CPA',  sum: false, fmt: fmtYen, axis: fmtCompact },
};

// CVアクションで絞り込み中はそのアクションの値、未選択なら合計CV
const convOf = a => (state.action ? (a.actions && a.actions[state.action]) || 0 : a.conv);
const CV_METRICS = new Set(['conv', 'cvr', 'cpa']);
// 絞り込み中はCV系指標のラベルにアクション名を付ける
const metricLabel = key => METRICS[key].label +
  (state.action && CV_METRICS.has(key) ? `（${ACTION_LABEL(state.action)}）` : '');

// 集計オブジェクト→指標値（率系は合計から再計算。分母0はnull）
function metricOf(a, key) {
  switch (key) {
    case 'imp': return a.imp;
    case 'clicks': return a.clicks;
    case 'cost': return a.cost;
    case 'conv': return convOf(a);
    case 'ctr': return a.imp > 0 ? a.clicks / a.imp * 100 : null;
    case 'cpc': return a.clicks > 0 ? a.cost / a.clicks : null;
    case 'cvr': return a.clicks > 0 ? convOf(a) / a.clicks * 100 : null;
    case 'cpa': return convOf(a) > 0 ? a.cost / convOf(a) : null;
  }
}

/* ================= 状態 ================= */
const params = new URLSearchParams(location.search);
let state = {
  metric: METRICS[params.get('m')] ? params.get('m') : 'clicks',
  norm: params.get('norm') === '1' && HAS_DAY_COUNTS,
  action: null, // null=合計CV、それ以外はアクション名（RAWのキー）
};
{
  const cvParam = params.get('cv');
  if (cvParam) {
    state.action = ACTIONS.find(k => k === cvParam || ACTION_LABEL(k) === cvParam) || null;
  }
}
const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

// sequential blue ramp（100→700）。ダークは暗→明で「多いほど明るく」
const RAMP_LIGHT = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7',
                    '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const RAMP_DARK = [...RAMP_LIGHT].reverse();
const ramp = () => (isDark() ? RAMP_DARK : RAMP_LIGHT);

/* ================= ツールチップ ================= */
const tipEl = document.getElementById('tooltip');
function showTip(evt, head, rows) {
  tipEl.textContent = '';
  const h = document.createElement('div');
  h.className = 'tt-head';
  h.textContent = head;
  tipEl.appendChild(h);
  rows.forEach(([k, v, em]) => {
    const row = document.createElement('div');
    row.className = 'tt-row' + (em ? ' em' : '');
    const ke = document.createElement('span'); ke.className = 'k'; ke.textContent = k;
    const ve = document.createElement('span'); ve.className = 'v'; ve.textContent = v;
    row.append(ke, ve);
    tipEl.appendChild(row);
  });
  tipEl.classList.add('show');
  moveTip(evt);
}
function moveTip(evt) {
  const pad = 14, r = tipEl.getBoundingClientRect();
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
}
function hideTip() { tipEl.classList.remove('show'); }

function cellTipRows(a, emKey) {
  const cv = convOf(a);
  return [
    ['表示回数', fmtInt(a.imp), emKey === 'imp'],
    ['クリック数', fmtInt(a.clicks), emKey === 'clicks'],
    ['費用', fmtYen(a.cost), emKey === 'cost'],
    [state.action ? `CV（${ACTION_LABEL(state.action)}）` : 'CV', fmtDec(cv), emKey === 'conv'],
    ['CTR', a.imp > 0 ? fmtPct(a.clicks / a.imp * 100) : '—', emKey === 'ctr'],
    ['CPC', a.clicks > 0 ? fmtYen(a.cost / a.clicks) : '—', emKey === 'cpc'],
    ['CVR', a.clicks > 0 ? fmtPct(cv / a.clicks * 100) : '—', emKey === 'cvr'],
    ['CPA', cv > 0 ? fmtYen(a.cost / cv) : '—', emKey === 'cpa'],
  ];
}

/* ================= SVGヘルパー ================= */
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, styles) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (styles) for (const k in styles) el.style[k] = styles[k];
  return el;
}
// 上端(横棒は右端)のみ4px角丸のバー。基線側は直角
function roundedBarPath(x, y, w, h, r, horizontal) {
  if (h <= 0 || w <= 0) return '';
  if (!horizontal) {
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
  }
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
}
function niceTicks(max, n = 4) {
  if (max <= 0) return [0];
  const step = Math.pow(10, Math.floor(Math.log10(max / n)));
  const err = max / n / step;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const s = mult * step;
  const ticks = [];
  for (let v = 0; ; v += s) { ticks.push(v); if (v >= max) break; }
  return ticks;
}
function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/* ================= KPIタイル ================= */
function renderKPI() {
  const row = document.getElementById('kpiRow');
  row.textContent = '';
  const cv = convOf(TOTAL);
  const tiles = [
    ['表示回数', fmtInt(TOTAL.imp)],
    ['クリック数', fmtInt(TOTAL.clicks)],
    ['費用', fmtYen(TOTAL.cost)],
    [metricLabel('conv'), fmtDec(cv)],
    ['CTR', TOTAL.imp > 0 ? fmtPct(TOTAL.clicks / TOTAL.imp * 100) : '—'],
    ['CPC', TOTAL.clicks > 0 ? fmtYen(TOTAL.cost / TOTAL.clicks) : '—'],
    [metricLabel('cvr'), TOTAL.clicks > 0 ? fmtPct(cv / TOTAL.clicks * 100) : '—'],
    [metricLabel('cpa'), cv > 0 ? fmtYen(TOTAL.cost / cv) : '—'],
  ];
  tiles.forEach(([label, value]) => {
    const t = document.createElement('div');
    t.className = 'stat-tile';
    const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
    const v = document.createElement('div'); v.className = 'value'; v.textContent = value;
    t.append(l, v);
    row.appendChild(t);
  });
}

/* ================= 指標スイッチ ================= */
function renderSwitch() {
  const sw = document.getElementById('metricSwitch');
  sw.textContent = '';
  Object.entries(METRICS).forEach(([key, m]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m.label;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(state.metric === key));
    b.addEventListener('click', () => {
      state.metric = key;
      renderCharts();
      renderSwitch();
    });
    sw.appendChild(b);
  });
  const toggle = document.getElementById('normToggle');
  toggle.style.display = HAS_DAY_COUNTS ? '' : 'none';
  toggle.classList.toggle('disabled', !METRICS[state.metric].sum);
}

/* ================= ヒートマップ ================= */
function renderHeatmap() {
  const key = state.metric, m = METRICS[key];
  const norm = state.norm && m.sum;
  document.getElementById('heatmapTitle').textContent =
    `曜日 × 時間帯 ヒートマップ｜${metricLabel(key)}${norm ? '（1日あたり）' : ''}`;

  // 値の収集
  const vals = [];
  const valOf = (d, h) => {
    const a = cell[d][h];
    let v = metricOf(a, key);
    if (v !== null && norm) v = v / RAW.dayCounts[d];
    return v;
  };
  DAYS.forEach(d => HOURS.forEach(h => { const v = valOf(d, h); if (v !== null) vals.push(v); }));
  vals.sort((a, b) => a - b);
  // 率・単価系は外れ値で色が飽和しないよう95パーセンタイルでキャップ
  const lo = m.sum ? 0 : vals[0];
  const hi = m.sum ? vals[vals.length - 1] : quantile(vals, 0.95);
  const R = ramp();
  const colorOf = v => {
    if (v === null) return null;
    const t = hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0.5;
    return R[Math.round(t * (R.length - 1))];
  };

  const cw = 34, ch = 27, gap = 2, left = 36, top = 22;
  const W = left + 24 * cw, H = top + 7 * ch + 4;
  const box = document.getElementById('heatmap');
  box.textContent = '';
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' }, { minWidth: '700px' });

  // 時間ラベル（3時間おき＋23時）
  [0, 3, 6, 9, 12, 15, 18, 21, 23].forEach(h => {
    const t = svgEl('text', { x: left + h * cw + cw / 2, y: 14, 'text-anchor': 'middle', 'font-size': 11 },
      { fill: 'var(--text-muted)' });
    t.textContent = h + '時';
    svg.appendChild(t);
  });

  DAYS.forEach((d, di) => {
    const lab = svgEl('text', { x: left - 8, y: top + di * ch + ch / 2 + 4, 'text-anchor': 'end', 'font-size': 12 },
      { fill: 'var(--text-secondary)' });
    lab.textContent = DAY_SHORT[di];
    svg.appendChild(lab);

    HOURS.forEach(h => {
      const v = valOf(d, h);
      const fill = colorOf(v);
      const rect = svgEl('rect', {
        x: left + h * cw + gap / 2, y: top + di * ch + gap / 2,
        width: cw - gap, height: ch - gap, rx: 3,
      });
      if (fill) rect.style.fill = fill;
      else { rect.style.fill = 'var(--grid)'; rect.style.opacity = '0.5'; }
      rect.style.cursor = 'default';
      const a = cell[d][h];
      const head = `${d} ${h}時台` + (norm ? '（実数）' : '');
      rect.addEventListener('pointerenter', e => {
        rect.style.stroke = 'var(--text-primary)';
        rect.style.strokeWidth = '1.5';
        showTip(e, head, cellTipRows(a, key));
      });
      rect.addEventListener('pointermove', moveTip);
      rect.addEventListener('pointerleave', () => { rect.style.stroke = 'none'; hideTip(); });
      svg.appendChild(rect);
    });
  });
  box.appendChild(svg);

  // 凡例
  const leg = document.getElementById('heatLegend');
  leg.textContent = '';
  const minL = document.createElement('span');
  minL.textContent = '少 ' + (m.fmt(lo));
  const rampEl = document.createElement('div');
  rampEl.className = 'ramp';
  rampEl.style.background = `linear-gradient(to right, ${R.join(',')})`;
  const maxL = document.createElement('span');
  maxL.textContent = m.fmt(hi) + (m.sum ? '' : '（95%点）') + ' 多';
  leg.append(minL, rampEl, maxL);
}

/* ================= 時間帯別チャート ================= */
function renderHourly() {
  const key = state.metric, m = METRICS[key];
  const norm = state.norm && m.sum;
  document.getElementById('hourlyTitle').textContent =
    `時間帯別 ${metricLabel(key)}${norm ? '（1日あたり平均）' : ''}`;

  const values = hourAgg.map(a => {
    let v = metricOf(a, key);
    if (v !== null && norm) v = v / TOTAL_DAYS;
    return v;
  });
  const max = Math.max(...values.filter(v => v !== null));
  const ticks = niceTicks(max);
  const tickMax = ticks[ticks.length - 1];

  const W = 520, H = 256, mL = 46, mT = 24, mB = 24, mR = 6;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const band = plotW / 24, barW = Math.min(24, band - 3);
  const y = v => mT + plotH * (1 - v / tickMax);

  const box = document.getElementById('hourlyChart');
  box.textContent = '';
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' });

  ticks.forEach(tv => {
    svg.appendChild(svgEl('line', { x1: mL, x2: W - mR, y1: y(tv), y2: y(tv), 'stroke-width': 1 },
      { stroke: tv === 0 ? 'var(--baseline)' : 'var(--grid)' }));
    const t = svgEl('text', { x: mL - 6, y: y(tv) + 4, 'text-anchor': 'end', 'font-size': 10.5 },
      { fill: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' });
    t.textContent = m.axis(tv);
    svg.appendChild(t);
  });
  [0, 3, 6, 9, 12, 15, 18, 21, 23].forEach(h => {
    const t = svgEl('text', { x: mL + h * band + band / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 10.5 },
      { fill: 'var(--text-muted)' });
    t.textContent = h;
    svg.appendChild(t);
  });

  const maxIdx = values.indexOf(Math.max(...values.filter(v => v !== null)));
  values.forEach((v, h) => {
    if (v === null) return;
    const bx = mL + h * band + (band - barW) / 2;
    const bar = svgEl('path', { d: roundedBarPath(bx, y(v), barW, y(0) - y(v), 4, false) },
      { fill: 'var(--series-1)' });
    svg.appendChild(bar);

    if (h === maxIdx) { // 最大値のみ直接ラベル
      const t = svgEl('text', { x: bx + barW / 2, y: y(v) - 5, 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 600 },
        { fill: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' });
      t.textContent = m.fmt(v);
      svg.appendChild(t);
    }

    // 帯全体をヒットターゲットに
    const hit = svgEl('rect', { x: mL + h * band, y: mT, width: band, height: plotH, fill: 'transparent' });
    const a = hourAgg[h];
    hit.addEventListener('pointerenter', e => {
      bar.style.opacity = '0.75';
      showTip(e, `${h}時台（全曜日${norm ? '・1日あたり' : '合計'}）`,
        [[metricLabel(key), m.fmt(v), true], ...cellTipRows(a, key).filter(r => r[0] !== m.label)]);
    });
    hit.addEventListener('pointermove', moveTip);
    hit.addEventListener('pointerleave', () => { bar.style.opacity = '1'; hideTip(); });
    svg.appendChild(hit);
  });
  box.appendChild(svg);
}

/* ================= 曜日別チャート ================= */
function renderDaily() {
  const key = state.metric, m = METRICS[key];
  const norm = state.norm && m.sum;
  document.getElementById('dailyTitle').textContent =
    `曜日別 ${metricLabel(key)}${norm ? '（1日あたり平均）' : ''}`;
  document.getElementById('dailySub').textContent = norm
    ? '全時間帯の合計を曜日の日数で割った平均'
    : '全時間帯の合計を曜日別に集計';

  const values = DAYS.map(d => {
    let v = metricOf(dayAgg[d], key);
    if (v !== null && norm) v = v / RAW.dayCounts[d];
    return v;
  });
  const max = Math.max(...values.filter(v => v !== null));

  const W = 520, H = 7 * 33 + 16, mL = 34, mR = 86, mT = 8;
  const plotW = W - mL - mR;
  const box = document.getElementById('dailyChart');
  box.textContent = '';
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' });

  svg.appendChild(svgEl('line', { x1: mL, x2: mL, y1: mT, y2: H - 8, 'stroke-width': 1 },
    { stroke: 'var(--baseline)' }));

  DAYS.forEach((d, i) => {
    const v = values[i];
    const rowY = mT + i * 33, barH = 22;
    const lab = svgEl('text', { x: mL - 8, y: rowY + barH / 2 + 4.5, 'text-anchor': 'end', 'font-size': 12.5 },
      { fill: 'var(--text-secondary)' });
    lab.textContent = DAY_SHORT[i];
    svg.appendChild(lab);
    if (v === null) return;

    const w = plotW * (v / max);
    const bar = svgEl('path', { d: roundedBarPath(mL, rowY, w, barH, 4, true) },
      { fill: 'var(--series-1)' });
    svg.appendChild(bar);

    const t = svgEl('text', { x: mL + w + 7, y: rowY + barH / 2 + 4.5, 'font-size': 11.5, 'font-weight': 600 },
      { fill: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' });
    t.textContent = m.fmt(v);
    svg.appendChild(t);

    const hit = svgEl('rect', { x: 0, y: rowY - 3, width: W, height: barH + 6, fill: 'transparent' });
    const a = dayAgg[d];
    hit.addEventListener('pointerenter', e => {
      bar.style.opacity = '0.75';
      showTip(e, HAS_DAY_COUNTS ? `${d}（${RAW.dayCounts[d]}日間${norm ? '・1日あたり' : 'の合計'}）` : `${d}（合計）`,
        [[metricLabel(key), m.fmt(v), true], ...cellTipRows(a, key).filter(r => r[0] !== m.label)]);
    });
    hit.addEventListener('pointermove', moveTip);
    hit.addEventListener('pointerleave', () => { bar.style.opacity = '1'; hideTip(); });
    svg.appendChild(hit);
  });
  box.appendChild(svg);
}

/* ================= CV内訳チャート ================= */
function renderCV() {
  const items = Object.entries(TOTAL.actions)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const box = document.getElementById('cvChart');
  box.textContent = '';
  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'card-sub';
    p.textContent = '内訳データがありません（このレポートにCVアクション列が含まれていないか、すべて0件です）';
    box.appendChild(p);
    return;
  }
  const max = items[0][1];

  const W = 520, rowH = 32, mL = 150, mR = 76, H = items.length * rowH + 12;
  const plotW = W - mL - mR;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' });
  svg.appendChild(svgEl('line', { x1: mL, x2: mL, y1: 4, y2: H - 6, 'stroke-width': 1 },
    { stroke: 'var(--baseline)' }));

  items.forEach(([rawKey, v], i) => {
    const rowY = 6 + i * rowH, barH = 20;
    // 絞り込み中は選択中のアクション以外を薄く表示
    const dimmed = state.action && state.action !== rawKey;
    const lab = svgEl('text', { x: mL - 8, y: rowY + barH / 2 + 4, 'text-anchor': 'end', 'font-size': 11.5 },
      { fill: dimmed ? 'var(--text-muted)' : 'var(--text-secondary)' });
    lab.textContent = ACTION_LABEL(rawKey);
    svg.appendChild(lab);

    const w = Math.max(plotW * (v / max), 2);
    svg.appendChild(svgEl('path', { d: roundedBarPath(mL, rowY, w, barH, 4, true) },
      { fill: 'var(--series-1)', opacity: dimmed ? '0.3' : '1' }));

    const t = svgEl('text', { x: mL + w + 7, y: rowY + barH / 2 + 4, 'font-size': 11.5, 'font-weight': 600 },
      { fill: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', opacity: dimmed ? '0.45' : '1' });
    t.textContent = fmtDec(v);
    svg.appendChild(t);

    // 行クリックでそのアクションに絞り込み（もう一度クリックで解除）
    const hit = svgEl('rect', { x: 0, y: rowY - 3, width: W, height: barH + 6, fill: 'transparent' },
      { cursor: 'pointer' });
    hit.addEventListener('click', () => {
      state.action = state.action === rawKey ? null : rawKey;
      const sel = document.getElementById('actionSelect');
      if (sel) sel.value = state.action || '';
      renderAll();
    });
    svg.appendChild(hit);
  });
  box.appendChild(svg);
}

/* ================= データ表 ================= */
function renderTable() {
  const table = document.getElementById('dataTable');
  table.textContent = '';
  const cols = ['曜日', '時間帯', '表示回数', 'クリック数', '費用',
    state.action ? `CV（${ACTION_LABEL(state.action)}）` : 'CV', 'CTR', 'CPC', 'CVR', 'CPA'];
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  cols.forEach(c => { const th = document.createElement('th'); th.textContent = c; hr.appendChild(th); });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  DAYS.forEach(d => HOURS.forEach(h => {
    const a = cell[d][h];
    const cv = convOf(a);
    const tr = document.createElement('tr');
    const vals = [
      d.replace('曜日', ''), `${h}時台`,
      fmtInt(a.imp), fmtInt(a.clicks), fmtYen(a.cost), fmtDec(cv),
      a.imp > 0 ? fmtPct(a.clicks / a.imp * 100) : '—',
      a.clicks > 0 ? fmtYen(a.cost / a.clicks) : '—',
      a.clicks > 0 ? fmtPct(cv / a.clicks * 100) : '—',
      cv > 0 ? fmtYen(a.cost / cv) : '—',
    ];
    vals.forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
    tbody.appendChild(tr);
  }));
  table.appendChild(tbody);
}

/* ================= 主な気づき（自動生成） ================= */
function renderInsights() {
  const ul = document.getElementById('insightsList');
  ul.textContent = '';
  const add = (strong, rest) => {
    const li = document.createElement('li');
    const s = document.createElement('strong');
    s.textContent = strong;
    li.appendChild(s);
    li.appendChild(document.createTextNode(rest));
    ul.appendChild(li);
  };
  const argBest = (arr, better) => { // better: (a,b)=>aがbより良いならtrue
    let idx = -1;
    arr.forEach((v, i) => { if (v !== null && (idx < 0 || better(v, arr[idx]))) idx = i; });
    return idx;
  };

  // 0) CVアクション絞り込み中の注記
  if (state.action) {
    add(`CVアクション「${ACTION_LABEL(state.action)}」で絞り込み中。`,
      'CV・CVR・CPAはこのアクションのみで計算しています。');
  }

  // 1) クリック数のピーク時間帯
  const clk = hourAgg.map(a => a.clicks);
  const maxH = argBest(clk, (a, b) => a > b), minH = argBest(clk, (a, b) => a < b);
  if (clk[minH] > 0) {
    add(`クリック数のピークは${maxH}時台。`,
      `${fmtInt(clk[maxH])}クリックで、最少の${minH}時台（${fmtInt(clk[minH])}）の約${(clk[maxH] / clk[minH]).toFixed(1)}倍です。`);
  }

  // 2) 効率ベスト時間帯（CPA最安・CVR最高）
  const cpaH = hourAgg.map(a => metricOf(a, 'cpa'));
  const cvrH = hourAgg.map(a => metricOf(a, 'cvr'));
  const bestCpaH = argBest(cpaH, (a, b) => a < b);
  const bestCvrH = argBest(cvrH, (a, b) => a > b);
  if (bestCpaH >= 0) {
    add(`獲得効率が最も良いのは${bestCpaH}時台。`,
      `CPAは${fmtYen(cpaH[bestCpaH])}と全時間帯で最安です` +
      (bestCvrH >= 0 ? `（CVR最高は${bestCvrH}時台の${fmtPct(cvrH[bestCvrH])}）。` : '。'));
  }

  // 3) 効率ワースト時間帯
  const worstCpaH = argBest(cpaH, (a, b) => a > b);
  if (worstCpaH >= 0 && worstCpaH !== bestCpaH) {
    add(`CPAが最も高いのは${worstCpaH}時台（${fmtYen(cpaH[worstCpaH])}）。`,
      `最安の${bestCpaH}時台の約${(cpaH[worstCpaH] / cpaH[bestCpaH]).toFixed(1)}倍で、入札抑制の検討余地があります。`);
  }

  // 4) 曜日のベスト/ワースト（日数補正後のクリック数）
  const perDay = DAYS.map(d => dayAgg[d].clicks / (HAS_DAY_COUNTS ? RAW.dayCounts[d] : 1));
  const bestD = argBest(perDay, (a, b) => a > b), worstD = argBest(perDay, (a, b) => a < b);
  if (perDay[worstD] > 0) {
    const unit = HAS_DAY_COUNTS ? '1日あたりクリック数' : 'クリック数';
    add(`曜日のボリュームは${DAY_SHORT[bestD]}曜が最大。`,
      `${unit}（${fmtInt(perDay[bestD])}）は最少の${DAY_SHORT[worstD]}曜（${fmtInt(perDay[worstD])}）の約${(perDay[bestD] / perDay[worstD]).toFixed(1)}倍です。`);
  }

  // 5) 曜日の効率（CVR）
  const cvrD = DAYS.map(d => metricOf(dayAgg[d], 'cvr'));
  const cpaD = DAYS.map(d => metricOf(dayAgg[d], 'cpa'));
  const bestCvrD = argBest(cvrD, (a, b) => a > b);
  const worstCpaD = argBest(cpaD, (a, b) => a > b);
  if (bestCvrD >= 0 && worstCpaD >= 0) {
    add(`効率が良い曜日は${DAY_SHORT[bestCvrD]}曜（CVR ${fmtPct(cvrD[bestCvrD])}）。`,
      `逆に${DAY_SHORT[worstCpaD]}曜はCPAが${fmtYen(cpaD[worstCpaD])}と最も高く、効率が落ちる曜日です。`);
  }
}

/* ================= CVアクションセレクター ================= */
function renderActionSelect() {
  const wrap = document.getElementById('actionSelectWrap');
  if (!wrap) return;
  if (ACTIONS.length === 0) { wrap.style.display = 'none'; return; }
  const sel = document.getElementById('actionSelect');
  sel.textContent = '';
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'すべて（合計CV）';
  sel.appendChild(optAll);
  ACTIONS.forEach(k => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = ACTION_LABEL(k);
    sel.appendChild(o);
  });
  sel.value = state.action || '';
  sel.addEventListener('change', () => {
    state.action = sel.value || null;
    renderAll();
  });
}

/* ================= 初期化 ================= */
function renderCharts() {
  renderHeatmap();
  renderHourly();
  renderDaily();
}
function renderAll() {
  renderKPI();
  renderCharts();
  renderCV();
  renderInsights();
  renderTable();
}
document.getElementById('period').textContent = '集計期間: ' + RAW.period;
if (RAW.source) {
  document.querySelector('.source-note').textContent = 'データソース: ' + RAW.source;
}
document.getElementById('normCheck').checked = state.norm;
document.getElementById('normCheck').addEventListener('change', e => {
  state.norm = e.target.checked;
  renderCharts();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderCharts);

renderSwitch();
renderActionSelect();
renderAll();
