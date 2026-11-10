// ---------- Range model: what villain probably holds ----------
// An estimate, not a solver. Built from three parts:
// 1. Default preflop charts: a percentage of the best hands for each spot (e.g. a UTG open is the
//    best 14%), editable by the player. "Best" is equity against a random hand from the
//    precomputed table, adjusted: suited and connected hands get a small bonus (they play better
//    after the flop than raw equity suggests) and pairs a small penalty (raw equity overrates
//    small and middle pairs against A-K and broadways).
// 2. Villain's preflop range in a hand comes from their last voluntary preflop action: open,
//    limp, call an open, 3-bet, call a 3-bet, 4-bet, or check the big blind.
// 3. After the flop, every villain action re-weights each possible holding by its hand category
//    (strong, top pair, weaker pair, draw, nothing): big bets keep strong hands, draws and some
//    bluffs; calls keep pairs and draws; checks make the strongest hands less likely.
// Equity against the range is then estimated by random sampling (Monte Carlo).
// Weights and percentages are recorded in docs/ROADMAP.md section 9.

import { ALL_CELLS, cellName, combosForCell } from './rangeGrid.js';
import { postflopCategory } from './handCategories.js';
import { computeHandPositions } from './positions.js';
import { eval7, seededRandom } from './equity.js';
import { parseCard } from './cards.js';

const WEIGHTS = ALL_CELLS.map(c => combosForCell(c).length);
const RANKS = 'AKQJT98765432';

// Default sizes, as % of all 1,326 starting hands.
export const RANGE_SPECS = [
  { key: 'open_UTG', label: 'Open: UTG', pct: 14 },
  { key: 'open_UTG+1', label: 'Open: UTG+1', pct: 16 },
  { key: 'open_UTG+2', label: 'Open: UTG+2', pct: 18 },
  { key: 'open_MP', label: 'Open: MP', pct: 20 },
  { key: 'open_MP+1', label: 'Open: MP+1', pct: 22 },
  { key: 'open_HJ', label: 'Open: HJ', pct: 25 },
  { key: 'open_CO', label: 'Open: CO', pct: 30 },
  { key: 'open_BTN', label: 'Open: BTN', pct: 45 },
  { key: 'open_SB', label: 'Open: SB', pct: 40 },
  { key: 'limp', label: 'Limp', pct: 50, excludeTop: 10 },
  { key: 'callOpen', label: 'Call an open', pct: 21, excludeTop: 7 },
  { key: 'bbDefend', label: 'Big blind call vs an open', pct: 45, excludeTop: 7 },
  { key: 'threeBet', label: '3-bet', pct: 7 },
  { key: 'callThreeBet', label: 'Call a 3-bet', pct: 12, excludeTop: 3 },
  { key: 'fourBet', label: '4-bet', pct: 3 },
  { key: 'bbCheck', label: 'Big blind check (no raise)', pct: 100, excludeTop: 10 },
];

// Strength order of the 169 cells, strongest first.
export function strengthOrder(eq) {
  const score = ALL_CELLS.map((cell, i) => {
    let s = 0;
    let w = 0;
    for (let j = 0; j < 169; j++) {
      s += WEIGHTS[j] * eq(i, j);
      w += WEIGHTS[j];
    }
    const vsRandom = s / w;
    const [a, b, kind] = cell;
    const gap = Math.abs(RANKS.indexOf(a) - RANKS.indexOf(b));
    const bonus = (a === b ? -0.02 : 0) + (kind === 's' ? 0.025 : 0) + (a !== b && gap <= 1 ? 0.015 : 0);
    return { i, s: vsRandom + bonus };
  });
  return score.sort((x, y) => y.s - x.s).map(x => x.i);
}

// Cells making up the top `pct`% of combos (by the strength order), minus the top `excludeTop`%.
export function topRange(order, pct, excludeTop = 0) {
  const range = new Float64Array(169);
  let combos = 0;
  for (const i of order) {
    const before = combos;
    combos += WEIGHTS[i];
    if ((100 * before) / 1326 >= pct) break;
    if ((100 * combos) / 1326 > excludeTop + 0.0001) range[i] = 1;
  }
  return range;
}

export function rangeShare(range) {
  let w = 0;
  for (let i = 0; i < 169; i++) w += WEIGHTS[i] * range[i];
  return w / 1326;
}

