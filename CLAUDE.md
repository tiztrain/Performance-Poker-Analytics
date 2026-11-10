# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Client-side analyzer for CoinPoker tournament hand histories: vanilla JS (no framework, no TypeScript) built with Vite.
The only backends are optional: the AI chat (`backend/chat`, `infra/chat.tf`, `enable_chat`) and cloud history
(`backend/sync`, `infra/history.tf`, `enable_cloud_history`; browser side `render/cloudSync.js`, merging in
`engine/sync.js`). Every key a new localStorage feature uses must be added to `SYNC_KEYS` in `engine/sync.js`, with a
merge rule, if it should follow the user across devices. Loaded hands are saved in the browser's IndexedDB (`render/historyStore.js`, raw text
re-parsed on load by `engine/history.js`); quiz scores and settings, review-queue marks and drill schedules, and stat target overrides use `localStorage`. Optional login uses Amazon
Cognito's hosted pages (phase 2); saving hand histories to an account is not built yet. See `README.md` for user-facing behavior and the bug case studies,
`infra/README.md` for the AWS setup, and `docs/ROADMAP.md` for planned features and their build order.

## Rules

- `src/engine` never imports from `src/render`.
- Run `npm test`, `npm run lint` and `npm run format:check` before every commit.
- Work on a branch, not on `main`.
- Push feature branches, open pull requests, and merge them into `main` once CI passes, without asking (the owner's
  instruction of 2026-11-09). Merging deploys the live site, so merge only work that is tested and complete. Never push
  directly to `main`.
- When unsure which approach to take (design, scope, scoring rules, poker assumptions, trade-offs), take the option you
  would recommend, build it, and record it under "Decisions to review" in the pull request and in `docs/ROADMAP.md`
  (section 9) so the owner can overrule it later. Stop and ask only when work can't go ahead without them (credentials,
  AWS changes, spending money).

## Learning

This project is also a way for the owner to learn software delivery, so teaching is part of every task.

- Before work that relies on a concept they may not know, ask whether they know it. Explain the ones they don't, and
  skip the ones they do.
- Explain what you did and why, in plain language, using this project as the example.
- Once they say they know a concept, don't ask about it again.
- Expand abbreviations with their full name and a few words on what they do, in brackets, e.g. OIDC (OpenID Connect:
  proving who someone is to another service) or PKCE (Proof Key for Code Exchange: protects the login code). Do this in
  explanations and in new code comments.

## Commands

Requires Node 22.13+ or 24, the overlap of what `vitest` 5 and `eslint` 10 support. CI uses 24.

`package.json` overrides `minimatch` to `^11.0.4`, outside the `^10` range ESLint declares, to clear advisory
GHSA-g3hv-75wg-m249. Remove the override once ESLint depends on a fixed version.

```bash
npm run dev                            # Vite dev server
npm test                               # all tests, once
npx vitest run tests/parser.test.js    # one test file
npx vitest run -t "wheel"              # tests whose name matches
npm run lint                           # ESLint
npm run format                         # Prettier, write
npm run format:check                   # Prettier, check only
npm run build                          # production build to dist/
```

`src/engine/preflopEquity.json` (169×169 all-in equities used by push/fold) is generated, not hand-written: rebuild it
with `node scripts/build-preflop-equity.mjs` (about 17 minutes) if the evaluator or sampling changes.

CI runs lint, format check, test and build. The format check covers the whole repo, including Markdown, so run
`npm run format` after editing docs too.

## Architecture

Data flows one way:

`main.js` -> `parseAll` (text to hand objects) -> `renderResults` -> `groupByTournament` -> `computeStats` per selection
-> HTML strings.

- **`src/engine/`** is pure logic with no DOM access. Tests run in Vitest's
  `node` environment and cover this layer plus `src/auth/oauth.js`, so anything that needs testing belongs in a pure
  module. Where logic needs browser storage (the quiz store in `engine/quiz.js`), the storage object is passed in, so
  tests can use a stand-in.
- **`src/render/`** builds HTML strings, assigns them to `innerHTML`, then binds events. `results.js` is the orchestrator:
  date, tournament and view selection all live in closures inside `renderResults`, and its `rerender()` redraws from
  them. New view state goes there.
- **`src/state.js`** holds only the BB/chips display mode and a pointer to the current `rerender`, so the unit toggle in
  `main.js` can redraw whichever view is on screen. Amounts must be formatted through the helpers in
  `src/render/format.js` to respect that mode.
- **`src/auth/`** handles optional login. `oauth.js` is pure (URL building, PKCE, JWT decoding) and is tested;
  `session.js` does the redirects, `sessionStorage` and token request. Login is on only when `VITE_COGNITO_DOMAIN` and
  `VITE_COGNITO_CLIENT_ID` are set at build time, so the app must keep working with `authEnabled` false. Never decode a
  token to grant access in the browser: anything that trusts a token must verify its signature server-side.
- **`backend/chat/`** is the AI chat's Lambda. `core.js` is pure (limits, budget, pricing, request building) and
  tested with stand-ins; `handler.js` wires in DynamoDB, SSM, SNS and the Anthropic SDK. `npm run build:lambdas` bundles it
  with esbuild (AWS SDK left external) into `infra/build/chat-lambda.zip`. The API key must never reach the browser.
  The site shows the chat only when built with `VITE_CHAT_API_URL` and login on (`render/chatPanel.js`).
- **`index.html`** contains all the CSS, inline in a `<style>` block, including the color variables the render code
  references. There are no separate stylesheets.

Two files are named `format.js`: `engine/format.js` classifies tournament formats; `render/format.js` formats money and
cards. Stat targets live in `engine/targets.js`.

## Domain invariants

These encode real bugs or deliberate decisions; `tests/grouping.test.js` pins the first three.

- **Group tournaments by name and ID** (`name::tourneyId`). CoinPoker reuses display names for recurring tournaments.
- **Order hands by timestamp** using `handSortKey`, never by hand ID. IDs are not reliably chronological.
- **Bucket dates by tournament start** (`groupStartDate`), so a tournament that runs past midnight stays in one day.
- **Never blend stats across formats.** Regular, turbo, hyper and satellite each get their own stat panel with its own
  targets (`engine/targets.js`). Turbo and hyper defaults are labelled estimates; satellite deliberately has none.
- **Sum bb results per hand** using each hand's own `heroNetBB`, because blind levels change during a tournament.
- **Keep flags framed as review prompts.** There is no solver. `engine/equity.js` is exact only when every hand is
  known (all-in EV); `engine/rangeModel.js` estimates villain's range from editable charts and heuristic narrowing, so
  "vs their estimated range" figures, hand-strength flags and `detectPreflopRace` are estimates, and the UI says so.

## Parser assumptions

`parser.js` is line-by-line regex matching against CoinPoker's export format, so a format difference usually produces
silently wrong or missing data rather than an error.

- The player is hard-coded as the literal name `Hero`.
- Hands are split on lines starting `CoinPoker Hand #`, and the header regex only accepts `NLH`.
- `src/sample-hand.js` is the reference for the format. Its player names are anonymized; keep any new fixtures that way.

## Deployment

Pushes to `main` run `.github/workflows/deploy.yml`, which repeats the CI checks, then syncs `dist/` to S3 and invalidates
CloudFront, authenticating through GitHub OIDC with no stored AWS keys. Terraform in `infra/` is applied manually and is
never run by CI. The build reads the Cognito settings from the `COGNITO_DOMAIN` and `COGNITO_CLIENT_ID` repository
variables. The deploy role's trust policy is limited to the branch in `github_branch` (default `main`), so a branch
rename needs matching workflow and Terraform changes.
