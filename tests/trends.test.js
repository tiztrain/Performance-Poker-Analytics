import { describe, it, expect } from 'vitest';
import {
  chronological,
  luckSeries,
  quizModesUsed,
  quizSeries,
  statSeries,
  tournamentSeries,
} from '../src/engine/trends.js';
import { parseAll } from '../src/engine/parser.js';
import { computeStats } from '../src/engine/stats.js';
import { SAMPLE } from '../src/sample-hand.js';

// Minimal hand stand-ins: only what the trend helpers read.
const hand = (id, dateStr, timeStr) => ({ id, dateStr, timeStr });
const group = (key, format, hands) => ({ key, name: key, format, hands, startDate: hands[0].dateStr });

describe('trends', () => {
  it('orders tournaments by their first hand, not by name or ID', () => {
    const late = group('A', 'regular', [hand('1', '2026/09/12', '10:00:00')]);
    const early = group('B', 'regular', [hand('9', '2026/09/10', '23:00:00'), hand('2', '2026/09/11', '01:00:00')]);
    expect(chronological([late, early]).map(g => g.key)).toEqual(['B', 'A']);
  });

  it('pools hands over the rolling window instead of averaging tournaments', () => {
    const gs = [
      group('T1', 'regular', [hand('1', '2026/09/01', '10:00:00')]),
      group(
        'T2',
        'regular',
        [1, 2, 3].map(i => hand('2' + i, '2026/09/02', '10:00:0' + i)),
      ),
      group('T3', 'regular', [hand('3', '2026/09/03', '10:00:00')]),
    ];
    const s = tournamentSeries(gs, hands => hands.length, 2);
    expect(s.map(p => p.value)).toEqual([1, 3, 1]);
    expect(s.map(p => p.rolling)).toEqual([1, 4, 4]); // T1+T2, then T2+T3
  });

  it('keeps each format separate in stat trends', () => {
    const hands = parseAll(SAMPLE);
    const half = Math.ceil(hands.length / 2);
    const gs = [group('R', 'regular', hands.slice(0, half)), group('H', 'hyper', hands.slice(half))];
    const s = statSeries(gs, 'hyper', 'vpip');
    expect(s.map(p => p.key)).toEqual(['H']);
    expect(s[0].value).toBe(Number(computeStats(hands.slice(half)).vpip));
  });

  it('accumulates all-in expected and actual results in big blinds', () => {
    const r = (id, timeStr, expectedNet, actualNet, bb) => ({
      hand: hand(id, '2026/09/01', timeStr),
      expectedNet,
      actualNet,
      bb,
      heroEquity: 0.5,
    });
    const s = luckSeries([r('2', '11:00:00', -100, 400, 200), r('1', '10:00:00', 50, -100, 100)]);
    expect(s.map(p => p.handId)).toEqual(['1', '2']);
    expect(s[1].expected).toBeCloseTo(0.5 - 0.5);
    expect(s[1].actual).toBeCloseTo(-1 + 2);
    expect(s[1].luck).toBeCloseTo(1);
  });

  it('averages the last answers of one quiz mode', () => {
    const records = [
      { mode: 'simple', points: 100 }, // an old record: simple on every street
      { mode: 'advanced-river', points: 10 },
      { mode: 'simple-every', points: 0 },
      { mode: 'simple-every', points: 50 },
      { mode: 'simple-every' }, // unscored
    ];
    expect(quizSeries(records, 'simple-every', 2).map(p => p.rolling)).toEqual([100, 50, 25]);
    expect(quizModesUsed(records).sort()).toEqual(['advanced-river', 'simple-every']);
  });
});
