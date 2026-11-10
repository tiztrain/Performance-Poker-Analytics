// ---------- ICM (Independent Chip Model) ----------
// In a tournament, chips aren't money: doubling your stack doesn't double your prize. ICM turns
// stacks into prize-money equity: each player's chance of finishing 1st is their share of the
// chips, and the chance of each later place follows by removing the finisher and repeating
// (the Malmuth-Harville method).
//
// Table-only ICM (the owner's choice): the players at Hero's table are treated as the whole field,
// competing for the top prizes of the pasted payout table, as if it were the final table. That is
// exact at a final table and overstates prize pressure earlier, which the UI says.
//
// Push/fold under ICM (icmPushFold): the same spots as the chip-EV chart (engine/pushFoldSpots.js),
// but each outcome's stacks are valued in prize money. Opponents' ranges: the shover uses the
// chip-EV Nash shoving range; callers call when calling is worth more prize money than folding
// against that range (an ICM best reply). One caller at most, as in the chip chart.

import { equityVsRange, rangeShare } from './pushFold.js';
import { ALL_CELLS } from './rangeGrid.js';

// ----- Payouts pasted from the lobby -----
// Accepts one place per line in most shapes, e.g. "1st ₮125.40", "1  ₮125.40", "2 25%", "4-6 $10",
// "4th - 6th: 10.00", or just amounts in order. Headers and blank lines are skipped. Returns
// { places: [amount for 1st, 2nd, ...], unit, error }.
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const toNum = s => parseFloat(s.replace(/,/g, ''));

export function parsePayouts(text) {
  const places = [];
  const unitMatch = (text || '').match(/[₮$€£¥₿]/);
  let pct = false;
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/%/.test(line)) pct = true;
    const nums = line.match(NUMBER);
    if (!nums) continue; // a header such as "Place  Prize"
    const amount = toNum(nums[nums.length - 1]);
    if (nums.length === 1) {
      places.push(amount);
      continue;
    }
    // A place range such as "4-6" or "4th - 6th": the first two numbers, joined by a dash.
    const range = line.match(/^\D*?(\d+)(?:st|nd|rd|th)?\s*[-–—]\s*(\d+)(?:st|nd|rd|th)?\b/i);
    const from = range ? parseInt(range[1], 10) : toNum(nums[0]);
    const to = range && nums.length >= 3 ? parseInt(range[2], 10) : from;
    if (!Number.isInteger(from) || from !== places.length + 1 || to < from || to > 10000) {
      return { places: [], unit: null, error: 'Couldn’t read the place numbers on: “' + line + '”.' };
    }
    for (let p = from; p <= to; p++) places.push(amount);
  }
  if (!places.length) return { places: [], unit: null, error: 'No prizes found.' };
  if (places.some((v, i) => i > 0 && v > places[i - 1])) {
    return { places: [], unit: null, error: 'Prizes should go down from 1st place.' };
  }
  return { places, unit: pct ? '%' : unitMatch ? unitMatch[0] : '', error: null };
}

// ----- Prize equity -----
// stacks: chips per player; payouts: prize per place (missing places pay 0). Players with no chips
// left share the bottom places' prizes. Returns each player's expected prize.
export function icmEquities(stacks, payouts) {
  const n = stacks.length;
  const pay = p => payouts[p] || 0;
  const alive = stacks.map((s, i) => (s > 0 ? i : -1)).filter(i => i >= 0);
  const busted = stacks.map((s, i) => (s > 0 ? -1 : i)).filter(i => i >= 0);
  const k = alive.length;
  const out = new Array(n).fill(0);
  if (busted.length) {
    let share = 0;
    for (let p = k; p < n; p++) share += pay(p);
    busted.forEach(i => (out[i] = share / busted.length));
  }
  // value(mask): expected prize of each alive player still in `mask`, competing for the places
  // from k − |mask| down. Memoised by mask, so 10 players is about 10,000 steps.
  const memo = new Map();
  function value(mask) {
    if (mask === 0) return new Array(k).fill(0);
    if (memo.has(mask)) return memo.get(mask);
    const res = new Array(k).fill(0);
    let total = 0;
    let size = 0;
    for (let j = 0; j < k; j++) {
      if (mask & (1 << j)) {
        total += stacks[alive[j]];
        size++;
      }
    }
    const place = k - size;
    for (let j = 0; j < k; j++) {
      if (!(mask & (1 << j))) continue;
      const pFirst = stacks[alive[j]] / total;
      res[j] += pFirst * pay(place);
      const rest = value(mask & ~(1 << j));
      for (let x = 0; x < k; x++) res[x] += pFirst * rest[x];
    }
    memo.set(mask, res);
    return res;
  }
  const v = value((1 << k) - 1);
  alive.forEach((i, j) => (out[i] = v[j]));
  return out;
}

