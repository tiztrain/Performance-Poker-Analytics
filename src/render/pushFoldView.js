// ---------- Push/fold tab ----------
// Lists every push/fold spot (15 big blinds or less) with what Hero did, what the Nash chart for
// that spot says, and the cost of any difference. The equity table is loaded and the charts are
// worked out the first time the tab is opened; results are kept for later redraws.
// With a tournament's payouts pasted in, each spot also gets an ICM (Independent Chip Model: prize-
// money) verdict from engine/icm.js, treating the players at the table as the whole field.

import { createPushFoldChecker, findPushFoldSpot, summarizePushFold } from '../engine/pushFoldSpots.js';
import { equityLookup } from '../engine/pushFold.js';
import { cellName } from '../engine/rangeGrid.js';
import { formatDateLabel, groupByTournament, groupStartDate, handSortKey } from '../engine/grouping.js';
import { createPayoutStore, icmPushFold, parsePayouts, payoutsFor } from '../engine/icm.js';
import { amountLabel, fmtSigned, fmtSignedTotal } from './format.js';

const ACTION_WORDS = { shove: 'Shove', call: 'Call', fold: 'Fold' };

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const payoutStore = createPayoutStore(browserStorage());

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Prize amounts in the units pasted (a currency, or % of the prize pool).
function prizeText(v, unit) {
  const n = Math.abs(v).toFixed(2);
  const sign = v < 0 ? '−' : '';
  return unit === '%' ? sign + n + '%' : sign + (unit || '') + n;
}

