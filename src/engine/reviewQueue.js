// ---------- Review queue and drill scheduling ----------
// Turns every flag the app raises into one ranked list of hands worth studying, and schedules
// drills with spaced repetition (re-testing at growing gaps so lessons stick).
//
// Ranking: big blinds at stake × how serious the flag type is. The weights are judgement calls,
// recorded in docs/ROADMAP.md section 9 so they can be changed:
// - expensive call, weak continue: the call size (weight 1)
// - push/fold mistake: its cost in EV (weight 5, since it is already a loss, not just a stake)
// - cheap fold: the pot given up (weight 0.5)
// - preflop race: Hero's chips in the pot (weight 0.5)
// - missed 3-bet spot: the open-raise size (weight 0.3; it's a frequency prompt)
// - big all-in swing (luck of 10bb or more either way): the swing (weight 0.2; luck, not a mistake)

const DAY = 24 * 60 * 60 * 1000;
export const DRILL_INTERVALS_DAYS = [1, 3, 7, 21];

function heroAction(hand, street, actions) {
  return hand.streets[street].find(a => a.player === 'Hero' && actions.includes(a.action)) || null;
}

// Reasons for one hand from computeStats().raw (plus optional push/fold and all-in results).
export function reasonsForHand(hand, raw, extras = {}) {
  const bb = hand.bb || 1;
  const reasons = [];
  raw.bigCalls
    .filter(f => f.handId === hand.id)
    .forEach(f =>
      reasons.push({
        type: 'bigCall',
        street: f.street,
        label: `Expensive call on the ${f.street} (needed ${f.equityNeeded}% equity)`,
        stake: f.callAmount / bb,
        weight: 1,
      }),
    );
  raw.weakContinues
    .filter(f => f.handId === hand.id)
    .forEach(f =>
      reasons.push({
        type: 'weakContinue',
        street: f.street,
        label: `Called the ${f.street} with a weak holding (${f.handClass})`,
        stake: f.callAmount / bb,
        weight: 1,
      }),
    );
  raw.cheapFolds
    .filter(f => f.handId === hand.id)
    .forEach(f =>
      reasons.push({
        type: 'cheapFold',
        street: f.street,
        label: `Folded the ${f.street} needing only ${f.equityNeeded}% equity`,
        stake: (f.potBefore + f.toCall) / bb,
        weight: 0.5,
      }),
    );
  if (raw.threeBetOppsMissed.some(f => f.handId === hand.id)) {
    const open = hand.streets.preflop.find(a => a.action === 'raise');
    reasons.push({
      type: 'missed3b',
      street: 'preflop',
      label: 'Called an open instead of 3-betting',
      stake: open ? open.to / bb : 2,
      weight: 0.3,
    });
  }
  if (raw.preflopRaces.some(f => f.handId === hand.id)) {
    reasons.push({
      type: 'race',
      street: 'preflop',
      label: 'Got the stack in preflop in a race',
      stake: (hand.heroInvested || 0) / bb,
      weight: 0.5,
    });
  }
  const pf = extras.pushFold && extras.pushFold.get(hand.id);
  if (pf && pf.cost > 0) {
    const did = pf.did === 'fold' ? 'Folded' : pf.did === 'shove' ? 'Shoved' : 'Called';
    reasons.push({
      type: 'pushFold',
      street: 'preflop',
      label: `${did} ${pf.cell} at ${pf.stack.toFixed(1)}bb against the push/fold chart (−${pf.cost.toFixed(2)}bb)`,
      stake: pf.cost,
      weight: 5,
      spotKind: pf.kind, // 'shove' (first in) or 'call' (facing a shove)
      did: pf.did,
      chartAct: pf.chartAct,
    });
  }
  const ai = extras.allIn && extras.allIn.get(hand.id);
  if (ai && Math.abs(ai.luck / bb) >= 10) {
    reasons.push({
      type: 'allInSwing',
      street: ai.street,
      label: `Big all-in swing: ${ai.luck > 0 ? '+' : ''}${(ai.luck / bb).toFixed(1)}bb against expectation`,
      stake: Math.abs(ai.luck / bb),
      weight: 0.2,
    });
  }
  return reasons;
}

