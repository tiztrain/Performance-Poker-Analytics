// ---------- Target ranges per stat ----------
// Each stat can have a target range per format. A stat inside its range is "good"; a little
// outside (up to a quarter of the range's width, at least 3 points) is "watch"; further out is a
// "leak". Too high counts as much as too low: folding to 3-bets 70% of the time is a leak too.
//
// Defaults: regular uses common tournament ranges. Turbo and hyper are estimates (shallower stacks
// mean looser, more aggressive play), and satellite has none, because seat-equity play doesn't
// fit fixed frequencies. All of them can be overridden by the player (saved in this browser).
// See docs/ROADMAP.md section 9.

export const TARGET_STATS = [
  { key: 'vpip', label: 'VPIP' },
  { key: 'pfr', label: 'PFR' },
  { key: 'threeBet', label: '3-bet' },
  { key: 'threeBetDefense', label: '3-bet defense' },
  { key: 'foldToThreeBet', label: 'Fold to 3-bet' },
  { key: 'cbet', label: 'C-bet' },
  { key: 'foldToCbet', label: 'Fold to c-bet' },
  { key: 'checkRaise', label: 'Check-raise' },
  { key: 'wtsd', label: 'WTSD' },
  { key: 'wsd', label: 'W$SD' },
];

const r = (min, max) => ({ min, max });

export const DEFAULT_TARGETS = {
  regular: {
    vpip: r(18, 26),
    pfr: r(14, 20),
    threeBet: r(6, 10),
    threeBetDefense: r(45, 50),
    foldToThreeBet: r(50, 55),
    cbet: r(55, 70),
    foldToCbet: r(47, 50),
    checkRaise: r(8, 10),
    wtsd: r(25, 32),
    wsd: r(50, 56),
  },
  turbo: {
    vpip: r(20, 28),
    pfr: r(16, 23),
    threeBet: r(7, 12),
    threeBetDefense: r(42, 50),
    foldToThreeBet: r(45, 55),
    cbet: r(55, 70),
    foldToCbet: r(42, 50),
    checkRaise: r(7, 11),
    wtsd: r(26, 34),
    wsd: r(50, 56),
  },
  hyper: {
    vpip: r(24, 34),
    pfr: r(20, 30),
    threeBet: r(8, 15),
    threeBetDefense: r(40, 55),
    foldToThreeBet: r(35, 50),
    cbet: r(55, 75),
    foldToCbet: r(35, 50),
    checkRaise: r(5, 12),
    wtsd: r(30, 40),
    wsd: r(48, 55),
  },
  satellite: {},
};

export function isValidRange(range) {
  return (
    !!range &&
    Number.isFinite(range.min) &&
    Number.isFinite(range.max) &&
    range.min >= 0 &&
    range.max <= 100 &&
    range.min <= range.max
  );
}

// Defaults for a format with the player's overrides on top. An override of null removes a
// default target for that stat.
export function effectiveTargets(format, overrides = {}) {
  const out = { ...(DEFAULT_TARGETS[format] || {}) };
  Object.entries(overrides[format] || {}).forEach(([key, range]) => {
    if (range === null) delete out[key];
    else if (isValidRange(range)) out[key] = range;
  });
  return out;
}

export function gradeStat(value, range) {
  if (value === null || value === undefined || !range) return '';
  const v = Number(value);
  if (v >= range.min && v <= range.max) return 'good';
  const margin = Math.max(3, (range.max - range.min) / 4);
  if (v >= range.min - margin && v <= range.max + margin) return 'watch';
  return 'leak';
}

export function rangeLabel(range) {
  return 'target ' + range.min + '–' + range.max + '%';
}

// Saved overrides: { format: { statKey: {min, max} | null } }. Storage is passed in (the
// browser's localStorage, or a stand-in in tests), with an in-memory fallback.
const KEY = 'statTargets.v1';

export function createTargetStore(storage) {
  let memory = {};
  function load() {
    if (!storage) return memory;
    try {
      const v = JSON.parse(storage.getItem(KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      return memory;
    }
  }
  function save(v) {
    memory = v;
    if (!storage) return;
    try {
      storage.setItem(KEY, JSON.stringify(v));
    } catch {
      // keep the in-memory copy
    }
  }
  return {
    load,
    setOverride(format, key, range) {
      if (range !== null && !isValidRange(range)) return false;
      const v = load();
      v[format] = { ...(v[format] || {}), [key]: range };
      save(v);
      return true;
    },
    removeOverride(format, key) {
      const v = load();
      if (v[format]) delete v[format][key];
      save(v);
    },
    clearFormat(format) {
      const v = load();
      delete v[format];
      save(v);
    },
  };
}
