import { describe, it, expect } from 'vitest';
import table from '../src/engine/preflopEquity.json';
import { equityLookup, solvePushFold } from '../src/engine/pushFold.js';
import { createPushFoldChecker, findPushFoldSpot, summarizePushFold } from '../src/engine/pushFoldSpots.js';
import { ALL_CELLS } from '../src/engine/rangeGrid.js';
import { parseHand } from '../src/engine/parser.js';

const eq = equityLookup(table);
const idx = name => ALL_CELLS.indexOf(name);

describe('preflop equity table', () => {
  it('matches well-known all-in equities', () => {
    expect(eq(idx('AA'), idx('KK'))).toBeGreaterThan(0.8);
    expect(eq(idx('AA'), idx('KK'))).toBeLessThan(0.84);
    expect(eq(idx('AKo'), idx('QQ'))).toBeGreaterThan(0.41);
    expect(eq(idx('AKo'), idx('QQ'))).toBeLessThan(0.45);
    expect(eq(idx('72o'), idx('AA'))).toBeLessThan(0.14);
  });

  it('is consistent both ways round', () => {
    expect(eq(idx('KQs'), idx('JTs')) + eq(idx('JTs'), idx('KQs'))).toBeCloseTo(1, 10);
  });
});

describe('solvePushFold', () => {
  // Heads-up: small blind (0.5 posted) shoves or folds; big blind (1 posted) calls or folds.
  const headsUp = stack => solvePushFold({ stack, players: 2, pusherPost: 0.5, callerPosts: [1], eq });

  it('matches published heads-up Nash ranges at 10bb: shove about 58%, call about 37%', () => {
    const s = headsUp(10);
    expect(s.pushShare).toBeGreaterThan(0.52);
    expect(s.pushShare).toBeLessThan(0.64);
    expect(s.callShares[0]).toBeGreaterThan(0.31);
    expect(s.callShares[0]).toBeLessThan(0.43);
    expect(s.push[idx('AA')]).toBe(1);
    expect(s.push[idx('K2s')]).toBeGreaterThan(0.5);
    expect(s.push[idx('32o')]).toBeLessThan(0.5);
    expect(s.calls[0][idx('A2o')]).toBeGreaterThan(0.5);
    expect(s.calls[0][idx('72o')]).toBeLessThan(0.5);
  });

  it('shoves wider with a shorter stack', () => {
    expect(headsUp(5).pushShare).toBeGreaterThan(headsUp(10).pushShare);
    expect(headsUp(10).pushShare).toBeGreaterThan(headsUp(15).pushShare);
  });

  it('shoves tighter with more players left to act', () => {
    const utg = solvePushFold({ stack: 10, players: 7, callerPosts: [0, 0, 0, 0, 0.5, 1], eq });
    expect(utg.pushShare).toBeLessThan(headsUp(10).pushShare);
    expect(utg.pushShare).toBeGreaterThan(0.05);
  });

  it('gives each hand an EV against folding that agrees with the range', () => {
    const s = headsUp(10);
    expect(s.pushEV[idx('AA')]).toBeGreaterThan(0);
    expect(s.pushEV[idx('32o')]).toBeLessThan(0);
  });
});

// Made-up player IDs, like src/sample-hand.js. Blinds 500/1,000, no ante.
const header = (id, button) => `CoinPoker Hand #${id}: NLH (500/1,000/0) 2026/09/10 20:00:00 AEST
Tournament 'Test Regular' '50010' 6-max Seat #${button} is the button`;

const SB_FOLDS_K9O = `${header('900000000040', 1)}
Seat 1: f00f0001 (30,000 in chips)
Seat 2: Hero (8,000 in chips)
Seat 3: f00f0002 (30,000 in chips)
Hero: posts small blind 500
f00f0002: posts big blind 1,000
*** HOLE CARDS ***
Dealt to Hero [Kd 9c]
f00f0001: folds
Hero: folds
f00f0002: RETURN 500
*** SHOWDOWN ***
f00f0002 collected 1,000 from pot
*** SUMMARY ***
Total pot 1,000
Board [  ]`;

describe('findPushFoldSpot', () => {
  it('finds a folded-to shove-or-fold spot with the right blinds', () => {
    const spot = findPushFoldSpot(parseHand(SB_FOLDS_K9O));
    expect(spot).toMatchObject({
      kind: 'shove',
      did: 'fold',
      stack: 8,
      players: 3,
      pusherPost: 0.5,
      callerPosts: [1],
      otherPosts: 0,
      position: 'SB',
    });
  });

  it('finds a call-or-fold spot against a single shove', () => {
    const text = SB_FOLDS_K9O.replace('f00f0001: folds\nHero: folds', 'f00f0001: ALLIN 30,000\nHero: folds');
    const spot = findPushFoldSpot(parseHand(text));
    expect(spot).toMatchObject({ kind: 'call', did: 'fold', stack: 8, heroIndex: 0, callerPosts: [0.5, 1] });
  });

  it('skips limps and deep stacks', () => {
    expect(findPushFoldSpot(parseHand(SB_FOLDS_K9O.replace('Hero: folds', 'Hero: calls 500')))).toBeNull();
    expect(findPushFoldSpot(parseHand(SB_FOLDS_K9O.replace('Hero (8,000', 'Hero (20,000')))).toBeNull();
  });
});

describe('push/fold check', () => {
  it('flags folding a chart shove, with its EV as the cost', () => {
    const check = createPushFoldChecker(eq, { iterations: 200 });
    const r = check(parseHand(SB_FOLDS_K9O));
    expect(r.cell).toBe('K9o');
    expect(r.chartAct).toBe('shove'); // K9o is a clear heads-up shove at 8bb
    expect(r.ev).toBeGreaterThan(0);
    expect(r.cost).toBeCloseTo(r.ev, 10);
    expect(summarizePushFold([r])).toEqual({ spots: 1, mistakes: 1, costBB: r.cost });
  });
});
