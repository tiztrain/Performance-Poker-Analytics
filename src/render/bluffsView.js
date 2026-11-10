// ---------- Bluffs tab ----------
// Bluff analysis (engine/bluffs.js) over every loaded hand: how your bets split into value, thin
// value, semi-bluffs and bluffs; river bluff share against the balanced share for your sizes;
// how often bluffs won straight away against the break-even fold rate; spot quality; and a list
// of every bluff. Worked out the first time the tab is opened.

import { analyseBets, breakEvenFold, spotQuality, summarizeBluffs, verdict } from '../engine/bluffs.js';
import { handSortKey } from '../engine/grouping.js';
import { currentRanges } from './rangeEquity.js';
import { cardsToIconStr, fmtSigned, fmtSignedTotal } from './format.js';

const KIND_LABELS = { value: 'Value', thin: 'Thin value', semiBluff: 'Semi-bluff', bluff: 'Bluff' };
const CONDITION_LABELS = {
  headsUp: 'Heads-up',
  villainShowedWeakness: 'They showed weakness',
  drawBackup: 'Draw as backup',
  noShowdownValue: 'No showdown value',
  stackBehind: 'Not all-in',
};

const pct = x => (x === null || x === undefined ? '–' : Math.round(x * 100) + '%');

export function createBluffsController(allHands) {
  let bets = null;
  let working = false;

  async function compute(done) {
    if (working) return;
    working = true;
    const ranges = await currentRanges();
    const sorted = allHands
      .slice()
      .sort((a, b) => (handSortKey(a) < handSortKey(b) ? -1 : handSortKey(a) > handSortKey(b) ? 1 : 0));
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      out.push(...analyseBets(sorted[i], ranges));
      if (i % 25 === 24) await new Promise(r => setTimeout(r, 0)); // keep the page responsive
    }
    bets = out;
    done();
  }

  function summaryHtml(s) {
    const v = verdict(s.river.share, s.river.balanced);
    const verdictText =
      v === 'under'
        ? 'You bluff the river less than half as often as balanced: opponents can fold more against your river bets.'
        : v === 'over'
          ? 'You bluff the river more than balanced for your sizes: opponents can call you down more.'
          : v === 'balanced'
            ? 'Your river bluff share is close to balanced for your sizes.'
            : 'No river bets yet.';
    const successGood =
      s.success.rate !== null && s.success.breakEven !== null && s.success.rate >= s.success.breakEven;
    return (
      '<div class="panel"><h2>Bluffs</h2><div class="quiz-intro">Each of your bets after the flop is classified by your ' +
      'estimated equity against the range that would call it (from the range model): value above 50%, bluff under 30% ' +
      'on the river, semi-bluff when not value but with a draw or 30%+ on the flop or turn. These are estimates, not ' +
      'solver results, and need many hands before the percentages mean much.</div>' +
      '<div class="quiz-scores">' +
      ['value', 'thin', 'semiBluff', 'bluff']
        .map(k => '<div><b>' + s.counts[k] + '</b><span>' + KIND_LABELS[k].toLowerCase() + ' bets</span></div>')
        .join('') +
      '</div></div>' +
      '<div class="panel"><h2>River bluff share</h2><div class="quiz-scores"><div><b>' +
      pct(s.river.share) +
      '</b><span>of ' +
      s.river.bets +
      ' river bets were bluffs</span></div><div><b>' +
      pct(s.river.balanced) +
      '</b><span>balanced share for your sizes</span></div></div><div class="caveat">Balanced: with a bet of b into a ' +
      'pot of p, bluffs should be b ÷ (p + 2b) of river bets (25% at half pot, 33% at pot), so opponents can’t profit ' +
      'by always calling or always folding. ' +
      verdictText +
      '</div></div>' +
      '<div class="panel"><h2>Bluff success</h2><div class="quiz-scores"><div><b class="' +
      (s.success.rate === null ? '' : successGood ? 'good' : 'leak') +
      '">' +
      pct(s.success.rate) +
      '</b><span>of ' +
      s.success.bluffs +
      ' bluffs and semi-bluffs won straight away</span></div><div><b>' +
      pct(s.success.breakEven) +
      '</b><span>needed to break even for your sizes</span></div><div><b>' +
      fmtSignedTotal(s.success.chipsResult, s.success.bbResult) +
      '</b><span>result of the ' +
      s.success.hands +
      ' hand' +
      (s.success.hands === 1 ? '' : 's') +
      ' with a bluff</span></div><div><b>' +
      pct(s.quality) +
      '</b><span>average spot quality</span></div></div><div class="caveat">Break-even: a bluff of b into p must win ' +
      'b ÷ (p + b) of the time (33% at half pot, 50% at pot). Semi-bluffs can win less often because they also win ' +
      'when they hit. Spot quality is the share of good conditions present: heads-up, the opponent showed weakness, a ' +
      'draw as backup (flop and turn), no showdown value (river), and chips left behind.</div></div>'
    );
  }

  function listHtml(list) {
    if (!list.length) return '';
    let h =
      '<div class="panel"><h2>Every bluff and semi-bluff</h2><div class="table-scroll"><table class="hand-table">' +
      '<thead><tr><th>Hand</th><th>Street</th><th>You</th><th>Board</th><th>Size</th><th>Type</th><th>Equity vs calls</th>' +
      '<th>Needed folds</th><th>Result</th><th>Conditions</th></tr></thead><tbody>';
    list.forEach(b => {
      const board =
        b.street === 'flop'
          ? b.hand.board.flop
          : b.street === 'turn'
            ? [...b.hand.board.flop, b.hand.board.turn]
            : [...b.hand.board.flop, b.hand.board.turn, b.hand.board.river];
      const conds = Object.entries(b.conditions)
        .filter(([, v]) => v !== null)
        .map(
          ([k, v]) =>
            '<span class="' +
            (v ? 'quiz-up' : 'quiz-down') +
            '">' +
            (v ? '✓ ' : '✗ ') +
            CONDITION_LABELS[k] +
            '</span>',
        )
        .join('<br>');
      h +=
        '<tr><td class="mono">#' +
        b.handId +
        '</td><td>' +
        b.street +
        '</td><td class="cards">' +
        cardsToIconStr(b.hand.heroCards) +
        '</td><td class="cards">' +
        cardsToIconStr(board) +
        '</td><td class="mono">' +
        (b.pctPot === null ? '–' : b.pctPot + '%') +
        '</td><td>' +
        KIND_LABELS[b.kind] +
        '</td><td class="mono">' +
        pct(b.equity) +
        '</td><td class="mono">' +
        (b.pot > 0 ? pct(breakEvenFold(b.size, b.pot)) : '–') +
        '</td><td class="mono ' +
        (b.won ? 'good' : '') +
        '">' +
        (b.won ? 'Won it' : 'Called / raised') +
        ' · ' +
        fmtSigned(b.hand.heroNetChips, b.bb) +
        '</td><td class="pf-conds">' +
        conds +
        (spotQuality(b.conditions) !== null ? '<br><b>' + pct(spotQuality(b.conditions)) + '</b>' : '') +
        '</td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }

  function render(mount) {
    if (!bets) {
      mount.innerHTML =
        '<div class="panel"><h2>Bluffs</h2><div class="quiz-intro">Classifying your bets against estimated ranges…</div></div>';
      compute(() => mount.isConnected && render(mount));
      return;
    }
    const s = summarizeBluffs(bets);
    mount.innerHTML = summaryHtml(s) + listHtml(bets.filter(b => b.kind === 'bluff' || b.kind === 'semiBluff'));
  }

  return { render };
}
