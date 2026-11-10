// ---------- Hand-reading quiz view ----------
// Replays showdown hands one street at a time with villain's cards hidden. Two independent
// settings, both remembered in this browser, give four ways to practise:
// - Answer type. Simple: tick the categories villain could hold; after a miss you must find the
//   right category before moving on. Advanced: paint villain's range on the 13×13 grid, scored
//   with the tightness curve (engine/rangeGrid.js); the painted range carries to the next street.
// - Timing. Every street, or the river only (earlier streets are a replay to click through).
// In advanced mode a street's result says only whether villain's hand was in the range; where it
// was is revealed after the last street, so later streets aren't given away.
// Every answer has a Copy for Claude button for going over the read in a chat.
// Quiz position lives in the controller this module returns, so redrawing the results (for
// example after the BB/chips toggle) doesn't lose your place.

import { anonymizePlayers, describeAction } from '../engine/handSummary.js';
import { categoriesForStreet, POSTFLOP_CATEGORIES, PREFLOP_CATEGORIES } from '../engine/handCategories.js';
import { computeHandPositions } from '../engine/positions.js';
import {
  buildQuizItems,
  createQuizStore,
  explainRead,
  modeKey,
  normalizeMode,
  quizToClaudeText,
  recordsForMode,
  scoreAnswer,
  summarizeAnswers,
} from '../engine/quiz.js';
import { ALL_CELLS, cellName, countLive, scoreRange } from '../engine/rangeGrid.js';
import { bindCopyButton } from './clipboard.js';
import { bindChatButton, chatButtonHtml } from './chatPanel.js';
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

