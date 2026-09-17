import { describe, it, expect } from 'vitest';
import { classifyFormat } from '../src/engine/format.js';

describe('classifyFormat', () => {
  it('classifies plain tournament names as regular', () => {
    expect(classifyFormat('GOPC-L: ₮2.20 Midnight Grand Prix')).toBe('regular');
  });

  it('classifies turbo and hyper tournaments', () => {
    expect(classifyFormat('Sunday Turbo 22')).toBe('turbo');
    expect(classifyFormat('GOPC-M: ₮11 Tuesday Sprint Asia [Hyper]')).toBe('hyper');
  });

  it('classifies satellites, steps, and seat-qualifier names', () => {
    expect(classifyFormat('Step [2] to ₮55 GOLD TOUR - DOHA')).toBe('satellite');
    expect(classifyFormat('8 Seats to ₮22 Mini CoinMasters Asia')).toBe('satellite');
    expect(classifyFormat('Sunday Qualifier')).toBe('satellite');
  });

  it('matches turbo/hyper inside a compound word with no boundary (regression)', () => {
    // \bturbo\b / \bhyper\b previously missed compound names like "TurboCharger" or
    // "Hyperturbo" because there's no word boundary between the word and what follows
    // it, and it silently fell through to "regular".
    expect(classifyFormat('Friday TurboCharger 6-Max')).toBe('turbo');
    expect(classifyFormat('Hyperturbo Knockout')).toBe('hyper');
  });

  it('checks hyper before turbo when a name could match both', () => {
    expect(classifyFormat('Nightly Hyper Turbo')).toBe('hyper');
  });

  it('falls back to regular for an unrecognized or missing name', () => {
    expect(classifyFormat('')).toBe('regular');
    expect(classifyFormat(undefined)).toBe('regular');
  });
});
