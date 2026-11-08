import { computeStats } from '../engine/stats.js';
import { classifyFormat, FORMAT_LABELS, FORMAT_ORDER } from '../engine/format.js';
import { computeHandPositions } from '../engine/positions.js';
import { handSortKey } from '../engine/grouping.js';
import { flagReasonsForHand, handToClaudeText } from '../engine/handSummary.js';
import { displayMode } from '../state.js';
import {
  fmt,
  amountLabel,
  fmtChips,
  fmtSigned,
  fmtStack,
  sumNetStr,
  cardsToIconStr,
  stackChangeStyle,
} from './format.js';
import { renderImpactChart } from './chart.js';
import { bindCopyButton } from './clipboard.js';
import { statGridHtml } from './statGrid.js';

export function chartAndTableSkeletonHtml(showChart) {
  // The chart's bar heights always stay bb-normalized (a fair "impact" comparison across
  // rising blind levels) even in chips mode - only the hover value switches unit, noted below.
  const chartUnitNote =
    displayMode === 'chips'
      ? 'Bars stay bb-normalized (so early and late hands compare fairly despite rising blinds) - hover values show chips.'
      : 'Green = won bb, red = lost bb (folds included, sized by actual bb lost).';
  const chartHtml =
    showChart === false
      ? ''
      : '<div class="panel"><h2>Stack impact by hand (bb won/lost)</h2><div class="chart-scroll"><svg id="impact-chart" style="display:block;"></svg></div><div style="font-size:11px;color:var(--text-faint);margin-top:6px;">Hover a bar for the hand, click to jump to it below. ' +
        chartUnitNote +
        '</div></div>';
  return (
    chartHtml +
    '<div class="panel"><h2>Hands</h2><div class="filter-row">' +
    '<button class="filter-btn active" data-filter="all">All</button>' +
    '<button class="filter-btn" data-filter="showdown">Went to showdown</button>' +
    '<button class="filter-btn" data-filter="flagged">Flagged calls</button>' +
    '<button class="filter-btn" data-filter="weak">Possibly should\'ve folded</button>' +
    '<button class="filter-btn" data-filter="cheapfold">Flagged folds</button>' +
    '<button class="filter-btn" data-filter="missed3b">Missed 3-bet spots</button>' +
    '<button class="filter-btn" data-filter="race">Coin flips / races</button>' +
    '</div><div id="filter-desc" style="font-size:12px;color:var(--text-muted);margin-bottom:10px;display:none;"></div>' +
    // .table-scroll lets the table scroll sideways inside its panel on narrow phones,
    // instead of making the whole page scroll.
    '<div class="table-scroll"><table class="hand-table"><thead><tr><th>Hand</th><th>Hero cards</th><th>Board</th><th>Stack (' +
    amountLabel() +
    ')</th><th>Result (' +
    amountLabel() +
    ')</th></tr></thead><tbody class="hand-tbody"></tbody></table></div></div>'
  );
}

