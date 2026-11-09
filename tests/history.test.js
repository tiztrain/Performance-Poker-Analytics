import { describe, it, expect } from 'vitest';
import { wilsonRange } from '../src/engine/confidence.js';
import { byPosition, byStackDepth, effectiveStackBB, lastHands, stackBucket } from '../src/engine/breakdowns.js';
import { countNew, handsFromRecords, recordsFromText } from '../src/engine/history.js';
import { computeStats } from '../src/engine/stats.js';
import { parseAll, parseHand } from '../src/engine/parser.js';
import { SAMPLE } from '../src/sample-hand.js';

describe('wilsonRange (95% confidence range)', () => {
  it('matches hand-worked values', () => {
    const r = wilsonRange(6, 50); // 12% from 50 chances
    expect(r.low).toBeCloseTo(5.62, 1);
    expect(r.high).toBeCloseTo(23.8, 1);
    const zero = wilsonRange(0, 10);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeCloseTo(27.75, 1);
  });

  it('narrows as the sample grows', () => {
    const small = wilsonRange(12, 100);
    const big = wilsonRange(120, 1000);
    expect(big.high - big.low).toBeLessThan(small.high - small.low);
  });

  it('returns null with no chances', () => {
    expect(wilsonRange(0, 0)).toBeNull();
  });
});

describe('computeStats counts', () => {
  it('reports hits and chances behind each percentage', () => {
    const s = computeStats(parseAll(SAMPLE));
    expect(s.counts.vpip).toEqual([1, 4]); // Hero called in hand 2 only
    expect(s.counts.threeBet).toEqual([0, 3]); // facing an open in hands 2, 3 and 4
  });
});

describe('breakdowns', () => {
  const hands = parseAll(SAMPLE);

  it('uses the effective stack: the smaller of Hero and the biggest other stack', () => {
    expect(effectiveStackBB(hands[0])).toBe(100); // 50,000 vs 50,000 at 500 big blind
    // Hero 30,500 vs biggest other 41,000 at a 2,000 big blind: 15.25bb.
    const short = parseHand(`CoinPoker Hand #900000000030: NLH (1,000/2,000/250) 2026/09/09 21:15:02 AEST
Tournament 'Test' '50005' 7-max Seat #1 is the button
Seat 1: a1b2c3d4 (24,000 in chips)
Seat 2: Hero (30,500 in chips)
Seat 3: e5f6a7b8 (41,000 in chips)
*** HOLE CARDS ***
Dealt to Hero [Ah Jd]`);
    expect(effectiveStackBB(short)).toBe(15.25);
    expect(stackBucket(short)).toBe('10to20');
  });

  it('groups hands by stack depth and by position', () => {
    const depth = byStackDepth(hands);
    expect(depth.map(r => [r.id, r.hands])).toEqual([['40plus', 4]]);
    const pos = byPosition(hands);
    expect(pos.reduce((t, r) => t + r.hands, 0)).toBe(4);
    expect(pos.find(r => r.id === 'BB').hands).toBe(1); // hand 2: Hero in the big blind
    expect(pos.find(r => r.id === 'BB').bbWon).toBeCloseTo(5.03, 2);
  });

  it('keeps the last N hands', () => {
    expect(lastHands([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(lastHands([1, 2, 3], 0)).toEqual([1, 2, 3]);
  });
});

describe('saved history records', () => {
  it('stores each hand’s text keyed by hand ID', () => {
    const records = recordsFromText(SAMPLE);
    expect(records.map(r => r.id)).toEqual(['162993700001', '162993700002', '162993700003', '162993700004']);
    expect(records[0].raw.startsWith('CoinPoker Hand #162993700001')).toBe(true);
  });

  it('counts only hands not saved yet, including duplicates within one upload', () => {
    const records = recordsFromText(SAMPLE + '\n\n' + SAMPLE);
    expect(countNew(['162993700001'], records)).toBe(3);
  });

  it('parses saved records back into the same hands', () => {
    const back = handsFromRecords(recordsFromText(SAMPLE));
    expect(back.map(h => h.heroNetChips)).toEqual(parseAll(SAMPLE).map(h => h.heroNetChips));
  });

  it('ignores text without a hand header', () => {
    expect(recordsFromText('not a hand history')).toEqual([]);
  });
});
