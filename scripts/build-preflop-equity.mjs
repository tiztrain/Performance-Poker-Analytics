// Builds src/engine/preflopEquity.json: how often each of the 169 starting hands beats each other
// one when all-in preflop. Run once with `node scripts/build-preflop-equity.mjs` (a few minutes);
// the app only reads the result. Each matchup is estimated from random boards (Monte Carlo:
// estimating by random sampling), with random suits for both hands each time, so card removal
// between the two hands is included. Seeded, so re-running gives the same file.
//
// Output: { samples, cells: [169 names], eq: [upper triangle incl. diagonal, row by row] }, where
// eq is hero's equity in thousandths (0-1000) for cell i vs cell j (i <= j). eq for j vs i is
// 1000 minus it.

import { writeFileSync } from 'node:fs';
import { ALL_CELLS, combosForCell } from '../src/engine/rangeGrid.js';
import { eval7, seededRandom } from '../src/engine/equity.js';
import { parseCard } from '../src/engine/cards.js';

const SAMPLES = Number(process.argv[2] || 20000);
const rand = seededRandom(20261109);
const DECK = [];
for (const r of '23456789TJQKA') for (const s of 'shdc') DECK.push(r + s);
const parsed = Object.fromEntries(DECK.map(c => [c, parseCard(c)]));
const combos = Object.fromEntries(ALL_CELLS.map(c => [c, combosForCell(c)]));

function equity(a, b) {
  let wins = 0;
  let n = 0;
  while (n < SAMPLES) {
    const ha = combos[a][Math.floor(rand() * combos[a].length)];
    const hb = combos[b][Math.floor(rand() * combos[b].length)];
    if (ha.includes(hb[0]) || ha.includes(hb[1])) continue; // the two hands share a card
    const dead = new Set([...ha, ...hb]);
    const board = [];
    while (board.length < 5) {
      const c = DECK[Math.floor(rand() * 52)];
      if (!dead.has(c)) {
        dead.add(c);
        board.push(c);
      }
    }
    const bp = board.map(c => parsed[c]);
    const va = eval7([parsed[ha[0]], parsed[ha[1]], ...bp]);
    const vb = eval7([parsed[hb[0]], parsed[hb[1]], ...bp]);
    wins += va > vb ? 1 : va === vb ? 0.5 : 0;
    n++;
  }
  return Math.round((1000 * wins) / n);
}

const eq = [];
const t0 = Date.now();
for (let i = 0; i < 169; i++) {
  for (let j = i; j < 169; j++) eq.push(equity(ALL_CELLS[i], ALL_CELLS[j]));
  if (i % 20 === 0) console.log(`row ${i}/169, ${Math.round((Date.now() - t0) / 1000)}s`);
}
writeFileSync(
  new URL('../src/engine/preflopEquity.json', import.meta.url),
  JSON.stringify({ samples: SAMPLES, cells: ALL_CELLS, eq }),
);
console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