export function createQuizController(allHands) {
  const allItems = buildQuizItems(allHands);
  const riverItems = allItems.filter(it => it.streets.some(st => st.street === 'river'));
  const store = createQuizStore(browserStorage());
  let answerType = store.getSetting('answerType', 'simple') === 'advanced' ? 'advanced' : 'simple';
  let timing = store.getSetting('timing', 'every') === 'river' ? 'river' : 'every';
  let items, itemIdx, streetIdx, picks, result, wrongTaps, cells, streetResults;

  const mode = () => modeKey(answerType, timing);
  const isQuestion = street => timing === 'every' || street === 'river';
  const questionStreets = item => item.streets.filter(st => isQuestion(st.street));

  function firstUnanswered() {
    const answered = new Set(
      store
        .all()
        .filter(r => normalizeMode(r.mode) === mode())
        .map(r => r.handId + ':' + r.street),
    );
    const idx = items.findIndex(it => questionStreets(it).some(st => !answered.has(it.hand.id + ':' + st.street)));
    return idx === -1 ? items.length : idx;
  }

  function resetHandState() {
    streetIdx = 0;
    picks = new Set();
    result = null;
    wrongTaps = new Set();
    cells = new Set();
    streetResults = {};
  }

  function applySettings() {
    items = timing === 'river' ? riverItems : allItems;
    itemIdx = firstUnanswered();
    resetHandState();
  }
  applySettings();

  // ---------- Score panel ----------
  function scorePanelHtml() {
    const s = summarizeAnswers(recordsForMode(store.all(), mode()));
    const box = (setting, checked, label) =>
      '<label class="quiz-mode"><input type="checkbox" data-quiz-setting="' +
      setting +
      '"' +
      (checked ? ' checked' : '') +
      '> ' +
      label +
      '</label>';
    const how =
      (answerType === 'advanced'
        ? 'Advanced: paint every hand your opponent could have on the 13×13 grid. The tighter your range, the more ' +
          'you score, but 0 if their hand isn’t in it.'
        : 'Simple: tick every category your opponent could have. You score more for being right with fewer ticks, ' +
          'and nothing for a miss; after a miss, find the right category to continue.') +
      (timing === 'river'
        ? ' Asked on the river only; earlier streets are a replay.'
        : answerType === 'advanced'
          ? ' Asked on every street: each result says only whether their hand was in your range, and your range ' +
            'carries over so you can narrow it. Where their hand was is shown after the river.'
          : ' Asked on every street.');
    let h =
      '<div class="panel"><div class="quiz-head"><h2>Hand-reading quiz</h2><div class="quiz-settings">' +
      box('answerType', answerType === 'advanced', 'Advanced: paint the range') +
      box('timing', timing === 'river', 'River only') +
      '</div></div><div class="quiz-intro">' +
      how +
      ' Scores are saved in this browser, separately for each combination of settings.</div>';
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
        (answerType === 'advanced' ? 'ranges that contained their hand' : 'answers that included the real category') +
        '</span></div><div><b>' +
        s.count +
        '</b><span>answers saved</span></div></div><div class="quiz-streets">';
      if (timing === 'every') {
        ['preflop', 'flop', 'turn', 'river'].forEach(st => {
          const b = s.byStreet[st];
          h += '<span>' + STREET_LABELS[st] + ': ' + (b.count ? b.average + ' (' + b.count + ')' : '–') + '</span>';
        });
      }
      h += '<button class="filter-btn" data-quiz-reset="1">Reset these scores</button></div>';
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

  function deadCards(item, st) {
    return [...st.board, ...(item.hand.heroCards || [])];
  }

  function gridHtml(villainCell, locked) {
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
          (locked ? ' disabled' : '') +
          '>' +
          name +
          '</button>';
      }
    }
    return h + '</div>';
  }

  function rangeShareText(item, st) {
    const dead = deadCards(item, st);
    const pct = Math.round((countLive(cells, dead) / countLive(ALL_CELLS, dead)) * 1000) / 10;
    return cells.size + ' cell' + (cells.size === 1 ? '' : 's') + ' · ' + pct + '% of the hands they could hold';
  }

  function copyRowHtml() {
    return (
      '<div class="copy-row"><button class="copy-claude-btn" type="button">Copy for Claude</button>' +
      chatButtonHtml() +
      '<span class="copy-hint">Copies this hand, your read and their real hand, to go over in a chat.</span></div>'
    );
  }

  // Recap and lesson, shown when the last question of a hand has been answered.
  function finishedHtml(item, rangeResult) {
    const ex = explainRead(item, rangeResult);
    let h = '<div class="quiz-recap">';
    ex.recap.forEach(r => {
      const sr = streetResults[r.street];
      h +=
        '<div class="quiz-recap-row"><b>' +
        STREET_LABELS[r.street] +
        '</b><span>' +
        r.actions.join('; ') +
        '</span><span>Had: ' +
        r.actual +
        '</span><span>' +
        (sr
          ? 'Your read: ' +
            sr.readText +
            ' <span class="' +
            (sr.right ? 'quiz-up">✓' : 'quiz-down">✗') +
            '</span>' +
            (sr.points !== null ? ' (' + sr.points + ')' : '')
          : 'Not asked') +
        '</span></div>';
    });
    h += '</div>';
    const anyMiss = Object.values(streetResults).some(sr => !sr.right);
    if (anyMiss) h += '<div class="quiz-lesson"><b>What to take from it:</b> ' + ex.lesson + '</div>';
    return h;
  }

  function nextButtonHtml(item) {
    const last = streetIdx === item.streets.length - 1;
    return (
      '<button class="primary quiz-submit" data-quiz-next="1">' +
      (last ? 'Next hand' : 'Continue to the ' + item.streets[streetIdx + 1].street) +
      '</button>'
    );
  }

  function handHtml(item) {
    const st = item.streets[streetIdx];
    const villainName = anonymizePlayers(item.hand).get(item.villain);
    const last = streetIdx === item.streets.length - 1;
    const skip = '<button class="filter-btn" data-quiz-skip="1">Skip hand</button>';

    // Replay-only street (river-only timing): just move on.
    if (!isQuestion(st.street)) {
      return replayHtml(item, false) + '<div class="quiz-actions">' + nextButtonHtml(item) + skip + '</div>';
    }

    if (answerType === 'simple') {
      const found = result && (result.points > 0 || result.corrected);
      let h = replayHtml(item, last && found);
      h +=
        '<div class="quiz-question">After the ' +
        st.street +
        ', what could ' +
        villainName +
        ' have? Tick every category you think is possible.</div>';
      if (!result) {
        return (
          h +
          optionsHtml(st.street) +
          '<div class="quiz-actions"><button class="primary quiz-submit" data-quiz-submit="1"' +
          (picks.size ? '' : ' disabled') +
          '>Check answer</button>' +
          skip +
          '</div>'
        );
      }
      if (!found) {
        return (
          h +
          optionsHtml(st.street) +
          '<div class="quiz-actions"><div class="quiz-result miss">Missed: 0 points. Tap the category you think ' +
          villainName +
          ' really had to continue.</div>' +
          skip +
          '</div>'
        );
      }
      h +=
        optionsHtml(st.street, { disabled: true, actual: result.actual }) +
        '<div class="quiz-actions"><div class="quiz-result ' +
        (result.points > 0 ? 'hit' : 'miss') +
        '">' +
        villainName +
        '’s hand was in <b>' +
        LABELS[result.actual] +
        '</b>. ' +
        (result.points > 0 ? 'You scored ' + result.points + '.' : 'Found it (scored 0 for the miss).') +
        (last ? ' They showed ' + cardsToIconStr(item.villainCards) + '.' : '') +
        '</div>' +
        nextButtonHtml(item) +
        skip +
        '</div>' +
        copyRowHtml();
      if (last) h += finishedHtml(item, null);
      return h;
    }

    // Advanced: paint the range.
    const revealNow = result && last;
    let h = replayHtml(item, revealNow);
    h +=
      '<div class="quiz-question">After the ' +
      st.street +
      ', paint every hand ' +
      villainName +
      ' could have. Tap cells, or press and drag across them.' +
      (timing === 'every' && streetIdx > 0 ? ' Your range from the last street is kept so you can narrow it.' : '') +
      '</div><div class="range-legend">Pairs on the diagonal, suited hands above it, offsuit hands below.</div>' +
      gridHtml(revealNow ? result.villainCell : null, !!result);
    if (!result) {
      return (
        h +
        '<div class="quiz-actions"><span class="range-share" data-range-share="1">' +
        rangeShareText(item, st) +
        '</span><button class="filter-btn" data-range-clear="1">Clear</button>' +
        '<button class="primary quiz-submit" data-range-submit="1"' +
        (cells.size ? '' : ' disabled') +
        '>Check range</button>' +
        skip +
        '</div>'
      );
    }
    const pct = Math.round(result.share * 1000) / 10;
    h +=
      '<div class="quiz-actions"><div class="quiz-result ' +
      (result.hit ? 'hit' : 'miss') +
      '">' +
      (revealNow ? villainName + ' showed ' + cardsToIconStr(item.villainCards) + ' (outlined in green). ' : '') +
      (result.hit
        ? 'Their hand was in your range (' + pct + '% of possible hands). You scored ' + result.points + '.'
        : 'Their hand was not in your range (' + pct + '% of possible hands). 0 points.') +
      '</div>' +
      nextButtonHtml(item) +
      skip +
      '</div>' +
      copyRowHtml();
    if (last) h += finishedHtml(item, result);
    return h;
  }

  // ---------- Page ----------
  function render(mount) {
    let h = scorePanelHtml();
    if (!items.length) {
      h +=
        '<div class="panel"><div class="empty-state" style="padding:30px 20px;">' +
        (timing === 'river'
          ? 'None of the loaded hands has an opponent’s cards shown on a river, so there is nothing to quiz on yet.'
          : 'None of the loaded hands has an opponent’s cards shown, so there is nothing to quiz on yet.') +
        ' Load hands that went to showdown.</div></div>';
    } else if (itemIdx >= items.length) {
      h +=
        '<div class="panel"><div class="empty-state" style="padding:30px 20px;">You’ve answered every showdown hand ' +
        'loaded (' +
        items.length +
        ') with these settings. Load more hands, change the settings, or go through these again.<br><br>' +
        '<button class="filter-btn" data-quiz-restart="1">Go through again</button></div></div>';
    } else {
      h += '<div class="panel quiz-hand">' + handHtml(items[itemIdx]) + '</div>';
    }
    mount.innerHTML = h;
    bind(mount);
  }

  function nextHand() {
    itemIdx++;
    resetHandState();
  }

  function saveRecord(item, st, extra) {
    store.add({
      mode: mode(),
      key: item.hand.id + ':' + mode() + ':' + st.street,
      handId: item.hand.id,
      street: st.street,
      at: new Date().toISOString(),
      ...extra,
    });
  }

  function bind(mount) {
    const redraw = () => render(mount);
    const on = (selector, fn) => {
      const el = mount.querySelector(selector);
      if (el) el.addEventListener('click', fn);
    };
    const item = items[itemIdx];
    const st = item && item.streets[streetIdx];

    mount.querySelectorAll('[data-quiz-setting]').forEach(boxEl => {
      boxEl.addEventListener('change', () => {
        if (boxEl.dataset.quizSetting === 'answerType') answerType = boxEl.checked ? 'advanced' : 'simple';
        else timing = boxEl.checked ? 'river' : 'every';
        store.setSetting('answerType', answerType);
        store.setSetting('timing', timing);
        applySettings();
        redraw();
      });
    });

    mount.querySelectorAll('[data-quiz-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.quizPick;
        if (result && !(result.points > 0 || result.corrected)) {
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
      const points = scoreAnswer([...picks], st.actual, st.options.length);
      saveRecord(item, st, { picks: [...picks], actual: st.actual, points });
      result = { actual: st.actual, points, corrected: false };
      streetResults[st.street] = {
        readText: [...picks].map(id => LABELS[id]).join(', '),
        right: points > 0,
        points,
      };
      redraw();
    });

    on('[data-range-submit]', () => {
      const scored = scoreRange(cells, item.villainCards, deadCards(item, st));
      saveRecord(item, st, { cells: [...cells], actual: scored.villainCell, points: scored.points });
      result = scored;
      streetResults[st.street] = {
        readText: cells.size + ' cells (' + Math.round(scored.share * 1000) / 10 + '%)',
        right: scored.hit,
        points: scored.points,
      };
      redraw();
    });

    on('[data-quiz-next]', () => {
      if (streetIdx < item.streets.length - 1) {
        streetIdx++;
        picks = new Set();
        result = null;
        wrongTaps = new Set();
        // In advanced mode the painted range carries over to the next street.
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
      if (window.confirm('Delete the saved quiz scores for these settings in this browser?')) {
        const keep = store.all().filter(r => normalizeMode(r.mode) !== mode());
        store.clear();
        keep.forEach(r => store.add(r));
        applySettings();
        redraw();
      }
    });
    on('[data-range-clear]', () => {
      cells = new Set();
      redraw();
    });

    if (item && result && mount.querySelector('.copy-claude-btn')) {
      const readText =
        answerType === 'advanced'
          ? 'a range of ' +
            cells.size +
            ' grid cells (' +
            Math.round(result.share * 1000) / 10 +
            '% of possible hands): ' +
            [...cells].join(', ')
          : [...picks].map(id => LABELS[id]).join(', ');
      const resultText =
        answerType === 'advanced'
          ? 'Their hand was ' + (result.hit ? '' : 'not ') + 'in my range; I scored ' + result.points + ' out of 100.'
          : 'I scored ' + result.points + ' out of 100.';
      const quizText = () => quizToClaudeText(item, st.street, readText, resultText);
      bindCopyButton(mount, quizText);
      bindChatButton(mount, quizText, 'Quiz: hand #' + item.hand.id);
    }

    if (item && st && answerType === 'advanced' && !result && isQuestion(st.street)) bindGrid(mount, item, st);
  }

  // Painting updates cells in place rather than redrawing, so a drag isn't interrupted.
  function bindGrid(mount, item, st) {
    const grid = mount.querySelector('[data-range-grid]');
    if (!grid) return;
    const shareEl = mount.querySelector('[data-range-share]');
    const submitEl = mount.querySelector('[data-range-submit]');
    let painting = null; // true = adding cells, false = removing, null = not dragging
    const stop = () => {
      painting = null;
    };
    const apply = btn => {
      const name = btn.dataset.cell;
      if (painting) cells.add(name);
      else cells.delete(name);
      btn.classList.toggle('painted', painting);
      shareEl.textContent = rangeShareText(item, st);
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
