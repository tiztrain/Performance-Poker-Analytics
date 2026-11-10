// ---------- Money / card display helpers ----------
import { displayMode } from '../state.js';

export function fmt(n) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function amountLabel() {
  return displayMode === 'bb' ? 'bb' : 'chips';
}

// Unsigned amount (a bet size, a call size, a stack) - chips arg is a raw chip count.
export function fmtChips(chips, bbSize) {
  if (chips === null || chips === undefined) return '—';
  if (displayMode === 'chips') return fmt(chips);
  if (!bbSize) return '—';
  return (chips / bbSize).toFixed(2) + 'bb';
}

// Signed net result (a win/loss) - always carries a +/- sign.
export function fmtSigned(chips, bbSize) {
  if (chips === null || chips === undefined) return '—';
  if (displayMode === 'chips') return (chips >= 0 ? '+' : '') + fmt(chips);
  if (!bbSize) return '—';
  const bb = chips / bbSize;
  return (bb >= 0 ? '+' : '') + bb.toFixed(2) + 'bb';
}

// A rounded, unsigned starting-stack figure (bb mode rounds to whole bb, matching prior display).
export function fmtStack(chips, bbSize) {
  if (chips === null || chips === undefined) return '—';
  if (displayMode === 'chips') return fmt(chips);
  if (!bbSize) return '—';
  return (chips / bbSize).toFixed(0) + 'bb';
}

// Net result summed across a list of hands, in whichever unit is active. In bb mode this
// sums each hand's own bb-normalized result (the standard way to combine hands across
// different blind levels); in chips mode it sums raw chip results directly.
export function sumNetStr(hands) {
  if (displayMode === 'chips') {
    const total = hands.reduce((sum, h) => sum + (h.heroNetChips || 0), 0);
    return { str: (total >= 0 ? '+' : '') + fmt(total), cls: total > 0 ? 'good' : total < 0 ? 'leak' : '' };
  }
  const total = hands.reduce((sum, h) => sum + (h.heroNetBB || 0), 0);
  return { str: (total >= 0 ? '+' : '') + total.toFixed(2) + 'bb', cls: total > 0 ? 'good' : total < 0 ? 'leak' : '' };
}

// A card as a small white playing card (styled by .pcard in index.html, four-colour deck).
export function cardToIcon(cardStr) {
  const rank = cardStr[0];
  const suit = cardStr[1].toLowerCase();
  const suitMap = { h: '♥', d: '♦', c: '♣', s: '♠' };
  const icon = suitMap[suit] || suit;
  return '<span class="pcard ' + (suitMap[suit] ? suit : '') + '">' + rank + icon + '</span>';
}

export function cardsToIconStr(cardsArr) {
  return cardsArr.length ? cardsArr.map(cardToIcon).join(' ') : '—';
}

export function stackChangeStyle(netBB, startBB) {
  if (netBB === null || startBB === null || startBB === 0) return 'color:var(--text-primary);';
  const pct = Math.min(1, Math.abs(netBB) / startBB);
  const isPos = netBB >= 0;
  const base = isPos ? [90, 156, 124] : [192, 82, 79];
  const muted = [125, 131, 141];
  const t = 0.3 + pct * 0.7;
  const r = Math.round(muted[0] + (base[0] - muted[0]) * t);
  const g = Math.round(muted[1] + (base[1] - muted[1]) * t);
  const b = Math.round(muted[2] + (base[2] - muted[2]) * t);
  const weight = pct > 0.15 ? '700' : pct > 0.05 ? '600' : '400';
  const size = pct > 0.3 ? '14px' : '13px';
  return 'color: rgb(' + r + ',' + g + ',' + b + '); font-weight:' + weight + '; font-size:' + size + ';';
}

// A signed total that has already been summed both ways (raw chips, and each hand in its own big
// blinds), shown in whichever unit is active.
export function fmtSignedTotal(chipsTotal, bbTotal) {
  if (displayMode === 'chips') return (chipsTotal >= 0 ? '+' : '') + fmt(chipsTotal);
  return (bbTotal >= 0 ? '+' : '') + bbTotal.toFixed(2) + 'bb';
}
