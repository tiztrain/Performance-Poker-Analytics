// ---------- Confidence ranges for percentage stats ----------
// A stat like "3-bet 12%" from 50 chances could easily be a true 7% or 20% that ran hot or cold.
// The 95% confidence range is the band the true rate most likely sits in, given the sample. It
// narrows as the sample grows. This uses the Wilson score interval, which stays sensible for
// small samples and for rates near 0% or 100% (where the simpler textbook formula breaks down).

const Z = 1.96; // 95% confidence

// Returns { low, high } as percentages (0..100), or null when there are no chances at all.
export function wilsonRange(hits, chances) {
  if (!chances) return null;
  const p = hits / chances;
  const z2 = Z * Z;
  const centre = (p + z2 / (2 * chances)) / (1 + z2 / chances);
  const margin = (Z * Math.sqrt((p * (1 - p)) / chances + z2 / (4 * chances * chances))) / (1 + z2 / chances);
  return { low: Math.max(0, (centre - margin) * 100), high: Math.min(100, (centre + margin) * 100) };
}
