// ---------- Play quality tab ----------
// Mistake cost (engine/quality.js) per tournament and across saved history: big blinds per 100
// hands and % of stack per 100 hands, by stage, with each tournament's three costliest decisions.
// Lower is better. Worked out when the tab is first opened, with a progress count.

import { mistakesForHand, scoreHands } from '../engine/quality.js';
import { analyseBets } from '../engine/bluffs.js';
import { createPushFoldChecker, findPushFoldSpot } from '../engine/pushFoldSpots.js';
import { groupByTournament, groupStartDate, formatDateLabel } from '../engine/grouping.js';
import { currentRanges, equityTable } from './rangeEquity.js';

const fmt = x => (x === null || x === undefined ? '–' : x.toFixed(1));

export function createQualityController(allHands) {
  let mistakesById = null;
  let progress = 0;
  let working = false;
  let openKey = null;

  async function compute(update) {
    if (working) return;
    working = true;
    const ranges = await currentRanges();
    const check = createPushFoldChecker(await equityTable());
    const map = new Map();
    for (let i = 0; i < allHands.length; i++) {
      const h = allHands[i];
      const pushFold = findPushFoldSpot(h) ? check(h) : null;
      map.set(h.id, mistakesForHand(h, ranges, { pushFold, bets: analyseBets(h, ranges) }));
      if (i % 20 === 19) {
        progress = i + 1;
        update();
        await new Promise(r => setTimeout(r, 0));
      }
    }
    mistakesById = map;
    update();
  }

  function scoreCards(s, title) {
    return (
      '<div class="quiz-scores"><div><b>' +
      fmt(s.bbPer100) +
      '</b><span>bb lost to mistakes per 100 hands' +
      (title ? ' · ' + title : '') +
      '</span></div><div><b>' +
      fmt(s.stackPctPer100) +
      '%</b><span>of your stack per 100 hands</span></div>' +
      s.stages
        .map(st => '<div><b>' + fmt(st.bbPer100) + '</b><span>' + st.label + ' · ' + st.hands + ' hands</span></div>')
        .join('') +
      '</div>'
    );
  }

  function render(mount) {
    if (!mistakesById) {
      mount.innerHTML =
        '<div class="panel"><h2>Play quality</h2><div class="quiz-intro">Estimating the cost of your decisions… ' +
        progress +
        ' of ' +
        allHands.length +
        ' hands.</div></div>';
      compute(() => mount.isConnected && render(mount));
      return;
    }
    const groups = groupByTournament(allHands);
    groups.forEach(g => (g.startDate = groupStartDate(g)));
    groups.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0)); // newest first
    const overall = scoreHands(allHands, mistakesById);
    const recent = scoreHands(
      groups.slice(0, 10).flatMap(g => g.hands),
      mistakesById,
    );
    let h =
      '<div class="panel"><h2>Play quality</h2><div class="quiz-intro">The estimated cost of your mistakes: push/fold ' +
      'deviations (exact against the chart), calls with less equity than they needed and folds with more (against ' +
      'the estimated range, after the flop or facing an all-in), and losing bluffs in weak spots. Lower is better; a ' +
      'single tournament is a small sample, so watch the trend. Judged on decisions, never results.</div>' +
      scoreCards(overall, 'all ' + overall.hands + ' hands') +
      (groups.length > 10
        ? '<h3 class="breakdown-title">Last 10 tournaments</h3>' +
          scoreCards(recent, '') +
          '<div class="caveat">' +
          (recent.bbPer100 < overall.bbPer100
            ? 'Better than your long-run average.'
            : 'Not better than your long-run average yet.') +
          '</div>'
        : '') +
      '</div><div class="panel"><h2>By tournament</h2><div class="table-scroll"><table class="hand-table">' +
      '<thead><tr><th>Date</th><th>Tournament</th><th>Hands</th><th>bb / 100</th><th>% stack / 100</th>' +
      '<th>Deep</th><th>Middle</th><th>Short</th><th>Mistakes</th></tr></thead><tbody>';
    groups.forEach(g => {
      const s = scoreHands(g.hands, mistakesById);
      const better = s.bbPer100 !== null && overall.bbPer100 !== null && s.bbPer100 <= overall.bbPer100;
      h +=
        '<tr class="pf-row' +
        (openKey === g.key ? ' open' : '') +
        '" data-q="' +
        encodeURIComponent(g.key) +
        '"><td>' +
        (g.startDate ? formatDateLabel(g.startDate) : '–') +
        '</td><td>' +
        g.name +
        '</td><td class="mono">' +
        s.hands +
        '</td><td class="mono ' +
        (better ? 'good' : 'leak') +
        '">' +
        fmt(s.bbPer100) +
        '</td><td class="mono">' +
        fmt(s.stackPctPer100) +
        '%</td>' +
        s.stages.map(st => '<td class="mono">' + (st.hands ? fmt(st.bbPer100) : '–') + '</td>').join('') +
        '<td class="mono">' +
        s.mistakes +
        '</td></tr>';
      if (openKey === g.key) {
        h +=
          '<tr class="pf-detail"><td colspan="9"><div class="pf-detail-inner"><b>Costliest decisions</b><ul class="rq-reasons">' +
          (s.costliest.length
            ? s.costliest
                .map(m => '<li>#' + m.hand.id + ': ' + m.label + ' (−' + m.cost.toFixed(2) + 'bb)</li>')
                .join('')
            : '<li>No mistakes found.</li>') +
          '</ul></div></td></tr>';
      }
    });
    h +=
      '</tbody></table></div><div class="caveat">Green: at or below your long-run average. Click a tournament for its ' +
      'costliest decisions. Calls, folds and bluffs are judged against estimated ranges, not a solver.</div></div>';
    mount.innerHTML = h;
    mount.querySelectorAll('[data-q]').forEach(row =>
      row.addEventListener('click', () => {
        const key = decodeURIComponent(row.dataset.q);
        openKey = openKey === key ? null : key;
        render(mount);
      }),
    );
  }

  return { render };
}