export function bindChartAndTable(hands, mountEl) {
  const stats = computeStats(hands);
  const s = stats;
  const flaggedMap = new Map(s.raw.bigCalls.map(b => [b.handId, b]));
  // Group by hand, not overwrite-by-hand: the same hand can have more than one weak continue
  // (e.g. a weak call on the flop AND another on the turn), and the tag should reflect all of them.
  const weakMap = new Map();
  s.raw.weakContinues.forEach(b => {
    if (!weakMap.has(b.handId)) weakMap.set(b.handId, []);
    weakMap.get(b.handId).push(b);
  });
  const cheapFoldMap = new Map(s.raw.cheapFolds.map(b => [b.handId, b]));
  const missed3bMap = new Map(s.raw.threeBetOppsMissed.map(b => [b.handId, b]));
  const raceMap = new Map(s.raw.preflopRaces.map(b => [b.handId, b]));
  const tbody = mountEl.querySelector('.hand-tbody');
  const filterDescEl = mountEl.querySelector('#filter-desc');

  const filterDescriptions = {
    flagged:
      'Calls where the pot odds required more than 40% equity to break even — not a verdict, just worth checking whether the hand actually had that much equity against what was likely out there.',
    weak: "Calls where your own hand was no pair at all, or a pair below the board's second-highest card (so worse than pairing the top two board ranks) — heuristic only, this doesn’t know villain’s actual range.",
    cheapfold:
      'Folds where you only needed under 20% equity to continue — worth checking if the hand had enough outs or blockers to be worth a look instead of an automatic fold.',
    missed3b:
      'Hands where you called an opening raise instead of re-raising — a frequency flag on your 3-bet rate, not a judgment that 3-betting was correct here.',
    race: 'Hands where you committed most of your stack preflop with no further decisions, and it showed down as either a genuine ~50/50 coinflip (pair vs. two live overcards) or your pair running into a bigger shown pair (~80/20, not really a flip but the same "was this needed" question) — flagged regardless of whether you won or lost it, since the point is reviewing the decision to get stacks in, not the result.',
    showdown: "Hands that reached a genuine showdown (didn't end by everyone else folding).",
  };

  function goToHand(handId) {
    mountEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    const allBtn = mountEl.querySelector('.filter-btn[data-filter="all"]');
    if (allBtn) allBtn.classList.add('active');
    renderRows('all');
    requestAnimationFrame(() => {
      const row = tbody.querySelector('tr[data-hand-id="' + handId + '"]');
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.style.outline = '2px solid var(--accent-gold)';
        setTimeout(() => {
          row.style.outline = '';
        }, 1600);
        const detail = row.nextElementSibling;
        if (detail && detail.classList.contains('detail')) detail.classList.add('open');
      }
    });
  }

  const chartEl = mountEl.querySelector('#impact-chart');
  if (chartEl) renderImpactChart(hands, chartEl, goToHand);

  function renderRows(filter) {
    if (filterDescriptions[filter]) {
      filterDescEl.textContent = filterDescriptions[filter];
      filterDescEl.style.display = 'block';
    } else {
      filterDescEl.style.display = 'none';
    }

    tbody.innerHTML = '';
    hands.forEach(h => {
      if (filter === 'showdown' && !h.reachedShowdown) return;
      if (filter === 'flagged' && !flaggedMap.has(h.id)) return;
      if (filter === 'weak' && !weakMap.has(h.id)) return;
      if (filter === 'cheapfold' && !cheapFoldMap.has(h.id)) return;
      if (filter === 'missed3b' && !missed3bMap.has(h.id)) return;
      if (filter === 'race' && !raceMap.has(h.id)) return;

      const board = [...h.board.flop];
      if (h.board.turn) board.push(h.board.turn);
      if (h.board.river) board.push(h.board.river);

      const netBB = h.heroNetBB;
      const netBBStr = fmtSigned(h.heroNetChips, h.bb);
      const foldedNote = h.heroFoldedOnStreet
        ? ' <span style="color:var(--text-faint);font-size:11px;">(folded ' + h.heroFoldedOnStreet + ')</span>'
        : '';
      const resultTag =
        '<span class="tag ' +
        (netBB > 0 ? 'win' : netBB < 0 ? (h.heroFoldedOnStreet ? 'folded' : 'lose') : 'folded') +
        '">' +
        netBBStr +
        '</span>' +
        foldedNote;
      const stackBBStr = fmtStack(h.heroStartStack, h.bb);
      const stackStyle = stackChangeStyle(h.heroNetChips, h.heroStartStack);
      const hFormat = classifyFormat(h.tourney);
      const tourneyNote = h.tourney
        ? ' <span style="color:var(--text-faint);font-size:10.5px;">' +
          (h.tourney.length > 28 ? h.tourney.slice(0, 28) + '…' : h.tourney) +
          (hFormat !== 'regular' ? ' · <span class="fmt-' + hFormat + '">' + FORMAT_LABELS[hFormat] + '</span>' : '') +
          '</span>'
        : '';
      const raceInfo = raceMap.get(h.id);
      const raceTagText = raceInfo
        ? raceInfo.matchups.map(m => (m.type === 'flip' ? 'flip' : 'dominated pair')).join('/')
        : '';
      const flagTags =
        (flaggedMap.has(h.id)
          ? ' <span class="tag flag">expensive call ' + flaggedMap.get(h.id).equityNeeded + '%</span>'
          : '') +
        (weakMap.has(h.id)
          ? ' <span class="tag flag">weak (' +
            [...new Set(weakMap.get(h.id).map(w => w.handClass))].join('/') +
            ')</span>'
          : '') +
        (cheapFoldMap.has(h.id)
          ? ' <span class="tag win">cheap fold ' + cheapFoldMap.get(h.id).equityNeeded + '%</span>'
          : '') +
        (missed3bMap.has(h.id) ? ' <span class="tag win">3b spot?</span>' : '') +
        (raceInfo ? ' <span class="tag info">' + raceTagText + '</span>' : '');

      // A preflop fold with nothing flagged on it is the least interesting row on the page -
      // dim it so the hands actually worth looking at (flags, showdowns, later-street folds) stand out.
      const isQuietPreflopFold = h.heroFoldedOnStreet === 'preflop' && !flagTags;
      const row = document.createElement('tr');
      row.className = 'hand-row' + (isQuietPreflopFold ? ' quiet-fold' : '');
      row.dataset.handId = h.id;
      row.innerHTML =
        '<td class="mono">#' +
        h.id +
        flagTags +
        (mountEl.dataset.multi === '1' ? '<br>' + tourneyNote : '') +
        '</td>' +
        '<td class="cards">' +
        cardsToIconStr(h.heroCards || []) +
        '</td>' +
        '<td class="cards">' +
        cardsToIconStr(board) +
        '</td>' +
        '<td class="mono" style="' +
        stackStyle +
        '">' +
        stackBBStr +
        '</td>' +
        '<td>' +
        resultTag +
        '</td>';
      tbody.appendChild(row);

      const detail = document.createElement('tr');
      detail.className = 'detail';
      const bbSize = h.bb;
      function toBB(chips) {
        return fmtChips(chips, bbSize);
      }
      const positions = computeHandPositions(h);
      function posTag(player) {
        return positions.has(player) ? ' <span class="pos-label">(' + positions.get(player) + ')</span>' : '';
      }
      let detailHtml = '<td colspan="5"><div class="detail-inner">';
      detailHtml +=
        '<div style="font-size:11px;color:var(--text-faint);margin-bottom:10px;font-family:var(--mono);">Blinds this hand: ' +
        fmt(h.sb) +
        '/' +
        fmt(h.bb) +
        (h.ante ? '/' + fmt(h.ante) + ' ante' : '') +
        ' (1bb = ' +
        fmt(h.bb) +
        ' chips)</div>';
      ['preflop', 'flop', 'turn', 'river'].forEach(street => {
        const acts = h.streets[street];
        // Board can run out (flop/turn/river dealt) with zero recorded actions when
        // everyone is already all-in - still show the board line in that case.
        const hasBoard =
          street === 'flop'
            ? h.board.flop.length > 0
            : street === 'turn'
              ? !!h.board.turn
              : street === 'river'
                ? !!h.board.river
                : false;
        if (!acts.length && !hasBoard) return;
        detailHtml += '<div class="street-block"><div class="street-name">' + street + '</div>';
        if (street === 'flop' && h.board.flop.length)
          detailHtml += '<div class="board-line">' + cardsToIconStr(h.board.flop) + '</div>';
        if (street === 'turn' && h.board.turn)
          detailHtml += '<div class="board-line">' + cardsToIconStr([...h.board.flop, h.board.turn]) + '</div>';
        if (street === 'river' && h.board.river)
          detailHtml +=
            '<div class="board-line">' + cardsToIconStr([...h.board.flop, h.board.turn, h.board.river]) + '</div>';
        acts.forEach(a => {
          let line = '<span class="actor">' + a.player + '</span>' + posTag(a.player) + ': ' + a.action;
          if (a.action === 'call' || a.action === 'bet') line += ' ' + toBB(a.amount);
          if (a.action === 'raise') line += ' to ' + toBB(a.to);
          if (a.allin) line += ' (all-in)';
          detailHtml += '<div class="action-line">' + line + '</div>';
        });
        detailHtml += '</div>';
      });

      // Result: who won, with what hand, plus any other hands shown at showdown -
      // so you can see what actually beat you without cross-referencing the raw text.
      const uniqueShows = [];
      const seenShowPlayers = new Set();
      h.shows.forEach(s => {
        if (!seenShowPlayers.has(s.player)) {
          seenShowPlayers.add(s.player);
          uniqueShows.push(s);
        }
      });
      const wonByPlayer = {};
      h.collections.forEach(c => {
        wonByPlayer[c.player] = (wonByPlayer[c.player] || 0) + c.amount;
      });
      const winnerNames = Object.keys(wonByPlayer);
      if (uniqueShows.length || winnerNames.length) {
        detailHtml += '<div class="street-block"><div class="street-name">Result</div>';
        winnerNames.forEach(player => {
          const shown = uniqueShows.find(s => s.player === player);
          // handClass is null for pots won without a real 5-card hand to name (no flop was
          // ever seen - everyone folded before a board existed), so just show the hole cards.
          const classStr = shown
            ? (shown.handClass ? ' with ' + shown.handClass : '') + ' [' + cardsToIconStr(shown.cards) + ']'
            : ' (cards not shown)';
          detailHtml +=
            '<div class="action-line"><span class="actor">' +
            player +
            '</span>' +
            posTag(player) +
            ' won ' +
            toBB(wonByPlayer[player]) +
            classStr +
            '</div>';
        });
        uniqueShows
          .filter(s => !wonByPlayer[s.player])
          .forEach(s => {
            const classStr = s.handClass ? s.handClass + ' ' : '';
            detailHtml +=
              '<div class="action-line"><span class="actor">' +
              s.player +
              '</span>' +
              posTag(s.player) +
              ' showed ' +
              classStr +
              '[' +
              cardsToIconStr(s.cards) +
              ']</div>';
          });
        detailHtml += '</div>';
      }
      detailHtml +=
        '<div class="copy-row"><button class="copy-claude-btn" type="button">Copy for Claude</button>' +
        '<span class="copy-hint">Copies this hand as text to paste into a chat. Opponents are renamed Villain 1, 2…</span></div>';
      detailHtml += '</div></td>';
      detail.innerHTML = detailHtml;
      tbody.appendChild(detail);
      bindCopyButton(detail, () => handToClaudeText(h, flagReasonsForHand(s.raw, h.id)));

      row.addEventListener('click', () => detail.classList.toggle('open'));
    });
  }

  renderRows('all');
  mountEl.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mountEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderRows(btn.dataset.filter);
    });
  });
}

