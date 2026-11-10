// ---------- Bluff analysis ----------
// Classifies every Hero bet or raise after the flop as value, thin value, semi-bluff or bluff,
// using Hero's equity against the estimated range that would call (the range model, narrowed as
// if the opponent calls). Then measures:
// - River bluff share against the balanced share for the bet size: with a bet of b into a pot of
//   p, a balanced river betting range is bluffs b / (p + 2b) of the time (25% at half pot, 33% at
//   pot). Much less is under-bluffing; much more is over-bluffing.
// - Bluff success: how often bluffs won the pot straight away, against the break-even fold rate
//   b / (p + b) (33% at half pot, 50% at pot).
// - Spot quality: conditions that make a bluff more likely to work.
// Thresholds are recorded in docs/ROADMAP.md section 9. All of it is an estimate: it rests on
// the range model, not a solver.

import { ACTION_WEIGHTS, equityVsCombos, villainCombos } from './rangeModel.js';
import { postflopCategory } from './handCategories.js';

const STREETS = ['flop', 'turn', 'river'];

function boardThrough(hand, street) {
  if (street === 'flop') return hand.board.flop;
  if (street === 'turn') return [...hand.board.flop, hand.board.turn];
  return [...hand.board.flop, hand.board.turn, hand.board.river];
}

// River: value above 50% equity against the calling range, bluff under 30%, thin value between.
// Flop and turn: value above 50%; a draw is a semi-bluff; a pair with 30%+ is thin value; 30%+ with
// no pair or draw (overcards) also counts as a semi-bluff; anything else is a bluff.
export function classifyBet(street, equity, heroCategory) {
  if (equity > 0.5) return 'value';
  if (street === 'river') return equity < 0.3 ? 'bluff' : 'thin';
  if (heroCategory === 'draw') return 'semiBluff';
  if (equity >= 0.3) return heroCategory === 'topPair' || heroCategory === 'weakPair' ? 'thin' : 'semiBluff';
  return 'bluff';
}

export const balancedBluffShare = (bet, pot) => bet / (pot + 2 * bet);
export const breakEvenFold = (bet, pot) => bet / (pot + bet);

function foldedBefore(hand, street, index) {
  const folded = new Set();
  for (const st of ['preflop', ...STREETS]) {
    const acts = hand.streets[st];
    const upto = st === street ? index : acts.length;
    for (let i = 0; i < upto; i++) if (acts[i].action === 'fold') folded.add(acts[i].player);
    if (st === street) break;
  }
  return folded;
}

// Every Hero bet or raise after the flop, analysed. `ranges` comes from buildRanges.
export function analyseBets(hand, ranges, { samples = 1500 } = {}) {
  if (!hand.heroCards || !hand.bb) return [];
  const out = [];
  STREETS.forEach((street, si) => {
    const acts = hand.streets[street];
    const board = boardThrough(hand, street);
    if (!board.length || !board.every(Boolean)) return;
    acts.forEach((a, index) => {
      if (a.player !== 'Hero' || (a.action !== 'bet' && a.action !== 'raise')) return;
      const folded = foldedBefore(hand, street, index);
      const opponents = hand.seats.map(s => s.name).filter(n => n !== 'Hero' && !folded.has(n));
      if (!opponents.length) return;
      // The opponent to read: the last one who acted on this street, else the first still in.
      const lastActor = [...acts.slice(0, index)]
        .reverse()
        .find(x => x.player !== 'Hero' && opponents.includes(x.player));
      const villain = lastActor ? lastActor.player : opponents[0];
      const dead = [...board, ...hand.heroCards];
      const { combos } = villainCombos(hand, villain, ranges, street, index, dead);
      const heroCategory = postflopCategory(hand.heroCards, board);
      // The range that calls: narrowed by the "call" weights for each holding's category.
      const calling = combos.map(c => ({ ...c, w: c.w * ACTION_WEIGHTS.call[postflopCategory(c.cards, board)] }));
      const equity = equityVsCombos(
        hand.heroCards,
        board,
        calling.filter(c => c.w > 0),
        { samples, seed: index + 11 * si },
      );
      if (equity === null) return;
      const size = a.action === 'bet' ? a.amount : a.raiseBy;
      const pot = a.potBefore;
      const after = acts.slice(index + 1);
      const won = after.length > 0 && after.every(x => x.player === 'Hero' || x.action === 'fold');
      // Spot quality: each condition true/false, null when it doesn't apply.
      const weakness =
        acts.slice(0, index).some(x => x.player === villain && x.action === 'check') ||
        (si > 0 &&
          hand.streets[STREETS[si - 1]].some(x => x.player === villain && x.action === 'check') &&
          !hand.streets[STREETS[si - 1]].some(
            x => x.player === villain && (x.action === 'bet' || x.action === 'raise'),
          ));
      const conditions = {
        headsUp: opponents.length === 1,
        villainShowedWeakness: weakness,
        drawBackup: street === 'river' ? null : heroCategory === 'draw',
        noShowdownValue: street === 'river' ? heroCategory === 'nothing' : null,
        // An all-in leaves nothing behind to win on later streets or to make the bet credible again.
        stackBehind: !a.allin,
      };
      out.push({
        handId: hand.id,
        hand,
        street,
        index,
        villain,
        opponents: opponents.length,
        equity,
        heroCategory,
        kind: classifyBet(street, equity, heroCategory),
        size,
        pot,
        pctPot: pot > 0 ? Math.round((100 * size) / pot) : null,
        won,
        conditions,
        bb: hand.bb,
      });
    });
  });
  return out;
}

function quality(c) {
  const vals = Object.values(c).filter(v => v !== null);
  return vals.length ? vals.filter(Boolean).length / vals.length : null;
}

// Totals across many analysed bets.
export function summarizeBluffs(bets) {
  const counts = { value: 0, thin: 0, semiBluff: 0, bluff: 0 };
  bets.forEach(b => counts[b.kind]++);
  const river = bets.filter(b => b.street === 'river' && b.pot > 0);
  const riverBluffs = river.filter(b => b.kind === 'bluff');
  const avg = xs => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
  const bluffs = bets.filter(b => b.kind === 'bluff' || b.kind === 'semiBluff');
  const sized = bluffs.filter(b => b.pot > 0);
  return {
    counts,
    river: {
      bets: river.length,
      bluffs: riverBluffs.length,
      share: river.length ? riverBluffs.length / river.length : null,
      balanced: avg(river.map(b => balancedBluffShare(b.size, b.pot))),
    },
    success: {
      bluffs: bluffs.length,
      won: bluffs.filter(b => b.won).length,
      rate: bluffs.length ? bluffs.filter(b => b.won).length / bluffs.length : null,
      breakEven: avg(sized.map(b => breakEvenFold(b.size, b.pot))),
      // Result of the hands bluffed in, each hand counted once (a hand can hold several bluffs):
      // in big blinds (each hand in its own) and in chips.
      ...(() => {
        const hands = [...new Map(bluffs.map(b => [b.handId, b.hand])).values()];
        return {
          hands: hands.length,
          bbResult: hands.reduce((t, h) => t + (h.heroNetBB || 0), 0),
          chipsResult: hands.reduce((t, h) => t + (h.heroNetChips || 0), 0),
        };
      })(),
    },
    quality: avg(bluffs.map(b => quality(b.conditions)).filter(q => q !== null)),
  };
}

export function verdict(share, balanced) {
  if (share === null || balanced === null) return null;
  if (share < balanced * 0.5) return 'under';
  if (share > balanced * 1.25) return 'over';
  return 'balanced';
}

export { quality as spotQuality };
