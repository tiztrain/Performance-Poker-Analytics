# Poker Hand Review

A client-side tool for analyzing CoinPoker tournament hand histories: paste or drop
hand-history text files in, get frequency stats (VPIP, PFR, 3-bet, c-bet, WTSD and
more), a per-hand table with table positions (UTG/HJ/CO/BTN/SB/BB), a stack-impact
chart, and a day-by-day comparison across sessions. Everything is computed and
rendered in the browser, and hand histories are never uploaded anywhere.

Live: <https://d168sqg7uqysns.cloudfront.net>

This started as a single 1900-line HTML file with an inline `<script>` block. This
repo is that tool rebuilt as a normal, testable, CI/CD'd web project, partly as a
genuine improvement to the tool and partly as a self-contained exercise in the parts
of software delivery that don't show up when you're just writing a script for
yourself: module boundaries, a real test suite, linting/formatting enforced in CI, and
infrastructure-as-code for hosting.

## Using it

1. Load hands: upload one or more `.txt`/`.log` exports, drag files onto the text box,
   or paste text and click **Analyze hands**. **Load the 4-hand sample** fills the box
   with example hands if you just want to see the output (click **Analyze hands** after).
   Once the hands are analyzed, the load panel shrinks to a one-line summary so the
   results get the full width; **Add more hands** opens it again.
   Every upload is saved in this browser and merged with what you loaded before, so the
   app opens straight into your whole history next time. Loading the same file twice
   changes nothing (hands are matched by hand number), and the sample is never saved.
   **Clear saved history** deletes it.
2. Pick what to look at. Every tournament starts selected; tournaments are listed by
   format, and you can narrow the selection. With more than 1,000 hands saved you can
   also limit the stats to your last 1,000 (or 5,000) hands. If the hands span more than one day, you also get date filters and a
   **Day comparison** view.
3. Switch every amount between big blinds and chips with the **BB / Chips** toggle in
   the top corner.

### What you get

- **Stats, one panel per format:** VPIP, PFR, 3-bet, 3-bet defense, fold to 3-bet,
  c-bet, fold to c-bet, check-raise, WTSD, W$SD and aggression factor. Formats (regular,
  turbo, hyper, satellite) are classified from the tournament name and kept separate,
  because correct strategy differs too much between them to blend the numbers.
- **How reliable each stat is:** every stat card shows a 95% confidence range and its
  sample, e.g. "likely 6–24% · 50 chances": the band your true rate most likely sits
  in. Small samples give wide ranges, so a red number from a handful of chances
  shouldn't worry you yet.
- **Breakdown by stack depth and position:** under each stat panel, VPIP, PFR, 3-bet,
  fold to 3-bet, c-bet, WTSD and bb won split by effective stack (under 10, 10–20,
  20–40 and 40+ big blinds) and by your seat.
- **Benchmarks:** regular and turbo panels color-code 3-bet defense, fold to 3-bet,
  fold to c-bet and check-raise against target ranges. Hyper and satellite panels show
  a note instead, since those fixed targets don't apply there.
- **Copy for Claude:** open any hand and click **Copy for Claude** to copy it as text for
  a chat with an AI. It includes positions, stacks and every action in big blinds, bet
  sizes as % of pot, the equity each of your calls needed, SPR (stack-to-pot ratio) on
  the flop, your made hand on each street, and why the app flagged it. Opponents are
  renamed Villain 1, 2 and so on, and shown cards come after the action so the review
  starts from ranges. The text only goes to your clipboard; nothing is sent anywhere.
- **Hand-reading quiz:** the **Hand-reading quiz** tab replays every loaded hand where an
  opponent showed cards, with their cards hidden. Two checkboxes, both remembered, set how
  it works:
  - **Advanced: paint the range** switches from ticking categories (five starting-hand
    groups preflop; strong, top pair, weaker pair, draw or nothing after the flop) to
    painting their range on the 13×13 starting-hand grid. Categories score 100 for the
    right one alone, less the more you tick, and 0 for a miss; after a miss you must find
    the right category before moving on. The grid scores 100 × (1 − √share painted) if
    their hand is in your range (about 83 for 3% of hands, 68 for 10%, 50 for 25%) and 0
    if not.
  - **River only** asks once on the river, with the earlier streets as a replay. Otherwise
    it asks on every street; with the grid, each street says only whether their hand was
    in your range and your range carries over, and where their hand was is shown after the
    river.

  Every answer has a **Copy for Claude** button that copies the hand, your read and their
  real hand to go over in a chat. A finished hand shows a street-by-street recap, plus a
  lesson if you missed. Scores are saved in this browser, separately for each combination
  of settings.

- **All-in EV:** the **All-in EV** tab lists every all-in with cards still to come where
  every remaining player's cards were shown. It gives your equity (how often you'd win
  over every possible runout), the result that equity is worth on average (expected
  value), what actually happened, and the difference (luck), totalled across the loaded
  hands. Multiway all-ins are split into a main pot and side pots. Flop and turn
  all-ins are exact; preflop ones (marked ≈) are estimated from 20,000 random boards,
  accurate to about half a percent. All-ins where an opponent mucked are listed as
  skipped.
