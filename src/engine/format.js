// Classifies a tournament by name into one of four buckets whose correct
// strategy differs enough that their stats should never be blended together:
// regular MTTs, turbos, hypers, and satellites/steps (won-a-seat, ICM-driven).
export function classifyFormat(name) {
  const n = name || '';
  // No \b word-boundary on hyper/turbo - a compound name like "TurboCharger" or
  // "Hyperturbo" has no boundary between the word and what follows it, so \bturbo\b
  // was silently missing those and falling through to "regular".
  if (/hyper/i.test(n)) return 'hyper';
  if (/turbo/i.test(n)) return 'turbo';
  if (/\bseats?\s+to\b/i.test(n) || /\bstep\s*\[/i.test(n) || /\bsatellite\b/i.test(n) || /\bqualifier\b/i.test(n))
    return 'satellite';
  return 'regular';
}
export const FORMAT_LABELS = { regular: 'regular', turbo: 'TURBO', hyper: 'HYPER', satellite: 'SATELLITE' };
export const FORMAT_ORDER = ['regular', 'turbo', 'hyper', 'satellite'];
