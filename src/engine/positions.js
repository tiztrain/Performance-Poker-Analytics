export function isHyperName(name) {
  return /\[hyper\]/i.test(name || '');
}

// ---------- Table position (UTG/HJ/CO/BTN/SB/BB) ----------
// Standard tracker-style labels by number of players ACTUALLY seated in a given hand
// (a table can lose players to elimination mid-tournament, so this is per-hand, not
// per-maxSeats), listed starting from the seat right after the button and wrapping
// around to the button itself last: [..., BTN].
export const POSITION_LABELS_BY_SIZE = {
  1: ['BTN'],
  2: ['BB', 'BTN'],
  3: ['SB', 'BB', 'BTN'],
  4: ['SB', 'BB', 'CO', 'BTN'],
  5: ['SB', 'BB', 'UTG', 'CO', 'BTN'],
  6: ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'],
  7: ['SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'CO', 'BTN'],
  8: ['SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN'],
  9: ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO', 'BTN'],
  10: ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'MP+1', 'HJ', 'CO', 'BTN'],
};
export function positionLabelsForSize(n) {
  if (POSITION_LABELS_BY_SIZE[n]) return POSITION_LABELS_BY_SIZE[n];
  // Beyond 10-max (rare): pad extra early seats as further UTG+k rather than guessing new names.
  const base = POSITION_LABELS_BY_SIZE[10].slice();
  let k = 3;
  while (base.length < n) {
    base.splice(2, 0, 'UTG+' + k);
    k++;
  }
  return base;
}
// Returns a Map<playerName, positionLabel> for the players actually seated in this hand.
export function computeHandPositions(hand) {
  const positions = new Map();
  if (!hand.seats.length || hand.buttonSeat === null) return positions;
  const sorted = hand.seats.slice().sort((a, b) => a.num - b.num);
  const n = sorted.length;
  const btnIdx = sorted.findIndex(s => s.num === hand.buttonSeat);
  if (btnIdx === -1) return positions;
  const labels = positionLabelsForSize(n);
  for (let i = 0; i < n; i++) {
    const seat = sorted[(btnIdx + 1 + i) % n];
    positions.set(seat.name, labels[i]);
  }
  return positions;
}
