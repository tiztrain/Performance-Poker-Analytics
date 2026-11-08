import { describe, it, expect } from 'vitest';
import {
  categoriesForStreet,
  hasFlushDraw,
  hasOpenEndedStraightDraw,
  postflopCategory,
  preflopCategory,
} from '../src/engine/handCategories.js';
import { parseCard } from '../src/engine/cards.js';
import {
  buildQuizItems,
  createQuizStore,
  explainRead,
  modeKey,
  normalizeMode,
  quizToClaudeText,
  recordsForMode,
  scoreAnswer,
  summarizeAnswers,
} from '../src/engine/quiz.js';
import { scoreRange } from '../src/engine/rangeGrid.js';
import { parseHand } from '../src/engine/parser.js';

const cards = s => s.split(' ');
const parsed = s => cards(s).map(parseCard);

describe('preflopCategory', () => {
  it.each([
    ['As Ah', 'bigPair'],
    ['Ts Td', 'bigPair'],
    ['9s 9d', 'smallPair'],
    ['2c 2d', 'smallPair'],
    ['Ad Kc', 'broadway'],
    ['Qh Ts', 'broadway'],
    ['8s 7s', 'suitedConnector'],
    ['9h 6h', 'suitedConnector'],
    ['9h 5h', 'other'], // 4 apart
    ['8s 7d', 'other'], // offsuit
    ['As 5s', 'other'], // a suited wheel ace is not a connector
    ['Ac 9d', 'other'],
  ])('%s is %s', (hole, expected) => {
    expect(preflopCategory(cards(hole))).toBe(expected);
  });
});

describe('postflopCategory', () => {
  it.each([
    // strong
    ['Ks Kd', 'Kc 7d 2h', 'strong', 'set'],
    ['Kh 7c', 'Kc 7d 2h', 'strong', 'two pair with both hole cards'],
    ['9s 8s', 'Ts Js 2d Qh', 'strong', 'made straight'],
    ['Kd 9c', 'Kc Kh 5s', 'strong', 'trips with a board pair'],
    // pairs
    ['Ah Kc', 'Kd 7s 2c', 'topPair', 'top pair'],
    ['Qs Qh', 'Jd 7s 2c', 'topPair', 'overpair'],
    ['As 7h', 'Kd 7s 2c', 'weakPair', 'middle pair'],
    ['5s 5h', 'Kd 7s 2c', 'weakPair', 'pocket pair below the top card'],
    ['Ah 7s', 'Ks 9s 7d 2h', 'weakPair', 'pair plus nothing else'],
    ['Ah Ks', 'Ks 9s 3s 2h', 'topPair', 'made hand beats the flush draw it also has'],
    // draws
    ['Ah 4h', 'Kh 9h 2c', 'draw', 'flush draw'],
    ['8c 7d', '9s 6h 2c', 'draw', 'open-ended straight draw'],
    // nothing
    ['8c 7d', 'Ts 5h 2c', 'nothing', 'gutshot only'],
    ['Ac Qd', '9s 6h 2c', 'nothing', 'two overcards'],
    ['Ac Kd', '9s 9h 2c', 'nothing', 'the pair is only on the board'],
    ['Ah 4h', 'Kh 9h 2c 3s Js', 'nothing', 'missed draw on the river'],
    ['Ac Kd', '9s 9h 5c 5d', 'nothing', 'two pair only on the board'],
  ])('%s on %s is %s (%s)', (hole, board, expected) => {
    expect(postflopCategory(cards(hole), cards(board))).toBe(expected);
  });
});

describe('draw detection', () => {
  it('needs one of villain’s cards in the flush draw', () => {
    expect(hasFlushDraw(parsed('Ac Kd'), parsed('2h 5h 9h Jh'))).toBe(false);
  });

  it('treats a one-ended straight draw as not open-ended', () => {
    expect(hasOpenEndedStraightDraw(parsed('Ah 2c'), parsed('3d 4s 9h'))).toBe(false); // A-2-3-4
    expect(hasOpenEndedStraightDraw(parsed('Ah Kc'), parsed('Qd Js 2h'))).toBe(false); // J-Q-K-A
    expect(hasOpenEndedStraightDraw(parsed('5h 4c'), parsed('3d 2s Kh'))).toBe(true); // 2-3-4-5: A or 6
  });

  it('offers no draw category on the river', () => {
    expect(categoriesForStreet('river').map(c => c.id)).not.toContain('draw');
    expect(categoriesForStreet('flop').map(c => c.id)).toContain('draw');
  });
});

