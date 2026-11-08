// ---------- Hand-reading quiz: building questions and scoring answers ----------
// Uses hands where an opponent's cards were shown as an answer key: the hand is replayed one
// street at a time with those cards hidden, and the player picks which categories villain could
// hold. See docs/ROADMAP.md 5.4.

import { categoriesForStreet, categoryOnStreet } from './handCategories.js';
import { handSortKey } from './grouping.js';

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

// Saved answers. `storage` is anything with getItem/setItem (the browser's localStorage, or a
// stand-in in tests). If storage is missing or refuses (private browsing, full), answers are
// kept in memory for this visit only.
const STORE_KEY = 'handReadingQuiz.v1';

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
  return {
    all: load,
    add(record) {
      save([...load(), record]);
    },
    clear() {
      save([]);
    },
  };
}
