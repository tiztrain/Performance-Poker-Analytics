import { describe, it, expect } from 'vitest';
import table from '../src/engine/preflopEquity.json';
import { equityLookup } from '../src/engine/pushFold.js';
import { createPushFoldChecker } from '../src/engine/pushFoldSpots.js';
import { icmEquities, icmPushFold, parsePayouts, payoutsFor } from '../src/engine/icm.js';
import { parseHand } from '../src/engine/parser.js';

const eq = equityLookup(table);

// Malmuth-Harville by brute force over every finishing order, to check the memoised version.
function bruteForce(stacks, payouts) {
  const out = stacks.map(() => 0);
  function walk(left, prob, place) {
    if (!left.length) return;
    const total = left.reduce((t, i) => t + stacks[i], 0);
    left.forEach(i => {
      const p = prob * (stacks[i] / total);
      out[i] += p * (payouts[place] || 0);
      walk(
        left.filter(j => j !== i),
        p,
        place + 1,
      );
    });
  }
  walk(
    stacks.map((_, i) => i),
    1,
    0,
  );
  return out;
}

describe('icmEquities', () => {
  it('splits evenly between equal stacks', () => {
    expect(icmEquities([1000, 1000], [70, 30])).toEqual([50, 50]);
  });

  it('matches the brute-force calculation and shares out the whole prize pool', () => {
    const stacks = [5000, 3000, 2000, 1500, 800];
    const payouts = [50, 30, 20];
    const got = icmEquities(stacks, payouts);
    bruteForce(stacks, payouts).forEach((v, i) => expect(got[i]).toBeCloseTo(v, 9));
    expect(got.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    // The chip leader's prize share is less than their chip share: chips are worth less as you gain them.
    expect(got[0] / 100).toBeLessThan(5000 / 12300);
  });

  it('gives busted players the bottom prizes', () => {
    expect(icmEquities([100, 0], [70, 30])).toEqual([70, 30]);
    expect(icmEquities([100, 0, 0], [60, 30, 10])).toEqual([60, 20, 20]);
  });

  it('is proportional to chips when the winner takes all', () => {
    const got = icmEquities([600, 300, 100], [100]);
    expect(got[0]).toBeCloseTo(60, 9);
    expect(got[2]).toBeCloseTo(10, 9);
  });
});

describe('parsePayouts', () => {
  it('reads place-and-prize lines with a currency', () => {
    expect(parsePayouts('Place\tPrize\n1st\t₮1,250.00\n2nd\t₮750.00\n3rd\t₮500.00')).toEqual({
      places: [1250, 750, 500],
      unit: '₮',
      error: null,
    });
  });

  it('expands place ranges and accepts percentages or bare amounts', () => {
    expect(parsePayouts('1 40\n2 25\n3 15\n4-6 6.67').places).toEqual([40, 25, 15, 6.67, 6.67, 6.67]);
    expect(parsePayouts('4th - 6th: 10').error).toMatch(/place numbers/); // doesn't start at 1st
    expect(parsePayouts('1. 50%\n2. 30%\n3. 20%')).toMatchObject({ places: [50, 30, 20], unit: '%' });
    expect(parsePayouts('100\n60\n40').places).toEqual([100, 60, 40]);
  });

  it('rejects text that isn’t a payout table', () => {
    expect(parsePayouts('no numbers here').error).toBeTruthy();
    expect(parsePayouts('1 10\n2 50').error).toMatch(/go down/);
  });

  it('finds payouts for a tournament, or for any tournament with its name', () => {
    const saved = { 'Nightly::7': { places: [1] }, 'name:Daily': { places: [2] } };
    expect(payoutsFor(saved, { key: 'Nightly::7', name: 'Nightly' }).places).toEqual([1]);
    expect(payoutsFor(saved, { key: 'Daily::9', name: 'Daily' }).places).toEqual([2]);
    expect(payoutsFor(saved, { key: 'Other::1', name: 'Other' })).toBeNull();
  });
});

// Made-up player IDs. Blinds 500/1,000, no ante. Three players; Hero has 8bb in the small blind.
const SPOT = `CoinPoker Hand #900000000040: NLH (500/1,000/0) 2026/09/10 20:00:00 AEST
Tournament 'Test Regular' '50010' 6-max Seat #1 is the button
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

describe('icmPushFold', () => {
  const check = createPushFoldChecker(eq, { iterations: 200 });

  it('needs more equity to call under ICM than for chips, and none extra when the winner takes all', () => {
    const text = SPOT.replace('f00f0001: folds\nHero: folds', 'f00f0001: ALLIN 30,000\nHero: folds').replace(
      'Kd 9c',
      'Ah Tc',
    );
    const r = check(parseHand(text));
    // Chip pot odds: call 7,500 more to win a pot of 8,000 + 8,000 + 1,000 = 17,000 → 7,500 / 17,000.
    const chipsNeed = 7500 / 17000;
    const wta = icmPushFold(r, eq, [100]);
    expect(wta.needed).toBeCloseTo(chipsNeed, 6);
    const topHeavy = icmPushFold(r, eq, [50, 30, 20]);
    expect(topHeavy.needed).toBeGreaterThan(chipsNeed);
    expect(topHeavy.heroEquity).toBeGreaterThan(0.3);
  });

  it('values a shove spot and reports whether ICM agrees with the chip chart', () => {
    const r = check(parseHand(SPOT));
    const res = icmPushFold(r, eq, [50, 30, 20]);
    expect(['shove', 'fold']).toContain(res.icmAct);
    expect(res.callers).toHaveLength(1);
    expect(res.diff).toBeCloseTo(res.actValue - res.foldValue, 12);
    expect(res.cost).toBe(r.did === res.icmAct ? 0 : Math.abs(res.diff));
    // Every value is a share of the 100 prize pool.
    expect(res.actValue).toBeGreaterThan(0);
    expect(res.actValue).toBeLessThan(100);
  });
});
