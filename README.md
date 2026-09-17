# Poker Hand Review

A client-side tool for analyzing CoinPoker tournament hand histories: paste or drop
hand-history text files in, get VPIP/PFR/3-bet/fold-to-3bet/c-bet/WTSD stats, a
per-hand table with table positions (UTG/HJ/CO/BTN/SB/BB), a stack-impact chart, and
a day-by-day comparison across sessions - all computed and rendered entirely in the
browser, nothing is uploaded anywhere.

Live: _(deployed URL goes here after the first `terraform apply` + push to `main` -
see [`infra/README.md`](infra/README.md))_

This started as a single 1900-line HTML file with an inline `<script>` block. This
repo is that tool rebuilt as a normal, testable, CI/CD'd web project, partly as a
genuine improvement to the tool and partly as a self-contained exercise in the parts
of software delivery that don't show up when you're just writing a script for
yourself: module boundaries, a real test suite, linting/formatting enforced in CI, and
infrastructure-as-code for hosting.

## Running it locally

```bash
npm install
npm run dev       # dev server with hot reload
npm test          # vitest, 38 tests
npm run lint       # eslint
npm run format:check   # prettier --check
npm run build      # production build to dist/
```

## Architecture

The app is split into two layers: pure calculation (`src/engine/`) and DOM rendering
(`src/render/`), plus a small shared UI-state module and the entry point.

```
src/
  engine/
    cards.js       5-card hand evaluator (straights, flushes, etc.) - no deps
    parser.js      hand-history text -> structured hand objects - no deps
    positions.js   seat number -> position label (UTG/HJ/CO/BTN/...) - no deps
    format.js      tournament name -> format (regular/turbo/hyper/satellite) - no deps
    races.js       preflop coinflip/dominated-pair heuristic - depends on cards.js
    grouping.js    group hands by tournament, sort/date by real timestamp - depends on format.js
    stats.js       the big Hero-stat aggregator (VPIP, PFR, 3-bet, c-bet, WTSD, ...) - depends on cards.js, races.js
  render/
    format.js, chart.js, statGrid.js, table.js, dayCompare.js, results.js
    (DOM string-building and event binding; results.js is the stateful orchestrator)
  state.js         tiny shared UI state (display mode, current rerender fn)
  main.js          entry point - wires file input, sample-data link, unit toggle, analyze button
```

The engine modules have no DOM dependency and are exercised directly by the test
suite; nothing under `engine/` imports anything from `render/`. This was worth doing
even for a single-user tool because it's the difference between "did I break the
straight detector" being answerable by `npm test` in under a second, versus by
clicking through the UI by hand after every change.

## Testing

Vitest, 38 tests across the engine layer: hand evaluation edge cases (wheel straights,
kicker comparisons), hand-history parsing, tournament format classification, position
labeling across table sizes, and the stat aggregator. Two of the test files
(`grouping.test.js`) exist specifically to pin down bugs found while using the tool on
real data - see below.

## CI/CD

- **`.github/workflows/ci.yml`** - runs on every push/PR to `main`: lint, format
  check, test, build. This is the gate; nothing merges to `main` without it.
- **`.github/workflows/deploy.yml`** - runs on push to `main`: same checks, then
  builds and syncs `dist/` to S3 and invalidates the CloudFront cache. Authenticates
  to AWS via OIDC - GitHub issues a short-lived identity token, AWS exchanges it for
  temporary credentials scoped to one IAM role, no long-lived AWS access keys are
  stored in GitHub at all.

## Hosting

Static site on S3 + CloudFront, provisioned with Terraform - see
[`infra/README.md`](infra/README.md) for the full writeup and setup steps. Short
version of why:

- The entire app is static HTML/CSS/JS with no server-side logic or persistence (yet
  - see Roadmap below), so a static host is the right fit; running a server (EC2, a
    container, a homelab box) to serve unchanging files would just be more to patch,
    monitor, and pay for.
- S3 + CloudFront is close to free for a low-traffic personal project (CloudFront's
  first 1TB/month and 10M requests/month are permanently free, not a trial), scales
  without any capacity planning, and is a pairing that comes up constantly in real
  job/interview contexts - which made it a better portfolio choice than a homelab
  setup that wouldn't transfer as directly, or a PaaS (Netlify/Vercel/GitHub Pages)
  that would have been faster to set up but wouldn't exercise IAM/OIDC, bucket
  policies, or CDN configuration.
- Terraform (rather than clicking through the AWS console) makes the whole
  infrastructure reviewable in a PR, reproducible, and destroyable in one command -
  also a genuinely standard practice, not just a resume line.

## Engineering notes: two real bugs found while using this on my own data

Both of these were caught by noticing a discrepancy between what the tool said and
what I remembered actually happening at the table, not by code review - which is
itself the reason they're worth writing up: the fix mattered, but so did the process
of tracing "this number looks wrong" back to a root cause.

### 1. Recurring tournaments with the same name were merged together

CoinPoker runs the same named tournament (e.g. "Midnight Grand Prix") repeatedly -
each run is a separate tournament with its own ID, but the same display name. The
original grouping logic grouped hands by tournament **name** only:

```js
const key = h.tourney; // BUG: different runs of the same-named tournament collide
```

This silently merged hands from unrelated runs of the same tournament into one
combined total - so a tournament's stats (buy-in, result, bb won) reflected multiple
separate games mashed together, not the one game being looked at. It surfaced as a
user-facing contradiction: a specific tournament's bb-won figure looked implausibly
high for a tournament the player didn't cash in.

Fix: group by name **and** tournament ID together, with a display-time
disambiguation label (the start date) when more than one group shares a name:

```js
const key = name + '::' + (h.tourneyId || '');
```

Regression test in `tests/grouping.test.js` constructs four hands across three
tournament IDs sharing one name and asserts three separate groups come out, with
hands correctly partitioned by ID even when the ID ordering doesn't match hand order.

### 2. Hands were sorted by hand ID instead of timestamp

The hand table and the impact chart sorted hands by their numeric ID. Hand IDs are
_usually_ increasing with time, but not strictly - and one sorting-order mismatch was
enough to hide the actual elimination hand behind an unrelated, later-sorted fold,
making it look (from the chart) like the player busted on a hand they'd actually
folded, several spots earlier.

Fix: sort by the hand's actual recorded date/time whenever it's available, falling
back to ID only when it isn't:

```js
export function handSortKey(h) {
  if (h.dateStr && h.timeStr) {
    return h.dateStr.replace(/\//g, '') + h.timeStr.replace(/:/g, '');
  }
  return String(h.id || '0').padStart(20, '0');
}
```

`tests/grouping.test.js` includes a fixture where a lower hand ID has a _later_
timestamp than a higher one, and asserts the chronological order wins.

Both bugs shipped in the original single-file version and went unnoticed until the
output was checked against what actually happened at the table - the regression tests
above are there so a future refactor can't silently reintroduce either one.

## Roadmap (phase 2, not yet started)

Deliberately out of scope for this phase, to keep it shippable:

- Login / accounts, so previously-uploaded hand histories persist and can be pulled
  up again without re-uploading the file each time
- A poker-themed visual redesign (the current UI is intentionally plain - functional,
  not styled to not look AI-generated)

These need their own design pass (in particular: where hand-history data would be
stored, and what a lightweight-but-real auth flow looks like for a static-hosted
single-page app) rather than being bolted on ad hoc, so they're planned as a separate
follow-up rather than folded into this build.
