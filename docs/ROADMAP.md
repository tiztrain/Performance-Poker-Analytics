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

**Done** (`engine/rangeModel.js`): default preflop charts (open by position, limp, call an open, big blind defend,
3-bet, call a 3-bet, 4-bet, big blind check) built from hand strength and editable in a **Ranges** tab. Villain's range
comes from their last preflop action, then each postflop action re-weights holdings by hand category. Each Hero call in
the hand detail shows "you had ~X% vs their estimated range" (green when above the equity needed), estimated by sampling
when the hand is opened.

- Next: show the estimated range on each hand's grid; use it in the advanced quiz; adjust ranges per opponent once the
  opponent database exists.

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

**Done:**

- Target ranges for every percentage stat, per format (`engine/targets.js`): defaults for regular (common tournament
  ranges), turbo and hyper (estimates), none for satellite; an "Edit targets" panel under each stat grid saves your
  own ranges in this browser, with reset per stat or for the whole format. Too high is graded like too low.
- Required equity shown on every Hero call (and every fold facing a bet) in the hand detail.
- New flags with hand-table filters and review-queue reasons (`engine/moreFlags.js`): missed value (two pair or better
  with your own cards, river checked down or bet under 33% of the pot), raise-fold (20%+ of stack in on that street),
  committed fold (a third or more of the stack in), and bet sizing (postflop bets or raises under 25% or over 150% of
  the pot, all-ins excluded).
- Next: estimated equity against a range next to the required equity, once the range model (5.6) exists; and calling
  off light at low SPR.

### 5.10 Opponent database (owner's decision, see section 4)

Private notes and stats per opponent (hands seen, VPIP (voluntarily put money in pot), PFR (preflop raise), 3-bet,
fold to c-bet (continuation bet), showdowns, tags), each with sample size and confidence. Shown only in post-session
review. Opponents are still anonymised in every export and AI prompt. Exports show opponents as IDs, not names, so this
depends on those IDs being stable (open question 1).

### 5.11 Bluff analysis

**Done:** a **Bluffs** tab over every loaded hand (`engine/bluffs.js`). Each Hero bet or raise after the flop is
classified by Hero's equity against the range that would call it (the range model, narrowed by the "call" weights):
value, thin value, semi-bluff or bluff. It reports the river bluff share against the balanced share `b / (p + 2b)` for
Hero's sizes, how often bluffs and semi-bluffs won straight away against the break-even fold rate `b / (p + b)`, the
result of hands with a bluff, average spot quality, and a list of every bluff with its conditions.

- Next: blockers (cards in Hero's hand that make villain's strong hands less likely) as a spot-quality condition.

### 5.12 Cloud history

Saves the browser data to the signed-in account (needs a small API and storage, designed when we get there).

### 5.13 Play-quality score

**Done:** a **Play quality** tab (`engine/quality.js`). Estimated mistake cost from push/fold deviations (exact),
calls with less estimated equity than needed and folds with more (after the flop, or preflop facing an all-in), and
losing bluffs in weak spots. Shown across saved history and per tournament, in bb per 100 hands and % of stack per 100
hands, split by stage (deep 40bb+, middle 15–40bb, short under 15bb), with the last 10 tournaments against the long-run
average and each tournament's three costliest decisions. No 1–10 rating (owner's choice).

- Next: "best decisions" alongside the costliest; a chart of the trend over time.

### 5.14 In-app AI discussion

**Built, off until the owner switches it on** (steps in `infra/README.md`). A **Discuss with Claude** button next to
every Copy for Claude button (hand table, quiz answers, review-queue drills) opens a side panel. The hand text goes to
our own API (`backend/chat`, `infra/chat.tf`): API Gateway verifies the Cognito token, a Lambda enforces daily limits
(free 3, "full" group 30) and a $10 monthly budget with email alerts at 50/80/100%, and calls Claude Opus 5.5 with the
hand cached in the system prompt and server-side refusal fallbacks on. The key lives in SSM Parameter Store.

