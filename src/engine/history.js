// ---------- Saved hand history ----------
// Hands are saved as their original text (one record per hand, keyed by hand ID) and parsed again
// when loaded. Keeping the text rather than the parsed result means a parser fix later also
// improves hands saved earlier. The storage itself (IndexedDB in the browser) is passed in, so
// this logic can be tested without a browser.

import { parseHand, splitHands } from './parser.js';

// Records { id, raw } for every hand block in a pasted or uploaded text that has a hand ID.
export function recordsFromText(text) {
  return splitHands(text)
    .map(raw => ({ raw, hand: parseHand(raw) }))
    .filter(x => x.hand.id)
    .map(x => ({ id: x.hand.id, raw: x.raw }));
}

// How many of `incoming` aren't already saved (by hand ID).
export function countNew(savedIds, incoming) {
  const seen = new Set(savedIds);
  let n = 0;
  incoming.forEach(r => {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      n++;
    }
  });
  return n;
}

export function handsFromRecords(records) {
  return records.map(r => parseHand(r.raw));
}
