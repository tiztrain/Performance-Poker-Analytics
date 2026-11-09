import { computeStats } from '../engine/stats.js';
import { getTargets, FORMAT_LABELS } from '../engine/format.js';
import { wilsonRange } from '../engine/confidence.js';
import { byPosition, byStackDepth } from '../engine/breakdowns.js';

// ---------- Stat-grid panel (one per format) ----------
export function statGridHtml(hands, format, labelFormat) {
  const stats = computeStats(hands);
  const s = stats;
  const targets = getTargets(format);

  function statValueOrNote(value) {
    return value !== null
      ? value + '%'
      : '<span style="font-size:12px;color:var(--text-faint);">no qualifying hands</span>';
  }
  function targetLine(t) {
    if (!t) return '';
    if (t.min !== undefined) return '<div class="target">' + t.label + '</div>';
    return '<div class="target" style="line-height:1.3;">' + t.label + '</div>';
  }
  function cls(value, t) {
    if (!t || t.min === undefined || value === null) return '';
    const v = parseFloat(value);
    if (v >= t.min) return 'good';
    if (v >= t.watch) return 'watch';
    return 'leak';
  }

  const formatLabel =
    format !== 'regular' || labelFormat
      ? ' — <span class="fmt-' + format + '" style="font-weight:600;">' + FORMAT_LABELS[format] + '</span> format'
      : '';
  let html =
    '<div class="panel"><h2>Stats computed from ' +
    s.hands +
    ' hand' +
    (s.hands === 1 ? '' : 's') +
    formatLabel +
    '</h2><div class="stat-grid">';
  const cards = [
    { label: 'VPIP', value: s.vpip, key: 'vpip' },
    { label: 'PFR', value: s.pfr, key: 'pfr' },
    { label: '3-BET', value: s.threeBet, key: 'threeBet' },
    { label: '3-BET DEFENSE', value: s.threeBetDefense, t: targets.threeBetDefense, key: 'threeBetDefense' },
    { label: 'FOLD TO 3-BET', value: s.foldToThreeBet, t: targets.foldToThreeBet, key: 'foldToThreeBet' },
    { label: 'C-BET', value: s.cbet, key: 'cbet' },
    { label: 'FOLD TO C-BET', value: s.foldToCbet, t: targets.foldToCbet, key: 'foldToCbet' },
    { label: 'CHECK-RAISE', value: s.checkRaise, t: targets.checkRaise, key: 'checkRaise' },
    { label: 'WTSD', value: s.wtsd, key: 'wtsd' },
    { label: 'W$SD', value: s.wsd, key: 'wsd' },
    { label: 'AGGRESSION FACTOR', value: null, raw: s.aggressionFactor },
  ];
  cards.forEach(c => {
    const display =
      c.raw !== undefined
        ? c.raw !== null
          ? c.raw
          : '<span style="font-size:12px;color:var(--text-faint);">n/a</span>'
        : statValueOrNote(c.value);
    html +=
      '<div class="stat-card ' +
      cls(c.value, c.t) +
      '"><div class="label">' +
      c.label +
      '</div><div class="value">' +
      display +
      '</div>' +
      rangeLine(c.key ? s.counts[c.key] : null) +
      targetLine(c.t) +
      '</div>';
  });
  html += '</div>' + breakdownHtml(hands) + '</div>';
  return html;
}

// "likely 7–19% · 85 chances": the 95% confidence range for the stat and its sample size.
function rangeLine(count) {
  if (!count || !count[1]) return '';
  const r = wilsonRange(count[0], count[1]);
  return (
    '<div class="stat-range" title="95% confidence range: where your true rate most likely sits, given this sample">' +
    (Math.round(r.low) === Math.round(r.high)
      ? 'likely about ' + Math.round(r.low)
      : 'likely ' + Math.round(r.low) + '–' + Math.round(r.high)) +
    '% · ' +
    count[1] +
    ' chance' +
    (count[1] === 1 ? '' : 's') +
    '</div>'
  );
}

const BREAKDOWN_COLUMNS = [
  ['vpip', 'VPIP'],
  ['pfr', 'PFR'],
  ['threeBet', '3-bet'],
  ['foldToThreeBet', 'Fold to 3-bet'],
  ['cbet', 'C-bet'],
  ['wtsd', 'WTSD'],
];

function breakdownTableHtml(title, rows) {
  if (!rows.length) return '';
  let h =
    '<h3 class="breakdown-title">' +
    title +
    '</h3><div class="table-scroll"><table class="hand-table breakdown-table"><thead><tr><th></th><th>Hands</th>';
  BREAKDOWN_COLUMNS.forEach(([, label]) => (h += '<th>' + label + '</th>'));
  h += '<th>bb won</th></tr></thead><tbody>';
  rows.forEach(r => {
    h += '<tr><td><b>' + r.label + '</b></td><td class="mono">' + r.hands + '</td>';
    BREAKDOWN_COLUMNS.forEach(([key]) => {
      const [hits, chances] = r.stats.counts[key];
      h +=
        '<td class="mono">' +
        (chances ? Math.round((100 * hits) / chances) + '%<span class="breakdown-n"> /' + chances + '</span>' : '–') +
        '</td>';
    });
    const won = r.bbWon;
    h +=
      '<td class="mono ' +
      (won > 0 ? 'good' : won < 0 ? 'leak' : '') +
      '">' +
      (won >= 0 ? '+' : '') +
      won.toFixed(1) +
      '</td></tr>';
  });
  return h + '</tbody></table></div>';
}

// Collapsed by default so the main stat grid stays the first thing you see.
function breakdownHtml(hands) {
  return (
    '<details class="breakdowns"><summary>Breakdown by stack depth and position</summary>' +
    '<div class="caveat">Each percentage shows its number of chances after the slash: small samples swing a lot. ' +
    'Stack depth is the effective stack (the smaller of your stack and the biggest other stack) at the start of the ' +
    'hand. bb won adds up each hand in its own big blinds.</div>' +
    breakdownTableHtml('By stack depth', byStackDepth(hands)) +
    breakdownTableHtml('By position', byPosition(hands)) +
    '</details>'
  );
}
