// ---------- Trends tab ----------
// Four charts over the saved history, oldest on the left:
// 1. Play quality: bb lost to mistakes per 100 hands, per tournament and over the last 5.
// 2. All-in luck: running totals of what your all-ins were expected to win and what they won.
// 3. Quiz accuracy: the average score of your last 20 answers, per quiz mode.
// 4. Key stats: one stat per tournament for one format, with its target range shaded.
// The maths lives in engine/trends.js; play quality and all-in results are shared with their tabs,
// so each is only worked out once.

import {
  luckSeries,
  qualitySeries,
  quizModesUsed,
  quizSeries,
  ROLLING_ANSWERS,
  ROLLING_TOURNAMENTS,
  statSeries,
} from '../engine/trends.js';
import { groupByTournament, groupStartDate, formatDateLabel } from '../engine/grouping.js';
import { FORMAT_LABELS, FORMAT_ORDER } from '../engine/format.js';
import { createTargetStore, effectiveTargets, TARGET_STATS } from '../engine/targets.js';
import { createQuizStore } from '../engine/quiz.js';
import { bindLineCharts, lineChartHtml, SERIES_COLORS } from './trendChart.js';

const QUIZ_MODE_LABELS = {
  'simple-every': 'Simple, every street',
  'simple-river': 'Simple, river only',
  'advanced-every': 'Advanced, every street',
  'advanced-river': 'Advanced, river only',
};

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const f1 = v => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(1));
const signed = v => (v > 0 ? '+' : '') + f1(v);
const dateLabel = d => (d ? formatDateLabel(d) : '–');

