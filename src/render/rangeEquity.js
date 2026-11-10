// ---------- Estimated equity on Hero's calls ----------
// When a hand's detail is opened, each Hero call gets "you had ~41% against their estimated
// range" next to the equity it needed. Worked out on demand (not for every hand on load), using
// the range model (engine/rangeModel.js) with the player's saved range edits.

import { buildRanges, callEquities, createRangeStore } from '../engine/rangeModel.js';
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
