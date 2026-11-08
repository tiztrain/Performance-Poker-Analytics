// ---------- Hand-reading quiz view ----------
// Replays showdown hands one street at a time with villain's cards hidden. Two modes, switched by
// a checkbox that is remembered in this browser:
// - Simple: tick the categories villain could hold on every street, scored each time. After a
//   miss you have to find the right category before moving on.
// - Advanced: note your category read on each street (not scored), then paint villain's range on
//   the 13×13 grid on the river. Scored with the tightness curve (see engine/rangeGrid.js); a miss
//   comes with an explanation.
// Quiz position lives in the controller this module returns, so redrawing the results (for
// example after the BB/chips toggle) doesn't lose your place.

import { anonymizePlayers, describeAction } from '../engine/handSummary.js';
import { categoriesForStreet, POSTFLOP_CATEGORIES, PREFLOP_CATEGORIES } from '../engine/handCategories.js';
import { computeHandPositions } from '../engine/positions.js';
import {
  buildQuizItems,
  createQuizStore,
  explainRead,
  recordsForMode,
  scoreAnswer,
  summarizeAnswers,
} from '../engine/quiz.js';
import { ALL_CELLS, cellName, countLive, scoreRange } from '../engine/rangeGrid.js';
import { cardsToIconStr } from './format.js';

const STREET_LABELS = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
const LABELS = Object.fromEntries([...PREFLOP_CATEGORIES, ...POSTFLOP_CATEGORIES].map(c => [c.id, c.label]));

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked (some private-browsing modes): scores stay in memory
  }
}

const recordKey = (item, mode, street) => item.hand.id + ':' + (mode === 'advanced' ? 'advanced' : street);

