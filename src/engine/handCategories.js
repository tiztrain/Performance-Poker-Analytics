// ---------- Hand categories for the hand-reading quiz ----------
// Sorts a known hand into the coarse buckets the quiz asks about, so a guess like "villain has
// a draw or a weak pair" can be checked against the cards villain actually showed.
// Rules agreed with the owner (docs/ROADMAP.md 5.4):
// - Preflop uses five starting-hand groups.
// - After the flop, a made hand beats a draw: top pair with a flush draw counts as top pair.
// - Only strong draws count as draws: a flush draw or an open-ended straight draw (8+ outs,
//   meaning 8 or more unseen cards complete the hand). A gutshot (4 outs) counts as nothing.
// - Pairs and better only count when villain's own cards make them; a pair that is only on the
//   board belongs to everyone.

import { bestHand, evaluate5, parseCard } from './cards.js';

export const PREFLOP_CATEGORIES = [
  { id: 'bigPair', label: 'Big pair', hint: 'TT and above' },
  { id: 'smallPair', label: 'Small or medium pair', hint: '22 to 99' },
  { id: 'broadway', label: 'Big aces and broadways', hint: 'Two cards T or higher: AK, AJ, KQ, QJ…' },
  { id: 'suitedConnector', label: 'Suited connectors and gappers', hint: 'Suited, ranks 1 to 3 apart: 87s, 96s…' },
  { id: 'other', label: 'Everything else', hint: 'Weak aces, offsuit junk…' },
];

export const POSTFLOP_CATEGORIES = [
  { id: 'strong', label: 'Strong', hint: 'Two pair or better, using villain’s own cards' },
  { id: 'topPair', label: 'Top pair or overpair', hint: 'Pairs the top board card, or a pocket pair above it' },
  { id: 'weakPair', label: 'Weaker pair', hint: 'Middle or bottom pair, or a pocket pair below the top card' },
  { id: 'draw', label: 'Draw', hint: 'Flush draw or open-ended straight draw (not on the river)' },
  { id: 'nothing', label: 'Nothing', hint: 'No pair and no strong draw; gutshots count here' },
];

// Categories offered on a street: the river has no draws left to complete.
export function categoriesForStreet(street) {
  if (street === 'preflop') return PREFLOP_CATEGORIES;
  if (street === 'river') return POSTFLOP_CATEGORIES.filter(c => c.id !== 'draw');
  return POSTFLOP_CATEGORIES;
}

export function preflopCategory(holeCards) {
  const [a, b] = holeCards.map(parseCard);
  if (a.rank === b.rank) return a.rank >= 10 ? 'bigPair' : 'smallPair';
  if (a.rank >= 10 && b.rank >= 10) return 'broadway';
  const gap = Math.abs(a.rank - b.rank);
  if (a.suit === b.suit && gap >= 1 && gap <= 3) return 'suitedConnector';
  return 'other';
}

// What the board makes by itself, as a hand category number (0 high card ... 8 straight flush).
// With 3 or 4 cards only pairs, trips and quads are possible.
function boardOnlyCategory(board) {
  if (board.length === 5) return evaluate5(board).category;
  const counts = Object.values(countRanks(board)).sort((x, y) => y - x);
  if (counts[0] === 4) return 7;
  if (counts[0] === 3) return 3;
  if (counts[0] === 2 && counts[1] === 2) return 2;
  if (counts[0] === 2) return 1;
  return 0;
}

function countRanks(cards) {
  const counts = {};
  cards.forEach(c => {
    counts[c.rank] = (counts[c.rank] || 0) + 1;
  });
  return counts;
}

// Four cards of one suit, at least one of them villain's.
export function hasFlushDraw(hole, board) {
  const all = [...hole, ...board];
  return ['h', 'd', 'c', 's'].some(
    suit => all.filter(c => c.suit === suit).length === 4 && hole.some(c => c.suit === suit),
  );
}

// Four consecutive ranks open at both ends, at least one rank from villain's cards.
// Runs go from 2-3-4-5 (an ace or a 6 completes it) up to T-J-Q-K (a 9 or an ace). The
// one-ended draws A-2-3-4 and J-Q-K-A never match: the ace is rank 14 here, so A-2-3-4 isn't a
// run, and a run starting at J would need rank 15.
export function hasOpenEndedStraightDraw(hole, board) {
  const ranks = new Set([...hole, ...board].map(c => c.rank));
  const holeRanks = new Set(hole.map(c => c.rank));
  for (let low = 2; low <= 10; low++) {
    const run = [low, low + 1, low + 2, low + 3];
    if (!run.every(r => ranks.has(r))) continue;
    if (!run.some(r => holeRanks.has(r))) continue;
    if (ranks.has(low - 1) || ranks.has(low + 4)) continue; // already a straight, not a draw
    return true;
  }
  return false;
}

// Category of a known hand on a given board (3, 4 or 5 cards).
export function postflopCategory(holeCards, boardCards) {
  const hole = holeCards.map(parseCard);
  const board = boardCards.map(parseCard);
  const topBoard = Math.max(...board.map(c => c.rank));

  // Strong: two pair or better that villain's cards actually improve on, compared with
  // what the board shows by itself (with 3 or 4 board cards, a 5-card hand needs both
  // hole cards, so any 2+ category beyond the board's own counts).
  const made = bestHand(holeCards, boardCards);
  if (made && made.category >= 2 && made.category > boardOnlyCategory(board)) return 'strong';

  const boardRanks = new Set(board.map(c => c.rank));
  const [a, b] = hole;
  if (a.rank === b.rank) {
    if (boardRanks.has(a.rank)) return 'strong'; // a set (caught above, kept for safety)
    return a.rank > topBoard ? 'topPair' : 'weakPair';
  }
  const paired = hole.filter(c => boardRanks.has(c.rank));
  if (paired.length) {
    return paired.some(c => c.rank === topBoard) ? 'topPair' : 'weakPair';
  }

  if (board.length < 5 && (hasFlushDraw(hole, board) || hasOpenEndedStraightDraw(hole, board))) return 'draw';
  return 'nothing';
}

export function categoryOnStreet(holeCards, boardCards, street) {
  return street === 'preflop' ? preflopCategory(holeCards) : postflopCategory(holeCards, boardCards);
}
