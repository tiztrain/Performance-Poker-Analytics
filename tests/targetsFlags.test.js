import { describe, it, expect } from 'vitest';
import {
  createTargetStore,
  DEFAULT_TARGETS,
  effectiveTargets,
  gradeStat,
  isValidRange,
} from '../src/engine/targets.js';
import { moreFlagsForHand, requiredEquity } from '../src/engine/moreFlags.js';
import { parseHand } from '../src/engine/parser.js';

describe('targets', () => {
  it('grades inside as good, just outside as watch, far outside as leak, either side', () => {
    const t = { min: 6, max: 10 };
    expect(gradeStat('8.0', t)).toBe('good');
    expect(gradeStat('12', t)).toBe('watch'); // within 3 points (the minimum margin)
    expect(gradeStat('16', t)).toBe('leak');
    expect(gradeStat('4', t)).toBe('watch');
    expect(gradeStat('1', t)).toBe('leak');
    expect(gradeStat(null, t)).toBe('');
    expect(gradeStat('50', undefined)).toBe('');
  });

  it('widens the watch margin for wide ranges (a quarter of the width)', () => {
    expect(gradeStat('80', { min: 55, max: 75 })).toBe('watch'); // margin 5
    expect(gradeStat('81', { min: 55, max: 75 })).toBe('leak');
  });

  it('has defaults for regular, turbo and hyper but not satellite', () => {
    expect(DEFAULT_TARGETS.regular.threeBet).toEqual({ min: 6, max: 10 });
    expect(Object.keys(DEFAULT_TARGETS.hyper)).toHaveLength(10);
    expect(DEFAULT_TARGETS.satellite).toEqual({});
  });

  it('applies overrides on top of defaults, and null removes a target', () => {
    const t = effectiveTargets('regular', { regular: { vpip: { min: 15, max: 22 }, wsd: null } });
    expect(t.vpip).toEqual({ min: 15, max: 22 });
    expect(t.wsd).toBeUndefined();
    expect(t.pfr).toEqual(DEFAULT_TARGETS.regular.pfr);
    expect(effectiveTargets('satellite', { satellite: { vpip: { min: 10, max: 20 } } }).vpip).toEqual({
      min: 10,
      max: 20,
    });
  });

  it('validates ranges', () => {
    expect(isValidRange({ min: 5, max: 10 })).toBe(true);
    expect(isValidRange({ min: 10, max: 5 })).toBe(false);
    expect(isValidRange({ min: -1, max: 5 })).toBe(false);
    expect(isValidRange({ min: 5, max: 101 })).toBe(false);
    expect(isValidRange({ min: NaN, max: 5 })).toBe(false);
  });

  it('saves overrides through storage and rejects invalid ones', () => {
    const data = {};
    const storage = { getItem: k => data[k] ?? null, setItem: (k, v) => (data[k] = v) };
    const store = createTargetStore(storage);
    expect(store.setOverride('turbo', 'vpip', { min: 30, max: 20 })).toBe(false);
    expect(store.setOverride('turbo', 'vpip', { min: 20, max: 30 })).toBe(true);
    expect(createTargetStore(storage).load()).toEqual({ turbo: { vpip: { min: 20, max: 30 } } });
    store.removeOverride('turbo', 'vpip');
    expect(store.load()).toEqual({ turbo: {} });
    store.setOverride('hyper', 'pfr', { min: 1, max: 2 });
    store.clearFormat('hyper');
    expect(store.load().hyper).toBeUndefined();
  });
});

// Made-up player IDs, like src/sample-hand.js. Blinds 100/200, no ante.
const hand = (id, body) =>
  parseHand(`CoinPoker Hand #${id}: NLH (100/200/0) 2026/09/11 20:00:00 AEST
Tournament 'Test Regular' '50030' 6-max Seat #1 is the button
Seat 1: c1c10001 (10,000 in chips)
Seat 2: Hero (10,000 in chips)
Seat 3: c1c10002 (10,000 in chips)
Hero: posts small blind 100
c1c10002: posts big blind 200
*** HOLE CARDS ***
${body}`);

describe('more flags', () => {
  it('flags a river check-down with two pair', () => {
    const h = hand(
      '900000000060',
      `Dealt to Hero [Kh 7c]
c1c10001: raises 300 to 500
Hero: calls 400
c1c10002: folds
*** FLOP *** [Kd 7s 2c]
Hero: checks
c1c10001: checks
*** TURN *** [Kd 7s 2c] [4d]
Hero: checks
c1c10001: checks
*** RIVER *** [Kd 7s 2c 4d] [9h]
Hero: checks
c1c10001: checks
*** SHOWDOWN ***
Hero: shows [Kh 7c] (Two Pair)
Hero collected 1,200 from pot`,
    );
    expect(moreFlagsForHand(h).missedValue).toEqual([
      { handId: '900000000060', street: 'river', kind: 'checked', pot: 1200 },
    ]);
  });

  it('flags a tiny river bet with a set, and the sizing', () => {
    const h = hand(
      '900000000061',
      `Dealt to Hero [7h 7c]
c1c10001: raises 300 to 500
Hero: calls 400
c1c10002: folds
*** FLOP *** [Kd 7s 2c]
Hero: checks
c1c10001: checks
*** TURN *** [Kd 7s 2c] [4d]
Hero: checks
c1c10001: checks
*** RIVER *** [Kd 7s 2c 4d] [9h]
Hero: bets 200
c1c10001: calls 200`,
    );
    const f = moreFlagsForHand(h);
    expect(f.missedValue).toEqual([{ handId: '900000000061', street: 'river', kind: 'small', pot: 1200, pct: 17 }]);
    expect(f.sizing).toEqual([{ handId: '900000000061', street: 'river', size: 200, pct: 17, kind: 'small' }]);
  });

  it('flags raise-fold and a committed fold', () => {
    // Hero 3-bets to 2,500 (25% of 10,000), folds to a 4-bet: both flags.
    const h = hand(
      '900000000062',
      `Dealt to Hero [Ah Jc]
c1c10001: raises 300 to 500
Hero: raises 2,000 to 2,500
c1c10002: folds
c1c10001: raises 5,000 to 7,500
Hero: folds`,
    );
    const f = moreFlagsForHand(h);
    expect(f.raiseFolds).toEqual([{ handId: '900000000062', street: 'preflop', invested: 2500, pctStack: 25 }]);
    expect(f.committedFolds).toEqual([]); // 25% is under a third
    const deeper = hand(
      '900000000063',
      `Dealt to Hero [Ah Jc]
c1c10001: raises 300 to 500
Hero: raises 3,500 to 4,000
c1c10002: folds
c1c10001: raises 6,000 to 10,000
Hero: folds`,
    );
    expect(moreFlagsForHand(deeper).committedFolds).toEqual([
      { handId: '900000000063', street: 'preflop', invested: 4000, pctStack: 40 },
    ]);
  });

  it('computes the equity a call needed', () => {
    expect(requiredEquity({ action: 'call', amount: 500, potBefore: 1000 })).toBeCloseTo(1 / 3, 10);
    expect(requiredEquity({ action: 'fold', toCall: 200, potBefore: 800 })).toBeCloseTo(0.2, 10);
    expect(requiredEquity({ action: 'check', potBefore: 800 })).toBeNull();
  });
});