// Default ranges, with the player's overrides ({ key: [cell names] }) on top.
export function buildRanges(eq, overrides = {}) {
  const order = strengthOrder(eq);
  const ranges = {};
  RANGE_SPECS.forEach(spec => {
    if (Array.isArray(overrides[spec.key])) {
      const r = new Float64Array(169);
      overrides[spec.key].forEach(name => {
        const i = ALL_CELLS.indexOf(name);
        if (i !== -1) r[i] = 1;
      });
      ranges[spec.key] = r;
    } else {
      ranges[spec.key] = topRange(order, spec.pct, spec.excludeTop || 0);
    }
  });
  return ranges;
}

// Which preflop range a player's action puts them in. Returns a range key.
export function preflopRangeKey(hand, player, uptoIndex = Infinity) {
  const acts = hand.streets.preflop;
  const position = computeHandPositions(hand).get(player);
  let key = null;
  let raises = 0;
  acts.forEach((a, i) => {
    if (i >= uptoIndex || a.action === 'post' || a.action === 'fold') return;
    if (a.player === player) {
      if (a.action === 'raise') {
        if (raises === 0) key = 'open_' + position in OPEN_KEYS ? 'open_' + position : 'open_CO';
        else if (raises === 1) key = 'threeBet';
        else key = 'fourBet';
      } else if (a.action === 'call') {
        if (raises === 0) key = 'limp';
        else if (raises === 1) key = position === 'BB' ? 'bbDefend' : 'callOpen';
        else key = 'callThreeBet';
      } else if (a.action === 'check' && raises === 0) {
        key = 'bbCheck';
      }
    }
    if (a.action === 'raise') raises++;
  });
  return key;
}

const OPEN_KEYS = Object.fromEntries(RANGE_SPECS.filter(s => s.key.startsWith('open_')).map(s => [s.key, true]));

// How much each action keeps of each hand category (1 = keeps all, 0.2 = keeps a fifth).
export const ACTION_WEIGHTS = {
  bigBet: { strong: 1, topPair: 0.7, weakPair: 0.2, draw: 0.6, nothing: 0.25 },
  smallBet: { strong: 1, topPair: 0.9, weakPair: 0.5, draw: 0.6, nothing: 0.4 },
  raise: { strong: 1, topPair: 0.5, weakPair: 0.1, draw: 0.5, nothing: 0.2 },
  call: { strong: 0.6, topPair: 1, weakPair: 0.8, draw: 1, nothing: 0.15 },
  check: { strong: 0.5, topPair: 0.8, weakPair: 1, draw: 0.9, nothing: 1 },
};

function actionKind(a) {
  if (a.action === 'raise') return 'raise';
  if (a.action === 'bet') return a.potBefore > 0 && a.amount / a.potBefore >= 0.6 ? 'bigBet' : 'smallBet';
  if (a.action === 'call') return 'call';
  if (a.action === 'check') return 'check';
  return null;
}

function boardThrough(hand, street) {
  if (street === 'flop') return hand.board.flop;
  if (street === 'turn') return [...hand.board.flop, hand.board.turn];
  return [...hand.board.flop, hand.board.turn, hand.board.river];
}

// Villain's estimated holdings at a point in the hand, as weighted specific combos:
// [{ cards: ['Ah', 'Kd'], w }]. Stops just before action `index` on `street`.
// `dead` are cards villain can't hold (the board and Hero's cards).
export function villainCombos(hand, villain, ranges, street, index, dead) {
  const deadSet = new Set(dead);
  const preIndex = street === 'preflop' ? index : Infinity;
  const key = preflopRangeKey(hand, villain, preIndex);
  const range = key ? ranges[key] : new Float64Array(169).fill(1);
  let combos = [];
  for (let i = 0; i < 169; i++) {
    if (!range[i]) continue;
    combosForCell(ALL_CELLS[i]).forEach(c => {
      if (!deadSet.has(c[0]) && !deadSet.has(c[1])) combos.push({ cards: c, w: range[i] });
    });
  }
  const streets = ['flop', 'turn', 'river'];
  for (const st of streets) {
    if (street === 'preflop') break;
    const acts = hand.streets[st];
    const upto = st === street ? index : acts.length;
    const board = boardThrough(hand, st);
    if (!board.every(Boolean) || !board.length) break;
    for (let i = 0; i < upto; i++) {
      const a = acts[i];
      if (a.player !== villain) continue;
      const kind = actionKind(a);
      if (!kind) continue;
      const weights = ACTION_WEIGHTS[kind];
      combos = combos.map(c => ({ ...c, w: c.w * weights[postflopCategory(c.cards, board)] }));
    }
    if (st === street) break;
  }
  return { key, combos: combos.filter(c => c.w > 0) };
}

