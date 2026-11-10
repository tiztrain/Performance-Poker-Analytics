// ---------- Play-quality score ----------
// Estimated cost of Hero's mistakes, in big blinds, from four sources agreed with the owner:
// 1. Push/fold deviations: the exact EV cost against the Nash chart (engine/pushFoldSpots.js).
// 2. Calls below their equity: Hero called needing more equity than they had against the
//    estimated range. Cost = (needed − had) × the pot after calling.
// 3. Folds that were profitable calls: Hero folded with more estimated equity than calling
//    needed. Cost = (had − needed) × the pot after calling.
// 4. Bluffs in bad spots: bluffs and semi-bluffs that lost the hand, costing the bet × the share
//    of poor spot conditions (a bluff with every condition good costs nothing here).
// Calls and folds count after the flop, and preflop only when facing an all-in (where no betting
// is left). Before the flop with betting still to come, raw equity overstates what a hand can win,
// so nearly every big-blind fold would look like a missed call. Push/fold spots are left to (1).
// The result is a score per tournament: mistake cost in big blinds per 100 hands, and as % of the
// stack per 100 hands, split by stage. Lower is better. All estimates: see docs/ROADMAP.md
// section 9.

import { equityVsCombos, villainCombos } from './rangeModel.js';
import { effectiveStackBB } from './breakdowns.js';
import { spotQuality } from './bluffs.js';

const STREETS = ['preflop', 'flop', 'turn', 'river'];

export const STAGES = [
  { id: 'deep', label: 'Deep (40bb+)', min: 40 },
  { id: 'middle', label: 'Middle (15–40bb)', min: 15 },
  { id: 'short', label: 'Short (under 15bb)', min: 0 },
];

export function stageFor(hand) {
  const eff = effectiveStackBB(hand);
  if (eff === null) return null;
  return STAGES.find(s => eff >= s.min).id;
}

function boardThrough(hand, street) {
  if (street === 'preflop') return [];
  if (street === 'flop') return hand.board.flop;
  if (street === 'turn') return [...hand.board.flop, hand.board.turn];
  return [...hand.board.flop, hand.board.turn, hand.board.river];
}

// Mistakes in one hand. `pushFold` is that hand's push/fold check result (or null); `bets` its
// analysed bets from engine/bluffs.js.
export function mistakesForHand(hand, ranges, { pushFold = null, bets = [], samples = 1500 } = {}) {
  const out = [];
  if (!hand.heroCards || !hand.bb) return out;
  const bb = hand.bb;

  if (pushFold && pushFold.cost > 0) {
    out.push({
      type: 'pushFold',
      street: 'preflop',
      cost: pushFold.cost,
      label: `${pushFold.did === 'fold' ? 'Folded' : pushFold.did === 'shove' ? 'Shoved' : 'Called'} ${pushFold.cell} at ${pushFold.stack.toFixed(1)}bb against the push/fold chart`,
    });
  }

  STREETS.forEach(street => {
    const acts = hand.streets[street];
    acts.forEach((a, index) => {
      if (a.player !== 'Hero') return;
      const isCall = a.action === 'call';
      const isFold = a.action === 'fold' && a.toCall > 0;
      if (!isCall && !isFold) return;
      const aggressor = [...acts.slice(0, index)]
        .reverse()
        .find(x => x.player !== 'Hero' && (x.action === 'raise' || x.action === 'bet'));
      if (!aggressor) return;
      if (street === 'preflop' && (!aggressor.allin || pushFold)) return; // see note at the top
      const toCall = isCall ? a.amount : a.toCall;
      const potAfter = a.potBefore + toCall;
      const need = toCall / potAfter;
      const board = boardThrough(hand, street);
      const { combos } = villainCombos(hand, aggressor.player, ranges, street, index, [...board, ...hand.heroCards]);
      const had = equityVsCombos(hand.heroCards, board, combos, { samples, seed: 31 + index });
      if (had === null) return;
      if (isCall && had < need) {
        out.push({
          type: 'badCall',
          street,
          cost: ((need - had) * potAfter) / bb,
          label: `Called on the ${street} needing ${Math.round(need * 100)}% with ~${Math.round(had * 100)}%`,
        });
      }
      if (isFold && had > need) {
        out.push({
          type: 'badFold',
          street,
          cost: ((had - need) * potAfter) / bb,
          label: `Folded on the ${street} with ~${Math.round(had * 100)}% when calling needed ${Math.round(need * 100)}%`,
        });
      }
    });
  });

  bets
    .filter(b => (b.kind === 'bluff' || b.kind === 'semiBluff') && !b.won && (hand.heroNetChips || 0) < 0)
    .forEach(b => {
      const q = spotQuality(b.conditions);
      if (q === null || q >= 1) return;
      out.push({
        type: 'badBluff',
        street: b.street,
        cost: (b.size / bb) * (1 - q),
        label: `${b.kind === 'bluff' ? 'Bluff' : 'Semi-bluff'} on the ${b.street} in a weak spot (${Math.round(q * 100)}% of conditions good) that lost`,
      });
    });

  return out;
}

// Score for a set of hands (one tournament, or a whole history). `mistakesById` maps hand ID to
// that hand's mistakes.
export function scoreHands(hands, mistakesById) {
  let costBB = 0;
  let stackPct = 0;
  const byStage = Object.fromEntries(STAGES.map(s => [s.id, { hands: 0, costBB: 0 }]));
  const decisions = [];
  hands.forEach(h => {
    const ms = mistakesById.get(h.id) || [];
    const handCost = ms.reduce((t, m) => t + m.cost, 0);
    costBB += handCost;
    const stackBB = h.heroStartStack && h.bb ? h.heroStartStack / h.bb : null;
    if (stackBB) stackPct += (100 * handCost) / stackBB;
    const stage = stageFor(h);
    if (stage) {
      byStage[stage].hands++;
      byStage[stage].costBB += handCost;
    }
    ms.forEach(m => decisions.push({ ...m, hand: h }));
  });
  const per100 = (x, n) => (n ? (100 * x) / n : null);
  return {
    hands: hands.length,
    costBB,
    bbPer100: per100(costBB, hands.length),
    stackPctPer100: per100(stackPct, hands.length),
    stages: STAGES.map(s => ({
      ...s,
      hands: byStage[s.id].hands,
      bbPer100: per100(byStage[s.id].costBB, byStage[s.id].hands),
    })),
    costliest: decisions.sort((a, b) => b.cost - a.cost).slice(0, 3),
    mistakes: decisions.length,
  };
}
