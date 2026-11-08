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

- Exact equity when all hands are known (enumerating every remaining board).
- Equity against a range (the set of hands a player could hold), by Monte Carlo sampling (simulating many random boards).
- Extends `engine/cards.js` from 5-card to best-of-7-card evaluation. Tested against known equity values.

### 5.3 All-in EV

For every all-in where the cards were shown, compare expected chips (equity × pot) with actual chips won. Shows "luck"
separately from decisions, per hand and over time.

### 5.4 Hand-reading trainer (targets the owner's main leak)

Uses showdown hands, where the opponent's cards are known, as an answer key.

- **Quiz (done):** replay a showdown hand street by street with villain's cards hidden. At each street, pick which
  hand categories villain could have. Preflop: big pair, small or medium pair, big aces and broadways, suited
  connectors and gappers, everything else. After the flop: strong (two pair or better using villain's cards), top pair
  or overpair, weaker pair, draw (flush draw or open-ended straight draw only), nothing. A made hand beats a draw.
- **Score (done):** 100 for the right category alone, less for each extra pick, 0 for a miss. Saved in `localStorage`
  with averages by street and the last 20 answers against the 20 before.
- **Next:** an Advanced mode with a switch, where you paint villain's range on the 13×13 starting-hand grid instead of
  picking categories. Scores by type of line (for example, "check-raise on the flop").
- **Review:** "what villains showed down with each line" across your own hands. This is a population summary (tendencies
  across all opponents), so it sits under the same feature flag as 5.10.
- Later: the quiz feeds the drill mode (5.8).

### 5.5 Saved history (in the browser first)

Saves imported hands, notes and settings in IndexedDB (a database built into the browser), so stats can cover many
tournaments. One tournament is too small a sample for most frequencies. Then:

- Stats over rolling windows (last 1,000 / 5,000 hands) with confidence ranges.
- Stats by **stack depth** (effective stack under 10, 10–20, 20–40, 40+ big blinds) as well as by position.
- Cloud storage tied to the account comes later (5.12).

### 5.6 Range model

A simple, editable model of what villains hold: preflop ranges by position and action, narrowed on each street by
their actions. Shown on each hand as a heuristic, it also feeds equity-vs-range checks. The hand-reading quiz (5.4) checks
the model against reality.

### 5.7 Push/fold checks

For stacks under about 15 big blinds, compare shoves, calls of shoves, and folds with Nash push/fold charts (game-theory
tables of correct all-in and call ranges by stack size and position), in chip terms. Flags deviations with their cost.

### 5.8 Drill mode and review queue

- **Review queue:** hands to study, ranked by big blinds at stake and how severe the flag is, with a "reviewed" state.
- **Drill:** replay a hand to the decision point, choose an action, then see the analysis. Missed spots come back at
  growing intervals (spaced repetition).

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

Done: login and account creation (Cognito hosted pages, PR #3), Copy for Claude (PR #5), hand-reading quiz
(category mode).

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
