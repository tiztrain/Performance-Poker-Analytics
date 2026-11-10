import { computeStats } from '../engine/stats.js';
import { FORMAT_LABELS, FORMAT_ORDER } from '../engine/format.js';
import { createTargetStore, effectiveTargets, gradeStat, rangeLabel, TARGET_STATS } from '../engine/targets.js';
import { currentRerender } from '../state.js';
import { wilsonRange } from '../engine/confidence.js';
import { byPosition, byStackDepth } from '../engine/breakdowns.js';

// ---------- Stat-grid panel (one per format) ----------
// Targets come from engine/targets.js: defaults per format with the player's own ranges (saved in
// this browser) on top. Turbo and hyper defaults are estimates and say so.
const targetStore = createTargetStore(browserStorage());
const openEditors = new Set(); // formats whose editor is open, so a redraw after saving keeps it open

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function statGridHtml(hands, format, labelFormat) {
  const stats = computeStats(hands);
  const s = stats;
  const overrides = targetStore.load();
  const targets = effectiveTargets(format, overrides);
  const custom = overrides[format] || {};

  function statValueOrNote(value) {
    return value !== null
      ? value + '%'
      : '<span style="font-size:12px;color:var(--text-faint);">no qualifying hands</span>';
  }
  function targetLine(key) {
    const t = targets[key];
    if (!t) return '';
    const estimate = (format === 'turbo' || format === 'hyper') && !(key in custom) ? ' (estimate)' : '';
    return '<div class="target">' + rangeLabel(t) + (key in custom ? ' (yours)' : estimate) + '</div>';
  }
  function cls(value, key) {
    return gradeStat(value, targets[key]);
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
    { label: '3-BET DEFENSE', value: s.threeBetDefense, key: 'threeBetDefense' },
    { label: 'FOLD TO 3-BET', value: s.foldToThreeBet, key: 'foldToThreeBet' },
    { label: 'C-BET', value: s.cbet, key: 'cbet' },
    { label: 'FOLD TO C-BET', value: s.foldToCbet, key: 'foldToCbet' },
    { label: 'CHECK-RAISE', value: s.checkRaise, key: 'checkRaise' },
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
      (c.key ? cls(c.value, c.key) : '') +
      '"><div class="label">' +
      c.label +
      '</div><div class="value">' +
      display +
      '</div>' +
      rangeLine(c.key ? s.counts[c.key] : null) +
      (c.key ? targetLine(c.key) : '') +
      '</div>';
  });
  html += '</div>' + breakdownHtml(hands) + targetEditorHtml(format, targets, custom) + '</div>';
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

// Editor for this format's target ranges. Saving or resetting redraws the current view.
function targetEditorHtml(format, targets, custom, forceOpen = false) {
  let h =
    '<details class="breakdowns target-editor" data-format="' +
    format +
    '"' +
    (forceOpen || openEditors.has(format) ? ' open' : '') +
    '><summary>Edit targets for ' +
    FORMAT_LABELS[format].toLowerCase() +
    ' tournaments</summary><div class="caveat">Set your own target range for each stat (0–100%). Leave both boxes ' +
    'empty and save to use no target. Your ranges are saved in this browser.</div><div class="target-rows">';
  TARGET_STATS.forEach(({ key, label }) => {
    const t = targets[key];
    h +=
      '<div class="target-row" data-key="' +
      key +
      '"><span class="target-name">' +
      label +
      (key in custom ? ' <span class="target-yours">yours</span>' : '') +
      '</span><input type="number" min="0" max="100" step="1" class="target-min" value="' +
      (t ? t.min : '') +
      '" aria-label="' +
      label +
      ' minimum"><span>–</span><input type="number" min="0" max="100" step="1" class="target-max" value="' +
      (t ? t.max : '') +
      '" aria-label="' +
      label +
      ' maximum"><span>%</span><button class="filter-btn" data-target-save="1">Save</button>' +
      (key in custom ? '<button class="filter-btn" data-target-reset="1">Reset to default</button>' : '') +
      '<span class="target-error"></span></div>';
  });
  return h + '</div><button class="filter-btn" data-target-reset-all="1">Reset all to defaults</button></details>';
}

// Called by the views after they insert stat panels.
export function bindTargetEditors(root) {
  const redraw = () => currentRerender && currentRerender();
  root.querySelectorAll('.target-editor').forEach(ed => {
    const format = ed.dataset.format;
    ed.addEventListener('toggle', () => (ed.open ? openEditors.add(format) : openEditors.delete(format)));
    ed.querySelectorAll('.target-row').forEach(row => {
      const key = row.dataset.key;
      row.querySelector('[data-target-save]').addEventListener('click', () => {
        const minRaw = row.querySelector('.target-min').value;
        const maxRaw = row.querySelector('.target-max').value;
        if (minRaw === '' && maxRaw === '') {
          targetStore.setOverride(format, key, null);
          return redraw();
        }
        const ok = targetStore.setOverride(format, key, { min: Number(minRaw), max: Number(maxRaw) });
        if (!ok)
          row.querySelector('.target-error').textContent = 'Use 0–100, with the minimum no higher than the maximum.';
        else redraw();
      });
      const reset = row.querySelector('[data-target-reset]');
      if (reset) {
        reset.addEventListener('click', () => {
          targetStore.removeOverride(format, key);
          redraw();
        });
      }
    });
    ed.querySelector('[data-target-reset-all]').addEventListener('click', () => {
      targetStore.clearFormat(format);
      redraw();
    });
  });
}

// The Settings > Targets page: every format's target editor in one place.
export function targetsPageHtml() {
  const overrides = targetStore.load();
  return (
    '<div class="panel"><h2>Targets</h2><div class="quiz-intro">The target range for each stat, per tournament format. ' +
    'Stat cards are green inside the range, gold just outside and red further out. Regular uses common tournament ' +
    'ranges; turbo and hyper are estimates; satellites have none unless you add them. The same editors also sit under ' +
    'each stat panel.</div>' +
    FORMAT_ORDER.map(f => targetEditorHtml(f, effectiveTargets(f, overrides), overrides[f] || {}, true)).join('') +
    '</div>'
  );
}
