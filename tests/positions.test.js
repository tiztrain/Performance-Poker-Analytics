import { describe, it, expect } from 'vitest';
import { positionLabelsForSize, computeHandPositions } from '../src/engine/positions.js';

describe('positionLabelsForSize', () => {
  it('returns the standard label set for common table sizes', () => {
    expect(positionLabelsForSize(2)).toEqual(['BB', 'BTN']);
    expect(positionLabelsForSize(6)).toEqual(['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN']);
    expect(positionLabelsForSize(9)).toEqual(['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO', 'BTN']);
  });

  it('pads beyond 10-max with extra UTG+k seats instead of guessing new names', () => {
    const labels = positionLabelsForSize(12);
    expect(labels).toHaveLength(12);
    expect(labels[labels.length - 1]).toBe('BTN');
    expect(labels.filter(l => l.startsWith('UTG')).length).toBeGreaterThanOrEqual(5);
  });
});

describe('computeHandPositions', () => {
  function hand(seats, buttonSeat) {
    return { seats: seats.map(([num, name]) => ({ num, name })), buttonSeat };
  }

  it('assigns BTN to the seat with the button, wrapping from there', () => {
    const h = hand(
      [
        [1, 'A'],
        [2, 'B'],
        [3, 'C'],
        [4, 'D'],
        [5, 'E'],
        [6, 'F'],
        [7, 'G'],
      ],
      7,
    );
    const positions = computeHandPositions(h);
    expect(positions.get('G')).toBe('BTN');
    expect(positions.get('A')).toBe('SB');
    expect(positions.get('B')).toBe('BB');
    expect(positions.get('C')).toBe('UTG');
    expect(positions.get('D')).toBe('UTG+1');
    expect(positions.get('E')).toBe('HJ');
    expect(positions.get('F')).toBe('CO');
  });

  it('is robust to players having busted (a shrunk, non-contiguous seat list)', () => {
    // Only seats 1, 3, 6 remain seated - positions should still be computed relative
    // to however many players are ACTUALLY in the hand, not the table's max size.
    const h = hand(
      [
        [1, 'A'],
        [3, 'C'],
        [6, 'F'],
      ],
      3,
    );
    const positions = computeHandPositions(h);
    expect(positions.size).toBe(3);
    expect(positions.get('C')).toBe('BTN');
    expect(positions.get('F')).toBe('SB');
    expect(positions.get('A')).toBe('BB');
  });

  it('returns an empty map when there is no seat data or button', () => {
    expect(computeHandPositions({ seats: [], buttonSeat: null }).size).toBe(0);
    expect(computeHandPositions({ seats: [{ num: 1, name: 'A' }], buttonSeat: null }).size).toBe(0);
  });
});
