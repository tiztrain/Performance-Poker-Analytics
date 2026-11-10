import { describe, it, expect } from 'vitest';
import table from '../src/engine/preflopEquity.json';
import { equityLookup } from '../src/engine/pushFold.js';
import { buildRanges } from '../src/engine/rangeModel.js';
import {
  analyseBets,
  balancedBluffShare,
  breakEvenFold,
  classifyBet,
  spotQuality,
  summarizeBluffs,
  verdict,
} from '../src/engine/bluffs.js';
import { parseHand } from '../src/engine/parser.js';

const ranges = buildRanges(equityLookup(table));

describe('bluff maths', () => {
  it('gives the balanced river bluff share b / (p + 2b)', () => {
    expect(balancedBluffShare(50, 100)).toBeCloseTo(0.25, 10);
    expect(balancedBluffShare(100, 100)).toBeCloseTo(1 / 3, 10);
  });

  it('gives the break-even fold rate b / (p + b)', () => {
    expect(breakEvenFold(50, 100)).toBeCloseTo(1 / 3, 10);
    expect(breakEvenFold(100, 100)).toBe(0.5);
  });

  it('calls a river share under half of balanced under-bluffing, and over 1.25× over-bluffing', () => {
    expect(verdict(0.1, 0.25)).toBe('under');
    expect(verdict(0.25, 0.25)).toBe('balanced');
    expect(verdict(0.4, 0.25)).toBe('over');
    expect(verdict(null, 0.25)).toBeNull();
  });
});

describe('classifyBet', () => {
  it.each([
    ['river', 0.8, 'strong', 'value'],
    ['river', 0.4, 'topPair', 'thin'],
    ['river', 0.1, 'nothing', 'bluff'],
    ['flop', 0.6, 'topPair', 'value'],
    ['flop', 0.35, 'draw', 'semiBluff'],
    ['flop', 0.2, 'draw', 'semiBluff'],
    ['turn', 0.35, 'weakPair', 'thin'],
    ['turn', 0.32, 'nothing', 'semiBluff'],
    ['turn', 0.15, 'nothing', 'bluff'],
  ])('%s at %s equity with %s is %s', (street, eq, cat, kind) => {
    expect(classifyBet(street, eq, cat)).toBe(kind);
  });
});

// Made-up player IDs. Hero opens 7♠6♠, c-bets, checks the turn, and bets 72% of the pot on an
// ace river after villain checks; villain folds.
const RIVER_BLUFF = `CoinPoker Hand #900000000080: NLH (100/200/25) 2026/09/13 20:01:10 AEST
Tournament 'Test Regular' '50050' 6-max Seat #3 is the button
Seat 1: f1f10001 (8,000 in chips)
Seat 2: f1f10002 (12,400 in chips)
Seat 3: Hero (10,000 in chips)
f1f10001: posts ante 25
f1f10002: posts ante 25
Hero: posts ante 25
f1f10001: posts small blind 100
f1f10002: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [7s 6s]
Hero: raises 250 to 450
f1f10001: folds
f1f10002: calls 250
*** FLOP *** [Kh Td 2s]
f1f10002: checks
Hero: bets 500
f1f10002: calls 500
*** TURN *** [Kh Td 2s] [4c]
f1f10002: checks
Hero: checks
*** RIVER *** [Kh Td 2s 4c] [Ah]
f1f10002: checks
Hero: bets 1,500
f1f10002: folds
Hero: RETURN 1,500
*** SHOWDOWN ***
Hero collected 2,075 from pot
*** SUMMARY ***
Total pot 2,075
Board [ Kh Td 2s 4c Ah ]`;

describe('analyseBets', () => {
  const bets = analyseBets(parseHand(RIVER_BLUFF), ranges);

  it('classifies a 7-high river bet as a bluff that won, in a good spot', () => {
    const river = bets.find(b => b.street === 'river');
    expect(river.kind).toBe('bluff');
    expect(river.equity).toBeLessThan(0.1);
    expect(river.pctPot).toBe(72); // 1,500 into 2,075
    expect(river.won).toBe(true);
    expect(river.conditions).toEqual({
      headsUp: true,
      villainShowedWeakness: true,
      drawBackup: null,
      noShowdownValue: true,
      stackBehind: true,
    });
    expect(spotQuality(river.conditions)).toBe(1);
  });

  it('looks at the flop c-bet too', () => {
    const flop = bets.find(b => b.street === 'flop');
    expect(flop.pctPot).toBe(47); // 500 into 1,075
    expect(['bluff', 'semiBluff']).toContain(flop.kind); // 7-high with a backdoor flush draw only
    expect(flop.won).toBe(false);
  });

  it('summarises shares, success and quality', () => {
    const s = summarizeBluffs(bets);
    expect(s.river).toMatchObject({ bets: 1, bluffs: 1, share: 1 });
    expect(s.river.balanced).toBeCloseTo(1500 / (2075 + 3000), 10);
    expect(s.success.bluffs).toBe(2);
    expect(s.success.won).toBe(1);
    expect(s.success.rate).toBe(0.5);
    // Two bluffs in one hand count its result once: +1,100 chips, 5.5bb.
    expect(s.success.hands).toBe(1);
    expect(s.success.bbResult).toBeCloseTo(5.5, 10);
    expect(s.success.chipsResult).toBe(1100);
  });
});
