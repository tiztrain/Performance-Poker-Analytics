import { describe, it, expect } from 'vitest';
import { parseCard, evaluate5, compareEval, bestHand } from '../src/engine/cards.js';

describe('parseCard', () => {
  it('parses rank and suit, case-insensitively', () => {
    expect(parseCard('Ah')).toEqual({ rank: 14, suit: 'h', raw: 'Ah' });
    expect(parseCard('tS')).toEqual({ rank: 10, suit: 's', raw: 'Ts' });
  });
});

describe('evaluate5', () => {
  const c = s => s.split(' ').map(parseCard);

  it('recognizes a flush', () => {
    expect(evaluate5(c('2h 5h 9h Jh Kh')).name).toBe('Flush');
  });

  it('recognizes a straight, including the wheel (A-2-3-4-5)', () => {
    expect(evaluate5(c('5h 4d 3c 2s Ah')).name).toBe('Straight');
    expect(evaluate5(c('9h 8d 7c 6s 5h')).name).toBe('Straight');
  });

  it('recognizes a straight flush over a plain flush', () => {
    expect(evaluate5(c('5h 4h 3h 2h Ah')).name).toBe('Straight Flush');
  });

  it('recognizes trips, two pair, and a full house', () => {
    expect(evaluate5(c('9h 9d 9c 2s Kh')).name).toBe('Trips');
    expect(evaluate5(c('9h 9d 3c 3s Kh')).name).toBe('Two Pair');
    expect(evaluate5(c('9h 9d 9c 3s 3h')).name).toBe('Full House');
  });
});

describe('compareEval', () => {
  it('ranks a higher category above a lower one regardless of tiebreak', () => {
    const pair = evaluate5('2h 2d 5c 9s Kh'.split(' ').map(parseCard));
    const trips = evaluate5('3h 3d 3c 4s 5h'.split(' ').map(parseCard));
    expect(compareEval(trips, pair)).toBeGreaterThan(0);
  });
});

describe('bestHand', () => {
  it('picks the best 5-card hand out of 7 cards', () => {
    // Hole: Ah Ad, board: Ac Kc Kh 2s 3d -> full house, aces full of kings.
    const ev = bestHand(['Ah', 'Ad'], ['Ac', 'Kc', 'Kh', '2s', '3d']);
    expect(ev.name).toBe('Full House');
    expect(ev.tiebreak).toEqual([14, 13]);
  });
});
