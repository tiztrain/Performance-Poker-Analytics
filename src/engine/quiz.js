// ---------- Hand-reading quiz: building questions and scoring answers ----------
// Uses hands where an opponent's cards were shown as an answer key: the hand is replayed one
// street at a time with those cards hidden, and the player picks which categories villain could
// hold. See docs/ROADMAP.md 5.4.

import { categoriesForStreet, categoryOnStreet, POSTFLOP_CATEGORIES, PREFLOP_CATEGORIES } from './handCategories.js';
import { handSortKey } from './grouping.js';
import { anonymizePlayers, describeAction, handToClaudeText } from './handSummary.js';
import { computeHandPositions } from './positions.js';

const STREETS = ['preflop', 'flop', 'turn', 'river'];

function boardThrough(hand, street) {
  if (street === 'preflop') return [];
  if (street === 'flop') return hand.board.flop;
  if (street === 'turn') return [...hand.board.flop, hand.board.turn];
  return [...hand.board.flop, hand.board.turn, hand.board.river];
}

function streetDealt(hand, street) {
  if (street === 'preflop') return true;
  if (street === 'flop') return hand.board.flop.length === 3;
  if (street === 'turn') return !!hand.board.turn;
  return !!hand.board.river;
}

// One quiz item per hand with a shown opponent hand, in time order. The villain to read is the
// first opponent who showed two cards.
export function buildQuizItems(hands) {
  return hands
    .slice()
    .sort((a, b) => (handSortKey(a) < handSortKey(b) ? -1 : handSortKey(a) > handSortKey(b) ? 1 : 0))
    .map(hand => {
      const shown = hand.shows.find(s => s.player !== 'Hero' && s.cards && s.cards.length === 2);
      if (!shown) return null;
      const streets = STREETS.filter(st => streetDealt(hand, st)).map(street => ({
        street,
        board: boardThrough(hand, street),
        actual: categoryOnStreet(shown.cards, boardThrough(hand, street), street),
        options: categoriesForStreet(street).map(c => c.id),
      }));
      return { hand, villain: shown.player, villainCards: shown.cards, streets };
    })
    .filter(Boolean);
}

// Points out of 100. A miss scores 0. A hit scores more the fewer categories were picked:
// one pick scores 100, ticking every option scores 0 (it says nothing), linear in between.
export function scoreAnswer(picks, actual, optionCount) {
  if (!picks.length || !picks.includes(actual)) return 0;
  if (optionCount <= 1) return 100;
  return Math.round((100 * (optionCount - picks.length)) / (optionCount - 1));
}

function average(records) {
  return records.length ? Math.round(records.reduce((sum, r) => sum + r.points, 0) / records.length) : null;
}

// Totals for the score panel. `records` are oldest first, as saved.
export function summarizeAnswers(records, recentSize = 20) {
  const byStreet = {};
  STREETS.forEach(st => {
    const rs = records.filter(r => r.street === st);
    byStreet[st] = { count: rs.length, average: average(rs) };
  });
  return {
    count: records.length,
    average: average(records),
    hitRate: records.length ? Math.round((100 * records.filter(r => r.points > 0).length) / records.length) : null,
    byStreet,
    recent: average(records.slice(-recentSize)),
    previous: average(records.slice(-2 * recentSize, -recentSize)),
  };
}

// Quiz settings are two independent choices, and scores are kept separately for each of the
// four combinations:
// - answer type: 'simple' (pick categories) or 'advanced' (paint the range on the 13×13 grid)
// - timing: 'every' (asked on every street) or 'river' (asked on the river only)
// Records saved by earlier versions: no mode or 'simple' meant simple on every street, and
// 'advanced' meant the grid on the river only.
export function modeKey(answerType, timing) {
  return answerType + '-' + timing;
}

export function normalizeMode(mode) {
  if (!mode || mode === 'simple') return 'simple-every';
  if (mode === 'advanced') return 'advanced-river';
  return mode;
}

export function recordsForMode(records, mode) {
  return records.filter(r => normalizeMode(r.mode) === mode);
}

const LABELS = Object.fromEntries([...PREFLOP_CATEGORIES, ...POSTFLOP_CATEGORIES].map(c => [c.id, c.label]));

