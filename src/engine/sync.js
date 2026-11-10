// ---------- Cloud sync: merging settings between devices ----------
// Hands sync as append-only batches (merged by hand ID, so they never conflict). The smaller
// saved data in localStorage syncs as one settings snapshot, merged key by key:
// - Quiz answers: combined from both sides (an answer is never lost).
// - Review queue: reviewed marks combined; for each hand's drill, the further-along schedule wins.
// - Everything else (targets, ranges, quiz settings): a three-way merge against the snapshot
//   from the last sync. If only one side changed it since then, that side wins; if both did, this
//   device's version wins (it's the one in use now).
// - ICM payouts: the same three-way merge, but per tournament, so payouts entered for different
//   tournaments on two devices are both kept.

export const SYNC_KEYS = [
  'handReadingQuiz.v1',
  'handReadingQuiz.answerType',
  'handReadingQuiz.timing',
  'reviewQueue.v1',
  'statTargets.v1',
  'rangeModel.v1',
  'icmPayouts.v1',
];

export function snapshot(storage) {
  const values = {};
  SYNC_KEYS.forEach(k => {
    const v = storage.getItem(k);
    if (v !== null) values[k] = v;
  });
  return values;
}

function parse(v, fallback) {
  try {
    return v === undefined || v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function mergeQuiz(a, b) {
  const seen = new Set();
  const out = [];
  [...parse(a, []), ...parse(b, [])].forEach(r => {
    const id = (r.key || '') + '|' + (r.at || '');
    if (!seen.has(id)) {
      seen.add(id);
      out.push(r);
    }
  });
  out.sort((x, y) => (x.at || '').localeCompare(y.at || ''));
  return JSON.stringify(out);
}

function mergeReview(a, b) {
  const x = parse(a, { reviewed: {}, drills: {} });
  const y = parse(b, { reviewed: {}, drills: {} });
  const drills = { ...x.drills };
  Object.entries(y.drills || {}).forEach(([id, d]) => {
    const mine = drills[id];
    const further =
      !mine || d.level > mine.level || (d.level === mine.level && (d.due || Infinity) > (mine.due || Infinity));
    if (further) drills[id] = d;
  });
  return JSON.stringify({ reviewed: { ...x.reviewed, ...y.reviewed }, drills });
}

function threeWay(l, r, b) {
  return l === b ? r : l; // unchanged here: take theirs; changed here (or both): keep ours
}

function mergeEntries(l, r, b) {
  const x = parse(l, {});
  const y = parse(r, {});
  const z = parse(b, {});
  const out = {};
  new Set([...Object.keys(x), ...Object.keys(y)]).forEach(k => {
    const s = v => (v === undefined ? undefined : JSON.stringify(v));
    const v = threeWay(s(x[k]), s(y[k]), s(z[k]));
    if (v !== undefined) out[k] = JSON.parse(v);
  });
  return JSON.stringify(out);
}

// local, remote and base are { key: string } snapshots. Returns the merged snapshot.
export function mergeSnapshots(local, remote, base = {}) {
  const out = {};
  SYNC_KEYS.forEach(k => {
    const l = local[k];
    const r = remote[k];
    if (l === undefined && r === undefined) return;
    if (k === 'handReadingQuiz.v1') out[k] = mergeQuiz(l, r);
    else if (k === 'reviewQueue.v1') out[k] = mergeReview(l, r);
    else if (k === 'icmPayouts.v1') out[k] = mergeEntries(l, r, base[k]);
    else if (l === base[k])
      out[k] = r !== undefined ? r : l; // unchanged here: take theirs
    else out[k] = l !== undefined ? l : r; // changed here (or both): keep ours
  });
  return out;
}

// Splits records into batches for upload (each batch becomes one stored file).
export function batches(records, size = 500) {
  const out = [];
  for (let i = 0; i < records.length; i += size) out.push(records.slice(i, i + size));
  return out;
}
