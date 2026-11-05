import { computeStats } from '../engine/stats.js';
import { getTargets, FORMAT_LABELS } from '../engine/format.js';

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
    { label: 'VPIP', value: s.vpip },
    { label: 'PFR', value: s.pfr },
    { label: '3-BET', value: s.threeBet },
    { label: '3-BET DEFENSE', value: s.threeBetDefense, t: targets.threeBetDefense },
    { label: 'FOLD TO 3-BET', value: s.foldToThreeBet, t: targets.foldToThreeBet },
    { label: 'C-BET', value: s.cbet },
    { label: 'FOLD TO C-BET', value: s.foldToCbet, t: targets.foldToCbet },
    { label: 'CHECK-RAISE', value: s.checkRaise, t: targets.checkRaise },
    { label: 'WTSD', value: s.wtsd },
    { label: 'W$SD', value: s.wsd },
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
      targetLine(c.t) +
      '</div>';
  });
  html += '</div></div>';
  return html;
}
