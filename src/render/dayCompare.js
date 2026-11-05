import { classifyFormat, FORMAT_ORDER } from '../engine/format.js';
import { distinctGroupDates, formatDateLabel } from '../engine/grouping.js';
import { computeStats } from '../engine/stats.js';
import { sumNetStr, amountLabel } from './format.js';

// Day-by-day comparison: like the "Filter by date" view, this buckets by each TOURNAMENT's
// start date (not each hand's own timestamp) so a tournament that runs past midnight stays
// together under the day it started rather than splitting its tail hands onto the next day.
// It's always computed from every hand loaded, independent of the "Filter by date" view's own
// selections. selectedFormats (a Set of 'regular'/'turbo'/'hyper'/'satellite') lets you exclude
// formats you don't want pulled into the comparison - e.g. drop satellites when you're only
// trying to compare your regular-tournament days against each other. `groups` is the same
// per-tournament grouping (with .startDate already attached) used by the main filter view.
export function dayFormatFilterHtml(groups, selectedFormats) {
  const presentFormats = FORMAT_ORDER.filter(f => groups.some(g => g.format === f));
  if (presentFormats.length <= 1) return '';
  let h = '<div class="panel"><h2>Filter which formats count toward the comparison</h2><div class="filter-row">';
  h += '<button class="filter-btn clear-btn" data-day-format-clear="1">Clear formats</button>';
  presentFormats.forEach(f => {
    const active = selectedFormats.has(f);
    const label = f.charAt(0).toUpperCase() + f.slice(1);
    h +=
      '<button class="filter-btn fmt-toggle-' +
      f +
      (active ? ' active' : '') +
      '" data-day-format="' +
      f +
      '"><span class="' +
      (active ? '' : 'fmt-' + f) +
      '">' +
      label +
      '</span></button>';
  });
  h += '</div></div>';
  return h;
}
// Which tournament-start dates count toward the day-comparison table.
export function dayDateFilterHtml(groups, selectedDayDates) {
  const dates = distinctGroupDates(groups);
  if (dates.length <= 1) return '';
  const allSelected = dates.every(d => selectedDayDates.has(d));
  let h = '<div class="panel"><h2>Filter which dates count toward the comparison</h2><div class="filter-row">';
  h +=
    '<button class="filter-btn all-btn' + (allSelected ? ' active' : '') + '" data-day-date-all="1">All dates</button>';
  h += '<button class="filter-btn clear-btn" data-day-date-clear="1">Clear dates</button>';
  dates.forEach(d => {
    h +=
      '<button class="filter-btn' +
      (selectedDayDates.has(d) ? ' active' : '') +
      '" data-day-date="' +
      d +
      '">' +
      formatDateLabel(d) +
      '</button>';
  });
  h += '</div></div>';
  return h;
}
export function dayComparisonHtml(groups, selectedFormats, selectedDayDates) {
  const filteredGroups = groups.filter(
    g =>
      (!selectedFormats || selectedFormats.has(g.format)) &&
      (!selectedDayDates || !g.startDate || selectedDayDates.has(g.startDate)),
  );
  const byDate = {};
  const order = [];
  filteredGroups.forEach(g => {
    const d = g.startDate;
    if (!d) return;
    if (!byDate[d]) {
      byDate[d] = [];
      order.push(d);
    }
    byDate[d].push(...g.hands);
  });
  if (selectedFormats && selectedFormats.size === 0) {
    return '<div class="panel"><div class="empty-state" style="padding:30px 20px;">Select at least one format above to see the comparison.</div></div>';
  }
  if (selectedDayDates && selectedDayDates.size === 0) {
    return '<div class="panel"><div class="empty-state" style="padding:30px 20px;">Select at least one date above to see the comparison.</div></div>';
  }
  if (order.length < 1) {
    return '<div class="panel"><div class="empty-state" style="padding:30px 20px;">No hands match the current format/date selection.</div></div>';
  }
  if (order.length === 1) {
    return (
      '<div class="panel"><div class="empty-state" style="padding:30px 20px;">Only one date (' +
      formatDateLabel(order[0]) +
      ') matches the current filter - nothing to compare it to. Select another date above.</div></div>'
    );
  }
  order.sort();
  const allFilteredHands = Object.values(byDate).flat();
  // Rolling summary across every hand in the currently selected format(s) - a fixed overall
  // reference point, independent of whatever dates/tournaments the "Filter by date" view has selected.
  const { str: totalNetStr, cls: totalNetClass } = sumNetStr(allFilteredHands);
  const summaryHtml =
    '<div class="panel"><div class="summary-banner"><div class="summary-label">' +
    allFilteredHands.length +
    ' hand' +
    (allFilteredHands.length === 1 ? '' : 's') +
    ' loaded across ' +
    order.length +
    ' dates</div>' +
    '<div class="summary-value ' +
    totalNetClass +
    '">' +
    totalNetStr +
    '</div></div></div>';

  const statCols = [
    { key: 'vpip', label: 'VPIP' },
    { key: 'pfr', label: 'PFR' },
    { key: 'threeBet', label: '3-BET' },
    { key: 'threeBetDefense', label: '3B DEFENSE' },
    { key: 'foldToThreeBet', label: 'FOLD TO 3B' },
    { key: 'cbet', label: 'C-BET' },
    { key: 'foldToCbet', label: 'FOLD TO C-BET' },
    { key: 'checkRaise', label: 'CHECK-RAISE' },
    { key: 'wtsd', label: 'WTSD' },
    { key: 'wsd', label: 'W$SD' },
    { key: 'aggressionFactor', label: 'AF' },
  ];
  const dashRow = statCols
    .map(() => '<td class="mono-num"><span style="color:var(--text-faint);">–</span></td>')
    .join('');
  function statRowCells(dayHands) {
    const stats = computeStats(dayHands);
    return statCols
      .map(c => {
        const v = stats[c.key];
        const display =
          v === null || v === undefined
            ? '<span style="color:var(--text-faint);">–</span>'
            : c.key === 'aggressionFactor'
              ? v
              : v + '%';
        return '<td class="mono-num">' + display + '</td>';
      })
      .join('');
  }

  let headHtml =
    '<th>Date</th><th>Format</th><th>Hands</th><th>Net (' +
    amountLabel() +
    ')</th>' +
    statCols.map(c => '<th>' + c.label + '</th>').join('');
  let rows = '';
  order.forEach(d => {
    const dayHands = byDate[d];
    const buckets = { regular: [], turbo: [], hyper: [], satellite: [] };
    dayHands.forEach(h => {
      buckets[classifyFormat(h.tourney)].push(h);
    });
    const presentFormats = FORMAT_ORDER.filter(f => buckets[f].length > 0);
    const needsTotalRow = presentFormats.length > 1;
    const rowSpan = presentFormats.length + (needsTotalRow ? 1 : 0);
    let firstRow = true;
    function dateCell() {
      if (!firstRow) return '';
      firstRow = false;
      return '<td rowspan="' + rowSpan + '">' + formatDateLabel(d) + '</td>';
    }

    if (needsTotalRow) {
      const { str: dayNetStr, cls: dayNetClass } = sumNetStr(dayHands);
      rows +=
        '<tr style="font-weight:600;">' +
        dateCell() +
        '<td>Total</td>' +
        '<td class="mono-num">' +
        dayHands.length +
        '</td>' +
        '<td class="mono-num ' +
        dayNetClass +
        '">' +
        dayNetStr +
        '</td>' +
        dashRow +
        '</tr>';
    }

    presentFormats.forEach(f => {
      const fHands = buckets[f];
      const { str: netStr, cls: netClass } = sumNetStr(fHands);
      const label = f.charAt(0).toUpperCase() + f.slice(1);
      rows +=
        '<tr>' +
        dateCell() +
        '<td class="fmt-' +
        f +
        '" style="font-weight:600;">' +
        label +
        '</td>' +
        '<td class="mono-num">' +
        fHands.length +
        '</td>' +
        '<td class="mono-num ' +
        netClass +
        '">' +
        netStr +
        '</td>' +
        statRowCells(fHands) +
        '</tr>';
    });
  });
  return (
    summaryHtml +
    '<div class="panel"><h2>Day-by-day comparison</h2><div style="overflow-x:auto;"><table class="hand-table"><thead><tr>' +
    headHtml +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table></div>' +
    '<div class="caveat">Each day breaks out by format (regular/turbo/hyper/satellite), same as everywhere else on the page, since frequency stats aren\'t meaningfully blended across formats — the bold "Total" row is hands/net only, which do combine cleanly. Scroll the table sideways on narrower screens.</div></div>'
  );
}