// Single-tournament (or single-group) view: one stat panel + shared chart/table
export function renderStatsAndTable(hands, mountEl, format) {
  mountEl.innerHTML = statGridHtml(hands, format, false) + chartAndTableSkeletonHtml(true);
  bindChartAndTable(hands, mountEl);
}

// Combined view for a multi-select of tournaments: a total-result banner,
// one stat panel per format present (regular/turbo/hyper/satellite are never
// merged into one frequency number), and one shared hand-table across everything
// selected. The stack-impact chart is shown only when exactly one tournament is
// selected — combined across several it isn't a meaningful read and can run very wide.
export function renderCombined(hands, mountEl, selectedCount) {
  const sorted = hands
    .slice()
    .sort((a, b) => (handSortKey(a) < handSortKey(b) ? -1 : handSortKey(a) > handSortKey(b) ? 1 : 0));
  const { str: netStr, cls: netClass } = sumNetStr(sorted);

  const buckets = { regular: [], turbo: [], hyper: [], satellite: [] };
  sorted.forEach(h => {
    buckets[classifyFormat(h.tourney)].push(h);
  });
  const presentFormats = FORMAT_ORDER.filter(f => buckets[f].length > 0);
  const forceLabel = presentFormats.length > 1;

  let html =
    '<div class="panel"><div class="summary-banner"><div class="summary-label">Combined result — ' +
    sorted.length +
    ' hand' +
    (sorted.length === 1 ? '' : 's') +
    ' across ' +
    selectedCount +
    ' tournament' +
    (selectedCount === 1 ? '' : 's') +
    '</div><div class="summary-value ' +
    netClass +
    '">' +
    netStr +
    '</div></div></div>';

  presentFormats.forEach(f => {
    html += statGridHtml(buckets[f], f, forceLabel);
  });

  html += chartAndTableSkeletonHtml(selectedCount === 1);
  mountEl.innerHTML = html;
  mountEl.dataset.multi = selectedCount > 1 ? '1' : '0';
  bindChartAndTable(sorted, mountEl);
}