// Explanation shown when a hand is finished: what villain did and held on each street, and a
// lesson picked from the pattern of their categories. `rangeResult` (from scoreRange) adds a line
// about the painted range in advanced mode; pass null in simple mode.
export function explainRead(item, rangeResult = null) {
  const hand = item.hand;
  const names = anonymizePlayers(hand);
  const positions = computeHandPositions(hand);
  const villain = names.get(item.villain);
  const recap = item.streets.map(st => {
    const acts = hand.streets[st.street]
      .filter(a => a.player === item.villain)
      .map(a => describeAction(a, hand, names, positions))
      .filter(Boolean);
    return {
      street: st.street,
      actions: acts.length ? acts : [villain + ' did not act'],
      actual: LABELS[st.actual],
    };
  });

  const path = item.streets.map(st => st.actual);
  const river = path[path.length - 1];
  const villainBetRiver = hand.streets.river.some(
    a => a.player === item.villain && (a.action === 'bet' || a.action === 'raise'),
  );
  const strongSinceFlop = path.slice(1).every(c => c === 'strong');
  let lesson;
  if (river === 'strong' && path.includes('draw')) {
    lesson =
      'They were drawing on an earlier street and got there on the river. When the river completes a flush or ' +
      'straight, keep the draws that called earlier streets in their range, not only hands that were already strong.';
  } else if (river === 'strong' && strongSinceFlop) {
    lesson =
      'They had a strong hand from the flop on. Strong hands don’t always raise: when villain just checks and calls, ' +
      'still include sets, two pair and better that are slow-playing.';
  } else if (river === 'strong') {
    lesson =
      'They improved to a strong hand on a later street. Think about which hands in their earlier range the turn or ' +
      'river card helps, such as two pair or trips made by a pair on the board.';
  } else if (river === 'nothing') {
    lesson = villainBetRiver
      ? 'They bet the river with nothing: a bluff' +
        (path.includes('draw') ? ', with a draw that missed' : '') +
        '. When the obvious draws miss, a river bet can be a missed draw, so include some air in their betting range.'
      : 'They reached showdown with nothing. Players often check down missed draws and high cards, so when villain ' +
        'plays passively their range can be weaker than it looks.';
  } else {
    lesson =
      'They had a one-pair hand. Medium-strength hands mostly check and call rather than bet big, so include top and ' +
      'middle pairs when villain plays passively.';
  }

  let rangeLine = null;
  if (rangeResult) {
    const pct = Math.round(rangeResult.share * 1000) / 10;
    rangeLine =
      `Their hand (${rangeResult.villainCell}) was ${rangeResult.hit ? '' : 'not '}in your range, ` +
      `which covered ${pct}% of the possible hands.`;
  }
  return { recap, rangeLine, lesson };
}

// Text for the quiz's Copy for Claude button: the whole hand (as in the hand table's button),
// plus what the player read on one street and what villain really had, with a request aimed
// at the read.
export function quizToClaudeText(item, street, readText, resultText) {
  const villain = anonymizePlayers(item.hand).get(item.villain);
  const st = item.streets.find(s => s.street === street);
  return handToClaudeText(item.hand, [], {
    context: [
      `I was practising hand reading on this hand, with ${villain}'s cards hidden until the end.`,
      `My read on the ${street}: ${readText}`,
      `What ${villain} really had on the ${street}: ${LABELS[st.actual]} (${item.villainCards.join(' ')}).`,
      resultText,
    ],
    instruction:
      `Explain what in ${villain}'s actions and the board pointed to their real holding on the ${street}, ` +
      'what my read got right or missed, and how to read this kind of spot better next time.',
  });
}

// Saved answers. `storage` is anything with getItem/setItem (the browser's localStorage, or a
// stand-in in tests). If storage is missing or refuses (private browsing, full), answers are
// kept in memory for this visit only.
const STORE_KEY = 'handReadingQuiz.v1';
const SETTING_PREFIX = 'handReadingQuiz.';

export function createQuizStore(storage) {
  let memory = [];
  function load() {
    if (!storage) return memory;
    try {
      const parsed = JSON.parse(storage.getItem(STORE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return memory;
    }
  }
  function save(records) {
    memory = records;
    if (!storage) return;
    try {
      storage.setItem(STORE_KEY, JSON.stringify(records));
    } catch {
      // keep the in-memory copy
    }
  }
  const memorySettings = {};
  return {
    all: load,
    add(record) {
      save([...load(), record]);
    },
    clear() {
      save([]);
    },
    // Remembered choices such as the answer type and timing, so the checkboxes stay as left.
    getSetting(name, fallback) {
      try {
        return (storage && storage.getItem(SETTING_PREFIX + name)) || memorySettings[name] || fallback;
      } catch {
        return memorySettings[name] || fallback;
      }
    },
    setSetting(name, value) {
      memorySettings[name] = value;
      try {
        if (storage) storage.setItem(SETTING_PREFIX + name, value);
      } catch {
        // keep the in-memory copy
      }
    },
  };
}