export function createPushFoldController(allHands) {
  const sorted = allHands
    .slice()
    .sort((a, b) => (handSortKey(a) < handSortKey(b) ? -1 : handSortKey(a) > handSortKey(b) ? 1 : 0));
  const candidates = sorted.filter(h => findPushFoldSpot(h));
  let results = null;
  let working = false;
  let openId = null;
  let eqLookup = null;
  let editing = null; // tournament key whose payout editor is open
  let editError = '';
  let editDraft = null; // the pasted text, kept when it couldn't be read
  const groups = groupByTournament(sorted);
  groups.forEach(g => (g.startDate = groupStartDate(g)));
  const groupOf = new Map();
  groups.forEach(g => g.hands.forEach(h => groupOf.set(h.id, g)));
  const spotGroups = groups.filter(g => g.hands.some(h => candidates.includes(h)));

  // ICM verdict for a result, or null when its tournament has no payouts. Cached per payout set.
  const icmCache = new Map();
  function icmFor(r) {
    const p = payoutsFor(payoutStore.load(), groupOf.get(r.hand.id));
    if (!p || !eqLookup) return null;
    const key = r.hand.id + '|' + p.places.join(',');
    if (!icmCache.has(key)) icmCache.set(key, { ...icmPushFold(r, eqLookup, p.places), unit: p.unit });
    return icmCache.get(key);
  }

  async function compute(onDone) {
    if (working) return;
    working = true;
    // The table is a separate file, loaded only when this tab is used.
    const table = (await import('../engine/preflopEquity.json')).default;
    eqLookup = equityLookup(table);
    const check = createPushFoldChecker(eqLookup);
    const out = [];
    for (let i = 0; i < candidates.length; i++) {
      out.push(check(candidates[i]));
      if (i % 20 === 19) await new Promise(r => setTimeout(r, 0)); // keep the page responsive
    }
    results = out;
    onDone();
  }

  function chartGridHtml(r) {
    let h = '<div class="range-grid pf-grid">';
    for (let row = 0; row < 13; row++) {
      for (let col = 0; col < 13; col++) {
        const name = cellName(row, col);
        const idx = row * 13 + col;
        const f = r.range[idx];
        h +=
          '<div class="range-cell ' +
          (f >= 0.5 ? 'painted' : '') +
          (name === r.cell ? ' actual' : '') +
          '" title="' +
          name +
          ': ' +
          Math.round(f * 100) +
          '%">' +
          name +
          '</div>';
      }
    }
    return h + '</div>';
  }

  function spotText(r) {
    return r.kind === 'shove'
      ? 'Folded to you in the ' + r.position
      : r.pusherPosition + ' shoved, you in the ' + r.position;
  }

  function rowHtml(r, list) {
    const key = list + ':' + r.hand.id;
    const bb = r.hand.bb;
    const ok = r.cost === 0;
    let h =
      '<tr class="pf-row' +
      (openId === key ? ' open' : '') +
      '" data-pf="' +
      key +
      '"><td class="mono">#' +
      r.hand.id +
      '</td><td>' +
      spotText(r) +
      '</td><td class="mono">' +
      r.stack.toFixed(1) +
      'bb</td><td class="mono"><b>' +
      r.cell +
      '</b></td><td>' +
      ACTION_WORDS[r.did] +
      '</td><td>' +
      ACTION_WORDS[r.chartAct] +
      '</td><td class="mono">' +
      fmtSigned(r.ev * bb, bb) +
      '</td><td class="mono ' +
      (ok ? 'good' : 'leak') +
      '">' +
      (ok ? '✓' : '−' + fmtSigned(r.cost * bb, bb).replace(/^[+-]/, '')) +
      '</td>' +
      icmCell(r) +
      '</tr>';
    if (openId === key) {
      h +=
        '<tr class="pf-detail"><td colspan="9"><div class="pf-detail-inner">' +
        chartGridHtml(r) +
        '<div class="caveat">Chart for this exact spot: ' +
        (r.kind === 'shove' ? 'shove' : 'call') +
        ' the gold hands (' +
        Math.round(r.rangeShare * 1000) / 10 +
        '% of hands), fold the rest. Your hand is outlined. ' +
        (r.kind === 'shove' ? 'Shoving ' : 'Calling ') +
        r.cell +
        ' is worth ' +
        fmtSigned(r.ev * r.hand.bb, r.hand.bb) +
        ' against folding, if the other players use the chart too.</div>' +
        icmDetail(r) +
        '</div></td></tr>';
    }
    return h;
  }

  function icmCell(r) {
    const icm = icmFor(r);
    if (!icm) return '<td class="mono" style="color:var(--text-faint)">–</td>';
    return (
      '<td class="mono ' +
      (icm.cost ? 'leak' : 'good') +
      '" title="ICM says ' +
      ACTION_WORDS[icm.icmAct].toLowerCase() +
      '">' +
      ACTION_WORDS[icm.icmAct] +
      (icm.cost ? ' · −' + prizeText(icm.cost, icm.unit) : ' ✓') +
      '</td>'
    );
  }

  function icmDetail(r) {
    const icm = icmFor(r);
    if (!icm) {
      return '<div class="caveat">Add this tournament’s payouts (above) to see the ICM verdict for this spot.</div>';
    }
    const act = r.kind === 'shove' ? 'Shoving' : 'Calling';
    let h =
      '<div class="caveat"><b>ICM:</b> ' +
      act.toLowerCase() +
      ' is worth ' +
      prizeText(icm.actValue, icm.unit) +
      ' of prize equity, folding ' +
      prizeText(icm.foldValue, icm.unit) +
      ', so ICM says <b>' +
      ACTION_WORDS[icm.icmAct].toLowerCase() +
      '</b>' +
      (icm.agreesWithChips ? ', the same as the chip chart.' : ', unlike the chip chart.');
    if (r.kind === 'call') {
      h +=
        ' Calling needs ' +
        Math.round(icm.needed * 100) +
        '% equity under ICM; you had about ' +
        Math.round(icm.heroEquity * 100) +
        '% against the shover’s chart range.';
    } else {
      h +=
        ' Under ICM, ' +
        icm.callers.map(c => c.player + ' calls ' + Math.round(c.callShare * 1000) / 10 + '% of hands').join(', ') +
        '.';
    }
    return (
      h +
      ' The players at this table are treated as the whole field, competing for the top ' +
      r.hand.seats.length +
      ' prizes.</div>'
    );
  }

  function payoutPanelHtml() {
    const saved = payoutStore.load();
    let h =
      '<div class="panel"><h2>Payouts for ICM</h2><div class="quiz-intro">ICM (Independent Chip Model) turns chip ' +
      'stacks into prize money: near the money or at a final table, losing chips costs more than winning them ' +
      'gains, so some chart shoves and calls become folds. Paste a tournament’s payout table from the CoinPoker ' +
      'lobby to check its spots under ICM. The players at your table are treated as the whole field, competing for ' +
      'the top prizes, so the verdicts are right at a final table and too cautious earlier on.</div>' +
      '<div class="table-scroll"><table class="hand-table"><thead><tr><th>Date</th><th>Tournament</th><th>Payouts</th>' +
      '<th></th></tr></thead><tbody>';
    spotGroups.forEach(g => {
      const own = saved[g.key];
      const byName = saved['name:' + g.name];
      const p = own || byName;
      const status = p
        ? p.places.length +
          ' places: ' +
          p.places
            .slice(0, 3)
            .map(v => prizeText(v, p.unit))
            .join(', ') +
          (p.places.length > 3 ? '…' : '') +
          (own ? '' : ' (from every “' + esc(g.name) + '”)')
        : '<span style="color:var(--text-faint)">not entered</span>';
      h +=
        '<tr><td>' +
        (g.startDate ? formatDateLabel(g.startDate) : '–') +
        '</td><td>' +
        esc(g.name) +
        '</td><td class="mono">' +
        status +
        '</td><td><button class="filter-btn" data-payout-edit="' +
        encodeURIComponent(g.key) +
        '">' +
        (p ? 'Edit' : 'Paste payouts') +
        '</button></td></tr>';
      if (editing === g.key) {
        const current = own || byName;
        h +=
          '<tr class="pf-detail"><td colspan="4"><div class="pf-detail-inner payout-editor">' +
          '<textarea rows="7" placeholder="1st  ₮125.00&#10;2nd  ₮75.00&#10;3rd  ₮50.00&#10;4-6  ₮20.00">' +
          (editDraft !== null
            ? esc(editDraft)
            : current
              ? current.places
                  .map((v, i) => i + 1 + '  ' + (current.unit === '%' ? v + '%' : (current.unit || '') + v))
                  .join('\n')
              : '') +
          '</textarea><label class="payout-name"><input type="checkbox" data-payout-byname' +
          (!own && byName ? ' checked' : '') +
          '> Use for every tournament named “' +
          esc(g.name) +
          '” without its own payouts</label><div class="payout-actions">' +
          '<button class="filter-btn active" data-payout-save>Save</button>' +
          (p ? '<button class="filter-btn" data-payout-remove>Remove</button>' : '') +
          '<button class="filter-btn" data-payout-cancel>Cancel</button><span class="target-error">' +
          esc(editError) +
          '</span></div></div></td></tr>';
      }
    });
    return h + '</tbody></table></div></div>';
  }

  function bindPayouts(mount) {
    const redraw = () => render(mount);
    mount.querySelectorAll('[data-payout-edit]').forEach(b =>
      b.addEventListener('click', () => {
        const key = decodeURIComponent(b.dataset.payoutEdit);
        editing = editing === key ? null : key;
        editError = '';
        editDraft = null;
        redraw();
      }),
    );
    const ed = mount.querySelector('.payout-editor');
    if (!ed) return;
    const g = groups.find(x => x.key === editing);
    ed.querySelector('[data-payout-cancel]').addEventListener('click', () => {
      editing = null;
      redraw();
    });
    const remove = ed.querySelector('[data-payout-remove]');
    if (remove) {
      remove.addEventListener('click', () => {
        const saved = { ...payoutStore.load() };
        if (saved[g.key]) delete saved[g.key];
        else delete saved['name:' + g.name];
        payoutStore.save(saved);
        editing = null;
        redraw();
      });
    }
    ed.querySelector('[data-payout-save]').addEventListener('click', () => {
      const parsed = parsePayouts(ed.querySelector('textarea').value);
      if (parsed.error) {
        editError = parsed.error;
        editDraft = ed.querySelector('textarea').value;
        redraw();
        return;
      }
      const saved = { ...payoutStore.load() };
      const byName = ed.querySelector('[data-payout-byname]').checked;
      delete saved[g.key];
      saved[byName ? 'name:' + g.name : g.key] = { places: parsed.places, unit: parsed.unit };
      payoutStore.save(saved);
      editing = null;
      editError = '';
      redraw();
    });
  }

  function tableHtml(rows, list) {
    return (
      '<div class="table-scroll"><table class="hand-table pf-table"><thead><tr><th>Hand</th><th>Spot</th>' +
      '<th>Stack</th><th>Your hand</th><th>You</th><th>Chart</th><th>Shove/call EV (' +
      amountLabel() +
      ')</th><th>Cost (' +
      amountLabel() +
      ')</th><th>ICM</th></tr></thead><tbody>' +
      rows.map(r => rowHtml(r, list)).join('') +
      '</tbody></table></div>'
    );
  }

  function icmSummary() {
    const checked = results.map(r => icmFor(r)).filter(Boolean);
    if (!checked.length) return '';
    const wrong = checked.filter(x => x.cost > 0);
    const unit = checked[0].unit;
    const mixed = checked.some(x => x.unit !== unit);
    return (
      '<div><b class="' +
      (wrong.length ? 'leak' : 'good') +
      '">' +
      wrong.length +
      ' of ' +
      checked.length +
      '</b><span>differ under ICM</span></div>' +
      (mixed
        ? ''
        : '<div><b class="' +
          (wrong.length ? 'leak' : '') +
          '">' +
          prizeText(-wrong.reduce((t, x) => t + x.cost, 0), unit) +
          '</b><span>prize equity given up (ICM)</span></div>')
    );
  }

  function render(mount) {
    if (!candidates.length) {
      mount.innerHTML =
        '<div class="panel"><h2>Push/fold</h2><div class="quiz-intro">No push/fold spots in the loaded hands: ' +
        'none where you were first in, or facing a single shove, with 15 big blinds or less.</div></div>';
      return;
    }
    if (!results) {
      mount.innerHTML =
        '<div class="panel"><h2>Push/fold</h2><div class="quiz-intro">Working out the chart for each of your ' +
        candidates.length +
        ' push/fold spots…</div></div>';
      compute(() => {
        if (mount.isConnected) render(mount);
      });
      return;
    }
    const s = summarizePushFold(results);
    const costChips = results.reduce((t, r) => t + r.cost * r.hand.bb, 0);
    const mistakes = results.filter(r => r.cost > 0).sort((a, b) => b.cost - a.cost);
    let h =
      '<div class="panel"><h2>Push/fold</h2><div class="quiz-intro">Every hand where you were first in, or facing ' +
      'one shove, with 15 big blinds or less, checked against the Nash push/fold chart for that exact spot: your ' +
      'stack, the antes, and how many players were left to act. Cost is the expected value you gave up, in big ' +
      'blinds, if the others play the chart too. Click a row to see the chart.</div><div class="quiz-scores">' +
      '<div><b>' +
      s.spots +
      '</b><span>spots checked</span></div><div><b class="' +
      (s.mistakes ? 'leak' : 'good') +
      '">' +
      s.mistakes +
      '</b><span>differ from the chart</span></div><div><b class="' +
      (s.mistakes ? 'leak' : '') +
      '">' +
      fmtSignedTotal(-costChips, -s.costBB) +
      '</b><span>given up against the chart</span></div>' +
      icmSummary() +
      '</div></div>' +
      payoutPanelHtml();
    if (mistakes.length)
      h +=
        '<div class="panel"><h2>Differences from the chart, costliest first</h2>' + tableHtml(mistakes, 'm') + '</div>';
    h +=
      '<div class="panel"><details' +
      (mistakes.length ? '' : ' open') +
      '><summary class="pf-summary">All ' +
      results.length +
      ' spots</summary>' +
      tableHtml(results, 'a') +
      '</details><div class="caveat">Charts assume chip EV (no prize-money effects), equal stacks at the effective ' +
      'stack, and at most one caller. Near the money bubble or at a final table, tighter play than the chart can be ' +
      'right; add payouts above for an ICM verdict.</div></div>';
    mount.innerHTML = h;
    bindPayouts(mount);
    mount.querySelectorAll('[data-pf]').forEach(row => {
      row.addEventListener('click', () => {
        openId = openId === row.dataset.pf ? null : row.dataset.pf;
        render(mount);
      });
    });
  }

  return { render, spotCount: candidates.length };
}
