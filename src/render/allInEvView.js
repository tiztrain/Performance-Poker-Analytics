// ---------- All-in EV tab ----------
// Lists every all-in where cards were still to come, with Hero's equity, the result Hero could
// expect on average (EV, expected value), what actually happened, and the difference (luck).
// The equity maths runs the first time the tab is opened and is kept for later redraws.

import { allInEv, findAllIn, summarizeAllIns } from '../engine/allInEv.js';
import { anonymizePlayers } from '../engine/handSummary.js';
import { handSortKey } from '../engine/grouping.js';
import { amountLabel, cardsToIconStr, fmtSigned, fmtSignedTotal } from './format.js';

const STREET_LABELS = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn' };

export function createAllInController(allHands) {
  const sorted = allHands
    .slice()
    .sort((a, b) => (handSortKey(a) < handSortKey(b) ? -1 : handSortKey(a) > handSortKey(b) ? 1 : 0));
  // Cheap check up front (no equity maths) so the tab label can show a count.
  const spots = sorted.map(h => ({ hand: h, spot: findAllIn(h) })).filter(x => x.spot);
  let computed = null;

  function compute() {
    if (computed) return computed;
    const results = [];
    const skipped = [];
    spots.forEach(({ hand, spot }) => {
      if (spot.skipped) skipped.push({ hand, reason: spot.skipped, street: spot.street });
      else results.push(allInEv(hand));
    });
    computed = { results, skipped, summary: summarizeAllIns(results) };
    return computed;
  }

  function pct(x) {
    return Math.round(x * 1000) / 10 + '%';
  }

  function summaryHtml(s, skippedCount) {
    if (!s.count) {
      return (
        '<div class="panel"><h2>All-in EV</h2><div class="quiz-intro">No all-ins with cards still to come and every ' +
        'player’s cards shown in the loaded hands' +
        (skippedCount ? ' (' + skippedCount + ' skipped because an opponent didn’t show).' : '.') +
        '</div></div>'
      );
    }
    const luckCls = s.luckChips > 0 ? 'good' : s.luckChips < 0 ? 'leak' : '';
    const luckWords =
      s.luckChips === 0
        ? 'exactly what your all-ins were worth'
        : (s.luckChips > 0 ? 'more' : 'less') + ' than your all-ins were worth on average';
    return (
      '<div class="panel"><h2>All-in EV</h2><div class="quiz-intro">For each all-in with cards still to come, your ' +
      '<b>equity</b> is how often you’d win the pot over every possible runout. <b>Expected</b> is the result that ' +
      'equity is worth on average; <b>actual</b> is what happened; <b>luck</b> is the difference. Judge the decision ' +
      'by the expected figure, not the result.</div><div class="quiz-scores">' +
      '<div><b>' +
      s.count +
      '</b><span>all-ins measured</span></div>' +
      '<div><b>' +
      fmtSignedTotal(s.expectedChips, s.expectedBB) +
      '</b><span>expected</span></div>' +
      '<div><b>' +
      fmtSignedTotal(s.actualChips, s.actualBB) +
      '</b><span>actual</span></div>' +
      '<div><b class="' +
      luckCls +
      '">' +
      fmtSignedTotal(s.luckChips, s.luckBB) +
      '</b><span>luck: you won ' +
      luckWords +
      '</span></div></div></div>'
    );
  }

  function rowHtml(r) {
    const names = anonymizePlayers(r.hand);
    const opponents = Object.keys(r.hands)
      .filter(p => p !== 'Hero')
      .map(p => names.get(p) + ' ' + cardsToIconStr(r.hands[p]))
      .join('<br>');
    // Hero's share of each pot others can also win (a pot only Hero can win is just a returned bet).
    const contested = r.pots.filter(p => p.eligible.length > 1 && p.eligible.includes('Hero'));
    const equity = contested.map((p, i) => (i === 0 ? '' : 'side ') + pct(p.heroEquity)).join('<br>');
    const luckCls = r.luck > 0 ? 'good' : r.luck < 0 ? 'leak' : '';
    return (
      '<tr><td class="mono">#' +
      r.hand.id +
      '</td><td>' +
      STREET_LABELS[r.street] +
      (Object.keys(r.hands).length > 2 ? ' · ' + Object.keys(r.hands).length + '-way' : '') +
      '</td><td class="cards">' +
      cardsToIconStr(r.hands.Hero) +
      '</td><td class="cards">' +
      opponents +
      '</td><td class="cards">' +
      cardsToIconStr(r.board) +
      '</td><td class="mono">' +
      (r.exact ? '' : '≈') +
      equity +
      '</td><td class="mono">' +
      fmtSigned(r.expectedNet, r.bb) +
      '</td><td class="mono">' +
      fmtSigned(r.actualNet, r.bb) +
      '</td><td class="mono ' +
      luckCls +
      '">' +
      fmtSigned(r.luck, r.bb) +
      '</td></tr>'
    );
  }

  function render(mount) {
    const { results, skipped, summary } = compute();
    let h = summaryHtml(summary, skipped.length);
    if (results.length) {
      h +=
        '<div class="panel"><h2>Every all-in</h2><div class="table-scroll"><table class="hand-table allin-table">' +
        '<thead><tr><th>Hand</th><th>All-in on</th><th>You</th><th>Opponents</th><th>Board then</th>' +
        '<th>Your equity</th><th>Expected (' +
        amountLabel() +
        ')</th><th>Actual (' +
        amountLabel() +
        ')</th><th>Luck (' +
        amountLabel() +
        ')</th></tr></thead><tbody>' +
        results.map(rowHtml).join('') +
        '</tbody></table></div><div class="caveat">Flop and turn all-ins are exact (every possible runout). ' +
        'Preflop ones, marked ≈, are estimated from 20,000 random boards, accurate to about half a percent. ' +
        'Multiway all-ins split into a main pot and side pots, each with its own equity. River all-ins aren’t listed: ' +
        'with no cards to come, there is no luck to measure.</div></div>';
    }
    if (skipped.length) {
      h +=
        '<div class="panel"><h2>Skipped</h2><div class="quiz-intro">' +
        skipped.length +
        ' all-in' +
        (skipped.length === 1 ? '' : 's') +
        ' couldn’t be measured because an opponent’s cards weren’t shown: ' +
        skipped.map(s => '#' + s.hand.id + ' (' + s.street + ')').join(', ') +
        '.</div></div>';
    }
    mount.innerHTML = h;
  }

  return { render, spotCount: spots.length, results: () => compute().results };
}
