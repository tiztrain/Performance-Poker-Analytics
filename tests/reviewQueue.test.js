import { describe, it, expect } from 'vitest';
import {
  buildQueue,
  createReviewStore,
  drillDecision,
  isDue,
  nextSchedule,
  reasonsForHand,
} from '../src/engine/reviewQueue.js';
import { computeStats } from '../src/engine/stats.js';
import { parseAll, parseHand } from '../src/engine/parser.js';
import { SAMPLE } from '../src/sample-hand.js';

const DAY = 24 * 60 * 60 * 1000;

// Made-up player IDs, like src/sample-hand.js. Hero calls a big river bet with a weak hand.
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

describe('review queue', () => {
  const hand = parseHand(BIG_CALL);
  const raw = computeStats([hand]).raw;

  it('collects every flag on a hand with its stake', () => {
    const reasons = reasonsForHand(hand, raw);
    const types = reasons.map(r => r.type);
    expect(types).toContain('bigCall'); // river call of 5,000 into 7,000: needs 5,000 / 12,000 = 41.7%
    expect(types).toContain('weakContinue');
    expect(types).toContain('missed3b');
    const weak = reasons.find(r => r.type === 'weakContinue' && r.street === 'river');
    expect(weak.stake).toBe(25); // 5,000 / 200
  });

  it('ranks by stake × weight', () => {
    const quiet = parseAll(SAMPLE);
    const q = buildQueue([...quiet, hand], computeStats([...quiet, hand]).raw);
    expect(q[0].hand.id).toBe('900000000050');
    expect(q.every((it, i) => i === 0 || q[i - 1].score >= it.score)).toBe(true);
  });

  it('adds push/fold mistakes and big all-in swings from extras', () => {
    const pushFold = new Map([
      [hand.id, { cost: 0.9, did: 'fold', cell: '98o', stack: 8, kind: 'shove', chartAct: 'shove' }],
    ]);
    const allIn = new Map([[hand.id, { luck: -2400, street: 'turn' }]]);
    const types = reasonsForHand(hand, raw, { pushFold, allIn }).map(r => r.type);
    expect(types).toContain('pushFold');
    expect(types).toContain('allInSwing'); // −12bb against expectation
  });
});

describe('drillDecision', () => {
  it('stops at the flagged call and offers fold, call or raise', () => {
    const hand = parseHand(BIG_CALL);
    const reasons = reasonsForHand(hand, computeStats([hand]).raw);
    const d = drillDecision(hand, reasons);
    expect(d.street).toBe(reasons.find(r => r.type === 'bigCall').street);
    expect(d.choices).toEqual(['fold', 'call', 'raise']);
    expect(d.did).toBe('call');
    expect(hand.streets[d.street][d.index]).toMatchObject({ player: 'Hero', action: 'call' });
  });

  it('offers fold or shove for a push/fold spot', () => {
    const hand = parseHand(BIG_CALL);
    const d = drillDecision(hand, [
      { type: 'pushFold', street: 'preflop', spotKind: 'shove', did: 'call', chartAct: 'shove', label: '' },
    ]);
    expect(d.choices).toEqual(['fold', 'shove']);
  });
});

describe('spaced repetition', () => {
  const now = 1_000_000_000_000;

  it('steps through 1, 3, 7 and 21 days while right, then graduates', () => {
    let e = nextSchedule(undefined, true, now);
    expect(e).toEqual({ level: 0, due: now + 1 * DAY });
    e = nextSchedule(e, true, now);
    expect(e.due).toBe(now + 3 * DAY);
    e = nextSchedule(e, true, now);
    expect(e.due).toBe(now + 7 * DAY);
    e = nextSchedule(e, true, now);
    expect(e.due).toBe(now + 21 * DAY);
    e = nextSchedule(e, true, now);
    expect(e).toMatchObject({ graduated: true, due: null });
  });

  it('goes back to 1 day after a wrong answer', () => {
    expect(nextSchedule({ level: 2, due: 0 }, false, now)).toEqual({ level: 0, due: now + DAY });
  });

  it('knows when a drill is due', () => {
    expect(isDue({ level: 0, due: now - 1 }, now)).toBe(true);
    expect(isDue({ level: 0, due: now + 1 }, now)).toBe(false);
    expect(isDue({ level: 4, due: null, graduated: true }, now)).toBe(false);
    expect(isDue(undefined, now)).toBe(false);
  });

  it('saves reviewed hands and drills through storage', () => {
    const data = {};
    const storage = { getItem: k => data[k] ?? null, setItem: (k, v) => (data[k] = v) };
    const s = createReviewStore(storage);
    s.setReviewed('1', true);
    s.recordDrill('2', false, now);
    const again = createReviewStore(storage).state();
    expect(again.reviewed).toEqual({ 1: true });
    expect(again.drills['2']).toEqual({ level: 0, due: now + DAY });
  });
});
