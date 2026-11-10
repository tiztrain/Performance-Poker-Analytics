// ---------- Line chart for the Trends tab ----------
// Draws one SVG line chart from a spec and binds a hover crosshair with a tooltip. One y-axis
// only; a target band (shaded) when the stat has one. Every chart also has a table view under it,
// so nothing is read from colour alone.
//
// spec: {
//   id, width (pixels), xLabels: [string per point],
//   series: [{ name, color, values: [number | null], kind: 'line' | 'dots' }],
//   band: { min, max } | null, zero: bool (draw a y = 0 line), include: [values the y-axis must span],
//   yFmt(v) -> string, tooltip(i) -> html, table: { headers: [], rows: [[]] }
// }

// Validated with the dataviz palette checker against the panel colour (#0f2419): gold for the main
// series, blue for the comparison.
export const SERIES_COLORS = { main: '#b8862a', compare: '#5b8fd9' };

const M = { l: 48, r: 16, t: 14, b: 26 };
const specs = new Map();

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

export function lineChartHtml(spec) {
  specs.set(spec.id, spec);
  // Drawn at the panel's real width (spec.width), so text stays the same size on a phone.
  const W = spec.width || 960;
  const H = W < 600 ? 200 : 250;
  const n = spec.xLabels.length;
  const all = spec.series.flatMap(s => s.values).filter(v => v !== null && Number.isFinite(v));
  if (spec.band) all.push(spec.band.min, spec.band.max);
  if (spec.zero) all.push(0);
  if (spec.include) all.push(...spec.include);
  if (!n || !all.length) return '<div class="quiz-intro">Not enough data yet.</div>';
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = i => M.l + (n === 1 ? (W - M.l - M.r) / 2 : (i * (W - M.l - M.r)) / (n - 1));
  const y = v => M.t + ((yMax - v) * (H - M.t - M.b)) / (yMax - yMin || 1);

  let svg = '';
  ticks.forEach(t => {
    svg +=
      '<line class="trend-grid" x1="' +
      M.l +
      '" x2="' +
      (W - M.r) +
      '" y1="' +
      y(t) +
      '" y2="' +
      y(t) +
      '"/>' +
      '<text class="trend-axis" x="' +
      (M.l - 6) +
      '" y="' +
      (y(t) + 4) +
      '" text-anchor="end">' +
      spec.yFmt(t) +
      '</text>';
  });
  if (spec.band) {
    svg +=
      '<rect class="trend-band" x="' +
      M.l +
      '" width="' +
      (W - M.l - M.r) +
      '" y="' +
      y(spec.band.max) +
      '" height="' +
      Math.max(1, y(spec.band.min) - y(spec.band.max)) +
      '"/>' +
      '<text class="trend-axis" x="' +
      (W - M.r - 4) +
      '" y="' +
      (y(spec.band.max) + 12) +
      '" text-anchor="end">target</text>';
  }
  if (spec.zero && yMin < 0 && yMax > 0) {
    svg += '<line class="trend-zero" x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
  }
  spec.series.forEach(s => {
    if (s.kind === 'dots') {
      s.values.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) return;
        svg += '<circle class="trend-dot" cx="' + x(i) + '" cy="' + y(v) + '" r="4" fill="' + s.color + '"/>';
      });
      return;
    }
    // Lines break at missing values rather than bridging them.
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return void (pen = false);
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
      pen = true;
    });
    svg += '<path class="trend-line" d="' + d + '" stroke="' + s.color + '"/>';
  });
  if (n > 1) {
    svg +=
      '<text class="trend-axis" x="' +
      M.l +
      '" y="' +
      (H - 6) +
      '">' +
      spec.xLabels[0] +
      '</text>' +
      '<text class="trend-axis" x="' +
      (W - M.r) +
      '" y="' +
      (H - 6) +
      '" text-anchor="end">' +
      spec.xLabels[n - 1] +
      '</text>';
  }
  svg +=
    '<line class="trend-cross" y1="' +
    M.t +
    '" y2="' +
    (H - M.b) +
    '" x1="0" x2="0" style="display:none"/>' +
    '<rect class="trend-hit" x="' +
    M.l +
    '" y="0" width="' +
    (W - M.l - M.r) +
    '" height="' +
    H +
    '"/>';

  const legend =
    spec.series.length > 1
      ? '<div class="trend-legend">' +
        spec.series
          .map(
            s =>
              '<span><i class="' +
              (s.kind === 'dots' ? 'dot' : 'line') +
              '" style="background:' +
              s.color +
              '"></i>' +
              s.name +
              '</span>',
          )
          .join('') +
        (spec.band ? '<span><i class="band"></i>Target range</span>' : '') +
        '</div>'
      : '';
  const table =
    '<details class="breakdowns"><summary>Show as a table</summary><div class="table-scroll"><table class="hand-table">' +
    '<thead><tr>' +
    spec.table.headers.map(h => '<th>' + h + '</th>').join('') +
    '</tr></thead><tbody>' +
    spec.table.rows.map(r => '<tr>' + r.map(c => '<td class="mono">' + c + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div></details>';
  return (
    legend +
    '<svg class="trend-chart" data-trend="' +
    spec.id +
    '" viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" role="img">' +
    svg +
    '</svg>' +
    table
  );
}

// Hover: the nearest point's tooltip, with a vertical crosshair.
export function bindLineCharts(root) {
  const tooltip = document.getElementById('chart-tooltip');
  root.querySelectorAll('svg.trend-chart').forEach(svg => {
    const spec = specs.get(svg.dataset.trend);
    const hit = svg.querySelector('.trend-hit');
    const cross = svg.querySelector('.trend-cross');
    if (!spec || !hit) return;
    const n = spec.xLabels.length;
    const W = spec.width || 960;
    hit.addEventListener('mousemove', e => {
      const box = svg.getBoundingClientRect();
      const vx = ((e.clientX - box.left) / box.width) * W;
      const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((vx - M.l) / (W - M.l - M.r)) * (n - 1))));
      const cx = M.l + (n === 1 ? (W - M.l - M.r) / 2 : (i * (W - M.l - M.r)) / (n - 1));
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.style.display = '';
      tooltip.innerHTML = spec.tooltip(i);
      tooltip.style.display = 'block';
      tooltip.style.left = Math.min(e.clientX + 12, window.innerWidth - 220) + 'px';
      tooltip.style.top = e.clientY - 10 + 'px';
    });
    hit.addEventListener('mouseleave', () => {
      cross.style.display = 'none';
      tooltip.style.display = 'none';
    });
  });
}
