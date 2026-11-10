# Roadmap

The owner's goal is to become as strong a tournament player as possible. This app serves that by being a **post-session
training tool**: it reviews hands after play and turns them into study and practice. It never advises during a hand.

Everything below is a proposal to refine as each feature is built. Thresholds and weights are starting points: they live
in one config module so they're easy to tune, and changing them is the owner's call (see "Working agreement").

## 1. Who it's for

- **Games:** mostly multi-table tournaments (MTTs), $1 to $5 buy-ins, on CoinPoker.
- **Biggest leak (owner's view): reading opponents' hands.** Better hand reading improves folding decisions and value
  betting, so features that train it come first.
- **Model:** chip-based (chip EV, expected value measured in chips). There is no ICM (Independent Chip Model: adjusting
  for prize money) for now, because the hand histories contain no payouts, players remaining or finishing position.

## 2. Questions the app answers

1. How well did I play, regardless of the result?
2. What did my opponents have, and could I have worked it out?
3. Where am I losing chips, and is that improving?
4. Which hands should I study, and why?

## 3. Guardrails (apply to every feature)

- **Post-session only.** No live mode, screen capture or overlay on the poker client.
- **Grade decisions, never results.** Luck is separated out (see all-in EV, 5.3).
- **Transparent.** Every score shows its parts, the hands behind it, and how sure it is (sample size and confidence
  range: the band the true value probably falls in).
- **Honest limits.** There is no solver. Range models and flags are heuristics (rules of thumb), and the UI says so.
- **Privacy.** Anything sent to an AI or exported replaces opponent names with `Villain 1`, `Villain 2` and so on.
- **Engine/render split.** New logic goes in `src/engine/` as pure, unit-tested functions.

## 4. Decisions on record

- **Opponent database (5.10): the owner has decided to build it.** As the owner understands CoinPoker's policy, it bans
  trackers, HUDs (heads-up displays) and aggregated opponent databases, with penalties up to confiscation of account funds.
  The owner has not asked CoinPoker Support and accepts that risk. It stays private to the owner, post-session only, never
  shared between users, and behind a feature flag (a setting that switches it on or off).
- **Chip-based checks only** until payouts are entered by hand (a possible later addition).

## 5. Features

### 5.1 Copy for Claude (no backend)

A button on each hand that copies a text summary to paste into a chat: format, blinds, positions, stacks in big blinds,
action by street with bet sizes as % of pot, hero's cards and any shown cards, required equity for each call
(`call / (pot + call)`), SPR (stack-to-pot ratio: how much is behind compared with the pot), why the hand was flagged, and
the instruction "help me review this decision". Opponents are anonymised. Tested with fixed expected output for at least
three hand types.

### 5.2 Equity calculator

The base for most later features. Equity is the share of the pot a hand wins on average.

- **Done:** equity when all hands are known (`engine/equity.js`). Exact on the flop and turn (every runout); preflop
  uses 20,000 seeded Monte Carlo samples (random boards, repeatable per hand). Pots split into main and side pots. A
  fast 7-card evaluator, tested against `engine/cards.js` on 3,000 random hands.
- **Next:** equity against a range (the set of hands a player could hold), for the range model (5.6) and to score the
  quiz's painted ranges by equity.

### 5.3 All-in EV

**Done:** an **All-in EV** tab. For every all-in with cards still to come and every remaining player's cards shown, it
compares expected chips (equity × each pot, including side pots) with actual chips, and totals the difference as luck.
Heads-up and multiway. River all-ins are left out (no cards to come), and all-ins where an opponent mucked are listed as
skipped. Next: luck over time, once saved history exists (5.5).

### 5.4 Hand-reading trainer (targets the owner's main leak)

Uses showdown hands, where the opponent's cards are known, as an answer key.

- **Quiz (done):** replay a showdown hand street by street with villain's cards hidden. At each street, pick which
  hand categories villain could have. Preflop: big pair, small or medium pair, big aces and broadways, suited
  connectors and gappers, everything else. After the flop: strong (two pair or better using villain's cards), top pair
  or overpair, weaker pair, draw (flush draw or open-ended straight draw only), nothing. A made hand beats a draw.
- **Score (done):** 100 for the right category alone, less for each extra pick, 0 for a miss. Saved in `localStorage`
  with averages by street and the last 20 answers against the 20 before.
- **Settings (done):** two remembered checkboxes. **Advanced: paint the range** switches from categories to the
  13×13 grid, scored 100 × (1 − √share of live combos painted) if villain's hand is in the range, otherwise 0. **River
  only** asks once on the river (earlier streets are a replay) instead of every street. In advanced every-street mode,
  each street reports only in-range or not, the range carries over, and the hand is revealed after the river. In simple
  mode, a miss means finding the right category before moving on. Scores are kept per combination.
- **Copy for Claude on every answer (done):** the hand, the player's read and villain's real holding, with a request
  to explain the read. The in-app AI discussion (5.14) is the owner's goal for this.
- **Next:** scores by type of line (for example, "check-raise on the flop").
- **Review:** "what villains showed down with each line" across your own hands. This is a population summary (tendencies
  across all opponents), so it sits under the same feature flag as 5.10.
- Later: the quiz feeds the drill mode (5.8).

### 5.5 Saved history (in the browser first)

**Done.** Every analyzed upload is saved in IndexedDB (a database built into the browser) as raw hand text, keyed by
hand ID, and merged into the history the app opens on. Stats cards show a 95% confidence range (Wilson interval) and
sample size; each stat panel has a collapsible breakdown by stack depth (effective stack under 10, 10–20, 20–40, 40+
big blinds) and by position; a last-1,000 / last-5,000 window appears once more than 1,000 hands are saved.

- Next: notes per hand, and luck and quiz trends over time.
- Cloud storage tied to the account comes later (5.12).

### 5.6 Range model

A simple, editable model of what villains hold: preflop ranges by position and action, narrowed on each street by
their actions. Shown on each hand as a heuristic, it also feeds equity-vs-range checks. The hand-reading quiz (5.4) checks
the model against reality.

### 5.7 Push/fold checks

**Done:** a **Push/fold** tab. Every spot at 15 big blinds or less (effective) where Hero was first in, or faced a
single shove, is checked against a Nash push/fold chart solved for that exact spot (stack, antes, blinds, players left
to act) by fictitious play over a precomputed 169×169 preflop equity table. Differences are listed with their cost in
big blinds (the EV given up against opponents playing the chart), and each spot's chart can be opened on the grid.
Next: ICM-aware charts once payouts can be entered, and flags in the hand table.

### 5.8 Drill mode and review queue

**Done:** a **Review queue** tab ranks every flagged hand (all stat flags, push/fold mistakes, and all-in swings of
10bb or more) by bb at stake × flag weight. Each hand can be marked reviewed, copied for Claude, or drilled: the hand
replays to the flagged decision and Hero picks an action. Push/fold drills are scored against the chart; others show
the facts (what Hero did, pot odds, the flag) and are self-marked. Drills come back after 1, 3, 7 and 21 days while
right, and after 1 day when wrong.

### 5.9 More flags and columns

- Configurable target stat ranges per format, with reset to default (rebuild from the earlier spec: `engine/targets.js`,
  a settings panel, and defaults merged with your overrides).
- Required-equity column next to each call, with estimated equity against the range model.
- Missed value: strong hand checked back, or a very small bet relative to the pot.
- Raise-fold: raising and then folding to a re-raise with a large investment.
- Commitment: folding when pot-committed, or calling off light at low SPR.
- Bet sizing as % of pot by street.

### 5.10 Opponent database (owner's decision, see section 4)

Private notes and stats per opponent (hands seen, VPIP (voluntarily put money in pot), PFR (preflop raise), 3-bet,
fold to c-bet (continuation bet), showdowns, tags), each with sample size and confidence. Shown only in post-session
review. Opponents are still anonymised in every export and AI prompt. Exports show opponents as IDs, not names, so this
depends on those IDs being stable (open question 1).

### 5.11 Bluff analysis

Classifies hero's bets as value, thin value, semi-bluff (a bluff with a draw) or pure bluff, using equity against the
range model rather than against a random hand. Measures:

- frequency, against the balanced river bluff share `b / (p + 2b)` (`b` is the bet and `p` the pot before it)
- fold rate, against the break-even rate `b / (p + b)`
- spot selection: blockers, villain weakness, number of opponents

All of these are measured over saved history, not per tournament.

### 5.12 Cloud history

Saves the browser data to the signed-in account (needs a small API and storage, designed when we get there).

### 5.13 Play-quality score

Shown in two units, each split by tournament stage (deep, middle, short): big blinds per 100 hands (each hand in its own
big blind), and % of stack lost, because a 5bb mistake at 15bb deep hurts far more than at 100bb. Built from objective checks (push/fold deviations, calls below required equity,
all-in EV, flag costs), with a breakdown, the best and costliest decisions, and a trend against your own average.

### 5.14 In-app AI discussion

The owner wants this inside the app eventually, starting from the quiz's and hand table's Copy for Claude text.

Chat about a hand, preloaded with the 5.1 context plus your notes and stats. Needs a serverless backend holding the API
key, login, rate limits and a monthly spend cap.

### 5.15 Poker-themed redesign

New look and the name "Poker Performance Analytics", after accounts and history so it covers those screens.

## 6. Build order

1. Copy for Claude (5.1): small, useful straight away
2. Hand-reading quiz (5.4): targets the main leak, and needs only showdown hands
3. Equity calculator (5.2), then all-in EV (5.3)
4. Saved history in the browser, rolling stats, stack-depth breakdown (5.5)
5. Range model (5.6)
6. Push/fold checks (5.7)
7. Configurable targets and more flags (5.9)
8. Drill mode and review queue (5.8)
9. Opponent database (5.10)
10. Bluff analysis (5.11)
11. Cloud history (5.12)
12. Play-quality score (5.13)
13. AI discussion (5.14)
14. Redesign (5.15)

Done: login and account creation (Cognito hosted pages, PR #3), Copy for Claude (PR #5), collapsible load panel (PR
#6), hand-reading quiz with category and range modes (PR #7), equity calculator and all-in EV.

## 7. Working agreement

- When unsure about an approach, Claude stops and asks, with options and a recommendation (also in `CLAUDE.md`).
- One feature per branch and pull request, merged after CI passes. Conventional commit messages (`feat:`, `fix:`,
  `docs:` and so on).
- Every feature: pure logic in `src/engine/` with tests, a regression test for every bug, README updated when it ships.

## 8. Open questions

1. **Are opponent IDs stable?** Exports show opponents as an ID (like `7581a7d2`), not a screen name. If the same player
   keeps the same ID across hands and tournaments, the opponent database can key on it. If IDs change per table or
   tournament, it can't link hands to people.
2. **Volume.** Roughly how many tournaments or hands a week? This sets how quickly rolling stats become reliable.

## 9. Decisions to review

Choices made while building without the owner present. Each can be changed; say which.

- **All-in EV (5.3):** the tab covers every loaded hand, not just the selected tournaments. River all-ins are left out,
  since no cards are to come. Preflop all-ins use 20,000 random boards (about ±0.4%).
- **Saved history (5.5):** every tournament now starts selected (before, only the first one was), so the app opens on
  stats over your whole history. The built-in sample is never saved. The last-N window only appears once more than
  1,000 hands are saved. Breakdowns show VPIP, PFR, 3-bet, fold to 3-bet, c-bet, WTSD and bb won; other stats can be
  added. Hands are stored as raw text and parsed again on load, so parser fixes apply to old hands too.
- **Push/fold (5.7):** shown as its own tab (like all-in EV), not as tags in the hand table. Standard chart
  simplifications: chip EV, every player at the spot's effective stack, at most one caller, card removal ignored.
  "Shove" means putting in 95% or more of the stack; limps and smaller raises are skipped. Spots are solved at the
  stack rounded to 0.5bb. The equity table is 20,000 random boards per matchup (about ±0.35%; checked within 0.7% of
  high-precision values), built by
  `scripts/build-preflop-equity.mjs`.
- **Review queue (5.8):** ranking weights are judgement calls: expensive call and weak continue 1 × call size;
  push/fold mistake 5 × its EV cost; cheap fold 0.5 × pot; race 0.5 × chips in; missed 3-bet 0.3 × open size; all-in
  swing of 10bb+ 0.2 × swing. A hand's drill stops at its most important flagged decision (push/fold first, then
  expensive call, weak continue, cheap fold, missed 3-bet, race). Only push/fold drills are scored automatically;
  others are self-marked because there's no solver. Reviewed marks and drill schedules are kept in `localStorage`.
