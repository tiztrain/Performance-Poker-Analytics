import { describe, it, expect } from 'vitest';
import { parseAll } from '../src/engine/parser.js';
import { computeStats } from '../src/engine/stats.js';
import { SAMPLE } from '../src/sample-hand.js';

describe('computeStats (SAMPLE fixture)', () => {
  const hands = parseAll(SAMPLE);
  const stats = computeStats(hands);

  it('computes VPIP/PFR over the full sample', () => {
    // Hero voluntarily puts money in on hands 2 (calls a raise) - hand 1/3/4 are all
    // blind/ante-only folds, not voluntary. VPIP should be 1 of 4 hands = 25.0%.
    expect(stats.vpip).toBe('25.0');
    // Hero never raises preflop in any of the 4 sample hands.
    expect(stats.pfr).toBe('0.0');
  });

  it('returns null (not 0%) for a rate with zero qualifying opportunities', () => {
    // No hand in the sample has hero facing a 3-bet.
    expect(stats.foldToThreeBet).toBe(null);
  });

  it('only counts a real showdown - not every "*** SHOWDOWN ***" marker - toward WTSD', () => {
    // Hero saw a flop only in hand 2 (the only hand hero didn't fold preflop), and that
    // hand did reach a genuine showdown.
    expect(stats.raw.sawFlop).toBe(1);
    expect(stats.raw.reachedShowdownOfFlopsSeen).toBe(1);
    expect(stats.wtsd).toBe('100.0');
  });
});

describe('computeStats weak-continuation heuristic', () => {
  it("does not flag a pair that beats the board's second-highest card as weak", () => {
    // Regression guard: the heuristic compares a pair against the board's SECOND-highest
    // distinct rank, not just the top card, so pairing the second-best board card (e.g.
    // Kings on a K-high-second board under an Ace) should not be flagged as "weak".
    const hand = {
      id: 'h1',
      heroCards: ['Ks', 'Qh'], // pairs the King on board - not the top card (Ace), but the second-highest
      streets: {
        preflop: [],
        flop: [{ player: 'Hero', action: 'call', amount: 100, potBefore: 100 }],
        turn: [],
        river: [],
      },
      board: { flop: ['Ac', 'Kc', '2d'], turn: null, river: null },
    };
    const stats = computeStats([hand]);
    expect(stats.raw.weakContinues).toHaveLength(0);
  });

  it("does flag a pair below the board's second-highest rank as weak", () => {
    const hand = {
      id: 'h2',
      heroCards: ['2s', '2h'], // bottom pair, well below the board's top two ranks
      streets: {
        preflop: [],
        flop: [{ player: 'Hero', action: 'call', amount: 100, potBefore: 100 }],
        turn: [],
        river: [],
      },
      board: { flop: ['Ac', 'Kc', '9d'], turn: null, river: null },
    };
    const stats = computeStats([hand]);
    expect(stats.raw.weakContinues).toHaveLength(1);
    expect(stats.raw.weakContinues[0].handClass).toBe('Pair');
  });
});