describe('scoreAnswer', () => {
  it('rewards picking the right category and few others', () => {
    expect(scoreAnswer(['topPair'], 'topPair', 5)).toBe(100);
    expect(scoreAnswer(['topPair', 'draw'], 'topPair', 5)).toBe(75);
    expect(scoreAnswer(['topPair', 'draw', 'nothing'], 'topPair', 5)).toBe(50);
    expect(scoreAnswer(['strong', 'topPair', 'weakPair', 'draw', 'nothing'], 'topPair', 5)).toBe(0);
  });

  it('scores a miss or an empty answer as 0', () => {
    expect(scoreAnswer(['draw'], 'topPair', 5)).toBe(0);
    expect(scoreAnswer([], 'topPair', 5)).toBe(0);
  });

  it('scales to the 4 options on the river', () => {
    expect(scoreAnswer(['strong', 'topPair'], 'strong', 4)).toBe(67);
  });
});

describe('summarizeAnswers', () => {
  it('averages overall, by street, and recent against previous', () => {
    const records = [
      { street: 'preflop', points: 0 },
      { street: 'flop', points: 100 },
      { street: 'flop', points: 50 },
      { street: 'river', points: 70 },
    ];
    const s = summarizeAnswers(records, 2);
    expect(s.count).toBe(4);
    expect(s.average).toBe(55);
    expect(s.hitRate).toBe(75);
    expect(s.byStreet.flop).toEqual({ count: 2, average: 75 });
    expect(s.byStreet.turn).toEqual({ count: 0, average: null });
    expect(s.recent).toBe(60); // 50 and 70
    expect(s.previous).toBe(50); // 0 and 100
  });

  it('handles no answers', () => {
    expect(summarizeAnswers([]).average).toBeNull();
  });
});

describe('quiz modes', () => {
  it('names the four setting combinations', () => {
    expect(modeKey('advanced', 'every')).toBe('advanced-every');
  });

  it('maps records from earlier versions onto the new modes', () => {
    expect(normalizeMode(undefined)).toBe('simple-every');
    expect(normalizeMode('simple')).toBe('simple-every');
    expect(normalizeMode('advanced')).toBe('advanced-river');
    expect(normalizeMode('simple-river')).toBe('simple-river');
  });

  it('keeps scores separate per mode', () => {
    const records = [{ points: 1 }, { mode: 'simple-every', points: 2 }, { mode: 'advanced', points: 3 }];
    expect(recordsForMode(records, 'simple-every').map(r => r.points)).toEqual([1, 2]);
    expect(recordsForMode(records, 'advanced-river').map(r => r.points)).toEqual([3]);
    expect(recordsForMode(records, 'simple-river')).toEqual([]);
  });
});

describe('createQuizStore', () => {
  it('remembers settings', () => {
    const data = {};
    const storage = { getItem: k => data[k] ?? null, setItem: (k, v) => (data[k] = v) };
    expect(createQuizStore(storage).getSetting('timing', 'every')).toBe('every');
    createQuizStore(storage).setSetting('timing', 'river');
    expect(createQuizStore(storage).getSetting('timing', 'every')).toBe('river');
  });

  it('saves and reloads answers through storage', () => {
    const data = {};
    const storage = { getItem: k => data[k] ?? null, setItem: (k, v) => (data[k] = v) };
    const store = createQuizStore(storage);
    store.add({ street: 'flop', points: 100 });
    expect(createQuizStore(storage).all()).toEqual([{ street: 'flop', points: 100 }]);
    store.clear();
    expect(store.all()).toEqual([]);
  });

  it('keeps answers in memory when storage refuses', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createQuizStore(storage);
    store.add({ street: 'river', points: 50 });
    expect(store.all()).toEqual([{ street: 'river', points: 50 }]);
  });
});

