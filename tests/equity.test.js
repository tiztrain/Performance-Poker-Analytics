import { describe, it, expect } from 'vitest';
import { bestHand, compareEval } from '../src/engine/cards.js';
import { eval7, potEquities, seededRandom } from '../src/engine/equity.js';
import { parseCard } from '../src/engine/cards.js';
import { allInEv, buildPots, contributions, findAllIn, summarizeAllIns } from '../src/engine/allInEv.js';
import { parseHand } from '../src/engine/parser.js';

const DECK = [];
for (const r of '23456789TJQKA') for (const s of 'shdc') DECK.push(r + s);

function randomSeven(rand) {
  const deck = DECK.slice();
  for (let i = 0; i < 7; i++) {
    const j = i + Math.floor(rand() * (deck.length - i));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, 7);
}

describe('eval7 (fast 7-card evaluator)', () => {
  it('ranks hands exactly like the existing bestHand, on 3,000 random pairs', () => {
    const rand = seededRandom(42);
    for (let n = 0; n < 3000; n++) {
      const a = randomSeven(rand);
      const b = randomSeven(rand);
      const fast = Math.sign(eval7(a.map(parseCard)) - eval7(b.map(parseCard)));
      const slow = Math.sign(compareEval(bestHand(a.slice(0, 2), a.slice(2)), bestHand(b.slice(0, 2), b.slice(2))));
      expect(fast).toBe(slow);
    }
  });

  it.each([
    ['As Ks Qs Js Ts 2d 3c', 'Ah Ad Ac As Kd 2c 3h'], // royal flush beats quads
    ['5h 5d 5c 9s 9d 2c 3h', 'Ah Kh 9h 4h 2h 2d 3c'], // full house beats flush
    ['Ah 2d 3c 4s 5h Kd Kc', 'Kh Kd Ks 7c 8d 2s 3s'], // wheel straight beats trips
    ['Ah Ad Kc Kd Qs Qh 2c', 'Ah Ad Kc Kd Js Jh 9c'], // two pair AAKK with Q kicker beats J kicker
  ])('%s beats %s', (better, worse) => {
    expect(eval7(better.split(' ').map(parseCard))).toBeGreaterThan(eval7(worse.split(' ').map(parseCard)));
  });
});

describe('potEquities', () => {
  it('is exact on the turn: A♥4♥ vs K♠K♦ on K♥9♥2♣5♦ wins 10 of 44 rivers', () => {
    // 7 safe hearts (2♥ and 5♥ pair the board for villain's full house) + three non-heart 3s.
    const r = potEquities(
      { Hero: ['Ah', '4h'], V: ['Ks', 'Kd'] },
      ['Kh', '9h', '2c', '5d'],
      [{ amount: 1000, eligible: ['Hero', 'V'] }],
    );
    expect(r.exact).toBe(true);
    expect(r.runouts).toBe(44);
    expect(r.potEquity[0].Hero).toBeCloseTo(10 / 44, 10);
    expect(r.expected.Hero).toBeCloseTo((1000 * 10) / 44, 6);
  });

  it('splits main and side pots by who can win each', () => {
    // S holds a made royal flush and wins the main pot every time. Hero's nines beat V's eights
    // for the side pot unless an 8 comes (8♦ or 8♠): 40 of 42 rivers.
    const r = potEquities(
      { S: ['Js', 'Ts'], Hero: ['9h', '9c'], V: ['8h', '8c'] },
      ['As', 'Ks', 'Qs', '2d'],
      [
        { amount: 3000, eligible: ['S', 'Hero', 'V'] },
        { amount: 4000, eligible: ['Hero', 'V'] },
      ],
    );
    expect(r.potEquity[0].S).toBe(1);
    expect(r.potEquity[1].Hero).toBeCloseTo(40 / 42, 10);
    expect(r.expected.Hero).toBeCloseTo((4000 * 40) / 42, 6);
  });

  it('samples preflop: AA vs KK is about 82%, and the same seed gives the same answer', () => {
    const args = [{ Hero: ['Ah', 'As'], V: ['Kd', 'Kc'] }, [], [{ amount: 100, eligible: ['Hero', 'V'] }]];
    const a = potEquities(...args, { seed: 7 });
    expect(a.exact).toBe(false);
    expect(a.runouts).toBe(20000);
    expect(a.potEquity[0].Hero).toBeGreaterThan(0.8);
    expect(a.potEquity[0].Hero).toBeLessThan(0.84);
    expect(potEquities(...args, { seed: 7 }).potEquity[0].Hero).toBe(a.potEquity[0].Hero);
  });

  it('splits a tie', () => {
    const r = potEquities(
      { Hero: ['2c', '3d'], V: ['2h', '3s'] },
      ['Ah', 'Ks', 'Qd', 'Jc'],
      [{ amount: 100, eligible: ['Hero', 'V'] }],
    );
    // Any river gives both players the same best five cards from the board (a T makes a broadway).
    expect(r.potEquity[0].Hero).toBeCloseTo(0.5, 10);
  });
});

