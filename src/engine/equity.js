// ---------- Equity calculator ----------
// Equity is the share of a pot a hand wins on average over every way the remaining board cards
// can come. Used by all-in EV (expected value, engine/allInEv.js).
// - With 2 or fewer board cards to come (a flop or turn all-in) every runout is checked exactly:
//   at most C(45,2) = 990 of them.
// - Preflop there are about 1.7 million possible boards, too slow in a browser, so a fixed number
//   of random boards is dealt instead (Monte Carlo: estimating by random sampling). The random
//   numbers come from a seed, so the same hand always gives the same answer.

import { parseCard } from './cards.js';

const DECK = [];
for (const r of '23456789TJQKA') for (const s of 'shdc') DECK.push(r + s);

// Seeded random numbers (the "mulberry32" generator): small, fast and repeatable.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Fast 7-card evaluator ----------
// Gives one number per hand: higher beats lower, equal is a tie. It ranks hands the same way as
// bestHand in cards.js (tested against it), but reads all 7 cards at once instead of trying all
// 21 five-card combinations, which makes the preflop sampling fast enough.
// Encoding: category × 16^5 + up to five tiebreak ranks in base 16 (ranks run 2 to 14).
function encode(category, tiebreak) {
  let v = category;
  for (let i = 0; i < 5; i++) v = v * 16 + (tiebreak[i] || 0);
  return v;
}

function straightHigh(rankMask) {
  // rankMask has bit r set for each rank r present (2..14); an ace also counts as 1 for the wheel.
  const m = rankMask | (rankMask & (1 << 14) ? 2 : 0);
  for (let hi = 14; hi >= 5; hi--) {
    const need = 0b11111 << (hi - 4);
    if ((m & need) === need) return hi;
  }
  return 0;
}

export function eval7(cards) {
  // cards: array of {rank, suit}, normally 7 (works for 5 or 6 as well)
  const counts = new Array(15).fill(0);
  const suitCards = { s: [], h: [], d: [], c: [] };
  let mask = 0;
  for (const c of cards) {
    counts[c.rank]++;
    suitCards[c.suit].push(c.rank);
    mask |= 1 << c.rank;
  }

  for (const s of 'shdc') {
    if (suitCards[s].length >= 5) {
      let fmask = 0;
      suitCards[s].forEach(r => (fmask |= 1 << r));
      const sf = straightHigh(fmask);
      if (sf) return encode(8, [sf]);
      const flushRanks = suitCards[s].sort((a, b) => b - a).slice(0, 5);
      // A flush can still lose to quads or a full house, checked first below.
      const quadsOrBoat =
        counts.some(n => n === 4) || (counts.some(n => n === 3) && counts.filter(n => n >= 2).length >= 2);
      if (!quadsOrBoat) return encode(5, flushRanks);
    }
  }

  const quads = [];
  const trips = [];
  const pairs = [];
  const singles = [];
  for (let r = 14; r >= 2; r--) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
    else if (counts[r] === 1) singles.push(r);
  }

  if (quads.length) {
    const kicker = Math.max(...[...trips, ...pairs, ...singles], 0);
    return encode(7, [quads[0], kicker]);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const pairPart = Math.max(trips[1] || 0, pairs[0] || 0);
    return encode(6, [trips[0], pairPart]);
  }
  for (const s of 'shdc') {
    if (suitCards[s].length >= 5) return encode(5, suitCards[s].sort((a, b) => b - a).slice(0, 5));
  }
  const st = straightHigh(mask);
  if (st) return encode(4, [st]);
  if (trips.length) return encode(3, [trips[0], ...singles.slice(0, 2)]);
  if (pairs.length >= 2) {
    const kicker = Math.max(pairs[2] || 0, singles[0] || 0);
    return encode(2, [pairs[0], pairs[1], kicker]);
  }
  if (pairs.length === 1) return encode(1, [pairs[0], ...singles.slice(0, 3)]);
  return encode(0, singles.slice(0, 5));
}

// ---------- Runouts ----------
function forEachCombination(cards, k, fn) {
  const combo = [];
  function helper(start) {
    if (combo.length === k) {
      fn(combo);
      return;
    }
    for (let i = start; i < cards.length; i++) {
      combo.push(cards[i]);
      helper(i + 1);
      combo.pop();
    }
  }
  helper(0);
}

export const DEFAULT_SAMPLES = 20000;

// Expected chips for each player from a set of pots.
//   hands: { player: ['Ah', 'Kd'], ... } for every player still in the hand
//   board: cards already dealt (0, 3 or 4 of them)
//   pots:  [{ amount, eligible: [player, ...] }, ...] (main pot first, then side pots)
// Returns { expected: { player: chips }, potEquity: [{ player: share 0..1 }, ...], exact, runouts }.
// A tie splits that pot evenly between the tied players.
export function potEquities(hands, board, pots, { samples = DEFAULT_SAMPLES, seed = 1 } = {}) {
  const players = Object.keys(hands);
  const known = new Set([...board, ...players.flatMap(p => hands[p])]);
  const rest = DECK.filter(c => !known.has(c));
  const toCome = 5 - board.length;
  const holeParsed = Object.fromEntries(players.map(p => [p, hands[p].map(parseCard)]));
  const boardParsed = board.map(parseCard);
  const wins = pots.map(() => Object.fromEntries(players.map(p => [p, 0])));
  let runouts = 0;

  const score = extra => {
    runouts++;
    const full = [...boardParsed, ...extra.map(parseCard)];
    const values = Object.fromEntries(players.map(p => [p, eval7([...holeParsed[p], ...full])]));
    pots.forEach((pot, i) => {
      if (pot.eligible.length === 1) {
        wins[i][pot.eligible[0]] += 1;
        return;
      }
      const best = Math.max(...pot.eligible.map(p => values[p]));
      const winners = pot.eligible.filter(p => values[p] === best);
      winners.forEach(p => (wins[i][p] += 1 / winners.length));
    });
  };

  const exact = toCome <= 2;
  if (toCome === 0) score([]);
  else if (exact) forEachCombination(rest, toCome, score);
  else {
    const rand = seededRandom(seed);
    const deck = rest.slice();
    for (let n = 0; n < samples; n++) {
      // Partial Fisher-Yates shuffle: draw `toCome` distinct cards.
      for (let i = 0; i < toCome; i++) {
        const j = i + Math.floor(rand() * (deck.length - i));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      score(deck.slice(0, toCome));
    }
  }

  const potEquity = wins.map(w => Object.fromEntries(players.map(p => [p, w[p] / runouts])));
  const expected = Object.fromEntries(players.map(p => [p, 0]));
  pots.forEach((pot, i) => players.forEach(p => (expected[p] += pot.amount * potEquity[i][p])));
  return { expected, potEquity, exact, runouts };
}