- Next: a self-hosted model (Ollama on the owner's home-lab machine) as a second provider behind `CHAT_PROVIDER`. It
  needs the machine reachable from AWS (a tunnel) and will reason less well than Opus about poker; test it against
  the same hands before switching.
- Later: include the player's notes and stats in the context; save conversations.

### 5.15 Poker-themed redesign

New look and the name "Poker Performance Analytics", after accounts and history so it covers those screens.

## 6. Build order

Done: login and account creation (PR #3), Copy for Claude (#5), collapsible load panel (#6), hand-reading quiz (#7),
equity calculator and all-in EV (#9), saved history (#10), push/fold (#11), review queue and drills (#12), targets and
more flags (#13), AI chat, switched off until set up (#14), range model.

Remaining, in order:

1. Bluff analysis (5.11)
2. Play-quality score (5.13)
3. Cloud history (5.12)
4. Redesign (5.15)
5. Opponent database (5.10), last: the owner isn't sure yet how to identify opponents beyond the IDs in the exports
   (the IDs are stable across tournaments, so a database could key on them, with nicknames the owner adds).

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
- **Targets and flags (5.9):** turbo and hyper target defaults are estimates (labelled so on the cards); grading
  allows a margin of a quarter of the range's width (at least 3 points) before "leak". Raise-fold needs 20% of the
  stack in on the street; committed fold needs a third of the stack in. New review-queue weights: raise-fold and
  committed fold 1 × chips in, missed value 0.5 × pot, sizing 0.2 × bet.
- **AI chat (5.14):** Opus 5.5 at low effort (keeps answers inside API Gateway's 30-second limit; chat-style review
  does well at low effort), max 2,000 output tokens per reply. Free tier 3 messages a day, "full" group 30, $10
  monthly budget estimated from token usage (the Console spend limit is the hard stop). Conversations aren't saved.
  Server-side refusal fallbacks are on (`fallbacks: "default"`), so a declined request is retried on another model.
  The "full" Cognito group is created even while the chat is off. The Anthropic SDK is pinned to 1.3.0 (18 days old
  at the time) rather than the newest release.
- **Range model (5.6):** default chart sizes: opens UTG 14%, UTG+1 16%, UTG+2 18%, MP 20%, MP+1 22%, HJ 25%, CO 30%,
  BTN 45%, SB 40%; limp 50% minus the top 10%; call an open 21% minus the top 7%; big blind defend 45% minus the top 7%;
  3-bet 7%; call a 3-bet 12% minus the top 3%; 4-bet 3%; big blind check 100% minus the top 10%. Hand strength order:
  equity vs a random hand, +2.5% suited, +1.5% connected, −2% pairs. Postflop weights (strong / top pair / weaker pair /
  draw / nothing): bet ≥60% pot 1/0.7/0.2/0.6/0.25, smaller bet 1/0.9/0.5/0.6/0.4, raise 1/0.5/0.1/0.5/0.2, call
  0.6/1/0.8/1/0.15, check 0.5/0.8/1/0.9/1. Shoves use the same charts as raises. Equity is against the player whose bet
  Hero called, even in multiway pots; 3,000 samples (about ±1%).
- **Bluff analysis (5.11):** equity is against the opponent who acted last on the street (or the first still in), with
  their range narrowed as if they call. River: value above 50%, bluff under 30%, thin between. Flop and turn: value above
  50%; a draw is a semi-bluff; a pair with 30%+ is thin; 30%+ with no pair or draw is a semi-bluff. "Won straight away"
  means every opponent folded to that bet. Verdicts: under-bluffing below half the balanced share, over-bluffing above
  1.25×. Spot quality conditions: heads-up, the opponent checked earlier on the street or checked without betting on
  the previous one, a draw (flop/turn), no showdown value (river), not all-in. 1,500 samples per flop/turn bet.
- **Play quality (5.13):** preflop calls and folds only count when facing an all-in (with betting still to come, raw
  equity overstates what a hand can win, so nearly every big-blind fold would look like a missed call); push/fold spots
  are counted by their chart cost only. Call and fold costs use the estimated range and ignore later streets (implied
  odds). A losing bluff costs bet × share of poor spot conditions, and only when the hand lost. Stages use the
  effective stack at the start of the hand.
