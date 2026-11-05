import { describe, it, expect } from 'vitest';
import { parseAll } from '../src/engine/parser.js';
import { SAMPLE } from '../src/sample-hand.js';

describe('parseAll (SAMPLE fixture)', () => {
  const hands = parseAll(SAMPLE);

  it('parses every hand in the sample', () => {
    expect(hands).toHaveLength(4);
  });

  it('reads hand id, blinds, and timestamp correctly', () => {
    const h = hands[0];
    expect(h.id).toBe('162993700001');
    expect(h.sb).toBe(250);
    expect(h.bb).toBe(500);
    expect(h.ante).toBe(75);
    expect(h.dateStr).toBe('2026/09/08');
    expect(h.timeStr).toBe('10:05:11');
  });

  it('captures the tournament name and id separately', () => {
    expect(hands[0].tourney).toBe('GOPC-L: ₮2.20 Midnight Grand Prix');
    expect(hands[0].tourneyId).toBe('96300');
  });

  it('parses Hero hole cards', () => {
    expect(hands[0].heroCards).toEqual(['Ah', '7d']);
    expect(hands[1].heroCards).toEqual(['Qs', '8c']);
  });

  it('computes hero net chips/bb from collections minus invested', () => {
    // Hand 1: Hero folds preflop after posting a 75 ante and a 500 big blind is NOT
    // paid by Hero here (bf52802a/a2b81c63 are SB/BB) - Hero only posts the ante and
    // folds to no further action, so the only investment is the ante.
    const h1 = hands[0];
    expect(h1.heroInvested).toBe(75);
    expect(h1.heroNetChips).toBe(-75);
  });

  it('detects a real showdown only when 2+ players never folded', () => {
    // Hand 2 goes to river and showdown between Hero and 6c92fa0e - a real showdown.
    expect(hands[1].reachedShowdown).toBe(true);
    // Hand 1 is everyone folding to the big blind - no real showdown despite the
    // "*** SHOWDOWN ***" marker CoinPoker still prints for uncontested pots.
    expect(hands[0].reachedShowdown).toBe(false);
  });

  it('flags heroFoldedOnStreet correctly', () => {
    expect(hands[0].heroFoldedOnStreet).toBe('preflop');
    expect(hands[2].heroFoldedOnStreet).toBe('preflop');
    expect(hands[1].heroFoldedOnStreet).toBe(null);
  });

  it('parses the board across streets', () => {
    const h = hands[1];
    expect(h.board.flop).toEqual(['4s', '7c', '9h']);
    expect(h.board.turn).toBe('5s');
    expect(h.board.river).toBe('6c');
  });
});
