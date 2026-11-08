// ---------- "Copy for Claude": one hand as plain text for an AI (artificial intelligence) chat ----------
// Builds a self-contained description of a hand to paste into a chat for post-session review.
// Rules (see docs/ROADMAP.md 5.1):
// - Deterministic: the same hand always gives the same text, so it can be tested exactly.
// - Anonymised: opponents become "Villain 1..n" (numbered in preflop seat order). Real IDs never appear.
// - Amounts are in big blinds (bb), using this hand's own big blind.
// - The action comes before any shown cards, so the reader reasons about ranges before seeing the answer.
// - The app does the arithmetic (pot odds, bet sizes, SPR) so the chat doesn't have to guess it.

import { bestHand } from './cards.js';
import { classifyFormat } from './format.js';
import { computeHandPositions } from './positions.js';

const STREETS = ['preflop', 'flop', 'turn', 'river'];

export const REVIEW_INSTRUCTION =
  'This is a post-session review of a tournament hand I played. For each of my decisions, explain what ' +
  "my opponent's range likely was at that point, whether my action was a good one, and what I should " +
  'consider next time. Judge the decisions, not the result.';

// One decimal place, trailing ".0" dropped: 2.25 -> "2.3", 2 -> "2".
function round1(x) {
  return String(Math.round(x * 10) / 10);
}

function pct(x) {
  return Math.round(x * 100) + '%';
}

// Map<realName, displayName>. Hero keeps "Hero"; everyone else is numbered in preflop seat
// order (SB first, button last), which only depends on the table, not on who acted.
export function anonymizePlayers(hand) {
  const names = new Map();
  const positions = computeHandPositions(hand);
  const ordered = positions.size ? [...positions.keys()] : hand.seats.map(s => s.name);
  let n = 0;
  ordered.forEach(name => {
    names.set(name, name === 'Hero' ? 'Hero' : 'Villain ' + ++n);
  });
  return names;
}

function boardThrough(hand, street) {
  if (street === 'preflop') return [];
  if (street === 'flop') return hand.board.flop;
  if (street === 'turn') return [...hand.board.flop, hand.board.turn];
  return [...hand.board.flop, hand.board.turn, hand.board.river];
}

function streetHasBoard(hand, street) {
  if (street === 'flop') return hand.board.flop.length > 0;
  if (street === 'turn') return !!hand.board.turn;
  if (street === 'river') return !!hand.board.river;
  return false;
}

// Chips each player has put in after every action, walking the hand in order. Antes aren't
// recorded per player in the parsed hand, so every seated player is assumed to have posted one.
function investedBeforeFlop(hand) {
  const invested = new Map(hand.seats.map(s => [s.name, hand.ante || 0]));
  const streetContrib = new Map();
  hand.streets.preflop.forEach(a => {
    const prev = streetContrib.get(a.player) || 0;
    let add = 0;
    if (a.action === 'raise') add = a.to - prev;
    else if (a.amount) add = a.amount;
    streetContrib.set(a.player, prev + add);
    invested.set(a.player, (invested.get(a.player) || 0) + add);
  });
  return invested;
}

// Players who hadn't folded by the time the flop was dealt.
function playersSeeingFlop(hand) {
  const folded = new Set(hand.streets.preflop.filter(a => a.action === 'fold').map(a => a.player));
  return hand.seats.map(s => s.name).filter(n => !folded.has(n));
}

export function describeAction(a, hand, names, positions) {
  const bb = chips => round1(chips / hand.bb) + 'bb';
  const who = names.get(a.player) + (positions.has(a.player) ? ' (' + positions.get(a.player) + ')' : '');
  const allin = a.allin ? ' (all-in)' : '';
  if (a.action === 'post') return null; // blinds are already in the pot line
  if (a.action === 'fold') {
    if (a.player === 'Hero' && a.toCall > 0) {
      const need = a.toCall / (a.potBefore + a.toCall);
      return `${who} folds, facing ${bb(a.toCall)} to call (calling needed ${pct(need)} equity)`;
    }
    return `${who} folds`;
  }
  if (a.action === 'check') return `${who} checks`;
  if (a.action === 'bet') return `${who} bets ${bb(a.amount)} (${pct(a.amount / a.potBefore)} of pot)${allin}`;
  if (a.action === 'raise') return `${who} raises to ${bb(a.to)}${allin}`;
  if (a.action === 'call') {
    let line = `${who} calls ${bb(a.amount)}${allin}`;
    if (a.player === 'Hero') {
      const need = a.amount / (a.potBefore + a.amount);
      line += ` (needs ${pct(need)} equity: call / (pot + call))`;
    }
    return line;
  }
  return null;
}

