// ---------- Ranges tab: view and edit the range model's preflop charts ----------
// Pick a chart (e.g. "Open: UTG"), paint cells on the 13×13 grid (tap or drag), and save. Saved
// charts replace the defaults everywhere the range model is used; Reset brings back the default.

import { ALL_CELLS, cellName } from '../engine/rangeGrid.js';
import { RANGE_SPECS, rangeShare, buildRanges } from '../engine/rangeModel.js';
import { equityTable, invalidateRanges, rangeStore } from './rangeEquity.js';

export function createRangesController() {
  let key = RANGE_SPECS[0].key;
  let cells = null; // the chart being edited, as a Set of cell names
  let defaults = null;

  async function load(onReady) {
    defaults = buildRanges(await equityTable(), {});
    onReady();
  }

  function currentFromStore() {
    const saved = rangeStore.load()[key];
    if (Array.isArray(saved)) return new Set(saved);
    return new Set(ALL_CELLS.filter((_, i) => defaults[key][i]));
  }

  const share = set => rangeShare(Float64Array.from(ALL_CELLS, c => (set.has(c) ? 1 : 0)));

  function render(mount) {
    if (!defaults) {
      mount.innerHTML =
        '<div class="panel"><h2>Ranges</h2><div class="quiz-intro">Loading the range charts…</div></div>';
      load(() => mount.isConnected && render(mount));
      return;
    }
    if (!cells) cells = currentFromStore();
    const custom = Array.isArray(rangeStore.load()[key]);
    let h =
      '<div class="panel"><h2>Ranges</h2><div class="quiz-intro">The range model estimates what villains hold from ' +
      'these preflop charts, then narrows them by what they did after the flop. It’s used for the “you had ~X% vs ' +
      'their estimated range” figures next to your calls. Defaults are standard-looking tournament charts built from ' +
      'hand strength; paint your own and save. Tap cells, or press and drag.</div>' +
      '<div class="quiz-actions"><select class="range-select" aria-label="Chart">' +
      RANGE_SPECS.map(
        s => '<option value="' + s.key + '"' + (s.key === key ? ' selected' : '') + '>' + s.label + '</option>',
      ).join('') +
      '</select><span class="range-share" data-share="1">' +
      (share(cells) * 100).toFixed(1) +
      '% of hands' +
      (custom ? ' · yours' : ' · default') +
      '</span></div><div class="range-grid ranges-editor" data-grid="1">';
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const name = cellName(r, c);
        h +=
          '<button class="range-cell ' +
          (r === c ? 'pair' : r < c ? 'suited' : 'offsuit') +
          (cells.has(name) ? ' painted' : '') +
          '" data-cell="' +
          name +
          '">' +
          name +
          '</button>';
      }
    }
    h +=
      '</div><div class="quiz-actions"><button class="primary quiz-submit" data-save="1">Save chart</button>' +
      '<button class="filter-btn" data-reset="1"' +
      (custom ? '' : ' disabled') +
      '>Reset to default</button><span class="range-saved"></span></div></div>';
    mount.innerHTML = h;
    bind(mount);
  }

  function bind(mount) {
    mount.querySelector('.range-select').addEventListener('change', e => {
      key = e.target.value;
      cells = null;
      render(mount);
    });
    mount.querySelector('[data-save]').addEventListener('click', () => {
      rangeStore.set(key, [...cells]);
      invalidateRanges();
      render(mount);
      mount.querySelector('.range-saved').textContent = 'Saved.';
    });
    mount.querySelector('[data-reset]').addEventListener('click', () => {
      rangeStore.reset(key);
      invalidateRanges();
      cells = null;
      render(mount);
    });
    // Painting updates cells in place so a drag isn't interrupted.
    const grid = mount.querySelector('[data-grid]');
    const shareEl = mount.querySelector('[data-share]');
    let painting = null;
    const stop = () => (painting = null);
    const apply = btn => {
      const name = btn.dataset.cell;
      if (painting) cells.add(name);
      else cells.delete(name);
      btn.classList.toggle('painted', painting);
      shareEl.textContent = (share(cells) * 100).toFixed(1) + '% of hands · unsaved';
    };
    grid.addEventListener('pointerdown', e => {
      const btn = e.target.closest('[data-cell]');
      if (!btn) return;
      e.preventDefault();
      painting = !cells.has(btn.dataset.cell);
      apply(btn);
      window.addEventListener('pointerup', stop, { once: true });
    });
    grid.addEventListener('pointermove', e => {
      if (painting === null) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const btn = el && el.closest('[data-cell]');
      if (btn && grid.contains(btn) && cells.has(btn.dataset.cell) !== painting) apply(btn);
    });
  }

  return { render };
}
