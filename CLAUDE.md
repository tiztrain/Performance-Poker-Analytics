# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Client-side analyzer for CoinPoker tournament hand histories: vanilla JS (no framework, no TypeScript) built with Vite.
There is no backend of our own and no saved data. Optional login uses Amazon Cognito's hosted pages (phase 2); saving hand
histories to an account is not built yet. See `README.md` for user-facing behavior and the bug case studies, and
`infra/README.md` for the AWS setup.

## Rules

- `src/engine` never imports from `src/render`.
- Run `npm test`, `npm run lint` and `npm run format:check` before every commit.
- Work on a branch, not on `main`.
- Don't push without asking.

## Learning

This project is also a way for the owner to learn software delivery, so teaching is part of every task.

- Before work that relies on a concept they may not know, ask whether they know it. Explain the ones they don't, and
  skip the ones they do.
- Explain what you did and why, in plain language, using this project as the example.
- Once they say they know a concept, don't ask about it again.

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

CI runs lint, format check, test and build. The format check covers the whole repo, including Markdown, so run
`npm run format` after editing docs too.

## Architecture

Data flows one way:

`main.js` -> `parseAll` (text to hand objects) -> `renderResults` -> `groupByTournament` -> `computeStats` per selection
-> HTML strings.

- **`src/engine/`** is pure logic with no DOM access. Tests run in Vitest's
  `node` environment and cover this layer plus `src/auth/oauth.js`, so anything that needs testing belongs in a pure
  module.
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
- **`index.html`** contains all the CSS, inline in a `<style>` block, including the color variables the render code
  references. There are no separate stylesheets.

Two files are named `format.js`: `engine/format.js` classifies tournament formats and holds benchmark targets;
`render/format.js` formats money and cards.

## Domain invariants

These encode real bugs or deliberate decisions; `tests/grouping.test.js` pins the first three.

- **Group tournaments by name and ID** (`name::tourneyId`). CoinPoker reuses display names for recurring tournaments.
- **Order hands by timestamp** using `handSortKey`, never by hand ID. IDs are not reliably chronological.
- **Bucket dates by tournament start** (`groupStartDate`), so a tournament that runs past midnight stays in one day.
- **Never blend stats across formats.** Regular, turbo, hyper and satellite each get their own stat panel; `getTargets`
  deliberately has no numeric benchmarks for hyper and satellite.
- **Sum bb results per hand** using each hand's own `heroNetBB`, because blind levels change during a tournament.
- **Keep flags framed as review prompts.** There is no equity engine: hand-strength flags and `detectPreflopRace` are
  heuristics, and the UI copy says so.

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
