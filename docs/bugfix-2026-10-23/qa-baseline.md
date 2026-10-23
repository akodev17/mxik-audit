# QA baseline on `main`, 23 Oct 2026 (Agent 5, Phase A)

What passes and fails on `main` **before** any bug-fix branch is merged, so a Phase B failure can be
put down to the integration branch or to a problem that was already there.

- Commit: `f11abc4` (main + the programme plan), branch `claude/agent5-qa-bf5d5e`, worktree
  `.claude/worktrees/agent5-qa-bf5d5e`, fresh `npm ci`, `npx prisma generate`.
- Toolchain: Node 20.18.2, Next 15.5.23, Prisma 6.19.3, Windows 10, Edge for Playwright.
- `.env` copied from the main checkout, `DATABASE_URL` with `&connection_limit=4`. No `REDIS_URL`,
  no `SMTP_URL`/`MAIL_FROM`, no Google/Telegram keys, no `NEXT_PUBLIC_SITE_URL`.
- Servers: API `tasnivo-api-4015` (`tsx watch`, port 4015); web `tasnivo-web-3015` (`next dev`) for
  the first e2e run, then `tasnivo-web-3015-prod` (`next start` of the production build) for the
  second. Shared dev Postgres `127.0.0.1:54329`, Redis container on `127.0.0.1:63799`.

## Summary

| Check | Result | Notes |
|---|---|---|
| `npx prisma migrate status` | **PASS** | 44 migrations, "Database schema is up to date!" (at 12:40; see §Migrations for what the shared DB holds now) |
| `npm run typecheck` | **PASS** | exit 0, 2 min 04 s |
| `npm run lint` | **PASS** (1 warning) | `scripts/lib/xlsx.ts:131:11` no-non-null-assertion (warning, not error) |
| `npm test` | **PASS** | 400 files, 1647 tests: 1645 pass, 0 fail, 2 skipped; 2 min 02 s. Redis tests skip silently, see below |
| `npm run build` (web) | **PASS** | `next build apps/web`, 44 s |
| `npm run build:api` | **PASS** | `apps/api/dist/main.mjs` 1.6 MB; booted from the bundle on port 4095, `/api/health` 200 |
| `npm run build:worker` | **PASS** | `apps/worker/dist/main.js` 968 KB |
| e2e, `next dev` on 3015 | **FAIL** | 56 tests: 38 pass, **9 fail**, 9 skipped (21 min 46 s) |
| e2e, production build on 3015 | **FAIL** | 56 tests: 40 pass, **7 fail**, 9 skipped (17 min 58 s) |
| Migrations on an empty DB | **PASS** | all 44 apply to a new database; known drift only (§Migrations) |
| Docker images | see §Docker | |

**The e2e suite is red on `main` today.** Every failure comes from two e2e selectors that the UI
refresh (U1–U5, merged untested, `docs/HANDOFF_2026-10-23.md` §4.2) broke, plus two tests that
can only pass on a production build. None is in an area the five workstreams own; none is
caused by a product bug I could find. Details below; the fixes are one-liners in the specs.

## Unit tests (`npm test`)

Green. Skips, all gated on the environment:

| Test | Why skipped | Re-run |
|---|---|---|
| `apps/api/test/e2e/redis-rate-limit.test.ts`: `RedisRateLimitStore`, `/api/v1 with REDIS_URL set` | `.env` has no `REDIS_URL`, tests fall back to `redis://127.0.0.1:6379`, but the compose Redis is published on **63799** | `REDIS_URL=redis://127.0.0.1:63799` → 7/7 pass (with the worker test) |
| `apps/worker/src/worker.test.ts`: `worker (Redis + database)` | same | pass |
| `packages/domain/src/jobs/dispatcher.test.ts`: `BullDispatcher on a real Redis` | same | 15/15 pass |
| two weighted full-text ranking tests | "weighted full-text column not built here (npm run search:weighted)" | not re-run (needs a long index build) |

