// ---------- Stats aggregation (Hero-focused) ----------
import { parseCard, bestHand } from './cards.js';
import { detectPreflopRace } from './races.js';
import { moreFlags } from './moreFlags.js';

export function computeStats(hands) {
  const s = {
    hands: hands.length,
    vpip: 0,
    pfr: 0,
    threeBetOpps: 0,
    threeBets: 0,
    facedThreeBetOpps: 0,
    foldedToThreeBet: 0,
    cbetOpps: 0,
    cbets: 0,
    facedCbetOpps: 0,
    foldedToCbet: 0,
    checkRaiseOpps: 0,
    checkRaises: 0,
    sawFlop: 0,
    reachedShowdownOfFlopsSeen: 0,
    wonAtShowdown: 0,
    postflopBets: 0,
    postflopCalls: 0,
    bigCalls: [],
    cheapFolds: [],
    threeBetOppsMissed: [],
    weakContinues: [],
    preflopRaces: [],
  };

  hands.forEach(h => {
    const race = detectPreflopRace(h);
    if (race) s.preflopRaces.push({ handId: h.id, matchups: race });

    const heroActs = h.streets.preflop.filter(
      a => a.player === 'Hero' && (a.action === 'call' || a.action === 'raise'),
    );
    if (heroActs.length) s.vpip++;
    if (h.streets.preflop.some(a => a.player === 'Hero' && a.action === 'raise')) s.pfr++;

    const raises = h.streets.preflop.filter(a => a.action === 'raise');

    if (raises.length >= 1 && raises[0].player !== 'Hero') {
      const openIdx = h.streets.preflop.indexOf(raises[0]);
      const heroRaiseAfterOpen = h.streets.preflop.find(
        (a, i) => a.player === 'Hero' && a.action === 'raise' && i > openIdx,
      );
      const heroCallAfterOpen = h.streets.preflop.find(
        (a, i) => a.player === 'Hero' && a.action === 'call' && i > openIdx,
      );
      s.threeBetOpps++;
      if (heroRaiseAfterOpen) s.threeBets++;
      else if (heroCallAfterOpen) s.threeBetOppsMissed.push({ handId: h.id });
    }

    if (raises.length >= 1 && raises[0].player === 'Hero') {
      const secondRaise = raises[1];
      if (secondRaise) {
        s.facedThreeBetOpps++;
        const heroResponseIdx = h.streets.preflop.findIndex(
          (a, i) => a.player === 'Hero' && i > h.streets.preflop.indexOf(secondRaise),
        );
        const heroResponse = h.streets.preflop[heroResponseIdx];
        if (heroResponse && heroResponse.action === 'fold') s.foldedToThreeBet++;
      }
    }

    const lastRaise = raises[raises.length - 1];
    const heroWasAggressor = lastRaise && lastRaise.player === 'Hero';
    const heroSawFlop = h.board.flop.length > 0 && h.heroFoldedOnStreet !== 'preflop';
    const heroWasCaller =
      !heroWasAggressor && h.streets.preflop.some(a => a.player === 'Hero' && a.action === 'call') && heroSawFlop;

    if (heroSawFlop) s.sawFlop++;
    if (h.board.flop.length && h.reachedShowdown) {
      s.reachedShowdownOfFlopsSeen++;
      if (h.summary.heroResult > 0) s.wonAtShowdown++;
    }

    if (heroSawFlop) {
      const flopActs = h.streets.flop;
      if (heroWasAggressor) {
        s.cbetOpps++;
        const heroFlopFirstAct = flopActs.find(a => a.player === 'Hero');
        if (heroFlopFirstAct && heroFlopFirstAct.action === 'bet') s.cbets++;
      } else if (heroWasCaller && lastRaise) {
        const aggressor = lastRaise.player;
        const aggressorBetIdx = flopActs.findIndex(a => a.player === aggressor && a.action === 'bet');
        if (aggressorBetIdx !== -1) {
          s.facedCbetOpps++;
          const heroRespIdx = flopActs.findIndex((a, i) => a.player === 'Hero' && i > aggressorBetIdx);
          if (flopActs[heroRespIdx] && flopActs[heroRespIdx].action === 'fold') s.foldedToCbet++;
        }
      }

      ['flop', 'turn', 'river'].forEach(street => {
        const acts = h.streets[street];
        acts.forEach(a => {
          if (a.player === 'Hero' && (a.action === 'bet' || a.action === 'raise')) s.postflopBets++;
          if (a.player === 'Hero' && a.action === 'call') s.postflopCalls++;
        });
        const heroCheckIdx = acts.findIndex(a => a.player === 'Hero' && a.action === 'check');
        if (heroCheckIdx !== -1) {
          const betAfter = acts.findIndex((a, i) => i > heroCheckIdx && a.action === 'bet');
          if (betAfter !== -1) {
            s.checkRaiseOpps++;
            const heroRaiseAfter = acts.findIndex(
              (a, i) => i > betAfter && a.player === 'Hero' && a.action === 'raise',
            );
            if (heroRaiseAfter !== -1) s.checkRaises++;
          }
        }
      });
    }

    ['preflop', 'flop', 'turn', 'river'].forEach(street => {
      h.streets[street].forEach(a => {
        if (a.player === 'Hero' && a.action === 'call') {
          const potAfterCall = a.potBefore + a.amount;
          const equityNeeded = a.amount / potAfterCall;
          if (equityNeeded > 0.4)
            s.bigCalls.push({
              handId: h.id,
              street,
              callAmount: a.amount,
              potBefore: a.potBefore,
              equityNeeded: (equityNeeded * 100).toFixed(1),
            });

          // Heuristic-only "possibly should have folded" flag: hero's OWN hand strength
          // relative to the board, at the moment of this call. No range/solver knowledge involved -
          // this says nothing about villain's actual hand. A single pair only counts as "weak"
          // when it's below the board's SECOND-highest distinct rank, not just below the very top
          // card - so pairing the second-highest board card (e.g. Kings on a board with an
          // unpaired Ace) reads as a normal top-two-ish holding, not a weak one; only a pair
          // that's third-best-or-worse on the board (closer to bottom pair) gets flagged.
          if (street !== 'preflop' && h.heroCards) {
            const boardSoFar =
              street === 'flop'
                ? h.board.flop
                : street === 'turn'
                  ? [...h.board.flop, h.board.turn]
                  : [...h.board.flop, h.board.turn, h.board.river];
            const ev = bestHand(h.heroCards, boardSoFar);
            if (ev) {
              const distinctBoardRanks = [...new Set(boardSoFar.map(c => parseCard(c).rank))].sort((x, y) => y - x);
              const secondBoardRank = distinctBoardRanks.length > 1 ? distinctBoardRanks[1] : distinctBoardRanks[0];
              const isWeak = ev.category === 0 || (ev.category === 1 && ev.tiebreak[0] < secondBoardRank);
              if (isWeak) {
                s.weakContinues.push({
                  handId: h.id,
                  street,
                  handClass: ev.name,
                  callAmount: a.amount,
                  potBefore: a.potBefore,
                });
              }
            }
          }
        }
        if (a.player === 'Hero' && a.action === 'fold' && a.toCall > 0) {
          const potAfterCall = a.potBefore + a.toCall;
          const equityNeeded = a.toCall / potAfterCall;
          if (equityNeeded < 0.2)
            s.cheapFolds.push({
              handId: h.id,
              street,
              toCall: a.toCall,
              potBefore: a.potBefore,
              equityNeeded: (equityNeeded * 100).toFixed(1),
            });
        }
      });
    });
  });

  // Missed value, raise-fold, committed folds and sizing (engine/moreFlags.js).
  Object.assign(s, moreFlags(hands));

  function pct(n, d) {
    return d > 0 ? ((n / d) * 100).toFixed(1) : null;
  }
  const threeBetDefended = s.facedThreeBetOpps - s.foldedToThreeBet;

  return {
    hands: s.hands,
    vpip: pct(s.vpip, s.hands),
    pfr: pct(s.pfr, s.hands),
    threeBet: pct(s.threeBets, s.threeBetOpps),
    foldToThreeBet: pct(s.foldedToThreeBet, s.facedThreeBetOpps),
    threeBetDefense: pct(threeBetDefended, s.facedThreeBetOpps),
    cbet: pct(s.cbets, s.cbetOpps),
    foldToCbet: pct(s.foldedToCbet, s.facedCbetOpps),
    checkRaise: pct(s.checkRaises, s.checkRaiseOpps),
    wtsd: pct(s.reachedShowdownOfFlopsSeen, s.sawFlop),
    wsd: pct(s.wonAtShowdown, s.reachedShowdownOfFlopsSeen),
    aggressionFactor:
      s.postflopCalls > 0 ? (s.postflopBets / s.postflopCalls).toFixed(2) : s.postflopBets > 0 ? '∞' : null,
    // [times it happened, chances] for each percentage stat, so the UI can show sample sizes and
    // confidence ranges (see engine/confidence.js).
    counts: {
      vpip: [s.vpip, s.hands],
      pfr: [s.pfr, s.hands],
      threeBet: [s.threeBets, s.threeBetOpps],
      foldToThreeBet: [s.foldedToThreeBet, s.facedThreeBetOpps],
      threeBetDefense: [threeBetDefended, s.facedThreeBetOpps],
      cbet: [s.cbets, s.cbetOpps],
      foldToCbet: [s.foldedToCbet, s.facedCbetOpps],
      checkRaise: [s.checkRaises, s.checkRaiseOpps],
      wtsd: [s.reachedShowdownOfFlopsSeen, s.sawFlop],
      wsd: [s.wonAtShowdown, s.reachedShowdownOfFlopsSeen],
    },
    raw: s,
  };
}
