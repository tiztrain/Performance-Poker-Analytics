import { parseCard } from './cards.js';

// Heuristic-only: flags a hand where hero committed most of their stack preflop with
// no further postflop decisions (i.e. an effective preflop shove-and-runout), and at
// showdown their holding forms one of two recognizable archetypes against a shown
// opponent hand: a genuine ~50/50 coinflip (pocket pair vs two live overcards, either
// direction), or hero holding the DOMINATED lower pocket pair against a shown higher
// pair (a ~80/20 cooler, not really a flip, but the same "was this worth it" category).
// This is pattern matching on ranks only - no suits/equity engine - so it will miss
// plenty of real races and can't say anything about hands that didn't reach showdown.
export function detectPreflopRace(h) {
  if (!h.heroCards || h.heroCards.length !== 2) return null;
  if (!h.heroStartStack || h.heroStartStack <= 0) return null;
  const heroActedPostflop = ['flop', 'turn', 'river'].some(street => h.streets[street].some(a => a.player === 'Hero'));
  if (heroActedPostflop) return null; // hero had real postflop decisions - not a clean shove
  if (h.heroFoldedOnStreet) return null; // never got to showdown
  if (h.heroInvested / h.heroStartStack < 0.55) return null; // not a real stack commitment
  const heroRanks = h.heroCards.map(c => parseCard(c).rank);
  const heroPair = heroRanks[0] === heroRanks[1];
  // A player can appear in h.shows more than once (CoinPoker repeats the "shows" line
  // once per side pot they collect from) - dedupe by player so a real multi-way hand
  // doesn't produce the same matchup twice.
  const seenOpponents = new Set();
  const opponents = h.shows.filter(sh => {
    if (sh.player === 'Hero' || !sh.cards || sh.cards.length !== 2) return false;
    if (seenOpponents.has(sh.player)) return false;
    seenOpponents.add(sh.player);
    return true;
  });
  if (!opponents.length) return null;
  const matchups = [];
  opponents.forEach(o => {
    const vRanks = o.cards.map(c => parseCard(c).rank);
    const villainPair = vRanks[0] === vRanks[1];
    if (heroPair && villainPair && heroRanks[0] !== vRanks[0] && heroRanks[0] < vRanks[0]) {
      matchups.push({ type: 'dominated-pair', villain: o.player, villainCards: o.cards, villainClass: o.handClass });
    } else if (heroPair && !villainPair && Math.min(vRanks[0], vRanks[1]) > heroRanks[0]) {
      matchups.push({ type: 'flip', villain: o.player, villainCards: o.cards, villainClass: o.handClass });
    } else if (!heroPair && villainPair && Math.min(heroRanks[0], heroRanks[1]) > vRanks[0]) {
      matchups.push({ type: 'flip', villain: o.player, villainCards: o.cards, villainClass: o.handClass });
    }
  });
  return matchups.length ? matchups : null;
}
