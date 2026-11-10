import { describe, it, expect } from 'vitest';
import table from '../src/engine/preflopEquity.json';
import { equityLookup } from '../src/engine/pushFold.js';
import { buildRanges } from '../src/engine/rangeModel.js';
import { mistakesForHand, scoreHands, stageFor } from '../src/engine/quality.js';
import { parseHand } from '../src/engine/parser.js';

const ranges = buildRanges(equityLookup(table));

// Made-up player IDs. Hero calls 5,000 on the river with 9-high into a pot of 7,000.
const BIG_CALL = `CoinPoker Hand #900000000050: NLH (100/200/0) 2026/09/10 21:00:00 AEST
Tournament 'Test Regular' '50020' 6-max Seat #1 is the button
Seat 1: b0b00001 (10,000 in chips)
Seat 2: Hero (10,000 in chips)
Seat 3: b0b00002 (10,000 in chips)
Hero: posts small blind 100
b0b00002: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [9c 8d]
b0b00001: raises 300 to 500
Hero: calls 400
b0b00002: folds
*** FLOP *** [Kh 7s 2c]
Hero: checks
b0b00001: bets 400
Hero: calls 400
*** TURN *** [Kh 7s 2c] [4d]
Hero: checks
b0b00001: checks
*** RIVER *** [Kh 7s 2c 4d] [Jc]
Hero: checks
b0b00001: bets 5,000
Hero: calls 5,000
*** SHOWDOWN ***
b0b00001: shows [Ks Qd] (Pair of Kings)
Hero: shows [9c 8d] (High Card)
b0b00001 collected 12,000 from pot
*** SUMMARY ***
Total pot 12,000
Board [ Kh 7s 2c 4d Jc ]`;

describe('mistakesForHand', () => {
  const hand = parseHand(BIG_CALL);

  it('costs a call made with less equity than it needed: (needed − had) × pot after calling', () => {
    const ms = mistakesForHand(hand, ranges);
    const river = ms.find(m => m.type === 'badCall' && m.street === 'river');
    // Needed 5,000 / 12,000 = 41.7%; 9-high has close to 0% against a big river bet: about 25bb.
    expect(river.cost).toBeGreaterThan(23);
    expect(river.cost).toBeLessThanOrEqual(25 + 1e-9);
  });

  it('ignores preflop calls that are not facing an all-in', () => {
    expect(mistakesForHand(hand, ranges).some(m => m.street === 'preflop')).toBe(false);
  });

  it('passes push/fold costs through, and leaves the preflop decision to it', () => {
    const pushFold = { cost: 0.9, did: 'fold', cell: '98o', stack: 8 };
    const ms = mistakesForHand(hand, ranges, { pushFold });
    expect(ms.filter(m => m.type === 'pushFold').map(m => m.cost)).toEqual([0.9]);
  });

  it('costs a losing bluff by the share of poor conditions', () => {
    const bets = [
      {
        kind: 'bluff',
        won: false,
        street: 'river',
        size: 1000,
        conditions: {
          headsUp: true,
          villainShowedWeakness: false,
          drawBackup: null,
          noShowdownValue: true,
          stackBehind: false,
        },
      },
    ];
    const ms = mistakesForHand(hand, ranges, { bets });
    expect(ms.find(m => m.type === 'badBluff').cost).toBeCloseTo(2.5, 10); // 5bb × (1 − 2/4)
  });

  it('costs a fold that would have been a profitable call', () => {
    // Hero folds a set to a quarter-pot river bet: calling needed 1,000 / 6,000 = 17%.
    const folded = parseHand(
      BIG_CALL.replace('Dealt to Hero [9c 8d]', 'Dealt to Hero [7c 7d]')
        .replace('b0b00001: bets 5,000\nHero: calls 5,000', 'b0b00001: bets 1,000\nHero: folds')
        .replace(/\*\*\* SHOWDOWN \*\*\*[\s\S]*$/, ''),
    );
    const ms = mistakesForHand(folded, ranges);
    const fold = ms.find(m => m.type === 'badFold');
    expect(fold.street).toBe('river');
    expect(fold.cost).toBeGreaterThan(3); // (had − 17%) × 6,000 / 200, with a set far ahead
  });
});

describe('scoreHands', () => {
  it('reports bb and % of stack per 100 hands, by stage', () => {
    const a = parseHand(BIG_CALL); // 50bb deep
    const b = parseHand(BIG_CALL.replace('900000000050', '900000000051'));
    const map = new Map([
      [a.id, [{ type: 'badCall', cost: 10, label: 'x' }]],
      [b.id, [{ type: 'badFold', cost: 4, label: 'y' }]],
    ]);
    const s = scoreHands([a, b], map);
    expect(s.bbPer100).toBe(700); // 14bb over 2 hands
    expect(s.stackPctPer100).toBeCloseTo((100 * (10 / 50 + 4 / 50) * 100) / 2, 10); // 28% of a 50bb stack per 2 hands
    expect(s.stages.find(x => x.id === 'deep')).toMatchObject({ hands: 2, bbPer100: 700 });
    expect(s.costliest.map(m => m.cost)).toEqual([10, 4]);
    expect(stageFor(a)).toBe('deep');
  });
});