export function createTrendsController(allHands, { quality, allIns }) {
  const groups = groupByTournament(allHands);
  groups.forEach(g => (g.startDate = groupStartDate(g)));
  const formats = FORMAT_ORDER.filter(f => groups.some(g => g.format === f));
  const quizStore = createQuizStore(browserStorage());
  const targetStore = createTargetStore(browserStorage());
  let statFormat = formats[0];
  let statKey = 'vpip';
  let quizMode = null;

  function panel(title, intro, body) {
    return '<div class="panel"><h2>' + title + '</h2><div class="quiz-intro">' + intro + '</div>' + body + '</div>';
  }

  function tournamentTooltip(p, valueText, rollingText) {
    return (
      p.name +
      '<br>' +
      dateLabel(p.date) +
      ' · ' +
      p.hands +
      ' hands<br>This tournament: ' +
      valueText +
      '<br>Last ' +
      ROLLING_TOURNAMENTS +
      ': ' +
      rollingText
    );
  }

  function qualityPanel(mount) {
    const mistakes = quality.mistakes();
    const intro =
      'Big blinds lost to mistakes per 100 hands (the same estimate as the Play quality tab). <b>Lower is better.</b> ' +
      'Dots are single tournaments, which are noisy; the line pools your last ' +
      ROLLING_TOURNAMENTS +
      ' tournaments.';
    if (!mistakes) {
      quality.compute(() => mount.isConnected && render(mount), 'trends');
      return panel(
        'Play quality over time',
        intro,
        '<div class="caveat">Estimating… ' + quality.progress() + ' of ' + allHands.length + ' hands.</div>',
      );
    }
    const pts = qualitySeries(groups, mistakes);
    return panel(
      'Play quality over time',
      intro,
      lineChartHtml({
        width,
        id: 'quality',
        xLabels: pts.map(p => dateLabel(p.date)),
        series: [
          { name: 'Each tournament', color: SERIES_COLORS.compare, kind: 'dots', values: pts.map(p => p.value) },
          {
            name: 'Last ' + ROLLING_TOURNAMENTS + ' tournaments',
            color: SERIES_COLORS.main,
            kind: 'line',
            values: pts.map(p => p.rolling),
          },
        ],
        include: [0],
        yFmt: v => String(v),
        tooltip: i => tournamentTooltip(pts[i], f1(pts[i].value) + ' bb/100', f1(pts[i].rolling) + ' bb/100'),
        table: {
          headers: ['Date', 'Tournament', 'Hands', 'bb/100', 'Last ' + ROLLING_TOURNAMENTS],
          rows: pts.map(p => [dateLabel(p.date), p.name, p.hands, f1(p.value), f1(p.rolling)]),
        },
      }),
    );
  }

  function luckPanel() {
    const pts = luckSeries(allIns.results());
    const intro =
      'Running totals over every measured all-in (the All-in EV tab), in big blinds. <b>Expected</b> is what your ' +
      'all-ins were worth on average; <b>actual</b> is what happened. The gap between them is luck, which evens out ' +
      'over time; the expected line is the one your decisions control.';
    if (!pts.length)
      return panel('All-in luck over time', intro, '<div class="quiz-intro">No measured all-ins yet.</div>');
    const last = pts[pts.length - 1];
    return panel(
      'All-in luck over time',
      intro,
      '<div class="quiz-scores"><div><b>' +
        signed(last.luck) +
        ' bb</b><span>luck over ' +
        pts.length +
        ' all-ins (' +
        (last.luck >= 0 ? 'above' : 'below') +
        ' expectation)</span></div></div>' +
        lineChartHtml({
          width,
          id: 'luck',
          xLabels: pts.map(p => dateLabel(p.date)),
          series: [
            { name: 'Actual', color: SERIES_COLORS.main, kind: 'line', values: pts.map(p => p.actual) },
            { name: 'Expected (EV)', color: SERIES_COLORS.compare, kind: 'line', values: pts.map(p => p.expected) },
          ],
          zero: true,
          yFmt: v => String(v),
          tooltip: i => {
            const p = pts[i];
            return (
              'All-in ' +
              (i + 1) +
              ' · #' +
              p.handId +
              '<br>Equity ' +
              Math.round(p.equity * 100) +
              '%<br>Actual ' +
              signed(p.actual) +
              ' bb · expected ' +
              signed(p.expected) +
              ' bb<br>Luck so far ' +
              signed(p.luck) +
              ' bb'
            );
          },
          table: {
            headers: ['All-in', 'Hand', 'Equity', 'Actual (total)', 'Expected (total)', 'Luck (total)'],
            rows: pts.map((p, i) => [
              i + 1,
              '#' + p.handId,
              Math.round(p.equity * 100) + '%',
              signed(p.actual),
              signed(p.expected),
              signed(p.luck),
            ]),
          },
        }),
    );
  }

  function quizPanel() {
    const records = quizStore.all();
    const modes = quizModesUsed(records);
    const intro =
      'Your average quiz score (out of 100) over your last ' +
      ROLLING_ANSWERS +
      ' answers, after each answer. ' +
      'Each quiz mode is scored separately.';
    if (!modes.length) {
      return panel(
        'Quiz accuracy over time',
        intro,
        '<div class="quiz-intro">No quiz answers yet (Study, Hand-reading quiz).</div>',
      );
    }
    if (!modes.includes(quizMode)) quizMode = modes[0];
    const pts = quizSeries(records, quizMode);
    const picker =
      '<div class="filter-row">' +
      modes
        .map(
          m =>
            '<button class="filter-btn' +
            (m === quizMode ? ' active' : '') +
            '" data-trend-quiz="' +
            m +
            '">' +
            QUIZ_MODE_LABELS[m] +
            '</button>',
        )
        .join('') +
      '</div>';
    return panel(
      'Quiz accuracy over time',
      intro,
      picker +
        lineChartHtml({
          width,
          id: 'quiz',
          xLabels: pts.map(p => 'answer ' + p.n),
          series: [
            {
              name: 'Average of last ' + ROLLING_ANSWERS,
              color: SERIES_COLORS.main,
              kind: 'line',
              values: pts.map(p => p.rolling),
            },
          ],
          include: [0, 100],
          yFmt: v => String(v),
          tooltip: i => {
            const p = pts[i];
            return (
              'Answer ' +
              p.n +
              (p.at ? ' · ' + p.at.slice(0, 10) : '') +
              '<br>Scored ' +
              p.points +
              '<br>Last ' +
              ROLLING_ANSWERS +
              ': ' +
              f1(p.rolling)
            );
          },
          table: {
            headers: ['Answer', 'Date', 'Score', 'Last ' + ROLLING_ANSWERS],
            rows: pts.map(p => [p.n, p.at ? p.at.slice(0, 10) : '–', p.points, f1(p.rolling)]),
          },
        }),
    );
  }

  function statsPanel() {
    const intro =
      'One stat per tournament for one format at a time (formats are never mixed), with its target range shaded ' +
      '(from Settings, Targets). Dots are single tournaments; the line pools the last ' +
      ROLLING_TOURNAMENTS +
      '.';
    if (!statFormat) return panel('Key stats over time', intro, '');
    const label = TARGET_STATS.find(t => t.key === statKey).label;
    const band = effectiveTargets(statFormat, targetStore.load())[statKey] || null;
    const pts = statSeries(groups, statFormat, statKey);
    const pickers =
      (formats.length > 1
        ? '<div class="filter-row">' +
          formats
            .map(
              f =>
                '<button class="filter-btn' +
                (f === statFormat ? ' active' : '') +
                '" data-trend-format="' +
                f +
                '">' +
                FORMAT_LABELS[f] +
                '</button>',
            )
            .join('') +
          '</div>'
        : '') +
      '<div class="filter-row">' +
      TARGET_STATS.map(
        t =>
          '<button class="filter-btn' +
          (t.key === statKey ? ' active' : '') +
          '" data-trend-stat="' +
          t.key +
          '">' +
          t.label +
          '</button>',
      ).join('') +
      '</div>';
    const pct = v => (v === null ? '–' : v + '%');
    return panel(
      'Key stats over time',
      intro,
      pickers +
        lineChartHtml({
          width,
          id: 'stat',
          xLabels: pts.map(p => dateLabel(p.date)),
          series: [
            { name: 'Each tournament', color: SERIES_COLORS.compare, kind: 'dots', values: pts.map(p => p.value) },
            {
              name: 'Last ' + ROLLING_TOURNAMENTS + ' tournaments',
              color: SERIES_COLORS.main,
              kind: 'line',
              values: pts.map(p => p.rolling),
            },
          ],
          band,
          include: [0],
          yFmt: v => v + '%',
          tooltip: i => tournamentTooltip(pts[i], pct(pts[i].value), pct(pts[i].rolling)),
          table: {
            headers: ['Date', 'Tournament', 'Hands', label, 'Last ' + ROLLING_TOURNAMENTS],
            rows: pts.map(p => [dateLabel(p.date), p.name, p.hands, pct(p.value), pct(p.rolling)]),
          },
        }) +
        (band
          ? ''
          : '<div class="caveat">No target for this stat in ' + FORMAT_LABELS[statFormat] + ' tournaments.</div>'),
    );
  }

  let width = 960;
  let resizeTimer = null;
  let lastMount = null;
  // Redraw at the new width after a resize or a phone rotation (charts are drawn at the panel's width).
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => lastMount && lastMount.isConnected && render(lastMount), 200);
  });
  function render(mount) {
    lastMount = mount;
    width = Math.max(300, Math.min(1100, (mount.clientWidth || 960) - 40));
    mount.innerHTML = qualityPanel(mount) + luckPanel() + quizPanel() + statsPanel();
    bindLineCharts(mount);
    const on = (attr, fn) =>
      mount.querySelectorAll('[' + attr + ']').forEach(b =>
        b.addEventListener('click', () => {
          fn(b.getAttribute(attr));
          render(mount);
        }),
      );
    on('data-trend-quiz', m => (quizMode = m));
    on('data-trend-format', f => (statFormat = f));
    on('data-trend-stat', k => (statKey = k));
  }

  return { render };
}
