// ---------- Trends over time ----------
// Turns saved history into points for the Trends tab's four charts. Pure: the render layer passes
// in the tournament groups, the play-quality mistakes, all-in results and quiz records.
//
// Each point of a tournament chart is one tournament, oldest first. A single tournament is a small
// sample, so every chart also has a rolling line that pools the last few tournaments' hands (pooled,
// not averaged, so a 30-hand tournament counts less than a 300-hand one).

import { computeStats } from './stats.js';
import { handSortKey } from './grouping.js';
import { scoreHands } from './quality.js';
import { normalizeMode } from './quiz.js';

export const ROLLING_TOURNAMENTS = 5;
export const ROLLING_ANSWERS = 20;

const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Groups oldest first, by the timestamp of their first hand.
export function chronological(groups) {
  const first = g => g.hands.reduce((m, h) => (m === null || byKey(handSortKey(h), m) < 0 ? handSortKey(h) : m), null);
  return groups
    .map(g => ({ g, k: first(g) || '' }))
    .sort((a, b) => byKey(a.k, b.k))
    .map(x => x.g);
}

// For each group, `value(hands)` of that group alone and of it pooled with the groups before it
// (up to `window` in all). Returns [{ key, name, date, hands, value, rolling }].
export function tournamentSeries(groups, value, window = ROLLING_TOURNAMENTS) {
  const ordered = chronological(groups);
  return ordered.map((g, i) => {
    const pooled = ordered.slice(Math.max(0, i - window + 1), i + 1).flatMap(x => x.hands);
    return {
      key: g.key,
      name: g.name,
      date: g.startDate || null,
      hands: g.hands.length,
      value: value(g.hands),
      rolling: value(pooled),
    };
  });
}

// Play quality: bb lost to mistakes per 100 hands (lower is better).
export function qualitySeries(groups, mistakesById, window) {
  return tournamentSeries(groups, hands => scoreHands(hands, mistakesById).bbPer100, window);
}

// One stat (a TARGET_STATS key, e.g. 'vpip'), for the groups of a single format only: stats are
// never blended across formats. A null value means the tournament had no qualifying hands.
export function statSeries(groups, format, statKey, window) {
  const cache = new Map();
  const stat = hands => {
    const id = hands.map(h => h.id).join(',');
    if (!cache.has(id)) cache.set(id, computeStats(hands));
    const v = cache.get(id)[statKey];
    return v === null || v === undefined ? null : Number(v); // computeStats gives '33.3'-style strings
  };
  return tournamentSeries(
    groups.filter(g => g.format === format),
    stat,
    window,
  );
}

// All-in luck: running totals in big blinds (each hand in its own big blind) of what Hero's
// all-ins were expected to win and what they actually won, oldest first. Luck = actual − expected.
export function luckSeries(results) {
  const sorted = results.slice().sort((a, b) => byKey(handSortKey(a.hand), handSortKey(b.hand)));
  let expected = 0;
  let actual = 0;
  return sorted.map(r => {
    expected += r.expectedNet / r.bb;
    actual += r.actualNet / r.bb;
    return {
      handId: r.hand.id,
      date: r.hand.dateStr || null,
      equity: r.heroEquity,
      expected,
      actual,
      luck: actual - expected,
    };
  });
}

// Quiz accuracy for one mode ('simple-every', 'advanced-river' and so on): the average score of
// the last `window` answers, after each answer. Records are oldest first, as saved.
export function quizSeries(records, mode, window = ROLLING_ANSWERS) {
  const rs = records.filter(r => normalizeMode(r.mode) === mode && typeof r.points === 'number');
  return rs.map((r, i) => {
    const last = rs.slice(Math.max(0, i - window + 1), i + 1);
    return {
      n: i + 1,
      at: r.at || null,
      points: r.points,
      rolling: last.reduce((t, x) => t + x.points, 0) / last.length,
    };
  });
}

// Modes that have at least one scored answer, for the mode picker.
export function quizModesUsed(records) {
  const seen = new Set();
  records.forEach(r => typeof r.points === 'number' && seen.add(normalizeMode(r.mode)));
  return [...seen];
}
