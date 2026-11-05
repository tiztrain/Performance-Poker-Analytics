// ---------- Card / 5-card hand evaluation ----------
export const RANK_ORDER = '23456789TJQKA';

export function parseCard(c) {
  // e.g. "Ah" -> {rank: 14, suit: 'h'}
  const r = c[0].toUpperCase();
  const s = c[1].toLowerCase();
  return { rank: RANK_ORDER.indexOf(r) + 2, suit: s, raw: r + s };
}

export function combinations(arr, k) {
  const results = [];
  function helper(start, combo) {
    if (combo.length === k) {
      results.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return results;
}

export const HAND_NAMES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Trips',
  'Straight',
  'Flush',
  'Full House',
  'Quads',
  'Straight Flush',
];

export function evaluate5(cards) {
  // cards: array of 5 {rank,suit}
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  const counts = {};
  ranks.forEach(r => (counts[r] = (counts[r] || 0) + 1));
  const groups = Object.entries(counts)
    .map(([r, c]) => ({ rank: parseInt(r), count: c }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  // straight check (including wheel A-2-3-4-5)
  const uniqRanks = [...new Set(ranks)];
  let straightHigh = null;
  if (uniqRanks.length === 5) {
    if (uniqRanks[0] - uniqRanks[4] === 4) straightHigh = uniqRanks[0];
    else if (JSON.stringify(uniqRanks) === JSON.stringify([14, 5, 4, 3, 2])) straightHigh = 5; // wheel
  }

  let category, tiebreak;
  if (straightHigh && isFlush) {
    category = 8;
    tiebreak = [straightHigh];
  } else if (groups[0].count === 4) {
    category = 7;
    tiebreak = [groups[0].rank, groups[1].rank];
  } else if (groups[0].count === 3 && groups[1].count === 2) {
    category = 6;
    tiebreak = [groups[0].rank, groups[1].rank];
  } else if (isFlush) {
    category = 5;
    tiebreak = ranks;
  } else if (straightHigh) {
    category = 4;
    tiebreak = [straightHigh];
  } else if (groups[0].count === 3) {
    category = 3;
    tiebreak = [groups[0].rank, ...groups.slice(1).map(g => g.rank)];
  } else if (groups[0].count === 2 && groups[1].count === 2) {
    const pairRanks = groups
      .filter(g => g.count === 2)
      .map(g => g.rank)
      .sort((a, b) => b - a);
    category = 2;
    tiebreak = [...pairRanks, groups[2].rank];
  } else if (groups[0].count === 2) {
    category = 1;
    tiebreak = [groups[0].rank, ...groups.slice(1).map(g => g.rank)];
  } else {
    category = 0;
    tiebreak = ranks;
  }

  return { category, tiebreak, name: HAND_NAMES[category] };
}

export function compareEval(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < a.tiebreak.length; i++) {
    if (a.tiebreak[i] !== b.tiebreak[i]) return a.tiebreak[i] - b.tiebreak[i];
  }
  return 0;
}

export function bestHand(holeCards, boardCards) {
  const all = [...holeCards, ...boardCards].map(parseCard);
  if (all.length < 5) return null;
  const combos = combinations(all, 5);
  let best = null;
  for (const combo of combos) {
    const ev = evaluate5(combo);
    if (!best || compareEval(ev, best) > 0) best = ev;
  }
  return best;
}
