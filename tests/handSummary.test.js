import { describe, it, expect } from 'vitest';
import { parseAll, parseHand } from '../src/engine/parser.js';
import { computeStats } from '../src/engine/stats.js';
import { SAMPLE } from '../src/sample-hand.js';
import { anonymizePlayers, flagReasonsForHand, handToClaudeText } from '../src/engine/handSummary.js';

// Player IDs are made up, like the ones in src/sample-hand.js.
const PREFLOP_JAM_CALL = `CoinPoker Hand #900000000001: NLH (1,000/2,000/250) 2026/09/09 21:15:02 AEST
Tournament 'Test Turbo' '50001' 7-max Seat #1 is the button
Seat 1: a1b2c3d4 (24,000 in chips)
Seat 2: Hero (30,500 in chips)
Seat 3: e5f6a7b8 (41,000 in chips)
a1b2c3d4: posts ante 250
Hero: posts ante 250
e5f6a7b8: posts ante 250
Hero: posts small blind 1,000
e5f6a7b8: posts big blind 2,000
*** HOLE CARDS ***
Dealt to Hero [Ah Jd]
a1b2c3d4: ALLIN 23,750
Hero: calls 22,750
e5f6a7b8: folds
*** FLOP *** [Kc 8d 3s]
*** TURN *** [Kc 8d 3s] [2h]
*** RIVER *** [Kc 8d 3s 2h] [Jc]
*** SHOWDOWN ***
a1b2c3d4: shows [Qs Qd] (Pair of Queens)
Hero: shows [Ah Jd] (Pair of Jacks)
a1b2c3d4 collected 50,250 from pot
*** SUMMARY ***
Total pot 50,250
Board [ Kc 8d 3s 2h Jc ]`;

const RIVER_BLUFF = `CoinPoker Hand #900000000002: NLH (100/200/25) 2026/09/09 20:01:10 AEST
Tournament 'Test Regular' '50002' 6-max Seat #3 is the button
Seat 1: 0f1e2d3c (8,000 in chips)
Seat 2: 9a8b7c6d (12,400 in chips)
Seat 3: Hero (10,000 in chips)
0f1e2d3c: posts ante 25
9a8b7c6d: posts ante 25
Hero: posts ante 25
0f1e2d3c: posts small blind 100
9a8b7c6d: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [7s 6s]
Hero: raises 250 to 450
0f1e2d3c: folds
9a8b7c6d: calls 250
*** FLOP *** [Kh Td 2s]
9a8b7c6d: checks
Hero: bets 500
9a8b7c6d: calls 500
*** TURN *** [Kh Td 2s] [4c]
9a8b7c6d: checks
Hero: checks
*** RIVER *** [Kh Td 2s 4c] [Ah]
9a8b7c6d: checks
Hero: bets 1,500
9a8b7c6d: folds
Hero: RETURN 1,500
*** SHOWDOWN ***
Hero collected 2,075 from pot
*** SUMMARY ***
Total pot 2,075
Board [ Kh Td 2s 4c Ah ]`;

const INSTRUCTION =
  "This is a post-session review of a tournament hand I played. For each of my decisions, explain what my opponent's range likely was at that point, whether my action was a good one, and what I should consider next time. Judge the decisions, not the result.";

