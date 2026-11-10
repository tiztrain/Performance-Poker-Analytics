// ---------- Nash push/fold solver ----------
// When stacks are short (about 15 big blinds or less), tournament play is mostly "shove all-in
// or fold". A Nash push/fold chart is the game-theory answer: a shoving range for the player
// first in, and a calling range for each player behind, such that nobody can do better by
// changing their own range alone.
//
// This solver works the chart out for one spot (stack size, antes, who has posted blinds, how
// many players are left to act) instead of reading a printed table, so it fits each hand.
// Method: fictitious play. Start from a guess; each round, every player switches to their best
// reply to the others' average play so far; the averages settle on the equilibrium.
//
// Simplifications, the standard ones for push/fold charts:
// - Chip EV (expected value in chips), no ICM (Independent Chip Model: prize-money effects).
// - Every player has the same stack: the effective stack of the spot.
// - At most one caller: each player behind decides as if nobody after them will also call.
// - Equity is by starting-hand type (169 cells) from a precomputed table; card removal between
//   Hero's hand and the callers' ranges is ignored.
//
// All amounts are in big blinds. "EV" below is always measured against folding (fold = 0).

import { ALL_CELLS, combosForCell } from './rangeGrid.js';

const WEIGHTS = ALL_CELLS.map(c => combosForCell(c).length); // 6 pairs, 4 suited, 12 offsuit
const TOTAL_COMBOS = 1326;

// Equity lookup from the table built by scripts/build-preflop-equity.mjs: eq(i, j) is cell i's
// share of the pot against cell j, from 0 to 1.
export function equityLookup(table) {
  const n = table.cells.length;
  const rowStart = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    rowStart.push(k - i); // so index = rowStart[i] + j for j >= i
    k += n - i;
  }
  const m = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const v = table.eq[rowStart[i] + j] / 1000;
      m[i * n + j] = v;
      m[j * n + i] = 1 - v;
    }
  }
  return (i, j) => m[i * n + j];
}

// Hero's equity with cell i against a weighted range (freq[c] = how often cell c is played).
export function equityVsRange(eq, i, freq) {
  let num = 0;
  let den = 0;
  for (let c = 0; c < 169; c++) {
    const w = WEIGHTS[c] * freq[c];
    if (w) {
      num += w * eq(i, c);
      den += w;
    }
  }
  return den ? num / den : 0.5;
}

export function rangeShare(freq) {
  let w = 0;
  for (let c = 0; c < 169; c++) w += WEIGHTS[c] * freq[c];
  return w / TOTAL_COMBOS;
}

// Solve one spot.
//   stack:   effective stack in big blinds, before antes and blinds are posted
//   ante:    ante per player in big blinds (0 if none)
//   players: number of players dealt in (they all post the ante)
//   pusherPost: what the shover has already posted as a blind (0, 0.5 or 1)
//   callerPosts: one entry per player left to act after the shover, in order (0, 0.5 or 1)
//   otherPosts: blinds posted by players who already folded before the shover
// Returns ranges as frequencies per cell (0..1) and each cell's EV against folding.
export function solvePushFold({
  stack,
  ante = 0,
  players,
  pusherPost = 0,
  callerPosts,
  otherPosts = 0,
  eq,
  iterations = 300,
}) {
  const blinds = pusherPost + callerPosts.reduce((a, b) => a + b, 0) + otherPosts;
  const deadPot = players * ante + blinds; // what the shover wins when everyone folds
  const committed = stack - ante; // what each all-in player puts in beyond the ante
  const potIfCalled = i => 2 * committed + players * ante + blinds - pusherPost - callerPosts[i];

  let push = new Float64Array(169).fill(1);
  let calls = callerPosts.map(() => new Float64Array(169));

  function callerEVs(i, pushRange) {
    const ev = new Float64Array(169);
    for (let c = 0; c < 169; c++) {
      ev[c] = equityVsRange(eq, c, pushRange) * potIfCalled(i) - (committed - callerPosts[i]);
    }
    return ev;
  }

  function pushEVs(callRanges) {
    const shares = callRanges.map(rangeShare);
    const ev = new Float64Array(169);
    for (let h = 0; h < 169; h++) {
      let reach = 1; // chance nobody before this caller has called
      let total = 0;
      callRanges.forEach((range, i) => {
        const q = shares[i];
        if (q > 0) total += reach * q * (equityVsRange(eq, h, range) * potIfCalled(i) - (committed - pusherPost));
        reach *= 1 - q;
      });
      ev[h] = total + reach * deadPot;
    }
    return ev;
  }

  for (let t = 1; t <= iterations; t++) {
    const rate = 1 / (t + 1);
    const brCalls = calls.map((_, i) => callerEVs(i, push).map(v => (v > 0 ? 1 : 0)));
    const brPush = pushEVs(calls).map(v => (v > 0 ? 1 : 0));
    calls = calls.map((avg, i) => avg.map((v, c) => v + (brCalls[i][c] - v) * rate));
    push = push.map((v, c) => v + (brPush[c] - v) * rate);
  }

  return {
    push,
    calls,
    pushEV: pushEVs(calls),
    callEVs: calls.map((_, i) => callerEVs(i, push)),
    pushShare: rangeShare(push.map(v => (v >= 0.5 ? 1 : 0))),
    callShares: calls.map(r => rangeShare(r.map(v => (v >= 0.5 ? 1 : 0)))),
  };
}