// ----- Push/fold under ICM -----
// r: a result from createPushFoldChecker (it carries the spot, Hero's cell and the chip solve).
// eq: the 169×169 equity lookup. payouts: prize per place. Returns null without enough players.
export function icmPushFold(r, eq, payouts) {
  const hand = r.hand;
  const names = hand.seats.map(s => s.name);
  if (names.length < 2) return null;
  const idx = Object.fromEntries(names.map((p, i) => [p, i]));
  const start = hand.seats.map(s => s.stack);
  const posts = names.map(p => hand.antes[p] || 0);
  hand.streets.preflop.forEach(a => {
    if (a.action === 'post') posts[idx[a.player]] += a.amount;
  });
  const dead = posts.reduce((a, b) => a + b, 0);
  const table = payouts.slice(0, names.length); // table-only: the top prizes, one per player here
  const prize = stacks => icmEquities(stacks, table);

  // Everyone else folds: `winner` collects the blinds and antes.
  function foldTo(winner) {
    const s = start.map((x, i) => x - posts[i]);
    s[idx[winner]] += dead;
    return prize(s);
  }
  // `a` and `b` all-in against each other; the others only lose their blinds and antes.
  function allIn(a, b, aWins) {
    const ia = idx[a];
    const ib = idx[b];
    const e = Math.min(start[ia], start[ib]);
    const s = start.map((x, i) => x - posts[i]);
    s[ia] = start[ia] - e;
    s[ib] = start[ib] - e;
    s[aWins ? ia : ib] += 2 * e + dead - posts[ia] - posts[ib];
    return prize(s);
  }
  const H = idx.Hero;
  const ci = ALL_CELLS.indexOf(r.cell);
  const sol = r.sol;

  if (r.kind === 'shove') {
    // Folding: assume the big blind (last to act) collects the blinds and antes.
    const foldValue = foldTo(r.order[r.order.length - 1])[H];
    const won = foldTo('Hero');
    let reach = 1;
    let shoveValue = 0;
    const callers = r.callers.map(c => {
      const callerWins = allIn(c, 'Hero', true);
      const heroWins = allIn(c, 'Hero', false);
      const me = idx[c];
      // The caller's ICM reply: call when their prize equity beats folding (Hero takes the pot).
      const need = (won[me] - heroWins[me]) / (callerWins[me] - heroWins[me] || 1e-9);
      const range = new Float64Array(169);
      for (let cell = 0; cell < 169; cell++) range[cell] = equityVsRange(eq, cell, sol.push) > need ? 1 : 0;
      const q = rangeShare(range);
      const heroEq = q > 0 ? equityVsRange(eq, ci, range) : 0;
      shoveValue += reach * q * (heroEq * heroWins[H] + (1 - heroEq) * callerWins[H]);
      reach *= 1 - q;
      return { player: c, callShare: q, needed: need };
    });
    shoveValue += reach * won[H];
    return finish(r, 'shove', shoveValue, foldValue, { callers });
  }

  // Call spot: Hero against the shover's chip-EV Nash range.
  const heroEq = equityVsRange(eq, ci, sol.push);
  const win = allIn('Hero', r.pusher, true)[H];
  const lose = allIn('Hero', r.pusher, false)[H];
  const foldValue = foldTo(r.pusher)[H];
  const callValue = heroEq * win + (1 - heroEq) * lose;
  const needed = (foldValue - lose) / (win - lose || 1e-9);
  return finish(r, 'call', callValue, foldValue, { heroEquity: heroEq, needed });
}

function finish(r, active, actValue, foldValue, extra) {
  const icmAct = actValue > foldValue ? active : 'fold';
  const diff = actValue - foldValue;
  return {
    icmAct,
    actValue,
    foldValue,
    diff,
    cost: r.did === icmAct ? 0 : Math.abs(diff),
    agreesWithChips: icmAct === r.chartAct,
    ...extra,
  };
}

// ----- Saved payouts -----
// { [tournament key 'name::id' or 'name:' + name]: { places, unit } }. A 'name:' entry applies to
// every tournament with that name that has no payouts of its own (recurring tournaments).
const KEY = 'icmPayouts.v1';

export function payoutsFor(saved, group) {
  return saved[group.key] || saved['name:' + group.name] || null;
}

export function createPayoutStore(storage) {
  let memory = {};
  return {
    load() {
      try {
        const v = storage ? JSON.parse(storage.getItem(KEY) || '{}') : memory;
        return v && typeof v === 'object' ? v : {};
      } catch {
        return memory;
      }
    },
    save(v) {
      memory = v;
      try {
        if (storage) storage.setItem(KEY, JSON.stringify(v));
      } catch {
        // keep the in-memory copy
      }
    },
  };
}
