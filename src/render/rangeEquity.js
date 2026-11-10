// ---------- Estimated equity on Hero's calls ----------
// When a hand's detail is opened, each Hero call gets "you had ~41% against their estimated
// range" next to the equity it needed. Worked out on demand (not for every hand on load), using
// the range model (engine/rangeModel.js) with the player's saved range edits.

import {
  buildRanges,
  callEquities,
  cellWeights,
  createRangeStore,
  mainVillain,
  villainCombos,
} from '../engine/rangeModel.js';
import { cellName } from '../engine/rangeGrid.js';
import { computeHandPositions } from '../engine/positions.js';
import { anonymizePlayers } from '../engine/handSummary.js';
import { equityLookup } from '../engine/pushFold.js';

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const rangeStore = createRangeStore(browserStorage());
let eqPromise = null;
let rangesCache = null;

export async function equityTable() {
  if (!eqPromise) eqPromise = import('../engine/preflopEquity.json').then(m => equityLookup(m.default));
  return eqPromise;
}

export async function currentRanges() {
  if (!rangesCache) rangesCache = buildRanges(await equityTable(), rangeStore.load());
  return rangesCache;
}

// Call after the player edits a range, so the next estimate uses it.
export function invalidateRanges() {
  rangesCache = null;
}

// Fills the .range-eq placeholders in an opened hand's detail.
export async function fillRangeEquity(detailEl, hand) {
  const slots = detailEl.querySelectorAll('.range-eq[data-street]');
  if (!slots.length || detailEl.dataset.rangeEqDone) return;
  detailEl.dataset.rangeEqDone = '1';
  slots.forEach(s => (s.textContent = '· estimating…'));
  const results = callEquities(hand, await currentRanges());
  slots.forEach(slot => {
    const r = results.find(x => x.street === slot.dataset.street && x.index === Number(slot.dataset.index));
    if (!r || r.equity === null) {
      slot.textContent = '';
      return;
    }
    const pct = Math.round(r.equity * 100);
    slot.textContent = '· you had ~' + pct + '% vs their estimated range';
    slot.classList.add(r.equity >= r.need ? 'good' : 'leak');
    slot.title =
      'Estimate: villain’s range from their actions (' +
      (r.rangeKey || 'any two cards') +
      ', ' +
      r.combos +
      ' possible hands), narrowed by what they did after the flop. Edit the ranges in the Ranges tab.';
  });
}

// ---------- Villain's estimated range as a heat map ----------
// Cell brightness = how much of that hand the model keeps (1 = all of it). Optional outlines mark
// a painted range (gold) and the hand villain actually held (green).
export function rangeHeatmapHtml(weights, { painted = null, actual = null } = {}) {
  let h = '<div class="range-grid heat-grid">';
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const name = cellName(r, c);
      const w = weights[r * 13 + c];
      const style = w > 0 ? ' style="background: rgba(216, 173, 85, ' + (0.12 + 0.88 * w).toFixed(2) + ')"' : '';
      let cls = 'range-cell' + (w > 0.5 ? ' heat-strong' : '');
      if (painted && painted.has(name)) cls += ' heat-painted';
      if (actual === name) cls += ' actual';
      h +=
        '<div class="' + cls + '"' + style + ' title="' + name + ': ' + Math.round(w * 100) + '%">' + name + '</div>';
    }
  }
  return h + '</div>';
}

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const boardThrough = (hand, street) =>
  street === 'preflop'
    ? []
    : street === 'flop'
      ? hand.board.flop
      : street === 'turn'
        ? [...hand.board.flop, hand.board.turn]
        : [...hand.board.flop, hand.board.turn, hand.board.river];

// The model's estimate of the main opponent's range at the end of a street.
export async function villainRangeAt(hand, street, villain = mainVillain(hand, street)) {
  if (!villain) return null;
  const board = boardThrough(hand, street);
  const { key, combos } = villainCombos(hand, villain, await currentRanges(), street, hand.streets[street].length, [
    ...board,
    ...(hand.heroCards || []),
  ]);
  return { villain, key, combos, weights: cellWeights(combos) };
}

// Fills the "Villain's estimated range" block in an opened hand's detail, with a button per street.
export async function fillVillainRange(detailEl, hand) {
  const box = detailEl.querySelector('.villain-range');
  if (!box || box.dataset.done) return;
  box.dataset.done = '1';
  const streets = STREETS.filter(
    st => st === 'preflop' || (boardThrough(hand, st).every(Boolean) && boardThrough(hand, st).length),
  );
  const names = anonymizePlayers(hand);
  const positions = computeHandPositions(hand);
  async function show(street) {
    const r = await villainRangeAt(hand, street);
    const tabs = streets
      .map(
        st =>
          '<button class="filter-btn' + (st === street ? ' active' : '') + '" data-vr="' + st + '">' + st + '</button>',
      )
      .join('');
    if (!r) {
      box.innerHTML =
        '<div class="filter-row">' + tabs + '</div><div class="caveat">No opponent left in the hand.</div>';
    } else {
      const label = names.get(r.villain) + (positions.has(r.villain) ? ' (' + positions.get(r.villain) + ')' : '');
      const shown = hand.shows.find(x => x.player === r.villain && x.cards && x.cards.length === 2);
      const pct = Math.round((r.combos.reduce((t, c) => t + c.w, 0) / 1326) * 1000) / 10;
      box.innerHTML =
        '<div class="filter-row">' +
        tabs +
        '</div>' +
        rangeHeatmapHtml(r.weights, { actual: shown ? cellOfCards(shown.cards) : null }) +
        '<div class="caveat">' +
        label +
        '’s estimated range at the end of the ' +
        street +
        ': starting from the “' +
        (r.key || 'any two cards') +
        '” chart, about ' +
        pct +
        '% of hands after narrowing by their actions. Brighter = more likely.' +
        (shown ? ' Their actual hand is outlined in green.' : '') +
        ' An estimate from the Ranges tab, not a solver.</div>';
    }
    box
      .querySelectorAll('[data-vr]')
      .forEach(b => b.addEventListener('click', e => (e.stopPropagation(), show(b.dataset.vr))));
  }
  box.innerHTML = '<div class="caveat">Estimating…</div>';
  await show(streets[streets.length - 1]);
}

function cellOfCards(cards) {
  const R = 'AKQJT98765432';
  const [x, y] = cards.map(c => c[0].toUpperCase());
  if (x === y) return x + y;
  const [hi, lo] = R.indexOf(x) < R.indexOf(y) ? [x, y] : [y, x];
  return hi + lo + (cards[0][1].toLowerCase() === cards[1][1].toLowerCase() ? 's' : 'o');
}
