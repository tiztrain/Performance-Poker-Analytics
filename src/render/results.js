import { groupByTournament, groupStartDate, distinctGroupDates, formatDateLabel } from '../engine/grouping.js';
import { FORMAT_ORDER, FORMAT_LABELS } from '../engine/format.js';
import { setCurrentRerender } from '../state.js';
import { renderStatsAndTable, renderCombined } from './table.js';
import { dayFormatFilterHtml, dayDateFilterHtml, dayComparisonHtml } from './dayCompare.js';
import { createQuizController } from './quiz.js';
import { createAllInController } from './allInEvView.js';

export function renderResults(allHands) {
  const container = document.getElementById('results');
  const allGroups = groupByTournament(allHands);
  allGroups.forEach(g => {
    g.startDate = groupStartDate(g);
  });
  const allDates = distinctGroupDates(allGroups);
  // Created once per load, so redraws (e.g. the BB/chips toggle) keep your place in the quiz.
  const quiz = createQuizController(allHands);
  const allIns = createAllInController(allHands);

  // Tournament selection persists by the group's unique key (name+tournamentId, not
  // name alone - recurring tournaments reuse the same display name every occurrence)
  // so it survives the date filter narrowing which tournaments are in view.
  let selectedDates = new Set(allDates); // default: every date included
  let selectedTourneys = new Set(allGroups.length ? [allGroups[0].key] : []);
  // 'filter': the usual date + tournament selector driving the stats/table below.
  // 'daycompare': a single standalone table comparing every date, independent of selection.
  // 'quiz': the hand-reading quiz over every loaded showdown hand.
  // 'allin': all-in EV (expected value) for every measurable all-in in the loaded hands.
  let activeView = 'filter';
  // Which formats count toward the day-by-day comparison (independent of the tournament
  // selection in the "Filter by date" view) - defaults to everything.
  let selectedDayFormats = new Set(FORMAT_ORDER);
  // Which tournament-start dates count toward the day-by-day comparison - independent of
  // selectedDates above (that one drives the "Filter by date" view's own selection state).
  // Uses the same tournament-start-date grouping as the main filter, so a tournament that runs
  // past midnight stays together under the day it started rather than splitting across dates.
  let selectedDayDates = new Set(allDates);

  function viewToggleHtml() {
    const tab = (view, label) =>
      '<button class="filter-btn view-tab' +
      (activeView === view ? ' active' : '') +
      '" data-view="' +
      view +
      '">' +
      label +
      '</button>';
    const multiDay = allDates.length > 1;
    return (
      '<div class="panel"><div class="filter-row">' +
      tab('filter', multiDay ? 'Filter by date' : 'Stats and hands') +
      (multiDay ? tab('daycompare', 'Day comparison') : '') +
      tab('quiz', 'Hand-reading quiz (' + quiz.itemCount + ')') +
      tab('allin', 'All-in EV (' + allIns.spotCount + ')') +
      '</div></div>'
    );
  }

  function dateFilteredGroups() {
    if (allDates.length <= 1) return allGroups;
    return allGroups.filter(g => !g.startDate || selectedDates.has(g.startDate));
  }

  function dateBarHtml() {
    if (allDates.length <= 1) return '';
    let h =
      '<div class="panel"><h2>' +
      allDates.length +
      ' dates detected — filter which days to include</h2><div class="filter-row">';
    h += '<button class="filter-btn all-btn" data-all-dates="1">All dates</button>';
    h += '<button class="filter-btn clear-btn" data-clear-dates="1">Clear dates</button>';
    allDates.forEach(d => {
      h +=
        '<button class="filter-btn date-tab' +
        (selectedDates.has(d) ? ' active' : '') +
        '" data-date="' +
        d +
        '">' +
        formatDateLabel(d) +
        '</button>';
    });
    h +=
      '</div><div class="caveat">A tournament is counted on the day it started, so one that runs past midnight stays together in a single day rather than being split.</div></div>';
    return h;
  }

  function tourneyBarHtml(groups) {
    if (groups.length <= 1) return '';
    const visibleKeys = groups.map(g => g.key);
    const allSelected = visibleKeys.length > 0 && visibleKeys.every(k => selectedTourneys.has(k));
    const presentFormats = FORMAT_ORDER.filter(f => groups.some(g => g.format === f));
    // Recurring tournaments (e.g. a nightly event) reuse the same display name every
    // occurrence - disambiguate those with their start date so they're distinguishable
    // in the list instead of looking like duplicates of the same entry.
    const nameCounts = {};
    groups.forEach(g => {
      nameCounts[g.name] = (nameCounts[g.name] || 0) + 1;
    });
    let h =
      '<div class="panel"><h2>' +
      groups.length +
      ' tournament' +
      (groups.length === 1 ? '' : 's') +
      ' in the current view — select one or more to combine</h2><div class="filter-row">';
    h +=
      '<button class="filter-btn all-btn' +
      (allSelected ? ' active' : '') +
      '" data-all-tourneys="1">All tournaments</button>';
    h += '<button class="filter-btn clear-btn" data-clear-tourneys="1">Clear</button>';
    if (presentFormats.length > 1) {
      presentFormats.forEach(f => {
        const keysInFormat = groups.filter(g => g.format === f).map(g => g.key);
        const formatAllSelected = keysInFormat.every(k => selectedTourneys.has(k));
        const label = f.charAt(0).toUpperCase() + f.slice(1);
        h +=
          '<button class="filter-btn all-btn fmt-toggle-' +
          f +
          (formatAllSelected ? ' active' : '') +
          '" data-all-format="' +
          f +
          '">All <span class="' +
          (formatAllSelected ? '' : 'fmt-' + f) +
          '">' +
          label +
          '</span></button>';
      });
    }
    groups.forEach(g => {
      // Truncate the name portion only, so the disambiguating date (the part that
      // actually distinguishes same-named recurring tournaments) never gets clipped.
      const disambig = nameCounts[g.name] > 1 && g.startDate ? ' · ' + formatDateLabel(g.startDate) : '';
      const maxNameLen = Math.max(10, 40 - disambig.length);
      const shortName = (g.name.length > maxNameLen ? g.name.slice(0, maxNameLen) + '…' : g.name) + disambig;
      const isActive = selectedTourneys.has(g.key);
      const fmtSuffix =
        g.format !== 'regular'
          ? ', <span class="' + (isActive ? '' : 'fmt-' + g.format) + '">' + FORMAT_LABELS[g.format] + '</span>'
          : '';
      h +=
        '<button class="filter-btn tourney-tab' +
        (isActive ? ' active' : '') +
        '" data-key="' +
        encodeURIComponent(g.key) +
        '">' +
        shortName +
        ' (' +
        g.hands.length +
        fmtSuffix +
        ')</button>';
    });
    h +=
      '</div><div class="caveat">Click to toggle tournaments in or out of the combined view below, or use "All tournaments" (or a format\'s "All" button) for everything currently in view. Each format (regular, turbo, hyper, satellite) always gets its own stats panel and they\'re never blended into one frequency number — the hand table does combine everything selected, since that\'s just your actual bb results, not a derived stat.</div></div>';
    return h;
  }

  function rerender() {
    if (activeView === 'allin') {
      container.innerHTML = viewToggleHtml() + '<div id="allin-mount"></div>';
      allIns.render(document.getElementById('allin-mount'));
      bindBars();
      return;
    }
    if (activeView === 'quiz') {
      container.innerHTML = viewToggleHtml() + '<div id="quiz-mount"></div>';
      quiz.render(document.getElementById('quiz-mount'));
      bindBars();
      return;
    }
    if (activeView === 'daycompare') {
      const bodyHtml =
        viewToggleHtml() +
        dayFormatFilterHtml(allGroups, selectedDayFormats) +
        dayDateFilterHtml(allGroups, selectedDayDates) +
        dayComparisonHtml(allGroups, selectedDayFormats, selectedDayDates);
      container.innerHTML = bodyHtml;
      bindBars();
      return;
    }

    const groups = dateFilteredGroups();
    const visibleKeys = groups.map(g => g.key);

    let bodyHtml = viewToggleHtml();
    bodyHtml += dateBarHtml();

    if (allDates.length > 1 && selectedDates.size === 0) {
      bodyHtml +=
        '<div class="panel"><div class="empty-state" style="padding:30px 20px;">Select at least one date above to see stats.</div></div>';
      container.innerHTML = bodyHtml;
      bindBars();
      return;
    }

    if (groups.length === 0) {
      bodyHtml +=
        '<div class="panel"><div class="empty-state" style="padding:30px 20px;">No hands in the current view.</div></div>';
      container.innerHTML = bodyHtml;
      bindBars();
      return;
    }

    if (groups.length === 1) {
      // Only one tournament visible - no tournament selector needed.
      bodyHtml += '<div id="tourney-mount"></div>';
      container.innerHTML = bodyHtml;
      bindBars();
      renderStatsAndTable(groups[0].hands, document.getElementById('tourney-mount'), groups[0].format);
      return;
    }

    bodyHtml += tourneyBarHtml(groups);
    bodyHtml += '<div id="tourney-mount"></div>';
    container.innerHTML = bodyHtml;

    const activeKeys = new Set([...selectedTourneys].filter(k => visibleKeys.includes(k)));
    const mount = document.getElementById('tourney-mount');
    if (activeKeys.size === 0) {
      mount.innerHTML =
        '<div class="panel"><div class="empty-state" style="padding:30px 20px;">Select at least one tournament above to see its stats.</div></div>';
      bindBars();
      return;
    }
    const selectedHands = [];
    groups.forEach(g => {
      if (activeKeys.has(g.key)) selectedHands.push(...g.hands);
    });
    renderCombined(selectedHands, mount, activeKeys.size);
    bindBars();
  }

  function bindBars() {
    container.querySelectorAll('.view-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.view === activeView) return;
        activeView = btn.dataset.view;
        rerender();
      });
    });

    container.querySelectorAll('[data-day-format]').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = btn.dataset.dayFormat;
        if (selectedDayFormats.has(f)) selectedDayFormats.delete(f);
        else selectedDayFormats.add(f);
        rerender();
      });
    });
    const clearDayFormatBtn = container.querySelector('[data-day-format-clear]');
    if (clearDayFormatBtn) {
      clearDayFormatBtn.addEventListener('click', () => {
        selectedDayFormats = new Set();
        rerender();
      });
    }

    const allDayDatesBtn = container.querySelector('[data-day-date-all]');
    if (allDayDatesBtn) {
      allDayDatesBtn.addEventListener('click', () => {
        selectedDayDates = new Set(allDates);
        rerender();
      });
    }
    const clearDayDatesBtn = container.querySelector('[data-day-date-clear]');
    if (clearDayDatesBtn) {
      clearDayDatesBtn.addEventListener('click', () => {
        selectedDayDates = new Set();
        rerender();
      });
    }
    container.querySelectorAll('[data-day-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = btn.dataset.dayDate;
        if (selectedDayDates.has(d)) selectedDayDates.delete(d);
        else selectedDayDates.add(d);
        rerender();
      });
    });

    const allDatesBtn = container.querySelector('[data-all-dates]');
    if (allDatesBtn) {
      allDatesBtn.addEventListener('click', () => {
        selectedDates = selectedDates.size === allDates.length ? new Set() : new Set(allDates);
        rerender();
      });
    }
    const clearDatesBtn = container.querySelector('[data-clear-dates]');
    if (clearDatesBtn) {
      clearDatesBtn.addEventListener('click', () => {
        selectedDates = new Set();
        rerender();
      });
    }
    container.querySelectorAll('.date-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = btn.dataset.date;
        if (selectedDates.has(d)) selectedDates.delete(d);
        else selectedDates.add(d);
        rerender();
      });
    });

    const allTourneysBtn = container.querySelector('[data-all-tourneys]');
    if (allTourneysBtn) {
      allTourneysBtn.addEventListener('click', () => {
        const groups = dateFilteredGroups();
        const visibleKeys = groups.map(g => g.key);
        const allSelected = visibleKeys.length > 0 && visibleKeys.every(k => selectedTourneys.has(k));
        selectedTourneys = allSelected ? new Set() : new Set(visibleKeys);
        rerender();
      });
    }
    const clearTourneysBtn = container.querySelector('[data-clear-tourneys]');
    if (clearTourneysBtn) {
      clearTourneysBtn.addEventListener('click', () => {
        selectedTourneys = new Set();
        rerender();
      });
    }
    container.querySelectorAll('[data-all-format]').forEach(btn => {
      btn.addEventListener('click', () => {
        const format = btn.dataset.allFormat;
        const groups = dateFilteredGroups();
        const keysInFormat = groups.filter(g => g.format === format).map(g => g.key);
        const formatAllSelected = keysInFormat.length > 0 && keysInFormat.every(k => selectedTourneys.has(k));
        if (formatAllSelected) {
          keysInFormat.forEach(k => selectedTourneys.delete(k));
        } else {
          keysInFormat.forEach(k => selectedTourneys.add(k));
        }
        rerender();
      });
    });
    container.querySelectorAll('.tourney-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = decodeURIComponent(btn.dataset.key);
        if (selectedTourneys.has(key)) selectedTourneys.delete(key);
        else selectedTourneys.add(key);
        rerender();
      });
    });
  }

  setCurrentRerender(rerender);
  rerender();
}