// Ranked queue: [{ hand, reasons, score }], highest score first.
export function buildQueue(hands, raw, extras = {}) {
  return hands
    .map(hand => {
      const reasons = reasonsForHand(hand, raw, extras);
      const score = reasons.reduce((t, r) => t + r.stake * r.weight, 0);
      return { hand, reasons, score };
    })
    .filter(item => item.reasons.length)
    .sort((a, b) => b.score - a.score);
}

// The decision a drill stops at: the first flagged Hero action, with the choices offered there.
export function drillDecision(hand, reasons) {
  const order = ['pushFold', 'bigCall', 'weakContinue', 'cheapFold', 'missed3b', 'race', 'allInSwing'];
  const reason = order.map(t => reasons.find(r => r.type === t)).find(Boolean);
  if (!reason) return null;
  const street = reason.street;
  let action;
  if (reason.type === 'bigCall' || reason.type === 'weakContinue') action = heroAction(hand, street, ['call']);
  else if (reason.type === 'cheapFold') action = heroAction(hand, street, ['fold']);
  else action = heroAction(hand, street, ['fold', 'call', 'raise', 'bet', 'check']);
  if (!action) return null;
  const index = hand.streets[street].indexOf(action);
  if (reason.type === 'pushFold') {
    const kind = reason.spotKind;
    return { street, index, reason, choices: ['fold', kind === 'shove' ? 'shove' : 'call'], did: reason.did };
  }
  // Facing a bet when someone has put more in on this street than Hero (blinds count preflop, so
  // the big blind with no raise is not facing one): fold, call or raise. Otherwise check or bet.
  const put = {};
  hand.streets[street].slice(0, index).forEach(a => {
    if (a.action === 'raise') put[a.player] = a.to;
    else if (a.amount) put[a.player] = (put[a.player] || 0) + a.amount;
  });
  const facing = Math.max(0, ...Object.values(put)) > (put.Hero || 0);
  const choices = facing ? ['fold', 'call', 'raise'] : ['check', 'bet'];
  const did = action.action;
  return { street, index, reason, choices, did };
}

// Spaced repetition. `entry` is { level, due } or undefined for a hand never drilled.
// Right: move one step up the intervals (1, 3, 7, then 21 days); right at the top level
// "graduates" the hand (no more drills). Wrong: back to 1 day.
export function nextSchedule(entry, correct, now) {
  const level = entry ? entry.level : -1;
  if (!correct) return { level: 0, due: now + DRILL_INTERVALS_DAYS[0] * DAY };
  const next = level + 1;
  if (next >= DRILL_INTERVALS_DAYS.length) return { level: next, due: null, graduated: true };
  return { level: next, due: now + DRILL_INTERVALS_DAYS[next] * DAY };
}

export function isDue(entry, now) {
  return !!entry && entry.due !== null && entry.due <= now;
}

// Saved review state: reviewed hands and drill schedules, in storage passed in (localStorage in
// the browser, a stand-in in tests), with an in-memory fallback.
const KEY = 'reviewQueue.v1';

export function createReviewStore(storage) {
  let memory = { reviewed: {}, drills: {} };
  function load() {
    if (!storage) return memory;
    try {
      const v = JSON.parse(storage.getItem(KEY) || 'null');
      return v && v.reviewed && v.drills ? v : { reviewed: {}, drills: {} };
    } catch {
      return memory;
    }
  }
  function save(state) {
    memory = state;
    if (!storage) return;
    try {
      storage.setItem(KEY, JSON.stringify(state));
    } catch {
      // keep the in-memory copy
    }
  }
  return {
    state: load,
    setReviewed(handId, value) {
      const s = load();
      if (value) s.reviewed[handId] = true;
      else delete s.reviewed[handId];
      save(s);
    },
    recordDrill(handId, correct, now) {
      const s = load();
      s.drills[handId] = nextSchedule(s.drills[handId], correct, now);
      save(s);
      return s.drills[handId];
    },
  };
}