// Hero's equity against weighted villain combos on a board, by sampling `samples` deals
// (exact over villain combos on the river). Seeded, so a hand always gives the same estimate.
export function equityVsCombos(heroCards, board, combos, { samples = 3000, seed = 1 } = {}) {
  if (!combos.length) return null;
  const hero = heroCards.map(parseCard);
  const boardP = board.map(parseCard);
  const total = combos.reduce((t, c) => t + c.w, 0);
  if (board.length === 5) {
    const hv = eval7([...hero, ...boardP]);
    let win = 0;
    combos.forEach(c => {
      const vv = eval7([...c.cards.map(parseCard), ...boardP]);
      win += c.w * (hv > vv ? 1 : hv === vv ? 0.5 : 0);
    });
    return win / total;
  }
  const rand = seededRandom(seed);
  const cum = [];
  let acc = 0;
  combos.forEach(c => cum.push((acc += c.w)));
  const deck = [];
  for (const r of '23456789TJQKA') for (const s of 'shdc') deck.push(r + s);
  const known = new Set([...heroCards, ...board]);
  let win = 0;
  for (let n = 0; n < samples; n++) {
    const x = rand() * acc;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    const v = combos[lo].cards;
    const used = new Set([...known, ...v]);
    const extra = [];
    while (extra.length < 5 - board.length) {
      const c = deck[Math.floor(rand() * 52)];
      if (!used.has(c)) {
        used.add(c);
        extra.push(c);
      }
    }
    const full = [...boardP, ...extra.map(parseCard)];
    const hv = eval7([...hero, ...full]);
    const vv = eval7([...v.map(parseCard), ...full]);
    win += hv > vv ? 1 : hv === vv ? 0.5 : 0;
  }
  return win / samples;
}

// Hero's estimated equity at each Hero call, against the player whose bet or raise was called.
// Returns [{ street, index, villain, need, equity, rangeKey, combos }].
export function callEquities(hand, ranges, { samples = 3000 } = {}) {
  if (!hand.heroCards) return [];
  const out = [];
  ['preflop', 'flop', 'turn', 'river'].forEach(street => {
    const acts = hand.streets[street];
    acts.forEach((a, index) => {
      if (a.player !== 'Hero' || a.action !== 'call') return;
      const aggressor = [...acts.slice(0, index)]
        .reverse()
        .find(x => x.player !== 'Hero' && (x.action === 'raise' || x.action === 'bet'));
      if (!aggressor) return; // a limp: no bet to measure against
      const board = street === 'preflop' ? [] : boardThrough(hand, street);
      const { key, combos } = villainCombos(hand, aggressor.player, ranges, street, index, [
        ...board,
        ...hand.heroCards,
      ]);
      const equity = equityVsCombos(hand.heroCards, board, combos, { samples, seed: index + 7 * street.length });
      out.push({
        street,
        index,
        villain: aggressor.player,
        need: a.amount / (a.potBefore + a.amount),
        equity,
        rangeKey: key,
        combos: combos.length,
      });
    });
  });
  return out;
}

// Saved range edits: { rangeKey: [cell names] }. Storage passed in, memory fallback.
const KEY = 'rangeModel.v1';

export function createRangeStore(storage) {
  let memory = {};
  const load = () => {
    if (!storage) return memory;
    try {
      const v = JSON.parse(storage.getItem(KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      return memory;
    }
  };
  const save = v => {
    memory = v;
    if (!storage) return;
    try {
      storage.setItem(KEY, JSON.stringify(v));
    } catch {
      // keep the in-memory copy
    }
  };
  return {
    load,
    set(key, cells) {
      save({ ...load(), [key]: cells });
    },
    reset(key) {
      const v = load();
      delete v[key];
      save(v);
    },
  };
}

export { cellName };
