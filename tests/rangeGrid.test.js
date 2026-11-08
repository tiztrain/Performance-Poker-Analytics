import { describe, it, expect } from 'vitest';
import {
  ALL_CELLS,
  cellForHand,
  cellName,
  combosForCell,
  countLive,
  liveCombos,
  scoreRange,
} from '../src/engine/rangeGrid.js';

describe('13×13 grid', () => {
  it('has 169 cells holding 1,326 combos', () => {
    expect(ALL_CELLS).toHaveLength(169);
    expect(countLive(ALL_CELLS, [])).toBe(1326);
  });

  it('puts pairs on the diagonal, suited above and offsuit below', () => {
    expect(cellName(0, 0)).toBe('AA');
    expect(cellName(0, 1)).toBe('AKs');
    expect(cellName(1, 0)).toBe('AKo');
    expect(cellName(12, 12)).toBe('22');
    expect(cellName(11, 12)).toBe('32s');
  });

  it('counts 6 combos for a pair, 4 suited, 12 offsuit', () => {
    expect(combosForCell('QQ')).toHaveLength(6);
    expect(combosForCell('T9s')).toHaveLength(4);
    expect(combosForCell('T9o')).toHaveLength(12);
  });

  it('finds the cell for a known hand', () => {
    expect(cellForHand(['Ah', '4h'])).toBe('A4s');
    expect(cellForHand(['4d', 'Ah'])).toBe('A4o');
    expect(cellForHand(['Kd', 'Kc'])).toBe('KK');
  });

  it('removes combos that use a card on the board or in Hero’s hand', () => {
    expect(liveCombos('AA', ['Ah'])).toHaveLength(3);
    expect(liveCombos('AKs', ['As', 'Kd']).map(c => c.join(''))).toEqual(['AhKh', 'AcKc']);
  });
});

describe('scoreRange (tightness curve)', () => {
  it('scores 100 × (1 − √share) when the hand is in the range', () => {
    const r = scoreRange(new Set(['AA']), ['Ah', 'As'], []);
    expect(r.hit).toBe(true);
    expect(r.painted).toBe(6);
    expect(r.total).toBe(1326);
    expect(r.points).toBe(93); // 100 × (1 − √(6/1326)) = 93.3
  });

  it('scores 0 when the hand is not in the range', () => {
    const r = scoreRange(new Set(['AA']), ['Kh', 'Ks'], []);
    expect(r).toMatchObject({ hit: false, points: 0, villainCell: 'KK' });
  });

  it('scores 0 for painting every hand', () => {
    expect(scoreRange(new Set(ALL_CELLS), ['Ah', '4h'], []).points).toBe(0);
  });

  it('measures the share against live combos only', () => {
    // 7 cards known (5 board + Hero's 2) leaves C(45,2) = 990 combos; AA has 3 left with Hero's ace gone.
    const dead = ['Kh', '9h', '2c', '5d', 'Jh', 'Ac', 'Jd'];
    const r = scoreRange(new Set(['AA']), ['Ah', '4h'], dead);
    expect(r.total).toBe(990);
    expect(r.painted).toBe(3);
  });
});
