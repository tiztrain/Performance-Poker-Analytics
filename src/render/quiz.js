// ---------- Hand-reading quiz view ----------
// Replays showdown hands one street at a time with villain's cards hidden. On each street the
// player ticks the categories villain could hold, then sees the real one and a score. Scores are
// saved in this browser (see createQuizStore) so the trend survives closing the tab.
// Quiz position lives in the controller this module returns, so redrawing the results (for
// example after the BB/chips toggle) doesn't lose your place.

import { anonymizePlayers, describeAction } from '../engine/handSummary.js';
import { categoriesForStreet, POSTFLOP_CATEGORIES, PREFLOP_CATEGORIES } from '../engine/handCategories.js';
import { computeHandPositions } from '../engine/positions.js';
import { buildQuizItems, createQuizStore, scoreAnswer, summarizeAnswers } from '../engine/quiz.js';
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
  const items = buildQuizItems(allHands);
  const store = createQuizStore(browserStorage());
  // Start at the first hand with a street not yet answered in a saved record.
  const answered = new Set(store.all().map(r => r.key));
  let itemIdx = items.findIndex(it => it.streets.some(st => !answered.has(it.hand.id + ':' + st.street)));
  if (itemIdx === -1) itemIdx = items.length; // everything done: show the finished screen
  let streetIdx = 0;
  let picks = new Set();
  let result = null; // { actual, points } once the current street is submitted

  function scorePanelHtml() {
    const s = summarizeAnswers(store.all());
    if (!s.count) {
      return (
        '<div class="panel"><h2>Hand-reading quiz</h2><div class="quiz-intro">' +
        'Showdown hands replayed one street at a time with your opponent’s cards hidden. On each street, tick ' +
        'every category you think they could have. You score more for being right with fewer ticks, and nothing ' +
        'for a miss. Scores are saved in this browser.</div></div>'
      );
    }
    const pct = v => (v === null ? '–' : v);
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
    let h =
      '<div class="panel"><h2>Hand-reading quiz</h2><div class="quiz-scores">' +
      '<div><b>' +
      pct(s.average) +
      '</b><span>average score' +
      trend +
      '</span></div>' +
      '<div><b>' +
      pct(s.hitRate) +
      '%</b><span>answers that included the real category</span></div>' +
      '<div><b>' +
      s.count +
      '</b><span>answers saved</span></div></div><div class="quiz-streets">';
    ['preflop', 'flop', 'turn', 'river'].forEach(st => {
      const b = s.byStreet[st];
      h += '<span>' + STREET_LABELS[st] + ': ' + (b.count ? b.average + ' (' + b.count + ')' : '–') + '</span>';
    });
    h += '<button class="filter-btn" data-quiz-reset="1">Reset scores</button></div></div>';
    return h;
  }

  function handHtml(item) {
    const hand = item.hand;
    const names = anonymizePlayers(hand);
    const positions = computeHandPositions(hand);
    const label = p => names.get(p) + (positions.has(p) ? ' (' + positions.get(p) + ')' : '');
    const current = item.streets[streetIdx];
    const revealed = result && streetIdx === item.streets.length - 1;

    let h =
      '<div class="panel quiz-hand"><div class="quiz-meta">Hand ' +
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

    const options = categoriesForStreet(current.street);
    h +=
      '<div class="quiz-question">After the ' +
      current.street +
      ', what could ' +
      names.get(item.villain) +
      ' have? Tick every category you think is possible.</div><div class="quiz-options">';
    options.forEach(c => {
      let cls = 'quiz-option';
      if (picks.has(c.id)) cls += ' picked';
      if (result && c.id === result.actual) cls += ' actual';
      h +=
        '<button class="' +
        cls +
        '" data-quiz-pick="' +
        c.id +
        '"' +
        (result ? ' disabled' : '') +
        '><b>' +
        c.label +
        '</b><span>' +
        c.hint +
        '</span></button>';
    });
    h += '</div><div class="quiz-actions">';
    if (!result) {
      h +=
        '<button class="primary quiz-submit" data-quiz-submit="1"' +
        (picks.size ? '' : ' disabled') +
        '>Check answer</button>';
    } else {
      h +=
        '<div class="quiz-result ' +
        (result.points > 0 ? 'hit' : 'miss') +
        '">' +
        names.get(item.villain) +
        '’s hand was in <b>' +
        LABELS[result.actual] +
        '</b>. ' +
        (result.points > 0 ? 'You scored ' + result.points + '.' : 'Missed: 0 points.') +
        (revealed ? ' They showed ' + cardsToIconStr(item.villainCards) + '.' : '') +
        '</div>';
      h +=
        '<button class="primary quiz-submit" data-quiz-next="1">' +
        (streetIdx < item.streets.length - 1 ? 'Next street' : 'Next hand') +
        '</button>';
    }
    h += '<button class="filter-btn" data-quiz-skip="1">Skip hand</button></div></div>';
    return h;
  }

  function render(mount) {
    let h = scorePanelHtml();
    if (!items.length) {
      h +=
        '<div class="panel"><div class="empty-state" style="padding:30px 20px;">None of the loaded hands has an ' +
        'opponent’s cards shown, so there is nothing to quiz on yet. Load hands that went to showdown.</div></div>';
    } else if (itemIdx >= items.length) {
      h +=
        '<div class="panel"><div class="empty-state" style="padding:30px 20px;">You’ve answered every showdown hand ' +
        'loaded (' +
        items.length +
        '). Load more hands, or go through these again.<br><br><button class="filter-btn" data-quiz-restart="1">' +
        'Go through again</button></div></div>';
    } else {
      h += handHtml(items[itemIdx]);
    }
    mount.innerHTML = h;
    bind(mount);
  }

  function goToNextHand() {
    itemIdx++;
    streetIdx = 0;
    picks = new Set();
    result = null;
  }

  function bind(mount) {
    const redraw = () => render(mount);
    mount.querySelectorAll('[data-quiz-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.quizPick;
        if (picks.has(id)) picks.delete(id);
        else picks.add(id);
        redraw();
      });
    });
    const submit = mount.querySelector('[data-quiz-submit]');
    if (submit) {
      submit.addEventListener('click', () => {
        const item = items[itemIdx];
        const st = item.streets[streetIdx];
        const points = scoreAnswer([...picks], st.actual, st.options.length);
        store.add({
          key: item.hand.id + ':' + st.street,
          handId: item.hand.id,
          street: st.street,
          picks: [...picks],
          actual: st.actual,
          points,
          at: new Date().toISOString(),
        });
        result = { actual: st.actual, points };
        redraw();
      });
    }
    const next = mount.querySelector('[data-quiz-next]');
    if (next) {
      next.addEventListener('click', () => {
        if (streetIdx < items[itemIdx].streets.length - 1) {
          streetIdx++;
          picks = new Set();
          result = null;
        } else {
          goToNextHand();
        }
        redraw();
      });
    }
    const skip = mount.querySelector('[data-quiz-skip]');
    if (skip) {
      skip.addEventListener('click', () => {
        goToNextHand();
        redraw();
      });
    }
    const restart = mount.querySelector('[data-quiz-restart]');
    if (restart) {
      restart.addEventListener('click', () => {
        itemIdx = -1;
        goToNextHand();
        redraw();
      });
    }
    const reset = mount.querySelector('[data-quiz-reset]');
    if (reset) {
      reset.addEventListener('click', () => {
        if (window.confirm('Delete all saved quiz scores in this browser?')) {
          store.clear();
          redraw();
        }
      });
    }
  }

  return { render, itemCount: items.length };
}
