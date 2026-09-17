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

export function getTargets(format) {
  if (format === 'hyper') {
    return {
      threeBetDefense: { label: 'no verified hyper benchmark — 3-bets are often effectively shoves at these depths' },
      foldToThreeBet: { label: 'less standardized in hypers — shallow stacks mean many 3-bets are polarized shoves' },
      foldToCbet: { label: 'less standardized — fewer postflop streets play out at this speed' },
      checkRaise: { label: 'less relevant — stacks are often committed before a check-raise spot arises' },
    };
  }
  if (format === 'satellite') {
    return {
      threeBetDefense: { label: "satellites are ICM/seat-driven — standard chip-EV benchmarks don't directly apply" },
      foldToThreeBet: { label: 'satellite play is about survival for a seat, not this frequency' },
      foldToCbet: { label: 'bubble ICM pressure changes correct folding a lot here — no fixed target' },
      checkRaise: { label: 'rarely the right lens in a satellite — seat equity dominates the decision' },
    };
  }
  // regular and turbo share the same numeric benchmarks
  return {
    threeBetDefense: { min: 45, watch: 35, label: 'target ~45-50%' },
    foldToThreeBet: { min: 50, watch: 40, label: 'target 50-55%' },
    foldToCbet: { min: 47, watch: 35, label: 'target 47-50%' },
    checkRaise: { min: 8, watch: 4, label: 'target 8-10%' },
  };
}
