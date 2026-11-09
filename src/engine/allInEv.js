// ---------- All-in EV (expected value) ----------
// For every all-in where the cards still to come decide the hand, compares what Hero won with
// what Hero would win on average over every possible runout. The difference is luck; the
// expected figure is what the decision to get the chips in was worth.
// - Multiway all-ins are split into a main pot and side pots (extra pots that only the players
//   who put in more can win), each with its own equity.
// - Needs every remaining player's cards. Hands where an opponent didn't show are listed as
//   skipped, since their equity can't be known.
// - River all-ins are left out: no cards are to come, so there is no luck to measure.

import { DEFAULT_SAMPLES, potEquities } from './equity.js';

const STREETS = ['preflop', 'flop', 'turn', 'river'];

function boardThrough(hand, street) {
  if (street === 'preflop') return [];
  if (street === 'flop') return hand.board.flop;
  if (street === 'turn') return [...hand.board.flop, hand.board.turn];
  return [...hand.board.flop, hand.board.turn, hand.board.river];
}

function streetDealt(hand, street) {
  if (street === 'flop') return hand.board.flop.length === 3;
  if (street === 'turn') return !!hand.board.turn;
  if (street === 'river') return !!hand.board.river;
  return true;
}

// Total chips each player put in over the whole hand, antes included. Uncalled chips (the part
// of a bet nobody matched, which CoinPoker returns) are still counted here; they end up in a pot
// only that player can win, so they come back to them in both the expected and actual result.
export function contributions(hand) {
  const total = {};
  hand.seats.forEach(s => (total[s.name] = (hand.antes && hand.antes[s.name]) || 0));
  STREETS.forEach(street => {
    const streetContrib = {};
    hand.streets[street].forEach(a => {
      const prev = streetContrib[a.player] || 0;
      let add = 0;
      if (a.action === 'raise') add = a.to - prev;
      else if (a.action === 'call' || a.action === 'bet' || a.action === 'post') add = a.amount || 0;
      streetContrib[a.player] = prev + add;
      total[a.player] = (total[a.player] || 0) + add;
    });
  });
  return total;
}

// Main pot and side pots. Each level is set by a remaining player's total contribution; a pot
// holds everyone's chips between the previous level and this one (folded players' chips
// included), and only remaining players who reached the level can win it.
export function buildPots(contrib, remaining) {
  const levels = [...new Set(remaining.map(p => contrib[p]))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  levels.forEach(level => {
    let amount = 0;
    Object.values(contrib).forEach(c => (amount += Math.max(0, Math.min(c, level) - prev)));
    const eligible = remaining.filter(p => contrib[p] >= level);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  });
  return pots;
}

// Turns a hand ID into a seed, so each hand's sampling is repeatable.
function seedFor(hand) {
  let h = 2166136261;
  for (const ch of String(hand.id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// The all-in spot in a hand, or null if there isn't one. Returns { skipped: reason } when there
// is an all-in but it can't be measured.
export function findAllIn(hand) {
  const folded = new Set();
  STREETS.forEach(st => hand.streets[st].forEach(a => a.action === 'fold' && folded.add(a.player)));
  const remaining = hand.seats.map(s => s.name).filter(n => !folded.has(n));
  if (!remaining.includes('Hero') || remaining.length < 2 || !hand.heroCards) return null;

  // The betting ends on the last street with a real action; if later streets were still dealt,
  // nobody could act on them, which means the remaining players were all-in.
  let lastIdx = -1;
  STREETS.forEach((st, i) => {
    if (hand.streets[st].some(a => a.action !== 'post')) lastIdx = i;
  });
  if (lastIdx < 0 || lastIdx === 3 || !streetDealt(hand, STREETS[lastIdx + 1])) return null;
  if (!hand.board.river) return null;

  const hands = { Hero: hand.heroCards };
  for (const p of remaining) {
    if (p === 'Hero') continue;
    const shown = hand.shows.find(s => s.player === p && s.cards && s.cards.length === 2);
    if (!shown) return { skipped: 'an opponent’s cards were not shown', street: STREETS[lastIdx] };
    hands[p] = shown.cards;
  }
  return { street: STREETS[lastIdx], board: boardThrough(hand, STREETS[lastIdx]), remaining, hands };
}

export function allInEv(hand, { samples = DEFAULT_SAMPLES } = {}) {
  const spot = findAllIn(hand);
  if (!spot || spot.skipped) return spot;
  const contrib = contributions(hand);
  const pots = buildPots(contrib, spot.remaining);
  const eq = potEquities(spot.hands, spot.board, pots, { samples, seed: seedFor(hand) });
  const expectedNet = eq.expected.Hero - contrib.Hero;
  const actualNet = hand.heroNetChips;
  return {
    hand,
    street: spot.street,
    board: spot.board,
    hands: spot.hands,
    pots: pots.map((p, i) => ({ ...p, heroEquity: p.eligible.includes('Hero') ? eq.potEquity[i].Hero : null })),
    heroEquity: eq.potEquity[0].Hero, // share of the main pot, which Hero is always in
    exact: eq.exact,
    expectedNet,
    actualNet,
    luck: actualNet - expectedNet,
    bb: hand.bb,
  };
}

// Totals across all-ins, in chips and in big blinds (each hand in its own big blind, because
// blinds rise during a tournament).
export function summarizeAllIns(results) {
  const sum = f => results.reduce((t, r) => t + f(r), 0);
  return {
    count: results.length,
    expectedChips: sum(r => r.expectedNet),
    actualChips: sum(r => r.actualNet),
    luckChips: sum(r => r.luck),
    expectedBB: sum(r => r.expectedNet / r.bb),
    actualBB: sum(r => r.actualNet / r.bb),
    luckBB: sum(r => r.luck / r.bb),
  };
}
