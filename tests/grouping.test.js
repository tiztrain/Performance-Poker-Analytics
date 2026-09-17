import { describe, it, expect } from 'vitest';
import { groupByTournament, handSortKey, groupStartDate, distinctGroupDates } from '../src/engine/grouping.js';

// Minimal hand-shaped fixtures - just the fields groupByTournament/handSortKey/groupStartDate
// actually read.
function h(id, tourney, tourneyId, dateStr, timeStr) {
  return { id, tourney, tourneyId, dateStr, timeStr };
}

describe('groupByTournament (regression: recurring tournament names)', () => {
  it('does NOT merge separate runs of a recurring tournament that share a display name', () => {
    // CoinPoker reuses the exact same name for every nightly occurrence of a recurring
    // tournament, distinguished only by its internal tournament id. Grouping by name
    // alone silently merged unrelated runs (different days, different results) into
    // one combined group - this is the bug found and fixed against real exported data.
    const hands = [
      h('1', 'Midnight Grand Prix', '96300', '2026/09/08', '10:05:11'),
      h('2', 'Midnight Grand Prix', '96300', '2026/09/08', '10:06:00'),
      h('3', 'Midnight Grand Prix', '93762', '2026/09/10', '12:00:00'),
      h('4', 'Midnight Grand Prix', '98345', '2026/09/11', '13:00:00'),
    ];
    const groups = groupByTournament(hands);
    expect(groups).toHaveLength(3);
    const byId = Object.fromEntries(groups.map(g => [g.tourneyId, g]));
    expect(byId['96300'].hands).toHaveLength(2);
    expect(byId['93762'].hands).toHaveLength(1);
    expect(byId['98345'].hands).toHaveLength(1);
    // Every group's hands must all share that group's own tournament id.
    groups.forEach(g => {
      expect(new Set(g.hands.map(x => x.tourneyId)).size).toBe(1);
    });
  });

  it('still groups hands from the SAME tournament id together', () => {
    const hands = [
      h('1', 'Friday Sprint', '111', '2026/09/08', '09:00:00'),
      h('2', 'Friday Sprint', '111', '2026/09/08', '09:05:00'),
      h('3', 'Saturday Sprint', '222', '2026/09/09', '09:00:00'),
    ];
    const groups = groupByTournament(hands);
    expect(groups).toHaveLength(2);
  });

  it('falls back to a stable "Unknown tournament" bucket when tourney is missing', () => {
    const hands = [h('1', null, null, '2026/09/08', '09:00:00')];
    const groups = groupByTournament(hands);
    expect(groups[0].name).toBe('Unknown tournament');
  });
});

describe('handSortKey / groupStartDate (regression: non-chronological hand IDs)', () => {
  it('sorts by actual timestamp, not by numeric hand id', () => {
    // Confirmed against real exported data: CoinPoker hand IDs are not reliably
    // chronological (likely a per-table counter rather than a global clock) - a hand
    // with a LOWER id can be played AFTER one with a higher id. Sorting a session's
    // hands by id can therefore show the wrong hand as "last".
    const early = h('999999', 'X', '1', '2026/09/10', '12:00:00');
    const late = h('100000', 'X', '1', '2026/09/10', '12:30:00'); // lower id, later time
    const hands = [early, late];
    const sorted = hands
      .slice()
      .sort((a, b) => (handSortKey(a) < handSortKey(b) ? -1 : handSortKey(a) > handSortKey(b) ? 1 : 0));
    expect(sorted[0].id).toBe('999999');
    expect(sorted[1].id).toBe('100000');
  });

  it('falls back to id-based ordering when a hand has no parsed timestamp', () => {
    const a = h('100', 'X', '1', null, null);
    const b = h('200', 'X', '1', null, null);
    expect(handSortKey(a) < handSortKey(b)).toBe(true);
  });

  it("groupStartDate picks the chronologically first hand's date, not the lowest hand id's", () => {
    const group = {
      hands: [
        h('999999', 'X', '1', '2026/09/09', '00:10:00'), // lower id, but a LATER date
        h('100000', 'X', '1', '2026/09/08', '23:50:00'), // higher id, but the true first hand
      ],
    };
    expect(groupStartDate(group)).toBe('2026/09/08');
  });
});

describe('distinctGroupDates', () => {
  it('returns sorted unique start dates across groups', () => {
    const groups = [
      { startDate: '2026/09/10' },
      { startDate: '2026/09/08' },
      { startDate: '2026/09/08' },
      { startDate: null },
    ];
    expect(distinctGroupDates(groups)).toEqual(['2026/09/08', '2026/09/10']);
  });
});
