// ---------- Stat breakdowns by stack depth and by position ----------
// Tournament play changes a lot with stack depth (at 12 big blinds you're mostly pushing or
// folding; at 60 you're playing deep), so stats are also split into effective-stack buckets.
// Effective stack: the smaller of Hero's stack and the biggest other stack at the table, in big
// blinds; it's the most Hero can win or lose in the hand.

import { computeHandPositions } from './positions.js';
import { computeStats } from './stats.js';

export const STACK_BUCKETS = [
  { id: 'under10', label: 'Under 10bb', max: 10 },
  { id: '10to20', label: '10–20bb', max: 20 },
  { id: '20to40', label: '20–40bb', max: 40 },
  { id: '40plus', label: '40bb+', max: Infinity },
];

export const POSITION_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'MP', 'MP+1', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export function effectiveStackBB(hand) {
  const hero = hand.seats.find(s => s.name === 'Hero');
  const others = hand.seats.filter(s => s.name !== 'Hero').map(s => s.stack);
  if (!hero || !others.length || !hand.bb) return null;
  return Math.min(hero.stack, Math.max(...others)) / hand.bb;
}

export function stackBucket(hand) {
  const eff = effectiveStackBB(hand);
  if (eff === null) return null;
  return STACK_BUCKETS.find(b => eff < b.max).id;
}

export function heroPosition(hand) {
  return computeHandPositions(hand).get('Hero') || null;
}

// Rows of { id, label, hands, stats, bbWon } in a fixed order, skipping empty groups.
function breakdown(hands, keyFn, order) {
  const groups = new Map(order.map(o => [o.id, []]));
  hands.forEach(h => {
    const key = keyFn(h);
    if (groups.has(key)) groups.get(key).push(h);
  });
  return order
    .filter(o => groups.get(o.id).length)
    .map(o => {
      const hs = groups.get(o.id);
      return {
        id: o.id,
        label: o.label,
        hands: hs.length,
        stats: computeStats(hs),
        bbWon: hs.reduce((t, h) => t + (h.heroNetBB || 0), 0), // each hand in its own big blind
      };
    });
}

export function byStackDepth(hands) {
  return breakdown(hands, stackBucket, STACK_BUCKETS);
}

export function byPosition(hands) {
  return breakdown(
    hands,
    heroPosition,
    POSITION_ORDER.map(p => ({ id: p, label: p })),
  );
}

// The last `n` hands by time (all of them when n is falsy). Hands must already be in time order.
export function lastHands(sortedHands, n) {
  return n ? sortedHands.slice(-n) : sortedHands;
}
