// ---------- Push/fold tab ----------
// Lists every push/fold spot (15 big blinds or less) with what Hero did, what the Nash chart for
// that spot says, and the cost of any difference. The equity table is loaded and the charts are
// worked out the first time the tab is opened; results are kept for later redraws.

import { createPushFoldChecker, findPushFoldSpot, summarizePushFold } from '../engine/pushFoldSpots.js';
import { equityLookup } from '../engine/pushFold.js';
import { cellName } from '../engine/rangeGrid.js';
import { handSortKey } from '../engine/grouping.js';
import { amountLabel, fmtSigned, fmtSignedTotal } from './format.js';

const ACTION_WORDS = { shove: 'Shove', call: 'Call', fold: 'Fold' };

export function createPushFoldController(allHands) {
  const sorted = allHands
    .slice()
    .sort((a, b) => (handSortKey(a) < handSortKey(b) ? -1 : handSortKey(a) > handSortKey(b) ? 1 : 0));
  const candidates = sorted.filter(h => findPushFoldSpot(h));
  let results = null;
  let working = false;
  let openId = null;

  async function compute(onDone) {
    if (working) return;
    working = true;
    // The table is a separate file, loaded only when this tab is used.
    const table = (await import('../engine/preflopEquity.json')).default;
    const check = createPushFoldChecker(equityLookup(table));
    const out = [];
    for (let i = 0; i < candidates.length; i++) {
      out.push(check(candidates[i]));
      if (i % 20 === 19) await new Promise(r => setTimeout(r, 0)); // keep the page responsive
    }
    results = out;
    onDone();
  }

  function chartGridHtml(r) {
    let h = '<div class="range-grid pf-grid">';
    for (let row = 0; row < 13; row++) {
      for (let col = 0; col < 13; col++) {
        const name = cellName(row, col);
        const idx = row * 13 + col;
        const f = r.range[idx];
        h +=
          '<div class="range-cell ' +
          (f >= 0.5 ? 'painted' : '') +
          (name === r.cell ? ' actual' : '') +
          '" title="' +
          name +
          ': ' +
          Math.round(f * 100) +
          '%">' +
          name +
          '</div>';
      }
    }
    return h + '</div>';
  }

  function spotText(r) {
    return r.kind === 'shove'
      ? 'Folded to you in the ' + r.position
      : r.pusherPosition + ' shoved, you in the ' + r.position;
  }

  function rowHtml(r, list) {
    const key = list + ':' + r.hand.id;
    const bb = r.hand.bb;
    const ok = r.cost === 0;
    let h =
      '<tr class="pf-row' +
      (openId === key ? ' open' : '') +
      '" data-pf="' +
      key +
      '"><td class="mono">#' +
      r.hand.id +
      '</td><td>' +
      spotText(r) +
      '</td><td class="mono">' +
      r.stack.toFixed(1) +
      'bb</td><td class="mono"><b>' +
      r.cell +
      '</b></td><td>' +
      ACTION_WORDS[r.did] +
      '</td><td>' +
      ACTION_WORDS[r.chartAct] +
      '</td><td class="mono">' +
      fmtSigned(r.ev * bb, bb) +
      '</td><td class="mono ' +
      (ok ? 'good' : 'leak') +
      '">' +
      (ok ? '✓' : '−' + fmtSigned(r.cost * bb, bb).replace(/^[+-]/, '')) +
      '</td></tr>';
    if (openId === key) {
      h +=
        '<tr class="pf-detail"><td colspan="8"><div class="pf-detail-inner">' +
        chartGridHtml(r) +
        '<div class="caveat">Chart for this exact spot: ' +
        (r.kind === 'shove' ? 'shove' : 'call') +
        ' the gold hands (' +
        Math.round(r.rangeShare * 1000) / 10 +
        '% of hands), fold the rest. Your hand is outlined. ' +
        (r.kind === 'shove' ? 'Shoving ' : 'Calling ') +
        r.cell +
        ' is worth ' +
        fmtSigned(r.ev * r.hand.bb, r.hand.bb) +
        ' against folding, if the other players use the chart too.</div></div></td></tr>';
    }
    return h;
  }

  function tableHtml(rows, list) {
    return (
      '<div class="table-scroll"><table class="hand-table pf-table"><thead><tr><th>Hand</th><th>Spot</th>' +
      '<th>Stack</th><th>Your hand</th><th>You</th><th>Chart</th><th>Shove/call EV (' +
      amountLabel() +
      ')</th><th>Cost (' +
      amountLabel() +
      ')</th></tr></thead><tbody>' +
      rows.map(r => rowHtml(r, list)).join('') +
      '</tbody></table></div>'
    );
  }

  function render(mount) {
    if (!candidates.length) {
      mount.innerHTML =
        '<div class="panel"><h2>Push/fold</h2><div class="quiz-intro">No push/fold spots in the loaded hands: ' +
        'none where you were first in, or facing a single shove, with 15 big blinds or less.</div></div>';
      return;
    }
    if (!results) {
      mount.innerHTML =
        '<div class="panel"><h2>Push/fold</h2><div class="quiz-intro">Working out the chart for each of your ' +
        candidates.length +
        ' push/fold spots…</div></div>';
      compute(() => {
        if (mount.isConnected) render(mount);
      });
      return;
    }
    const s = summarizePushFold(results);
    const costChips = results.reduce((t, r) => t + r.cost * r.hand.bb, 0);
    const mistakes = results.filter(r => r.cost > 0).sort((a, b) => b.cost - a.cost);
    let h =
      '<div class="panel"><h2>Push/fold</h2><div class="quiz-intro">Every hand where you were first in, or facing ' +
      'one shove, with 15 big blinds or less, checked against the Nash push/fold chart for that exact spot: your ' +
      'stack, the antes, and how many players were left to act. Cost is the expected value you gave up, in big ' +
      'blinds, if the others play the chart too. Click a row to see the chart.</div><div class="quiz-scores">' +
      '<div><b>' +
      s.spots +
      '</b><span>spots checked</span></div><div><b class="' +
      (s.mistakes ? 'leak' : 'good') +
      '">' +
      s.mistakes +
      '</b><span>differ from the chart</span></div><div><b class="' +
      (s.mistakes ? 'leak' : '') +
      '">' +
      fmtSignedTotal(-costChips, -s.costBB) +
      '</b><span>given up against the chart</span></div></div></div>';
    if (mistakes.length)
      h +=
        '<div class="panel"><h2>Differences from the chart, costliest first</h2>' + tableHtml(mistakes, 'm') + '</div>';
    h +=
      '<div class="panel"><details' +
      (mistakes.length ? '' : ' open') +
      '><summary class="pf-summary">All ' +
      results.length +
      ' spots</summary>' +
      tableHtml(results, 'a') +
      '</details><div class="caveat">Charts assume chip EV (no prize-money effects), equal stacks at the effective ' +
      'stack, and at most one caller. Near the money bubble or at a final table, tighter play than the chart can be ' +
      'right.</div></div>';
    mount.innerHTML = h;
    mount.querySelectorAll('[data-pf]').forEach(row => {
      row.addEventListener('click', () => {
        openId = openId === row.dataset.pf ? null : row.dataset.pf;
        render(mount);
      });
    });
  }

  return { render, spotCount: candidates.length };
}
