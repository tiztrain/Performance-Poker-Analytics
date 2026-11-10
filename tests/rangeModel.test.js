import { describe, it, expect } from 'vitest';
import table from '../src/engine/preflopEquity.json';
import { equityLookup } from '../src/engine/pushFold.js';
import {
  ACTION_WEIGHTS,
  buildRanges,
  callEquities,
  createRangeStore,
  equityVsCombos,
  preflopRangeKey,
  rangeShare,
  villainCombos,
} from '../src/engine/rangeModel.js';
import { ALL_CELLS, combosForCell } from '../src/engine/rangeGrid.js';
import { parseAll, parseHand } from '../src/engine/parser.js';
import { SAMPLE } from '../src/sample-hand.js';

const eq = equityLookup(table);
const ranges = buildRanges(eq);
const has = (key, cell) => ranges[key][ALL_CELLS.indexOf(cell)] === 1;

function combosOf(range, dead) {
  const out = [];
  range.forEach((v, i) => {
    if (v) combosForCell(ALL_CELLS[i]).forEach(c => !dead.some(d => c.includes(d)) && out.push({ cards: c, w: 1 }));
  });
  return out;
}

describe('default ranges', () => {
  it('sizes each chart close to its target percentage', () => {
    expect(rangeShare(ranges.open_UTG)).toBeCloseTo(0.14, 1);
    expect(rangeShare(ranges.open_BTN)).toBeCloseTo(0.45, 1);
    expect(rangeShare(ranges.threeBet)).toBeGreaterThan(0.06);
    expect(rangeShare(ranges.threeBet)).toBeLessThan(0.09);
  });

  it('puts sensible hands in each chart', () => {
    expect(has('fourBet', 'AA')).toBe(true);
    expect(has('fourBet', 'AKs')).toBe(true);
    expect(has('open_UTG', 'KQs')).toBe(true);
    expect(has('open_UTG', '72o')).toBe(false);
    expect(has('open_BTN', 'K5s')).toBe(true);
    // Calling ranges leave out the hands that would have 3-bet.
    expect(has('callOpen', 'AA')).toBe(false);
    expect(has('bbDefend', 'AA')).toBe(false);
  });

  it('applies saved edits over the defaults', () => {
    const r = buildRanges(eq, { open_UTG: ['AA', 'KK'] });
    expect(rangeShare(r.open_UTG)).toBeCloseTo(12 / 1326, 10);
  });
});

describe('preflopRangeKey', () => {
  const hand = parseAll(SAMPLE)[1]; // UTG opens to 2bb, Hero calls in the big blind

  it('reads opens and big blind defends', () => {
    expect(preflopRangeKey(hand, '6c92fa0e')).toBe('open_UTG');
    expect(preflopRangeKey(hand, 'Hero')).toBe('bbDefend');
  });
});

describe('postflop narrowing', () => {
  it('keeps strong hands and cuts air after a big bet', () => {
    expect(ACTION_WEIGHTS.bigBet.strong).toBe(1);
    expect(ACTION_WEIGHTS.bigBet.nothing).toBe(0.25);
  });

  it('down-weights hands by category after villain bets big on the river', () => {
    // Made-up player IDs. UTG opens, Hero calls in the big blind, villain bets 250% of the pot on the river.
    const hand = parseHand(`CoinPoker Hand #900000000070: NLH (100/200/0) 2026/09/12 20:00:00 AEST
Tournament 'Test Regular' '50040' 3-max Seat #1 is the button
Seat 1: e0e00001 (10,000 in chips)
Seat 2: e0e00002 (10,000 in chips)
Seat 3: Hero (10,000 in chips)
e0e00002: posts small blind 100
Hero: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [9c 8d]
e0e00001: raises 300 to 500
e0e00002: folds
Hero: calls 300
*** FLOP *** [Kh 7s 2c]
Hero: checks
e0e00001: checks
*** TURN *** [Kh 7s 2c] [4d]
Hero: checks
e0e00001: checks
*** RIVER *** [Kh 7s 2c 4d] [Jc]
Hero: checks
e0e00001: bets 2,500
Hero: calls 2,500`);
    const board = ['Kh', '7s', '2c', '4d', 'Jc'];
    const { key, combos } = villainCombos(hand, 'e0e00001', ranges, 'river', 3, [...board, '9c', '8d']);
    expect(key).toBe('open_BTN');
    const kk = combos.find(c => c.cards.join('') === 'KsKd');
    const air = combos.find(c => c.cards.join('') === 'As5s');
    // KK checked flop and turn (0.5 × 0.5) then bet big (× 1): 0.25. A5s: nothing all the way: 1 × 1 × 0.25.
    expect(kk.w).toBeCloseTo(0.25, 10);
    expect(air.w).toBeCloseTo(0.25, 10);
    const r = callEquities(hand, ranges);
    expect(r).toHaveLength(2); // preflop call and river call
    expect(r[1]).toMatchObject({ street: 'river', villain: 'e0e00001', rangeKey: 'open_BTN' });
    expect(r[1].equity).toBeLessThan(0.3); // 9-high against a big river bet
    expect(r[1].need).toBeCloseTo(2500 / (1100 + 2500 + 2500), 10); // pot 1,100: SB 100 + 500 each
  });
});

