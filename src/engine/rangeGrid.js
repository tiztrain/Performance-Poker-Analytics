// ---------- 13×13 starting-hand grid ----------
// The standard way to write a range: one cell per starting hand, with aces top-left.
// - The diagonal holds pairs (AA, KK ... 22): 6 combos each (combos are the specific card
//   combinations, e.g. A♠A♥ is one of the 6 ways to hold AA).
// - Above the diagonal are suited hands (AKs): 4 combos each.
// - Below the diagonal are offsuit hands (AKo): 12 combos each.
// 13×13 = 169 cells, 1,326 combos in total.

export const GRID_RANKS = 'AKQJT98765432';
const SUITS = ['s', 'h', 'd', 'c'];

// Cell name for row r, column c (0 = ace).
export function cellName(r, c) {
  const hi = GRID_RANKS[Math.min(r, c)];
  const lo = GRID_RANKS[Math.max(r, c)];
  if (r === c) return hi + lo;
  return hi + lo + (r < c ? 's' : 'o');
}

export const ALL_CELLS = [];
for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) ALL_CELLS.push(cellName(r, c));

// Every specific combo in a cell, as two-card strings like ['As', 'Kh'].
export function combosForCell(cell) {
  const [a, b, kind] = cell;
  const combos = [];
  if (a === b) {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) combos.push([a + SUITS[i], a + SUITS[j]]);
  } else if (kind === 's') {
    SUITS.forEach(s => combos.push([a + s, b + s]));
  } else {
    SUITS.forEach(s1 => SUITS.forEach(s2 => s1 !== s2 && combos.push([a + s1, b + s2])));
  }
  return combos;
}

// The cell a known hand belongs to: ['Ah', '4h'] -> 'A4s'.
export function cellForHand(cards) {
  const [x, y] = cards.map(c => c[0].toUpperCase());
  const [s1, s2] = cards.map(c => c[1].toLowerCase());
  if (x === y) return x + y;
  const [hi, lo] = GRID_RANKS.indexOf(x) < GRID_RANKS.indexOf(y) ? [x, y] : [y, x];
  return hi + lo + (s1 === s2 ? 's' : 'o');
}

// Combos still possible for villain: none of the cards are on the board or in Hero's hand.
export function liveCombos(cell, deadCards) {
  const dead = new Set(deadCards.map(c => c[0].toUpperCase() + c[1].toLowerCase()));
  return combosForCell(cell).filter(([x, y]) => !dead.has(x) && !dead.has(y));
}

export function countLive(cells, deadCards) {
  let n = 0;
  cells.forEach(cell => {
    n += liveCombos(cell, deadCards).length;
  });
  return n;
}

// Tightness-curve score agreed with the owner: 0 if villain's hand isn't in the range,
// otherwise 100 × (1 − √share), where share is the painted fraction of all live combos.
// Painting 3% scores about 83, 10% about 68, 25% 50, 50% about 29, everything 0.
export function scoreRange(cells, villainCards, deadCards) {
  const painted = countLive(cells, deadCards);
  const total = countLive(ALL_CELLS, deadCards);
  const share = total ? painted / total : 0;
  const villainCell = cellForHand(villainCards);
  const hit = cells.has(villainCell);
  const points = hit ? Math.round(100 * (1 - Math.sqrt(share))) : 0;
  return { points, hit, share, painted, total, villainCell };
}