describe('buildPots', () => {
  it('puts folded players’ chips in the main pot', () => {
    const pots = buildPots({ S: 1000, Hero: 3000, V: 3000, F: 500 }, ['S', 'Hero', 'V']);
    expect(pots).toEqual([
      { amount: 3500, eligible: ['S', 'Hero', 'V'] },
      { amount: 4000, eligible: ['Hero', 'V'] },
    ]);
  });

  it('gives an uncalled excess its own pot that only its owner can win', () => {
    expect(buildPots({ Hero: 5000, V: 2000 }, ['Hero', 'V'])).toEqual([
      { amount: 4000, eligible: ['Hero', 'V'] },
      { amount: 3000, eligible: ['Hero'] },
    ]);
  });
});

// Made-up player IDs, like src/sample-hand.js.
const TURN_ALLIN = `CoinPoker Hand #900000000020: NLH (100/200/25) 2026/09/09 21:00:00 AEST
Tournament 'Test Regular' '50004' 6-max Seat #1 is the button
Seat 1: d00d0001 (5,000 in chips)
Seat 2: Hero (6,000 in chips)
Seat 3: d00d0002 (8,000 in chips)
d00d0001: posts ante 25
Hero: posts ante 25
d00d0002: posts ante 25
Hero: posts small blind 100
d00d0002: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [Ah 4h]
d00d0001: raises 300 to 500
Hero: calls 400
d00d0002: folds
*** FLOP *** [Kh 9h 2c]
Hero: checks
d00d0001: bets 600
Hero: calls 600
*** TURN *** [Kh 9h 2c] [5d]
Hero: ALLIN 4,875
d00d0001: ALLIN 3,875
Hero: RETURN 1,000
*** RIVER *** [Kh 9h 2c 5d] [Jc]
*** SHOWDOWN ***
d00d0001: shows [Ks Kd] (Three of Kings)
Hero: shows [Ah 4h] (High Card)
d00d0001 collected 10,225 from pot
*** SUMMARY ***
Total pot 10,225
Board [ Kh 9h 2c 5d Jc ]`;

describe('allInEv', () => {
  const hand = parseHand(TURN_ALLIN);

  it('counts each player’s chips, antes included', () => {
    expect(contributions(hand)).toEqual({ d00d0001: 5000, Hero: 6000, d00d0002: 225 });
  });

  it('measures a turn all-in: expected −13.4bb, actual −25bb, luck −11.6bb', () => {
    const r = allInEv(hand);
    expect(r.street).toBe('turn');
    expect(r.pots).toEqual([
      { amount: 10225, eligible: ['d00d0001', 'Hero'], heroEquity: 10 / 44 },
      { amount: 1000, eligible: ['Hero'], heroEquity: 1 },
    ]);
    // Expected: 10,225 × 10/44 + the 1,000 returned − 6,000 put in = −2,676.14 chips.
    expect(r.expectedNet).toBeCloseTo((10225 * 10) / 44 + 1000 - 6000, 6);
    expect(r.actualNet).toBe(-5000);
    expect(r.luck / 200).toBeCloseTo(-11.62, 2);
    expect(r.expectedNet / 200).toBeCloseTo(-13.38, 2);
  });

  it('skips an all-in where the opponent didn’t show', () => {
    const mucked = TURN_ALLIN.replace('d00d0001: shows [Ks Kd] (Three of Kings)\n', '');
    expect(findAllIn(parseHand(mucked))).toEqual({ skipped: 'an opponent’s cards were not shown', street: 'turn' });
  });

  it('ignores river all-ins and hands without one', () => {
    const river = TURN_ALLIN.replace(
      '*** TURN *** [Kh 9h 2c] [5d]\n',
      '*** TURN *** [Kh 9h 2c] [5d]\nHero: checks\nd00d0001: checks\n',
    )
      .replace('*** RIVER *** [Kh 9h 2c 5d] [Jc]\n', '')
      .replace('Hero: ALLIN 4,875\nd00d0001: ALLIN 3,875\nHero: RETURN 1,000\n', '')
      .replace(
        '*** SHOWDOWN ***',
        '*** RIVER *** [Kh 9h 2c 5d] [Jc]\nHero: ALLIN 4,875\nd00d0001: ALLIN 3,875\nHero: RETURN 1,000\n*** SHOWDOWN ***',
      );
    expect(findAllIn(parseHand(river))).toBeNull();
  });

  it('adds up luck across all-ins in big blinds', () => {
    const r = allInEv(hand);
    const s = summarizeAllIns([r, r]);
    expect(s.count).toBe(2);
    expect(s.actualBB).toBe(-50);
    expect(s.luckBB).toBeCloseTo(-23.24, 2);
  });
});