describe('equityVsCombos', () => {
  it('is exact on the river: the nuts wins every time, a chop splits', () => {
    const board = ['Ah', 'Kh', 'Qh', 'Jh', '2c'];
    expect(equityVsCombos(['Th', '3d'], board, [{ cards: ['9s', '9c'], w: 1 }])).toBe(1);
    expect(equityVsCombos(['3d', '4d'], ['Ah', 'Kh', 'Qh', 'Jh', 'Th'], [{ cards: ['9s', '9c'], w: 1 }])).toBe(0.5);
  });

  it('gives sensible preflop numbers against a UTG open', () => {
    const aa = equityVsCombos(['Ah', 'As'], [], combosOf(ranges.open_UTG, ['Ah', 'As']));
    expect(aa).toBeGreaterThan(0.8);
    expect(aa).toBeLessThan(0.89);
    expect(equityVsCombos(['7d', '2c'], [], combosOf(ranges.open_UTG, ['7d', '2c']))).toBeLessThan(0.3);
  });
});

describe('createRangeStore', () => {
  it('saves and resets edits through storage', () => {
    const data = {};
    const storage = { getItem: k => data[k] ?? null, setItem: (k, v) => (data[k] = v) };
    const s = createRangeStore(storage);
    s.set('open_UTG', ['AA']);
    expect(createRangeStore(storage).load()).toEqual({ open_UTG: ['AA'] });
    s.reset('open_UTG');
    expect(s.load()).toEqual({});
  });
});

describe('range views', () => {
  it('averages combo weights per cell for the heat map', async () => {
    const { cellWeights } = await import('../src/engine/rangeModel.js');
    const w = cellWeights([
      { cards: ['As', 'Ah'], w: 1 },
      { cards: ['Ad', 'Ac'], w: 0.5 },
      { cards: ['Ks', 'Qs'], w: 0.25 },
    ]);
    expect(w[ALL_CELLS.indexOf('AA')]).toBeCloseTo(0.75, 10);
    expect(w[ALL_CELLS.indexOf('KQs')]).toBeCloseTo(0.25, 10);
    expect(w[ALL_CELLS.indexOf('KQo')]).toBe(0);
  });

  it('measures how much of the model a painted range covers', async () => {
    const { compareWithModel } = await import('../src/engine/rangeModel.js');
    const combos = [
      { cards: ['As', 'Ah'], w: 1 },
      { cards: ['Ks', 'Qs'], w: 3 },
    ];
    const r = compareWithModel(new Set(['AA']), combos);
    expect(r.coverage).toBeCloseTo(0.25, 10);
    expect(r.modelShare).toBeCloseTo(4 / 1326, 10);
  });

  it('picks the last bettor as the villain to show', async () => {
    const { mainVillain } = await import('../src/engine/rangeModel.js');
    const hand = parseAll(SAMPLE)[1];
    expect(mainVillain(hand, 'preflop')).toBe('6c92fa0e');
    expect(mainVillain(hand, 'river')).toBe('6c92fa0e'); // still in after calling the river
  });
});
