// ---------- Review queue tab ----------
// One ranked list of every flagged hand (engine/reviewQueue.js), with buttons to drill the
// decision, copy it for Claude, or mark it reviewed. Drills use spaced repetition: a hand comes
// back after 1, 3, 7 and 21 days while you keep getting it right, and after 1 day when you don't.
// Push/fold drills are scored against the chart; other spots have no exact answer without a
// solver, so you mark yourself right or wrong after seeing the facts.

import { computeStats } from '../engine/stats.js';
import { buildQueue, createReviewStore, drillDecision, isDue } from '../engine/reviewQueue.js';
import { allInEv, findAllIn } from '../engine/allInEv.js';
import { createPushFoldChecker, findPushFoldSpot } from '../engine/pushFoldSpots.js';
import { equityLookup } from '../engine/pushFold.js';
import { anonymizePlayers, describeAction, handToClaudeText } from '../engine/handSummary.js';
import { computeHandPositions } from '../engine/positions.js';
import { formatDateLabel } from '../engine/grouping.js';
import { bindCopyButton } from './clipboard.js';
import { cardsToIconStr } from './format.js';

const WORDS = { fold: 'Fold', call: 'Call', raise: 'Raise', shove: 'Shove all-in', check: 'Check', bet: 'Bet' };
const STREET_LABELS = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
const PAST = { fold: 'folded', call: 'called', raise: 'raised', shove: 'shoved all-in', check: 'checked', bet: 'bet' };

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createReviewQueueController(allHands) {
  const store = createReviewStore(browserStorage());
  let queue = null;
  let working = false;
  let showReviewed = false;
  let drill = null; // { item, decision, choice } while drilling
  let dueRun = false; // drilling through the due list one after another

  async function compute(onDone) {
    if (working) return;
    working = true;
    const raw = computeStats(allHands).raw;
    const allIn = new Map();
    allHands.forEach(h => {
      const spot = findAllIn(h);
      if (spot && !spot.skipped) allIn.set(h.id, allInEv(h, { samples: 5000 }));
    });
    const pushFold = new Map();
    const pfHands = allHands.filter(h => findPushFoldSpot(h));
    if (pfHands.length) {
      const table = (await import('../engine/preflopEquity.json')).default;
      const check = createPushFoldChecker(equityLookup(table));
      for (let i = 0; i < pfHands.length; i++) {
        pushFold.set(pfHands[i].id, check(pfHands[i]));
        if (i % 20 === 19) await new Promise(r => setTimeout(r, 0));
      }
    }
    queue = buildQueue(allHands, raw, { pushFold, allIn });
    onDone();
  }

  const dueItems = () => {
    const now = Date.now();
    const drills = store.state().drills;
    return queue.filter(it => isDue(drills[it.hand.id], now));
  };

  function listHtml() {
    const state = store.state();
    const reviewedCount = queue.filter(it => state.reviewed[it.hand.id]).length;
    const due = dueItems();
    const visible = queue.filter(it => showReviewed || !state.reviewed[it.hand.id]);
    let h =
      '<div class="panel"><h2>Review queue</h2><div class="quiz-intro">Every flagged hand in your history, ranked by ' +
      'the big blinds at stake and how serious the flag is. Drill a hand to replay it to the decision and choose ' +
      'again; hands you drill come back after 1, 3, 7 and 21 days while you keep getting them right.</div>' +
      '<div class="quiz-scores"><div><b>' +
      queue.length +
      '</b><span>flagged hands</span></div><div><b>' +
      reviewedCount +
      '</b><span>marked reviewed</span></div><div><b>' +
      due.length +
      '</b><span>drills due</span></div></div><div class="quiz-actions">' +
      (due.length
        ? '<button class="primary quiz-submit" data-rq-due="1">Drill due hands (' + due.length + ')</button>'
        : '') +
      '<label class="quiz-mode"><input type="checkbox" data-rq-show-reviewed="1"' +
      (showReviewed ? ' checked' : '') +
      '> Show reviewed hands</label></div></div>';
    if (!visible.length) {
      return (
        h +
        '<div class="panel"><div class="empty-state" style="padding:30px 20px;">' +
        (queue.length ? 'Every flagged hand is marked reviewed.' : 'No flagged hands in your history.') +
        '</div></div>'
      );
    }
    h += '<div class="panel"><div class="rq-list">';
    visible.forEach((it, i) => {
      const reviewed = !!state.reviewed[it.hand.id];
      const d = state.drills[it.hand.id];
      const drillNote = !d
        ? ''
        : d.graduated
          ? ' · drilled, done'
          : ' · next drill ' + new Date(d.due).toLocaleDateString();
      h +=
        '<div class="rq-item' +
        (reviewed ? ' reviewed' : '') +
        '"><div class="rq-head"><span class="rq-rank">' +
        (i + 1) +
        '</span><span class="mono">#' +
        it.hand.id +
        '</span><span class="rq-meta">' +
        (it.hand.dateStr ? formatDateLabel(it.hand.dateStr) : '') +
        ' · ' +
        cardsToIconStr(it.hand.heroCards || []) +
        ' · ' +
        it.score.toFixed(1) +
        ' weighted bb' +
        drillNote +
        '</span></div><ul class="rq-reasons">' +
        it.reasons.map(r => '<li>' + r.label + '</li>').join('') +
        '</ul><div class="rq-actions"><button class="filter-btn" data-rq-drill="' +
        it.hand.id +
        '">Drill</button><button class="copy-claude-btn" data-rq-copy="' +
        it.hand.id +
        '">Copy for Claude</button><button class="filter-btn' +
        (reviewed ? ' active' : '') +
        '" data-rq-reviewed="' +
        it.hand.id +
        '">' +
        (reviewed ? 'Reviewed ✓' : 'Mark reviewed') +
        '</button></div></div>';
    });
    return h + '</div></div>';
  }

  // Replay of the hand up to (not including) the decision.
  function replayHtml(item, decision, reveal) {
    const hand = item.hand;
    const names = anonymizePlayers(hand);
    const positions = computeHandPositions(hand);
    const label = p => names.get(p) + (positions.has(p) ? ' (' + positions.get(p) + ')' : '');
    let h = '<div class="quiz-players">';
    [...names.keys()].forEach(p => {
      const seat = hand.seats.find(s => s.name === p);
      h +=
        '<span class="' +
        (p === 'Hero' ? 'quiz-target' : '') +
        '">' +
        label(p) +
        ' ' +
        Math.round((seat.stack / hand.bb) * 10) / 10 +
        'bb' +
        (p === 'Hero' && hand.heroCards ? ' ' + cardsToIconStr(hand.heroCards) : '') +
        '</span>';
    });
    h += '</div>';
    const streets = ['preflop', 'flop', 'turn', 'river'];
    streets.slice(0, streets.indexOf(decision.street) + 1).forEach(st => {
      const board =
        st === 'flop'
          ? hand.board.flop
          : st === 'turn'
            ? [...hand.board.flop, hand.board.turn]
            : st === 'river'
              ? [...hand.board.flop, hand.board.turn, hand.board.river]
              : [];
      const acts = st === decision.street && !reveal ? hand.streets[st].slice(0, decision.index) : hand.streets[st];
      h += '<div class="street-block"><div class="street-name">' + STREET_LABELS[st] + '</div>';
      if (board.length) h += '<div class="board-line">' + cardsToIconStr(board) + '</div>';
      acts.forEach(a => {
        const line = describeAction(a, hand, names, positions);
        if (line) h += '<div class="action-line">' + line + '</div>';
      });
      h += '</div>';
    });
    return h;
  }

  // Pot odds at the decision: what calling would cost and the equity it needs.
  function potOddsLine(hand, decision) {
    const a = hand.streets[decision.street][decision.index];
    const toCall = a.action === 'call' ? a.amount : a.toCall;
    if (!toCall || typeof a.potBefore !== 'number') return '';
    const need = toCall / (a.potBefore + toCall);
    return (
      'Calling cost ' +
      Math.round((toCall / hand.bb) * 10) / 10 +
      'bb into a pot of ' +
      Math.round((a.potBefore / hand.bb) * 10) / 10 +
      'bb, so it needed ' +
      Math.round(need * 100) +
      '% equity to break even. '
    );
  }

  function drillHtml() {
    const { item, decision, choice, scored } = drill;
    const hand = item.hand;
    let h =
      '<div class="panel quiz-hand"><div class="quiz-meta">Drill · #' +
      hand.id +
      ' · blinds ' +
      hand.sb +
      '/' +
      hand.bb +
      (hand.ante ? '/' + hand.ante : '') +
      '</div><h2>What do you do?</h2>' +
      replayHtml(item, decision, !!choice);
    if (!choice) {
      h += '<div class="quiz-actions">';
      decision.choices.forEach(
        c => (h += '<button class="primary quiz-submit" data-rq-choose="' + c + '">' + WORDS[c] + '</button>'),
      );
      return h + '<button class="filter-btn" data-rq-back="1">Back to the queue</button></div></div>';
    }
    const r = decision.reason;
    let verdict;
    if (r.type === 'pushFold') {
      const right = choice === r.chartAct;
      verdict =
        '<div class="quiz-result ' +
        (right ? 'hit' : 'miss') +
        '">The push/fold chart says <b>' +
        WORDS[r.chartAct] +
        '</b>. ' +
        (right ? 'Right.' : 'Not this time.') +
        '</div>';
    } else {
      verdict =
        '<div class="quiz-result">There’s no exact answer for this spot without a solver: weigh the facts below, ' +
        'then mark yourself.</div>';
    }
    h +=
      '<div class="quiz-actions">' +
      verdict +
      '</div><div class="quiz-lesson">You chose <b>' +
      WORDS[choice] +
      '</b>. In the hand you <b>' +
      (PAST[decision.did] || decision.did) +
      '</b>. ' +
      potOddsLine(hand, decision) +
      'Flagged because: ' +
      item.reasons.map(x => x.label).join('; ') +
      '.</div><div class="quiz-actions">';
    if (r.type !== 'pushFold' && scored === undefined) {
      h +=
        '<button class="primary quiz-submit" data-rq-self="1">I got it right</button>' +
        '<button class="filter-btn" data-rq-self="0">I got it wrong</button>';
    } else {
      h +=
        '<button class="primary quiz-submit" data-rq-next="1">' +
        (dueRun && dueItems().length ? 'Next due hand' : 'Back to the queue') +
        '</button>';
    }
    h +=
      '</div><div class="copy-row"><button class="copy-claude-btn" type="button">Copy for Claude</button>' +
      '<span class="copy-hint">Copies this hand, the flag and your drill choice, to go over in a chat.</span></div></div>';
    return h;
  }

  function startDrill(item) {
    const decision = drillDecision(item.hand, item.reasons);
    if (!decision) return false;
    drill = { item, decision, choice: null, scored: undefined };
    return true;
  }

  function render(mount) {
    if (!queue) {
      mount.innerHTML =
        '<div class="panel"><h2>Review queue</h2><div class="quiz-intro">Ranking your flagged hands…</div></div>';
      compute(() => mount.isConnected && render(mount));
      return;
    }
    mount.innerHTML = drill ? drillHtml() : listHtml();
    bind(mount);
  }

  function bind(mount) {
    const redraw = () => render(mount);
    const find = id => queue.find(it => it.hand.id === id);
    mount.querySelectorAll('[data-rq-drill]').forEach(b =>
      b.addEventListener('click', () => {
        dueRun = false;
        if (startDrill(find(b.dataset.rqDrill))) redraw();
      }),
    );
    mount.querySelectorAll('[data-rq-reviewed]').forEach(b =>
      b.addEventListener('click', () => {
        const id = b.dataset.rqReviewed;
        store.setReviewed(id, !store.state().reviewed[id]);
        redraw();
      }),
    );
    mount.querySelectorAll('[data-rq-copy]').forEach(b => {
      const item = find(b.dataset.rqCopy);
      const wrap = document.createElement('div');
      b.replaceWith(wrap);
      wrap.className = 'rq-copy';
      wrap.appendChild(b);
      bindCopyButton(wrap, () =>
        handToClaudeText(
          item.hand,
          item.reasons.map(r => r.label),
        ),
      );
    });
    const showBox = mount.querySelector('[data-rq-show-reviewed]');
    if (showBox) {
      showBox.addEventListener('change', () => {
        showReviewed = showBox.checked;
        redraw();
      });
    }
    const dueBtn = mount.querySelector('[data-rq-due]');
    if (dueBtn) {
      dueBtn.addEventListener('click', () => {
        dueRun = true;
        if (startDrill(dueItems()[0])) redraw();
      });
    }
    mount.querySelectorAll('[data-rq-choose]').forEach(b =>
      b.addEventListener('click', () => {
        drill.choice = b.dataset.rqChoose;
        const r = drill.decision.reason;
        if (r.type === 'pushFold') {
          drill.scored = drill.choice === r.chartAct;
          store.recordDrill(drill.item.hand.id, drill.scored, Date.now());
        }
        redraw();
      }),
    );
    mount.querySelectorAll('[data-rq-self]').forEach(b =>
      b.addEventListener('click', () => {
        drill.scored = b.dataset.rqSelf === '1';
        store.recordDrill(drill.item.hand.id, drill.scored, Date.now());
        redraw();
      }),
    );
    const next = mount.querySelector('[data-rq-next]');
    if (next) {
      next.addEventListener('click', () => {
        const due = dueRun ? dueItems() : [];
        drill = null;
        if (due.length) startDrill(due[0]);
        redraw();
      });
    }
    const back = mount.querySelector('[data-rq-back]');
    if (back) {
      back.addEventListener('click', () => {
        drill = null;
        redraw();
      });
    }
    if (drill && drill.choice) {
      const { item, decision, choice } = drill;
      bindCopyButton(mount.querySelector('.quiz-hand'), () =>
        handToClaudeText(
          item.hand,
          item.reasons.map(r => r.label),
          {
            context: [
              `I drilled this decision (Hero's ${decision.street} action): I chose to ${choice}; in the hand I chose to ${decision.did}.`,
            ],
            instruction:
              "Review Hero's flagged decision: what were the options, what does the math and villain's likely range " +
              'say, and which choice was best? Judge the decision, not the result.',
          },
        ),
      );
    }
  }

  return {
    render,
    // Cheap count for the tab label: hands with any flag (push/fold and all-in extras come later).
    get flaggedCount() {
      return queue ? queue.length : null;
    },
  };
}