So Phase B should run `npm test` with `REDIS_URL=redis://127.0.0.1:63799` as well, or the Redis
rate-limit store (which Agent 1's code-attempt limits may use) goes untested.

## e2e (`npm run test:e2e`)

`E2E_BASE_URL=http://localhost:3015 E2E_CHANNEL=msedge`. The sign-in rate limit did not trip
(the fixture uses a per-run client address); no `auth_attempt` cleanup was needed.

| Suite (file) | Tests | `next dev` | production build |
|---|---|---|---|
| account flows on the API (`account-flows`) | 5 | pass | pass |
| demo access by e-mail (`demo-access`) | 6 | **pass** (the handoff's known U1 failure does not reproduce) | pass |
| firm dictionary review (`dictionary-review`) | 3 | pass | pass |
| empty states of a new firm (`empty-states`) | 3 | pass | pass |
| query-only navigation (`navigation`) | 6 | pass | pass |
| refresh after a change (`refresh`) | 4 | **2 fail** (F3, F4) | pass |
| review assignments and notifications (`review-assignment`) | 5 | pass | pass |
| review flow (`review-flow`) | 17 | **5 fail, 7 skipped** (F1) | **5 fail, 7 skipped** (F1) |
| a catalogue of 3000 rows (`scale`) | 3 | **1 fail, 2 skipped** (F1) | **1 fail, 2 skipped** (F1) |
| settings navigation (`settings-nav`) | 5 | pass | pass |
| app shell layout (`shell-layout`) | 4 | **1 fail** (F2) | **1 fail** (F2) |

### F1. Upload confirm step: heading locator matches two headings (6 failures + 9 skips)

- Fails: `review-flow` steps 4 ("review and correct the column mapping"), 5, 6, 7, 8 and `scale`
  step 16 ("3000 rows upload through the wizard and are audited"). Skips: review-flow 9, 10, 11, 12,
  13, 14, 18 and scale's two follow-ups (they need the audited catalogue).
- Error: `strict mode violation: locator('main').getByRole('heading', { name: 'Nima boʻladi' })
  resolved to 2 elements: <h2 id="confirm-title">Nima boʻladi</h2>, <h3>Keyin nima boʻladi</h3>`.
- Cause: the UI refresh added the h3 `importX.done.whatNext` = "Keyin nima boʻladi"
  (`packages/i18n/src/i18n-parts/imports.ts:409`) to the confirm step; Playwright's `name` is a
  substring match by default, so the spec's `getByRole('heading', { name: TA.importX.confirm.title })`
  now matches both. Step 4 fails before it presses "start", so no audit runs and step 5 waits its
  full 15-minute timeout; 6–8 fail on the missing workspace.
- Fix (test only): `exact: true` at `apps/web/e2e/review-flow.e2e.ts:257`, `:520` and
  `apps/web/e2e/scale.e2e.ts:78`.
- Verified with a throwaway local patch (not committed) against the production build:
  `scale` 3/3 pass, review-flow 16/17 then 12/17 (see F5), so nothing else hides behind F1.

### F2. Folded sidebar width check reads the header nav (1 failure)

- Fails: `shell-layout` 23 "the sidebar names its items from xl; folded to icons…" —
  `page.waitForFunction: Timeout 30000ms exceeded` at `apps/web/e2e/shell-layout.e2e.ts:105`.
- Cause: the check uses `document.querySelector('[data-rail="collapsed"] nav[aria-label]')`
  (line 106). Since U2 (`fc2a2c4`) the header's `TopNav` has `aria-label={ta.shellX.nav.label}`
  (`apps/web/src/ui/shell/top-nav.tsx:64`) and sits before the rail in the DOM, so the selector finds
  the header nav, whose parent is ~1 376 px wide, never ≤ 64.5 px. The rail itself is 64 px.
- Fix (test only): target the rail's nav, e.g. `nav[aria-label="${TA.shellX.nav.utilities}"]`
  passed into the page function. Verified with a throwaway patch: 4/4 pass.

### F3 and F4. `refresh` tests that only pass on a production build (dev only)

- F3 `refresh` "20 router.refresh() on the dashboard commits without any other update": the renamed
  client did not appear within `SETTLE_MS` = 2 000 ms after the first refresh. Same result on an
  isolated re-run. On the production build it passes.
- F4 `refresh` "20 a section fetched ahead before a workspace decision shows the decision":
  `page.waitForResponse` for `/queue?_rsc=` after hovering the header "Navbat" tab times out.
  Cause: `useIntentPrefetch` (`apps/web/src/ui/shell/intent-prefetch.ts`) calls `router.prefetch`,
  which Next.js does not run in development. Passes on the production build.
- Conclusion: run e2e against `next start` (launch entry `tasnivo-web-3015-prod`), as W4a did
  (56/56 on Docker images). A failure of these two on `next dev` is not a regression.

### F5. Intermittent: review-flow step 8 "pick another code" (seen once, behind F1)

With F1 patched locally, step 8 passed in one run and failed in the next:
`timed out after 15 s waiting for picked code in the database; last value
{"decision":"pending","chosenMxik":null}` (`review-flow.e2e.ts:415`). The drawer was open on the
right row; the "Tanlash: <code>" click did not save the pick. Not investigated further (flaky,
cause unknown). If it shows up in Phase B, it is pre-existing.

## Migrations

- `npx prisma migrate status` at 12:40: 44 migrations, up to date. Newest folder on `main`:
  `20261026120000_restricted_code` (dated three days ahead of today).
- **Empty database:** `CREATE DATABASE mxik_qa_empty` → `migrate deploy` applies all 44, exit 0.
  Kept as the "database at `main`'s state" for Phase B (checklist M3).
- **Drift on `main` (expected, raw-SQL objects Prisma cannot model)**, from
  `prisma migrate diff --from-url <mxik_qa_empty> --to-schema-datamodel schema.prisma`:
  - `catalog.clientId`: NOT NULL in the DB, `String?` in the schema (documented in the schema: a
    trigger fills the default client).
  - `catalog_item`: index on `rawName` (trigram, raw SQL).
  - `mxik_code`: indexes on `code`, `embeddingRu`, `embeddingUz`, `matchKeys`, `searchText`,
    `searchVector`, `(subPositionCode, isBase)`; `searchVector` generated default
    `to_tsvector('simple', "searchText")`.
  Any other line in the same diff in Phase B is new drift.
- **Shared dev DB `_prisma_migrations` (state at ~13:20):** 7.3 GB database. Already holds two
  migrations from the workstream branches, applied by Agents 1 and 3 at 07:44/07:46 UTC:
  `20261027100000_email_code_google` and `20261027100000_usage_ledger`: **the same timestamp**
  (checklist M4). Historic failed-then-resolved rows exist for `20261021100000_replay_unique`,
  `20261023100000_weighted_search_vector` and `20261026100000_demo_requests` (the last resolved as
  applied with 0 steps; its table `demo_request` exists). They are pre-existing and harmless, but
  make `_prisma_migrations` show 3 rows with `finished_at IS NULL` that are not new failures.

## Docker

Filled in below once the image builds finish (`docker build --target api|worker|web`, tags
`mxik-audit-*:qa-baseline`, so the team's own images are untouched).

## Environment notes for Phase B

- The in-app browser pane shares one `localhost` cookie jar across ports: opening :3015 showed
  Agent 1's test user signed in. Use a private context (Playwright) or sign in deliberately; never
  sign out in the pane, it ends another session's server-side record.
- `next build` writes `apps/web/.next`, which `next dev` also uses: stop the dev server before a
  production build.
- Running unit tests and e2e at the same time against one DB was avoided; keep it that way.
