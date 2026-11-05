// ---------- Tournament grouping and date helpers ----------
import { classifyFormat } from './format.js';

// CoinPoker's hand IDs are not reliably chronological - they can go slightly backwards
// hand-to-hand (likely a per-table counter rather than a global clock), so sorting by ID
// can put the true last hand of a session out of order. Sort by the hand's own recorded
// timestamp instead, falling back to ID only when a hand has no parsed timestamp.
export function handSortKey(h) {
  if (h.dateStr && h.timeStr) return h.dateStr.replace(/\//g, '') + h.timeStr.replace(/:/g, '');
  return String(h.id || '0').padStart(20, '0');
}

export function groupByTournament(hands) {
  // Keyed by name+tournamentId, not name alone: CoinPoker reuses the same display
  // name for every occurrence of a recurring tournament (e.g. a nightly "Midnight
  // Grand Prix" run under a fresh tournament ID each time), so name-only grouping
  // would silently merge separate runs - different days, different results - into
  // one combined group.
  const groups = {};
  const order = [];
  hands.forEach(h => {
    const name = h.tourney || 'Unknown tournament';
    const key = name + '::' + (h.tourneyId || '');
    if (!groups[key]) {
      groups[key] = { key, name, tourneyId: h.tourneyId || null, hands: [], format: classifyFormat(name) };
      order.push(key);
    }
    groups[key].hands.push(h);
  });
  return order.map(k => groups[k]);
}

// ---------- Date helpers (for the optional date filter, only shown when a paste spans multiple days) ----------
// The date FILTER buckets by each tournament's start date (its earliest hand),
// not by individual hand timestamps — so a tournament that runs past midnight
// stays together in one bucket instead of being split across two days.
export function groupStartDate(group) {
  const withDate = group.hands
    .filter(h => h.dateStr)
    .sort((a, b) => (handSortKey(a) < handSortKey(b) ? -1 : handSortKey(a) > handSortKey(b) ? 1 : 0));
  return withDate.length ? withDate[0].dateStr : null;
}

export function distinctGroupDates(groups) {
  const set = new Set();
  groups.forEach(g => {
    if (g.startDate) set.add(g.startDate);
  });
  return Array.from(set).sort();
}

export function formatDateLabel(dateStr) {
  const parts = (dateStr || '').split('/');
  if (parts.length !== 3) return dateStr || 'Unknown date';
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
