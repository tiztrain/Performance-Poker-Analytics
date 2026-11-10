// ---------- Push/fold spots in real hands ----------
// Finds the hands where Hero faced a push/fold decision at 15 big blinds or less (effective) and
// compares what Hero did with the Nash chart for that exact spot (engine/pushFold.js):
// - Shove spot: everyone before Hero folded, and Hero shoved or folded.
// - Call spot: exactly one player shoved, everyone between them and Hero folded, and Hero called
//   or folded.
// Limps and smaller raises are skipped: a push/fold chart doesn't cover them.
// The cost of a mistake is the EV (expected value) Hero gave up against opponents playing the
// chart, in big blinds.

import { computeHandPositions } from './positions.js';
import { cellForHand, ALL_CELLS } from './rangeGrid.js';
import { solvePushFold } from './pushFold.js';

export const MAX_PUSH_FOLD_BB = 15;

// Players in preflop acting order (first to act ... big blind).
function preflopOrder(hand) {
  const positions = computeHandPositions(hand);
  const names = [...positions.keys()]; // starts at the small blind, ends at the button
  if (names.length === 2) return names.slice().reverse(); // heads-up: the button (small blind) acts first
  return [...names.slice(2), names[0], names[1]];
}

function postsOf(hand) {
  const posts = {};
  hand.streets.preflop.forEach(a => {
    if (a.action === 'post') posts[a.player] = (posts[a.player] || 0) + a.amount / hand.bb;
  });
  return posts;
}

const stackOf = (hand, p) => hand.seats.find(s => s.name === p).stack;

// A raise counts as a shove when it puts in (nearly) the player's whole stack.
function isShove(hand, a) {
  if (a.action !== 'raise' && a.action !== 'bet') return false;
  if (a.allin) return true;
  const total = (a.to || a.amount) + ((hand.antes && hand.antes[a.player]) || 0);
  return total >= 0.95 * stackOf(hand, a.player);
}

// The decision to check in a hand, or null. Pure: no solving here.
export function findPushFoldSpot(hand) {
  if (!hand.heroCards || !hand.bb) return null;
  const order = preflopOrder(hand);
  if (!order.includes('Hero')) return null;
  const acts = hand.streets.preflop.filter(a => a.action !== 'post');
  const heroIdx = acts.findIndex(a => a.player === 'Hero');
  if (heroIdx === -1) return null; // Hero never had to act (e.g. folded to in the big blind)
  const before = acts.slice(0, heroIdx);
  const heroAct = acts[heroIdx];
  const posts = postsOf(hand);
  const ante = (hand.ante || 0) / hand.bb;
  const after = order.slice(order.indexOf('Hero') + 1);

  if (before.every(a => a.action === 'fold')) {
    // Shove-or-fold spot. Effective stack: Hero against the biggest stack still to act.
    const behind = Math.max(...after.map(p => stackOf(hand, p)));
    const stack = Math.min(stackOf(hand, 'Hero'), behind) / hand.bb;
    if (stack > MAX_PUSH_FOLD_BB || !after.length) return null;
    let did;
    if (heroAct.action === 'fold') did = 'fold';
    else if (isShove(hand, heroAct)) did = 'shove';
    else return null; // a limp or a smaller raise
    const foldedFirst = order.slice(0, order.indexOf('Hero'));
    return {
      kind: 'shove',
      did,
      stack,
      ante,
      players: hand.seats.length,
      pusherPost: posts.Hero || 0,
      callerPosts: after.map(p => posts[p] || 0),
      otherPosts: foldedFirst.reduce((t, p) => t + (posts[p] || 0), 0),
      heroIndex: null,
      position: computeHandPositions(hand).get('Hero'),
    };
  }

  // Call-or-fold spot: one shove, everything else before Hero folded.
  const raises = before.filter(a => a.action !== 'fold');
  if (raises.length !== 1 || !isShove(hand, raises[0])) return null;
  const pusher = raises[0].player;
  const stack = Math.min(stackOf(hand, 'Hero'), stackOf(hand, pusher)) / hand.bb;
  if (stack > MAX_PUSH_FOLD_BB) return null;
  let did;
  if (heroAct.action === 'fold') did = 'fold';
  else if (heroAct.action === 'call' || heroAct.action === 'raise') did = 'call';
  else return null;
  const callers = order.slice(order.indexOf(pusher) + 1);
  const foldedFirst = order.slice(0, order.indexOf(pusher));
  return {
    kind: 'call',
    did,
    stack,
    ante,
    players: hand.seats.length,
    pusherPost: posts[pusher] || 0,
    callerPosts: callers.map(p => posts[p] || 0),
    otherPosts: foldedFirst.reduce((t, p) => t + (posts[p] || 0), 0),
    heroIndex: callers.indexOf('Hero'),
    position: computeHandPositions(hand).get('Hero'),
    pusherPosition: computeHandPositions(hand).get(pusher),
  };
}

// Solves are cached by spot shape, rounded so near-identical spots share one solve.
export function createPushFoldChecker(eq, { iterations = 300 } = {}) {
  const cache = new Map();
  function solve(spot) {
    const stack = Math.round(spot.stack * 2) / 2;
    const ante = Math.round(spot.ante * 40) / 40;
    const key = [stack, ante, spot.players, spot.pusherPost, spot.otherPosts, spot.callerPosts.join(',')].join('|');
    if (!cache.has(key)) {
      cache.set(
        key,
        solvePushFold({
          stack,
          ante,
          players: spot.players,
          pusherPost: spot.pusherPost,
          callerPosts: spot.callerPosts,
          otherPosts: spot.otherPosts,
          eq,
          iterations,
        }),
      );
    }
    return cache.get(key);
  }

  // Full check of one hand, or null when there's no push/fold spot.
  return function check(hand) {
    const spot = findPushFoldSpot(hand);
    if (!spot) return null;
    const sol = solve(spot);
    const cell = cellForHand(hand.heroCards);
    const ci = ALL_CELLS.indexOf(cell);
    let ev, chartAct, range, rangeShare;
    if (spot.kind === 'shove') {
      ev = sol.pushEV[ci];
      range = sol.push;
      rangeShare = sol.pushShare;
    } else {
      ev = sol.callEVs[spot.heroIndex][ci];
      range = sol.calls[spot.heroIndex];
      rangeShare = sol.callShares[spot.heroIndex];
    }
    const active = spot.kind === 'shove' ? 'shove' : 'call';
    chartAct = ev > 0 ? active : 'fold';
    // Cost: the EV given up. Folding a +EV shove or call loses its EV; shoving or calling a −EV
    // hand loses the EV's size.
    const cost = spot.did === chartAct ? 0 : Math.abs(ev);
    return { hand, ...spot, cell, chartAct, ev, cost, range, rangeShare };
  };
}

export function summarizePushFold(results) {
  const mistakes = results.filter(r => r.cost > 0);
  return {
    spots: results.length,
    mistakes: mistakes.length,
    costBB: mistakes.reduce((t, r) => t + r.cost, 0),
  };
}
