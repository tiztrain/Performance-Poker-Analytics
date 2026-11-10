// ---------- More review flags ----------
// Heuristic prompts for review, like the other flags: they point at hands worth a second look,
// not verdicts. Thresholds agreed with the owner, or recorded in docs/ROADMAP.md section 9.
// - Missed value: on the river, Hero held two pair or better using their own cards, and either
//   nobody bet (Hero checked it down) or Hero bet under 33% of the pot.
// - Raise-fold: Hero raised on a street, then folded to a re-raise on the same street, after
//   putting in 20% or more of their starting stack.
// - Committed fold: Hero folded after already putting in a third or more of their starting stack.
// - Sizing: a postflop bet or raise (not all-in) under 25% or over 150% of the pot.

import { postflopCategory } from './handCategories.js';

const STREETS = ['preflop', 'flop', 'turn', 'river'];

function streetInvestment(hand, street, uptoIndex) {
  let put = 0;
  hand.streets[street].slice(0, uptoIndex).forEach(a => {
    if (a.player !== 'Hero') return;
    if (a.action === 'raise') put = a.to;
    else if (a.amount) put += a.amount;
  });
  return put;
}

function investedBefore(hand, street, index) {
  let total = (hand.antes && hand.antes.Hero) || 0;
  for (const st of STREETS) {
    if (st === street) return total + streetInvestment(hand, st, index);
    total += streetInvestment(hand, st, hand.streets[st].length);
  }
  return total;
}

export function moreFlagsForHand(hand) {
  const flags = { missedValue: [], raiseFolds: [], committedFolds: [], sizing: [] };
  if (!hand.heroCards || !hand.heroStartStack) return flags;
  const stack = hand.heroStartStack;

  // Missed value on the river.
  if (hand.board.river && hand.heroFoldedOnStreet === null) {
    const board = [...hand.board.flop, hand.board.turn, hand.board.river];
    if (postflopCategory(hand.heroCards, board) === 'strong') {
      const river = hand.streets.river;
      const anyBet = river.some(a => a.action === 'bet' || a.action === 'raise');
      const heroBet = river.find(a => a.player === 'Hero' && a.action === 'bet');
      if (!anyBet && river.some(a => a.player === 'Hero')) {
        flags.missedValue.push({ handId: hand.id, street: 'river', kind: 'checked', pot: river[0].potBefore });
      } else if (heroBet && heroBet.amount < 0.33 * heroBet.potBefore) {
        flags.missedValue.push({
          handId: hand.id,
          street: 'river',
          kind: 'small',
          pot: heroBet.potBefore,
          pct: Math.round((100 * heroBet.amount) / heroBet.potBefore),
        });
      }
    }
  }

  STREETS.forEach(street => {
    const acts = hand.streets[street];
    acts.forEach((a, i) => {
      if (a.player !== 'Hero') return;

      // Raise, then fold to a re-raise on the same street.
      if (a.action === 'fold') {
        const firstRaise = acts.findIndex(x => x.player === 'Hero' && x.action === 'raise');
        const reRaised =
          firstRaise !== -1 &&
          firstRaise < i &&
          acts.slice(firstRaise + 1, i).some(x => x.player !== 'Hero' && x.action === 'raise');
        const onStreet = streetInvestment(hand, street, i);
        if (reRaised && onStreet >= 0.2 * stack) {
          flags.raiseFolds.push({
            handId: hand.id,
            street,
            invested: onStreet,
            pctStack: Math.round((100 * onStreet) / stack),
          });
        }
        const total = investedBefore(hand, street, i);
        if (total >= stack / 3) {
          flags.committedFolds.push({
            handId: hand.id,
            street,
            invested: total,
            pctStack: Math.round((100 * total) / stack),
          });
        }
      }

      // Unusual bet sizes after the flop.
      if (street !== 'preflop' && (a.action === 'bet' || a.action === 'raise') && !a.allin && a.potBefore > 0) {
        const size = a.action === 'bet' ? a.amount : a.raiseBy;
        const pct = (100 * size) / a.potBefore;
        if (pct < 25 || pct > 150) {
          flags.sizing.push({
            handId: hand.id,
            street,
            size,
            pct: Math.round(pct),
            kind: pct < 25 ? 'small' : 'large',
          });
        }
      }
    });
  });
  return flags;
}

export function moreFlags(hands) {
  const out = { missedValue: [], raiseFolds: [], committedFolds: [], sizing: [] };
  hands.forEach(h => {
    const f = moreFlagsForHand(h);
    Object.keys(out).forEach(k => out[k].push(...f[k]));
  });
  return out;
}

// What calling cost and the equity it needed, for a Hero call (or a fold facing a bet).
export function requiredEquity(action) {
  const toCall = action.action === 'call' ? action.amount : action.toCall;
  if (!toCall || typeof action.potBefore !== 'number') return null;
  return toCall / (action.potBefore + toCall);
}