- **Push/fold:** the **Push/fold** tab checks every hand at 15 big blinds or less
  (effective) where you were first in, or facing a single shove. Each spot gets its own
  Nash push/fold chart (the game-theory shoving and calling ranges) for that stack, those
  antes and that number of players left to act. Differences are listed costliest first,
  with the expected value you gave up in big blinds; click a row to see the chart. The
  charts assume chip value only (no prize-money effects), equal stacks and at most one
  caller, so near the bubble or at a final table tighter play can be right.
- **Review queue and drills:** the **Review queue** tab ranks every flagged hand in your
  history by the big blinds at stake and how serious the flag is. Each hand can be
  marked reviewed, copied for Claude, or drilled: the hand replays to the flagged
  decision and you choose again. Push/fold drills are scored against the chart; other
  spots show what you did, the pot odds and the flag, and you mark yourself. Drilled
  hands come back after 1, 3, 7 and 21 days while you keep getting them right, and
  after 1 day when you don't.
- **Stack-impact chart:** bb or chips won and lost on each hand, in time order.
- **Hand table**, with these filters:

  | Filter                    | Shows                                                                   |
  | ------------------------- | ----------------------------------------------------------------------- |
  | Went to showdown          | Hands that reached a real showdown                                      |
  | Flagged calls             | Calls where the pot odds required more than 40% equity                  |
  | Possibly should've folded | Calls with no pair, or a pair below the board's second-highest card     |
  | Flagged folds             | Folds where you needed under 20% equity to continue                     |
  | Missed 3-bet spots        | Hands where you called an opening raise instead of re-raising           |
  | Coin flips / races        | Preflop all-in style spots that showed down as a flip or dominated pair |

### Limits

- **Flags are prompts for review, not verdicts.** Frequencies and pot-odds math come
  straight from the parsed actions. Equity is only calculated when every player's cards
  are known (all-in EV); there is no solver and no model of what villain holds, so
  hand-strength flags are pattern-based.
- **Multiway postflop spots** are tracked less precisely for c-bet and check-raise.
- **Race detection** only sees hands that reached showdown, and compares ranks only, so
  it misses some real races.
- **Input format:** the parser targets CoinPoker's NLH tournament export, with the
  player labeled `Hero`. Hand blocks must start with `CoinPoker Hand #`; see
  [`src/sample-hand.js`](src/sample-hand.js) for a full example. Hands with no
  tournament line fall into an "Unknown tournament" group.

### Accounts and privacy

Signing in is optional, and the analyzer works the same without an account. **Create
account** and **Sign in** (top right) go to login pages run by Amazon Cognito, so this
site never sees your password. An account currently holds only your email address:
saving hand histories to it is the next step on the roadmap.

Hand histories are read locally in the page and are never uploaded. They are saved in
this browser's IndexedDB (a database built into the browser, on this device only) so
your history is there next time; **Clear saved history** deletes them. Other browser
storage holds the login session in `sessionStorage` (cleared when the tab closes; a
login lasts at most an hour) and your quiz answers and settings in `localStorage`
until you press **Reset**. There is no analytics. The other external
requests are the web fonts, loaded from Google Fonts, and the Cognito login itself.

## Running it locally

Requires Node 22.13+ or 24 (the versions both `vitest` and `eslint` support). CI runs
on 24.

```bash
npm install
npm run dev
```

The sign-in buttons only appear when the build knows which Cognito user pool to use.
To try login locally, copy `.env.example` to `.env.local` and fill in the two values
from `terraform output` in `infra/`.

| Command                | What it does                            |
| ---------------------- | --------------------------------------- |
| `npm run dev`          | Dev server with hot reload              |
| `npm test`             | Run the test suite once (Vitest)        |
| `npm run test:watch`   | Run tests in watch mode                 |
| `npm run lint`         | ESLint                                  |
| `npm run format`       | Format everything with Prettier         |
| `npm run format:check` | Check formatting without changing files |
| `npm run build`        | Production build to `dist/`             |
| `npm run preview`      | Serve the production build locally      |

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
    format.js, chart.js, statGrid.js, table.js, dayCompare.js, results.js, account.js
    (DOM string-building and event binding; results.js is the stateful orchestrator)
  auth/
    oauth.js       OAuth + PKCE helpers: login URLs, token request, JWT decoding - pure, tested
    session.js     redirects to Cognito, token exchange, sessionStorage
  state.js         tiny shared UI state (display mode, current rerender fn)
  main.js          entry point - wires file input, sample-data link, unit toggle, analyze button
```

The engine modules have no DOM dependency and are exercised directly by the test
suite; nothing under `engine/` imports anything from `render/`. This was worth doing
even for a single-user tool because it's the difference between "did I break the
straight detector" being answerable by `npm test` in under a second, versus by
clicking through the UI by hand after every change.

## Testing

Vitest, tests across the engine layer and the auth helpers: hand evaluation edge cases (wheel straights,
kicker comparisons), hand-history parsing, tournament format classification, position
labeling across table sizes, the stat aggregator, and the login URL/PKCE/token helpers
(including the official PKCE test vector). `tests/grouping.test.js` exists
specifically to pin down two bugs found while using the tool on real data - see below.

## CI/CD

- **`.github/workflows/ci.yml`** - runs on every push/PR to `main`: lint, format
  check, test, build. To make this a hard gate on merging, mark it as a required
  status check in GitHub's branch protection settings for `main`.
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

## Roadmap

Login and account creation are done. The full plan, build order and open questions are in
[`docs/ROADMAP.md`](docs/ROADMAP.md).