// `flagReasons` is a list of plain-text reasons the app flagged this hand (see flagReasonsForHand).
// `options.context` adds lines just before the closing request, and `options.instruction`
// replaces that request (the quiz uses both to ask about a specific read).
export function handToClaudeText(hand, flagReasons = [], options = {}) {
  const { context = [], instruction = REVIEW_INSTRUCTION } = options;
  const names = anonymizePlayers(hand);
  const positions = computeHandPositions(hand);
  const bb = chips => round1(chips / hand.bb) + 'bb';
  const out = [];

  const format = classifyFormat(hand.tourney);
  out.push(`Poker hand for post-session review: No-Limit Hold'em tournament (format: ${format}), hand #${hand.id}.`);
  out.push(
    `Blinds ${hand.sb}/${hand.bb}` +
      (hand.ante ? `, ante ${hand.ante}` : '') +
      `. ${hand.seats.length} players dealt in` +
      (hand.maxSeats ? ` at a ${hand.maxSeats}-max table` : '') +
      '. All amounts are in big blinds (bb).',
  );
  out.push('');

  out.push('Players (preflop seat order), starting stacks:');
  const ordered = [...names.keys()];
  ordered.forEach(name => {
    const seat = hand.seats.find(s => s.name === name);
    const pos = positions.has(name) ? ` (${positions.get(name)})` : '';
    const cards = name === 'Hero' && hand.heroCards ? ` holding ${hand.heroCards.join(' ')}` : '';
    out.push(`- ${names.get(name)}${pos}: ${bb(seat.stack)}${cards}`);
  });
  const others = hand.seats.filter(s => s.name !== 'Hero').map(s => s.stack);
  if (hand.heroStartStack !== null && others.length) {
    out.push(
      `Effective stack (Hero vs the biggest other stack): ${bb(Math.min(hand.heroStartStack, Math.max(...others)))}`,
    );
  }

  const invested = investedBeforeFlop(hand);
  STREETS.forEach(street => {
    const acts = hand.streets[street];
    if (street !== 'preflop' && !streetHasBoard(hand, street)) return;
    const firstWithPot = acts.find(a => typeof a.potBefore === 'number');
    const pot = firstWithPot ? firstWithPot.potBefore : hand.summary.totalPot;
    out.push('');

    let header = street.charAt(0).toUpperCase() + street.slice(1);
    if (street !== 'preflop') header += ` [${boardThrough(hand, street).join(' ')}]`;
    header += `, pot ${bb(pot)}`;
    if (street === 'flop' && pot > 0) {
      // SPR (stack-to-pot ratio): the smallest stack still in the hand compared with the pot.
      const remaining = playersSeeingFlop(hand).map(n => {
        const seat = hand.seats.find(s => s.name === n);
        return seat.stack - (invested.get(n) || 0);
      });
      if (remaining.length >= 2) header += `, SPR ${round1(Math.min(...remaining) / pot)}`;
    }
    if (street !== 'preflop' && hand.heroCards && hand.heroFoldedOnStreet !== 'preflop') {
      const ev = bestHand(hand.heroCards, boardThrough(hand, street));
      if (ev) header += `. Hero has ${ev.name}`;
    }
    out.push(header + '.');

    acts.forEach(a => {
      const line = describeAction(a, hand, names, positions);
      if (line) out.push('- ' + line);
    });
  });

  const shows = [];
  const seen = new Set();
  hand.shows.forEach(s => {
    if (s.player !== 'Hero' && !seen.has(s.player)) {
      seen.add(s.player);
      shows.push(s);
    }
  });
  if (shows.length) {
    out.push('');
    out.push('Cards shown by opponents:');
    shows.forEach(s => {
      out.push(
        `- ${names.get(s.player) || 'Unknown player'}: ${s.cards.join(' ')}` + (s.handClass ? ` (${s.handClass})` : ''),
      );
    });
  }

  const won = new Map();
  hand.collections.forEach(c => won.set(c.player, (won.get(c.player) || 0) + c.amount));
  if (won.size) {
    out.push('');
    const parts = [...won.entries()].map(([p, amt]) => `${names.get(p) || 'Unknown player'} won ${bb(amt)}`);
    out.push(
      `Result (context only): ${parts.join(', ')}. Hero's net: ${hand.heroNetBB >= 0 ? '+' : ''}${bb(hand.heroNetChips)}.`,
    );
  }

  if (flagReasons.length) {
    out.push('');
    out.push('Why the app flagged this hand (heuristics, not verdicts):');
    flagReasons.forEach(r => out.push('- ' + r));
  }

  if (context.length) {
    out.push('');
    context.forEach(line => out.push(line));
  }
  out.push('');
  out.push(instruction);
  return out.join('\n');
}

// Plain-text reasons for one hand, from the flag lists computeStats returns in `raw`.
export function flagReasonsForHand(raw, handId) {
  const reasons = [];
  raw.bigCalls
    .filter(f => f.handId === handId)
    .forEach(f => reasons.push(`Expensive call on the ${f.street}: needed ${f.equityNeeded}% equity to break even.`));
  raw.weakContinues
    .filter(f => f.handId === handId)
    .forEach(f => reasons.push(`Called on the ${f.street} with a weak holding (${f.handClass}).`));
  raw.cheapFolds
    .filter(f => f.handId === handId)
    .forEach(f => reasons.push(`Folded on the ${f.street} when calling needed only ${f.equityNeeded}% equity.`));
  if (raw.threeBetOppsMissed.some(f => f.handId === handId)) {
    reasons.push('Called an opening raise instead of 3-betting (a 3-bet frequency prompt, not a verdict).');
  }
  raw.preflopRaces
    .filter(f => f.handId === handId)
    .forEach(f =>
      reasons.push(
        'Got most of the stack in preflop in a ' +
          f.matchups.map(m => (m.type === 'flip' ? 'coin flip' : 'dominated-pair spot')).join(' / ') +
          '.',
      ),
    );
  return reasons;
}