describe('handToClaudeText', () => {
  it('describes a preflop all-in call with the equity needed', () => {
    expect(handToClaudeText(parseHand(PREFLOP_JAM_CALL))).toBe(
      [
        "Poker hand for post-session review: No-Limit Hold'em tournament (format: turbo), hand #900000000001.",
        'Blinds 1000/2000, ante 250. 3 players dealt in at a 7-max table. All amounts are in big blinds (bb).',
        '',
        'Players (preflop seat order), starting stacks:',
        '- Hero (SB): 15.3bb holding Ah Jd',
        '- Villain 1 (BB): 20.5bb',
        '- Villain 2 (BTN): 12bb',
        'Effective stack (Hero vs the biggest other stack): 15.3bb',
        '',
        'Preflop, pot 1.9bb.',
        '- Villain 2 (BTN) raises to 11.9bb (all-in)',
        '- Hero (SB) calls 11.4bb (needs 45% equity: call / (pot + call))',
        '- Villain 1 (BB) folds',
        '',
        'Flop [Kc 8d 3s], pot 25.1bb, SPR 0. Hero has High Card.',
        '',
        'Turn [Kc 8d 3s 2h], pot 25.1bb. Hero has High Card.',
        '',
        'River [Kc 8d 3s 2h Jc], pot 25.1bb. Hero has Pair.',
        '',
        'Cards shown by opponents:',
        '- Villain 2: Qs Qd (Pair of Queens)',
        '',
        "Result (context only): Villain 2 won 25.1bb. Hero's net: -12bb.",
        '',
        INSTRUCTION,
      ].join('\n'),
    );
  });

  it('describes a multi-street value hand (sample hand 2: river straight bet for value)', () => {
    const hand = parseAll(SAMPLE)[1];
    const text = handToClaudeText(hand, ['Example reason.']);
    expect(text).toBe(
      [
        "Poker hand for post-session review: No-Limit Hold'em tournament (format: regular), hand #162993700002.",
        'Blinds 250/500, ante 75. 6 players dealt in at a 7-max table. All amounts are in big blinds (bb).',
        '',
        'Players (preflop seat order), starting stacks:',
        '- Villain 1 (SB): 101.4bb',
        '- Hero (BB): 99.9bb holding Qs 8c',
        '- Villain 2 (UTG): 99.9bb',
        '- Villain 3 (HJ): 99.9bb',
        '- Villain 4 (CO): 99.9bb',
        '- Villain 5 (BTN): 99.4bb',
        'Effective stack (Hero vs the biggest other stack): 99.9bb',
        '',
        'Preflop, pot 2.4bb.',
        '- Villain 2 (UTG) raises to 2bb',
        '- Villain 3 (HJ) folds',
        '- Villain 4 (CO) folds',
        '- Villain 5 (BTN) folds',
        '- Villain 1 (SB) folds',
        '- Hero (BB) calls 1bb (needs 19% equity: call / (pot + call))',
        '',
        'Flop [4s 7c 9h], pot 5.4bb, SPR 18.1. Hero has High Card.',
        '- Hero (BB) checks',
        '- Villain 2 (UTG) checks',
        '',
        'Turn [4s 7c 9h 5s], pot 5.4bb. Hero has High Card.',
        '- Hero (BB) checks',
        '- Villain 2 (UTG) checks',
        '',
        'River [4s 7c 9h 5s 6c], pot 5.4bb. Hero has Straight.',
        '- Hero (BB) bets 1.8bb (33% of pot)',
        '- Villain 2 (UTG) calls 1.8bb',
        '',
        "Result (context only): Hero won 9bb. Hero's net: +5bb.",
        '',
        'Why the app flagged this hand (heuristics, not verdicts):',
        '- Example reason.',
        '',
        INSTRUCTION,
      ].join('\n'),
    );
  });

  it('describes a river bluff with bet sizes as % of pot', () => {
    expect(handToClaudeText(parseHand(RIVER_BLUFF))).toBe(
      [
        "Poker hand for post-session review: No-Limit Hold'em tournament (format: regular), hand #900000000002.",
        'Blinds 100/200, ante 25. 3 players dealt in at a 6-max table. All amounts are in big blinds (bb).',
        '',
        'Players (preflop seat order), starting stacks:',
        '- Villain 1 (SB): 40bb',
        '- Villain 2 (BB): 62bb',
        '- Hero (BTN): 50bb holding 7s 6s',
        'Effective stack (Hero vs the biggest other stack): 50bb',
        '',
        'Preflop, pot 1.9bb.',
        '- Hero (BTN) raises to 2.3bb',
        '- Villain 1 (SB) folds',
        '- Villain 2 (BB) calls 1.3bb',
        '',
        'Flop [Kh Td 2s], pot 5.4bb, SPR 8.9. Hero has High Card.',
        '- Villain 2 (BB) checks',
        '- Hero (BTN) bets 2.5bb (47% of pot)',
        '- Villain 2 (BB) calls 2.5bb',
        '',
        'Turn [Kh Td 2s 4c], pot 10.4bb. Hero has High Card.',
        '- Villain 2 (BB) checks',
        '- Hero (BTN) checks',
        '',
        'River [Kh Td 2s 4c Ah], pot 10.4bb. Hero has High Card.',
        '- Villain 2 (BB) checks',
        '- Hero (BTN) bets 7.5bb (72% of pot)',
        '- Villain 2 (BB) folds',
        '',
        "Result (context only): Hero won 10.4bb. Hero's net: +5.5bb.",
        '',
        INSTRUCTION,
      ].join('\n'),
    );
  });

  it('never includes real player IDs', () => {
    const hands = [...parseAll(SAMPLE), parseHand(PREFLOP_JAM_CALL), parseHand(RIVER_BLUFF)];
    hands.forEach(h => {
      const text = handToClaudeText(h);
      h.seats.filter(s => s.name !== 'Hero').forEach(s => expect(text).not.toContain(s.name));
    });
  });

  it('numbers villains in seat order and keeps Hero', () => {
    const names = anonymizePlayers(parseHand(RIVER_BLUFF));
    expect([...names.values()]).toEqual(['Villain 1', 'Villain 2', 'Hero']);
  });
});

describe('flagReasonsForHand', () => {
  it('turns the stat flags for a hand into readable reasons', () => {
    const hands = parseAll(SAMPLE);
    const raw = computeStats(hands).raw;
    expect(flagReasonsForHand(raw, '162993700002')).toEqual([
      'Called an opening raise instead of 3-betting (a 3-bet frequency prompt, not a verdict).',
    ]);
    expect(flagReasonsForHand(raw, '162993700001')).toEqual([]);
  });
});