export function createQuizController(allHands) {
  const allItems = buildQuizItems(allHands);
  // Advanced mode needs a river to paint the range on.
  const riverItems = allItems.filter(it => it.streets.some(st => st.street === 'river'));
  const store = createQuizStore(browserStorage());
  let mode = store.getMode() === 'advanced' ? 'advanced' : 'simple';
  let items, itemIdx, streetIdx, picks, result, wrongTaps, reads, cells;

  function firstUnanswered() {
    const answered = new Set(recordsForMode(store.all(), mode).map(r => r.key));
    const idx = items.findIndex(it =>
      mode === 'advanced'
        ? !answered.has(recordKey(it, mode))
        : it.streets.some(st => !answered.has(recordKey(it, mode, st.street))),
    );
    return idx === -1 ? items.length : idx;
  }

  function resetHandState() {
    streetIdx = 0;
    picks = new Set();
    result = null;
    wrongTaps = new Set();
    reads = {};
    cells = new Set();
  }

  function setMode(next) {
    mode = next;
    store.setMode(mode);
    items = mode === 'advanced' ? riverItems : allItems;
    itemIdx = firstUnanswered();
    resetHandState();
  }
  setMode(mode);

  // ---------- Score panel ----------
  function scorePanelHtml() {
    const s = summarizeAnswers(recordsForMode(store.all(), mode));
    const toggle =
      '<label class="quiz-mode"><input type="checkbox" data-quiz-mode="1"' +
      (mode === 'advanced' ? ' checked' : '') +
      '> Advanced mode</label>';
    const intro =
      mode === 'advanced'
        ? 'Advanced: note your read on each street (not scored), then paint their whole range on the 13×13 grid on ' +
          'the river. The tighter your range, the more you score, but 0 if their hand isn’t in it.'
        : 'Simple: on each street, tick every category you think your opponent could have. You score more for being ' +
          'right with fewer ticks, and nothing for a miss. After a miss, find the right category to continue.';
    let h =
      '<div class="panel"><div class="quiz-head"><h2>Hand-reading quiz</h2>' +
      toggle +
      '</div><div class="quiz-intro">' +
      intro +
      ' Scores are saved in this browser, separately for each mode.</div>';
    if (s.count) {
      const trend =
        s.previous === null
          ? ''
          : ' <span class="' +
            (s.recent >= s.previous ? 'quiz-up' : 'quiz-down') +
            '">(last 20: ' +
            s.recent +
            ', previous 20: ' +
            s.previous +
            ')</span>';
      h +=
        '<div class="quiz-scores"><div><b>' +
        s.average +
        '</b><span>average score' +
        trend +
        '</span></div><div><b>' +
        s.hitRate +
        '%</b><span>' +
        (mode === 'advanced' ? 'ranges that contained their hand' : 'answers that included the real category') +
        '</span></div><div><b>' +
        s.count +
        '</b><span>answers saved</span></div></div><div class="quiz-streets">';
      if (mode === 'simple') {
        ['preflop', 'flop', 'turn', 'river'].forEach(st => {
          const b = s.byStreet[st];
          h += '<span>' + STREET_LABELS[st] + ': ' + (b.count ? b.average + ' (' + b.count + ')' : '–') + '</span>';
        });
      }
      h += '<button class="filter-btn" data-quiz-reset="1">Reset ' + mode + ' scores</button></div>';
    }
    return h + '</div>';
  }

  // ---------- Hand replay ----------
  function replayHtml(item, revealed) {
    const hand = item.hand;
    const names = anonymizePlayers(hand);
    const positions = computeHandPositions(hand);
    const label = p => names.get(p) + (positions.has(p) ? ' (' + positions.get(p) + ')' : '');
    let h =
      '<div class="quiz-meta">Hand ' +
      (itemIdx + 1) +
      ' of ' +
      items.length +
      ' · #' +
      hand.id +
      ' · blinds ' +
      hand.sb +
      '/' +
      hand.bb +
      (hand.ante ? '/' + hand.ante : '') +
      '</div><h2>Read ' +
      label(item.villain) +
      '</h2><div class="quiz-players">';
    [...names.keys()].forEach(p => {
      const seat = hand.seats.find(s => s.name === p);
      const stack = Math.round((seat.stack / hand.bb) * 10) / 10 + 'bb';
      let cardsStr = '';
      if (p === 'Hero' && hand.heroCards) cardsStr = ' ' + cardsToIconStr(hand.heroCards);
      if (p === item.villain) cardsStr = revealed ? ' ' + cardsToIconStr(item.villainCards) : ' 🂠 🂠';
      h +=
        '<span class="' +
        (p === item.villain ? 'quiz-target' : '') +
        '">' +
        label(p) +
        ' ' +
        stack +
        cardsStr +
        '</span>';
    });
    h += '</div>';
    item.streets.slice(0, streetIdx + 1).forEach(st => {
      h += '<div class="street-block"><div class="street-name">' + STREET_LABELS[st.street] + '</div>';
      if (st.board.length) h += '<div class="board-line">' + cardsToIconStr(st.board) + '</div>';
      hand.streets[st.street].forEach(a => {
        const line = describeAction(a, hand, names, positions);
        if (line) h += '<div class="action-line">' + line + '</div>';
      });
      h += '</div>';
    });
    return h;
  }

  function optionsHtml(street, { disabled = false, actual = null } = {}) {
    let h = '<div class="quiz-options">';
    categoriesForStreet(street).forEach(c => {
      let cls = 'quiz-option';
      if (picks.has(c.id)) cls += ' picked';
      if (wrongTaps.has(c.id)) cls += ' crossed';
      if (actual === c.id) cls += ' actual';
      h +=
        '<button class="' +
        cls +
        '" data-quiz-pick="' +
        c.id +
        '"' +
        (disabled ? ' disabled' : '') +
        '><b>' +
        c.label +
        '</b><span>' +
        c.hint +
        '</span></button>';
    });
    return h + '</div>';
  }

  // ---------- Simple mode ----------
  function simpleHtml(item) {
    const current = item.streets[streetIdx];
    const villainName = anonymizePlayers(item.hand).get(item.villain);
    const last = streetIdx === item.streets.length - 1;
    const found = result && (result.points > 0 || result.corrected);
    let h = replayHtml(item, last && found);
    h +=
      '<div class="quiz-question">After the ' +
      current.street +
      ', what could ' +
      villainName +
      ' have? Tick every category you think is possible.</div>';
    if (!result) {
      h += optionsHtml(current.street);
      h +=
        '<div class="quiz-actions"><button class="primary quiz-submit" data-quiz-submit="1"' +
        (picks.size ? '' : ' disabled') +
        '>Check answer</button>';
    } else if (!found) {
      // Missed: they must find the right category to continue. Tapping only, no answer shown yet.
      h += optionsHtml(current.street);
      h +=
        '<div class="quiz-actions"><div class="quiz-result miss">Missed: 0 points. Tap the category you think ' +
        villainName +
        ' really had to continue.</div>';
    } else {
      h += optionsHtml(current.street, { disabled: true, actual: result.actual });
      h +=
        '<div class="quiz-actions"><div class="quiz-result ' +
        (result.points > 0 ? 'hit' : 'miss') +
        '">' +
        villainName +
        '’s hand was in <b>' +
        LABELS[result.actual] +
        '</b>. ' +
        (result.points > 0 ? 'You scored ' + result.points + '.' : 'Found it (scored 0 for the miss).') +
        (last ? ' They showed ' + cardsToIconStr(item.villainCards) + '.' : '') +
        '</div><button class="primary quiz-submit" data-quiz-next="1">' +
        (last ? 'Next hand' : 'Next street') +
        '</button>';
    }
    return h + '<button class="filter-btn" data-quiz-skip="1">Skip hand</button></div>';
  }

  // ---------- Advanced mode ----------
  function deadCards(item) {
    const river = item.streets[item.streets.length - 1];
    return [...river.board, ...(item.hand.heroCards || [])];
  }

  function gridHtml(item, villainCell) {
    let h = '<div class="range-grid" data-range-grid="1">';
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const name = cellName(r, c);
        let cls = 'range-cell ' + (r === c ? 'pair' : r < c ? 'suited' : 'offsuit');
        if (cells.has(name)) cls += ' painted';
        if (villainCell === name) cls += ' actual';
        h +=
          '<button class="' +
          cls +
          '" data-cell="' +
          name +
          '"' +
          (villainCell ? ' disabled' : '') +
          '>' +
          name +
          '</button>';
      }
    }
    return h + '</div>';
  }

  function rangeShareText(item) {
    const dead = deadCards(item);
    const pct = Math.round((countLive(cells, dead) / countLive(ALL_CELLS, dead)) * 1000) / 10;
    return cells.size + ' cell' + (cells.size === 1 ? '' : 's') + ' · ' + pct + '% of the hands they could hold';
  }

  function advancedHtml(item) {
    const current = item.streets[streetIdx];
    const villainName = anonymizePlayers(item.hand).get(item.villain);
    const onRiver = current.street === 'river';
    let h = replayHtml(item, !!result);
    if (!onRiver) {
      h +=
        '<div class="quiz-question">Your read after the ' +
        current.street +
        ': which categories could ' +
        villainName +
        ' have? (Not scored; you’ll see how it compares at the end.)</div>' +
        optionsHtml(current.street) +
        '<div class="quiz-actions"><button class="primary quiz-submit" data-quiz-lock="1">' +
        (picks.size ? 'Lock in read' : 'Continue without a read') +
        '</button>';
      return h + '<button class="filter-btn" data-quiz-skip="1">Skip hand</button></div>';
    }

    h +=
      '<div class="quiz-question">On the river, paint every hand ' +
      villainName +
      ' could have. Tap cells, or press and drag across them.</div>' +
      '<div class="range-legend">Pairs on the diagonal, suited hands above it, offsuit hands below.</div>' +
      gridHtml(item, result ? result.villainCell : null);
    if (!result) {
      h +=
        '<div class="quiz-actions"><span class="range-share" data-range-share="1">' +
        rangeShareText(item) +
        '</span><button class="filter-btn" data-range-clear="1">Clear</button>' +
        '<button class="primary quiz-submit" data-range-submit="1"' +
        (cells.size ? '' : ' disabled') +
        '>Check range</button>';
      return h + '<button class="filter-btn" data-quiz-skip="1">Skip hand</button></div>';
    }

    const ex = explainRead(item, reads, result);
    h +=
      '<div class="quiz-actions"><div class="quiz-result ' +
      (result.hit ? 'hit' : 'miss') +
      '">' +
      villainName +
      ' showed ' +
      cardsToIconStr(item.villainCards) +
      ' (outlined in green). ' +
      (result.hit ? 'You scored ' + result.points + '.' : 'Missed: 0 points.') +
      ' ' +
      ex.rangeLine +
      '</div></div><div class="quiz-recap">';
    ex.recap.forEach(r => {
      h +=
        '<div class="quiz-recap-row"><b>' +
        STREET_LABELS[r.street] +
        '</b><span>' +
        r.actions.join('; ') +
        '</span><span>Had: ' +
        r.actual +
        '</span><span>' +
        (r.street === 'river'
          ? 'Your range: ' + cells.size + ' cell' + (cells.size === 1 ? '' : 's')
          : r.read === null
            ? 'No read'
            : 'Your read: ' + r.read + ' <span class="' + (r.readRight ? 'quiz-up">✓' : 'quiz-down">✗') + '</span>') +
        '</span></div>';
    });
    h += '</div>';
    if (!result.hit) h += '<div class="quiz-lesson"><b>Why it was missed:</b> ' + ex.lesson + '</div>';
    return (
      h + '<div class="quiz-actions"><button class="primary quiz-submit" data-quiz-next="1">Next hand</button></div>'
    );
  }

  // ---------- Page ----------
  function render(mount) {
    let h = scorePanelHtml();
    if (!items.length) {
      h +=
        '<div class="panel"><div class="empty-state" style="padding:30px 20px;">' +
        (mode === 'advanced'
          ? 'None of the loaded hands has an opponent’s cards shown on a river, so there is nothing to quiz on yet.'
          : 'None of the loaded hands has an opponent’s cards shown, so there is nothing to quiz on yet.') +
        ' Load hands that went to showdown.</div></div>';
    } else if (itemIdx >= items.length) {
      h +=
        '<div class="panel"><div class="empty-state" style="padding:30px 20px;">You’ve answered every showdown hand ' +
        'loaded (' +
        items.length +
        ') in ' +
        mode +
        ' mode. Load more hands, or go through these again.<br><br><button class="filter-btn" data-quiz-restart="1">' +
        'Go through again</button></div></div>';
    } else {
      const item = items[itemIdx];
      h += '<div class="panel quiz-hand">' + (mode === 'advanced' ? advancedHtml(item) : simpleHtml(item)) + '</div>';
    }
    mount.innerHTML = h;
    bind(mount);
  }

  function nextHand() {
    itemIdx++;
    resetHandState();
  }

  function bind(mount) {
    const redraw = () => render(mount);
    const on = (selector, fn) => {
      const el = mount.querySelector(selector);
      if (el) el.addEventListener('click', fn);
    };
    const item = items[itemIdx];

    const modeBox = mount.querySelector('[data-quiz-mode]');
    if (modeBox) {
      modeBox.addEventListener('change', () => {
        setMode(modeBox.checked ? 'advanced' : 'simple');
        redraw();
      });
    }

    mount.querySelectorAll('[data-quiz-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.quizPick;
        if (mode === 'simple' && result && !(result.points > 0 || result.corrected)) {
          // Finding the right category after a miss.
          if (id === result.actual) result.corrected = true;
          else wrongTaps.add(id);
        } else if (picks.has(id)) {
          picks.delete(id);
        } else {
          picks.add(id);
        }
        redraw();
      });
    });

    on('[data-quiz-submit]', () => {
      const st = item.streets[streetIdx];
      const points = scoreAnswer([...picks], st.actual, st.options.length);
      store.add({
        mode: 'simple',
        key: recordKey(item, 'simple', st.street),
        handId: item.hand.id,
        street: st.street,
        picks: [...picks],
        actual: st.actual,
        points,
        at: new Date().toISOString(),
      });
      result = { actual: st.actual, points, corrected: false };
      redraw();
    });

    on('[data-quiz-lock]', () => {
      reads[item.streets[streetIdx].street] = [...picks];
      streetIdx++;
      picks = new Set();
      redraw();
    });

    on('[data-quiz-next]', () => {
      if (mode === 'simple' && streetIdx < item.streets.length - 1) {
        streetIdx++;
        picks = new Set();
        result = null;
        wrongTaps = new Set();
      } else {
        nextHand();
      }
      redraw();
    });

    on('[data-quiz-skip]', () => {
      nextHand();
      redraw();
    });
    on('[data-quiz-restart]', () => {
      itemIdx = -1;
      nextHand();
      redraw();
    });
    on('[data-quiz-reset]', () => {
      if (window.confirm('Delete all saved ' + mode + '-mode quiz scores in this browser?')) {
        const keep = store.all().filter(r => (r.mode || 'simple') !== mode);
        store.clear();
        keep.forEach(r => store.add(r));
        itemIdx = firstUnanswered();
        resetHandState();
        redraw();
      }
    });

    bindGrid(mount, item);
    on('[data-range-clear]', () => {
      cells = new Set();
      redraw();
    });
    on('[data-range-submit]', () => {
      const dead = deadCards(item);
      const scored = scoreRange(cells, item.villainCards, dead);
      store.add({
        mode: 'advanced',
        key: recordKey(item, 'advanced'),
        handId: item.hand.id,
        street: 'river',
        reads,
        cells: [...cells],
        actual: scored.villainCell,
        points: scored.points,
        at: new Date().toISOString(),
      });
      result = scored;
      redraw();
    });
  }

  // Painting updates cells in place rather than redrawing, so a drag isn't interrupted.
  function bindGrid(mount, item) {
    const grid = mount.querySelector('[data-range-grid]');
    if (!grid || result) return;
    const shareEl = mount.querySelector('[data-range-share]');
    const submitEl = mount.querySelector('[data-range-submit]');
    let painting = null; // true = adding cells, false = removing, null = not dragging
    const stop = () => {
      painting = null;
    };
    const apply = btn => {
      if (!btn) return;
      const name = btn.dataset.cell;
      if (painting) cells.add(name);
      else cells.delete(name);
      btn.classList.toggle('painted', painting);
      shareEl.textContent = rangeShareText(item);
      submitEl.disabled = cells.size === 0;
    };
    grid.addEventListener('pointerdown', e => {
      const btn = e.target.closest('[data-cell]');
      if (!btn) return;
      e.preventDefault();
      painting = !cells.has(btn.dataset.cell);
      apply(btn);
      // Stop painting wherever the pointer is released, even outside the grid.
      window.addEventListener('pointerup', stop, { once: true });
    });
    grid.addEventListener('pointermove', e => {
      if (painting === null) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const btn = el && el.closest('[data-cell]');
      if (btn && grid.contains(btn) && cells.has(btn.dataset.cell) !== painting) apply(btn);
    });
  }

  return {
    render,
    get itemCount() {
      return allItems.length;
    },
  };
}