describe('buildQuizItems', () => {
  // Made-up player IDs, like src/sample-hand.js.
  const SHOWDOWN = `CoinPoker Hand #900000000010: NLH (100/200/25) 2026/09/09 20:30:00 AEST
Tournament 'Test Regular' '50003' 6-max Seat #1 is the button
Seat 1: c0ffee01 (10,000 in chips)
Seat 2: Hero (10,000 in chips)
Seat 3: c0ffee02 (10,000 in chips)
c0ffee01: posts ante 25
Hero: posts ante 25
c0ffee02: posts ante 25
Hero: posts small blind 100
c0ffee02: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [Ac Jd]
c0ffee01: raises 300 to 500
Hero: calls 400
c0ffee02: folds
*** FLOP *** [Kh 9h 2c]
Hero: checks
c0ffee01: bets 600
Hero: calls 600
*** TURN *** [Kh 9h 2c] [5d]
Hero: checks
c0ffee01: checks
*** RIVER *** [Kh 9h 2c 5d] [Jh]
Hero: checks
c0ffee01: bets 1,500
Hero: calls 1,500
*** SHOWDOWN ***
c0ffee01: shows [Ah 4h] (Flush)
Hero: shows [Ac Jd] (Pair of Jacks)
c0ffee01 collected 5,475 from pot
*** SUMMARY ***
Total pot 5,475
Board [ Kh 9h 2c 5d Jh ]`;

  it('makes one item per showdown hand, with the right category on each street', () => {
    const items = buildQuizItems([parseHand(SHOWDOWN)]);
    expect(items).toHaveLength(1);
    expect(items[0].villain).toBe('c0ffee01');
    expect(items[0].streets.map(s => [s.street, s.actual])).toEqual([
      ['preflop', 'other'],
      ['flop', 'draw'],
      ['turn', 'draw'],
      ['river', 'strong'],
    ]);
    expect(items[0].streets[3].options).not.toContain('draw');
  });

  it('explains a finished hand street by street', () => {
    const item = buildQuizItems([parseHand(SHOWDOWN)])[0];
    const dead = ['Kh', '9h', '2c', '5d', 'Jh', 'Ac', 'Jd'];
    const ex = explainRead(item, scoreRange(new Set(['AA']), item.villainCards, dead));
    expect(ex.recap.map(r => [r.street, r.actual])).toEqual([
      ['preflop', 'Everything else'],
      ['flop', 'Draw'],
      ['turn', 'Draw'],
      ['river', 'Strong'],
    ]);
    expect(ex.recap[1].actions).toEqual(['Villain 2 (BTN) bets 3bb (47% of pot)']);
    expect(ex.rangeLine).toBe('Their hand (A4s) was not in your range, which covered 0.3% of the possible hands.');
    expect(ex.lesson).toMatch(/drawing on an earlier street and got there/);
    expect(explainRead(item).rangeLine).toBeNull();
  });

  it('builds Copy for Claude text about a read', () => {
    const item = buildQuizItems([parseHand(SHOWDOWN)])[0];
    const text = quizToClaudeText(item, 'flop', 'Top pair or overpair', 'I scored 0 out of 100.');
    const lines = text.split('\n');
    expect(lines.slice(-7)).toEqual([
      '',
      "I was practising hand reading on this hand, with Villain 2's cards hidden until the end.",
      'My read on the flop: Top pair or overpair',
      'What Villain 2 really had on the flop: Draw (Ah 4h).',
      'I scored 0 out of 100.',
      '',
      "Explain what in Villain 2's actions and the board pointed to their real holding on the flop, what my read got right or missed, and how to read this kind of spot better next time.",
    ]);
    expect(text).not.toContain('c0ffee01');
  });

  it('skips hands where no opponent showed cards', () => {
    const noShow = SHOWDOWN.replace('c0ffee01: shows [Ah 4h] (Flush)\n', '');
    expect(buildQuizItems([parseHand(noShow)])).toEqual([]);
  });
});
