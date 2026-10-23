# QA checklist, bug-fix programme 23 Oct 2026 (Agent 5)

Run in Phase B on `agent5-qa` after merging `agent4-integration`, from the worktree root, servers on
API 4015 / web 3015. Every item ends as PASS / FAIL / N/A in `qa-report.md`, with evidence (command
output, test name, file:line, or a screenshot under `docs/bugfix-2026-10-23/agent5/`). A failure is
attributed with `qa-baseline.md`: a check that already failed on `main` at `f11abc4` is
"pre-existing", anything else belongs to the integration branch.

Facts the items rely on (from `main`): trial = 14 days, `clients: 3`, `rowsPerMonth: 5 000`,
`seats: 2` (`packages/domain/src/billing/plans.ts:22`); session cookie is iron-session, sealed with
`SESSION_SECRET`, server-side record in `session-store` keyed by `sid`; CSRF = global
`CsrfGuard` (`X-Requested-With: tasnivo` + Origin check on mutating requests, `@SkipCsrf()` opt-out);
`safeNext` in `packages/domain/src/security/safe-next.ts` (web copy kept in parity by
`tests/web-parity/safe-next.test.ts`); rate limits are `RULES` in
`packages/domain/src/security/rate-limit.ts` (rows in `auth_attempt`); the newest migration on
`main` is `20261026120000_restricted_code` (dated *after* today, see M4).

## S. Security review

Read `git diff main...HEAD` for each item; add a test or a manual probe where the item says so.

| # | Item | How to check |
|---|---|---|
| S1 | **Session fixation.** Every path that signs a browser in (password, verification code, Google callback, Telegram widget, Telegram deep link, invite accept, sign-up, 2FA completion) goes through `openSession`/`finish` in `packages/domain/src/security/sign-in.ts`, which ends the old `sid` and creates a new one. No new path writes `userId`/`orgId` into the cookie by hand. | `grep -rn "session.userId =\|userId:" apps/api/src packages/domain/src/security` on the diff; probe: take the cookie before sign-in, sign in, confirm the old `sid` record is ended and the old cookie is refused by `/api/auth/me` (or equivalent). |
| S2 | **Pending verification state cannot be promoted.** A session marked "pending verification" (unverified user) carries no `userId`/`orgId` usable by `SessionGuard`, or the guard refuses it; completing the code rotates `sid` (S1). | Read the new session fields; unit test in `apps/api/test/unit/guards.test.ts`. |
| S3 | **Google OAuth `state` + PKCE.** `GET /api/auth/google` sets a random `state` (≥128 bit) and PKCE `code_verifier` in an httpOnly, `SameSite=Lax`, short-lived cookie (or sealed session field); the callback refuses a missing/mismatched/reused `state` (timing-safe compare), clears it after use, and sends `code_verifier`. The callback is a GET, so `CsrfGuard` does not cover it: `state` is the CSRF defence and must be checked before any code exchange. | Read `apps/api/src/auth/*google*` and `packages/domain/src/security/google.ts`; tests for: no state, wrong state, replayed state, expired state. |
| S4 | **Google ID token verification.** Signature against Google JWKS (`jose` `createRemoteJWKSet`/`jwtVerify` or equivalent), `iss` in {`https://accounts.google.com`, `accounts.google.com`}, `aud` = `GOOGLE_CLIENT_ID`, `exp` checked, `email_verified === true` required; `nonce` checked if sent. Account linking by e-mail only when the existing user is verified; otherwise refused (account-takeover guard). | Read code; tests with a fixture JWKS: bad signature, wrong aud, wrong iss, expired, `email_verified:false`, link-to-unverified refused. |
| S5 | **Telegram login hash.** HMAC-SHA256 with key `SHA256(bot_token)` over the sorted data-check-string, compared with `timingSafeEqual` (equal-length buffers), `auth_date` freshness enforced (≤ 1 day or stricter). Telegram-created account counts as verified; Telegram never links to an existing e-mail account silently. | `packages/domain/src/telegram/login*.ts` + tests. |
| S6 | **Open redirect in `next`.** Every new redirect target (after code verification, after Google/Telegram callback, `/sign-up/verify?next=`) is passed through `safeNext`; OAuth callback never redirects to a URL taken from the request without `safeNext`. `safeNext` tests still pass and the web copy is in parity. | `grep -rn "redirect\|Location\|next" ` in the diff of `apps/api/src/auth`, `apps/web/src/app/sign-*`; `tests/web-parity/safe-next.test.ts`; probe `next=//evil.example`, `next=https://evil.example`, `next=/\evil.example`. |
| S7 | **Verification code storage.** 6-digit code generated with `crypto.randomInt` (not `Math.random`), stored only as a hash (keyed HMAC preferred, since 10⁶ codes are brute-forceable from a plain SHA-256), with expiry (≤ 15–30 min) and an attempt counter; compare is constant-time (`timingSafeEqual` on equal-length digests, or comparing hashes in SQL); a used or superseded code stops working. | Read the new table/model and domain module; tests: expiry, reuse, superseded code, wrong code. |
| S8 | **Rate limits on code attempts and resends.** Wrong codes lock after N (≤ 5–10) per code and per user; resend limited per e-mail and per IP (reuse `RULES.resendEmail`/`resendIp` or new rules); Google/Telegram callbacks limited per IP. Limits are server-side (`auth_attempt`), not UI-only. | Read `RULES`; tests for lockout and resend limit; probe in browser (6 wrong codes → locked). |
| S9 | **Secrets and codes never logged in production.** The dev fallback (code to API log and `tmp/outbox/`) runs only when `NODE_ENV !== 'production'`; in production missing `SMTP_URL`/`MAIL_FROM` is a startup/sign-up error, not a bypass. No `console.log` of codes, tokens, ID tokens, `client_secret`, OAuth `code`, cookies or passwords anywhere in the diff. | `grep -rn "console\.\(log\|info\|debug\)\|logger\.\(log\|debug\)" ` on the diff; read the mailer fallback; run `NODE_ENV=production` sign-up path test (or read the guard). |
| S10 | **Unverified users refused on every session endpoint.** All `auth: 'session'` endpoints (130 on `main`) refuse a user with `emailVerifiedAt = null` except the allow-list (verify, resend, sign-out, `me`). Check the mechanism is global (guard), not per-handler, so new endpoints are covered by default. | Read `SessionGuard`/`AccessGuard`; unit test over the contracts registry that lists every session endpoint and asserts 403 (or the specific code) for an unverified user except the allow-list; manual probe of 3 endpoints with curl. |
| S11 | **Quota gate on every entry point.** `rowsPerMonth` checked server-side, against the durable ledger, in web upload commit (`catalog-upload.ts` ~91 and ~179), public API (`api/handlers.ts:116`), Telegram bot (`telegram/bot.ts:65`), and any new path (re-audit, import, duplicate). `clients` (`apps/api/src/clients/clients.service.ts:50`, restore in `client-lifecycle.ts`) and `seats` (`team-forms.ts`) not bypassable by delete/restore. | `grep -rn "gate(\|allows(" `; ledger tests; API test for upload → delete → upload. |
| S12 | **CSRF on new mutating endpoints.** New POST endpoints (verify code, resend, Telegram sign-in, Google unlink) are not marked `@SkipCsrf()` unless they are provider callbacks with their own signature/state check. | `grep -rn "SkipCsrf" ` in the diff. |
| S13 | **Cookies.** New cookies (OAuth state, pending verification) are `httpOnly`, `Secure` in production, `SameSite=Lax`, path-scoped, with `maxAge` ≤ 10 min, and cleared after the callback. | Read code; inspect Set-Cookie in the browser. |
| S14 | **User enumeration.** Resend and sign-in answers do not reveal whether an e-mail exists beyond what `main` already reveals. | Compare responses for known vs unknown e-mail. |
| S15 | **Dependencies.** Any new dependency (e.g. `jose`) is from the lockfile, pinned, no install scripts added; `npm ci` clean. | `git diff main...HEAD -- package.json package-lock.json`. |
| S16 | **Leftovers.** No debug output, `TODO`/`FIXME`/`XXX` added, `.only`/`.skip`/`test.todo`, commented-out code, hard-coded secrets, real e-mails/tokens, or `.env` committed. | `git diff main...HEAD \| grep -n "^+.*\(console\.\|TODO\|FIXME\|XXX\|\.only(\|\.skip(\|skip:\|todo(\|debugger\)"`; `git diff --stat main...HEAD -- .env*`. |

## M. Database migrations

| # | Item | How to check |
|---|---|---|
| M1 | **Additive only.** New migration SQL has no `DROP`, `RENAME`, `ALTER COLUMN ... TYPE`, `SET NOT NULL` without a default, or destructive `DELETE`/`TRUNCATE` of existing data. | `git diff main...HEAD --name-only -- packages/db/prisma/migrations`; grep each new `migration.sql`. |
| M2 | **Applies on an empty database.** Fresh scratch DB `mxik_qa_empty2` (`docker exec mxik-audit-db psql -U <user> -d postgres -c "CREATE DATABASE mxik_qa_empty2"`) → `DATABASE_URL=...mxik_qa_empty2 npx prisma migrate deploy` → exit 0; then `npx prisma migrate diff --from-url <that url> --to-schema-datamodel packages/db/prisma/schema.prisma` shows **only the drift already present on `main`** (listed in `qa-baseline.md` §Migrations: raw-SQL indexes on `mxik_code`/`catalog_item`, the `searchVector` generated default, `catalog.clientId` NOT NULL by trigger). Any new line in the diff is a FAIL. Drop the scratch DB after. | Commands above. |
| M3 | **Applies on a database at `main`'s state with real-shaped data.** The shared dev DB can no longer serve as "before" (Agents 1 and 3 already applied their migrations there), and at 7.3 GB a full copy is impractical. Use `mxik_qa_empty` (kept from Phase A: exactly `main`'s 44 migrations applied): load data into it (`npm run seed` with its `DATABASE_URL`, plus a trial org with 2 catalogues committed this month, one catalogue from last month, one `uploaded` (uncommitted) catalogue, users with and without `emailVerifiedAt`), record counts, then `migrate deploy` the integration branch's migrations → exit 0; row counts of existing tables unchanged. Second check: `migrate status` against the shared dev DB → up to date, no "applied but missing locally" migrations (that happens if a folder was renamed after an agent applied it, see M4). | Commands above; `SELECT count(*)` before/after on `organization`, `"user"`, `catalog`, `email_token`. |
| M4 | **Strictly increasing timestamps after the newest existing migration.** Every new folder name sorts after `20261026120000_restricted_code`, and no two folders share a timestamp. **Known risk found in Phase A:** Agents 1 and 3 have both applied a migration with the same timestamp to the shared DB: `20261027100000_email_code_google` and `20261027100000_usage_ledger`. Prisma orders them by full name, so it works, but the integration must either keep both names exactly (they are already recorded in `_prisma_migrations` of the shared DB) or rename one and fix the shared DB's `_prisma_migrations.migration_name` to match; a rename without that leaves the shared DB reporting one migration "missing locally" and one "not yet applied" (re-running its SQL would fail on existing tables). | `ls packages/db/prisma/migrations \| sort -c`; `npx prisma migrate status` on the shared DB; compare with `main`. |
| M5 | **Backfill correctness.** The usage-ledger migration inserts one row per non-`uploaded` catalogue of the current month with `amount = rowCount`, so for every org `usageOf` after deploy equals the old `SUM(rowCount)` before deploy; re-running is impossible (migration runs once) and the app does not double-count catalogues already in the ledger. Users backfilled as verified where `emailVerifiedAt` was already set; no existing user is locked out (decide: existing users with `emailVerifiedAt = null` on `main` were created while mail was off and are signed in today). | Query before/after on the copy DB: per-org old sum vs new ledger sum; count of users with `emailVerifiedAt IS NULL`. |
| M6 | **Reversibility documented.** Each new migration has a stated manual rollback (drop the new table/columns) in the agent's result note; nothing depends on a destructive down step. | Read `*-result.md`. |
| M7 | **Prisma client regenerated and schema in sync.** `npx prisma generate` succeeds; `npx prisma validate`; `npx prisma migrate status` on the dev DB says "Database schema is up to date" after `migrate deploy`. | Commands. |
| M8 | **Shared-DB safety.** The integration's migrations are already applied to the shared dev DB by the agents; `migrate status` lists no failed (`finished_at IS NULL`) rows in `_prisma_migrations`. | `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`. |

## B. Builds

| # | Item | How to check |
|---|---|---|
| B1 | `npm ci` from a clean `node_modules` succeeds with the merged lockfile. | Command. |
| B2 | `npm run typecheck` exit 0. | Command. |
| B3 | `npm run lint` exit 0 (warnings recorded). | Command. |
| B4 | Web: `npm run build` (Next production build) exit 0. | Command. |
| B5 | API: `npm run build:api` exit 0 and `node apps/api/dist/main.mjs` boots far enough to listen (smoke on a spare port, then stop). | Command. |
| B6 | Worker: `npm run build:worker` exit 0. | Command. |
| B7 | Docker images (`docker compose --profile app build` or the `Dockerfile` targets) build, only if Docker is up and time allows. | Command; N/A otherwise. |

## R. Regression

| # | Item | How to check |
|---|---|---|
| R1 | Unit/integration: `npm test`, then again with `REDIS_URL=redis://127.0.0.1:63799` for the Redis-gated files (`apps/api/test/e2e/redis-rate-limit.test.ts`, `apps/worker/src/worker.test.ts`, `packages/domain/src/jobs/dispatcher.test.ts`), which skip silently otherwise. Baseline: 1647 tests, 1645 pass, 0 fail, 2 skipped (+ Redis ones). Every failure is either pre-existing or fixed; new test files from Agents 1–3 run and pass (count tests vs baseline). | Command; compare counts with the baseline. |
| R2 | e2e against the **production build** (`npm run build`, then launch `tasnivo-web-3015-prod`): `E2E_BASE_URL=http://localhost:3015 E2E_CHANNEL=msedge npm run test:e2e`. Baseline on `main`: 40 pass, 7 fail (F1 ×6, F2 ×1), 9 skipped. Expected after integration: at most those 7 (zero if Agent 2's fix session fixed F1/F2), F5 may flake; the new sign-up → code → dashboard spec passes. `next dev` additionally fails F3/F4 by design. Clear `auth_attempt` once if the sign-in rate limit trips. | Command; compare per suite with `qa-baseline.md`. |
| R3 | **Both locales.** Every new string exists in `uz` and `ru` (`packages/i18n`); sign-in, sign-up, `/sign-up/verify`, plan banner and quota-refusal message render in both with no raw keys or fallbacks. | `tests` i18n parity test if present; switch locale in the browser and screenshot `/sign-up/verify` in both. |
| R4 | **Mobile width (375 px).** `/sign-in`, `/sign-up`, `/sign-up/verify`, dashboard with plan banner, upload refusal: no horizontal scroll, buttons reachable. | `resize_window` mobile preset; screenshots. |
| R5 | Seed user `buxgalter@demo.uz` still signs in and reaches the dashboard. On `main`, `packages/db/prisma/seed.ts:128` creates it **without** `emailVerifiedAt` (the shared dev DB has it set, but a fresh `npm run seed` does not), and 27 of the 35 users in the dev DB have `emailVerifiedAt IS NULL`. Check: seed on `mxik_qa_empty` sets it verified; the migration/backfill decision for existing unverified users is documented (M5) and the e2e fixture still creates verified users (`apps/web/e2e/fixture.ts:119,157`). | Browser; `npm run seed` on the scratch DB; SQL. |
| R6 | Smoke of core flows unaffected by the auth change: upload wizard → audit → catalogue workspace → export; clients page; settings tabs; demo (`/demo`); share link. | Browser walk; e2e covers most. |
| R7 | Bug list: every S1/S2 in `docs/bugfix-2026-10-23/bugs.md` has a fix commit and a test; spot-check three in the browser. | Read `agent2-fixes-result.md`; browser. |

## A. Owner's acceptance scenarios (drive in the in-app browser on :3015, screenshot each numbered step)

Screenshots: `docs/bugfix-2026-10-23/agent5/a1-*.png`, `a2-*.png`, `a3-*.png`.

### A1. An unverified user cannot reach protected features

1. Open `http://localhost:3015/sign-up` in a fresh context (no cookie). Register with a new address
   `qa-a1-<timestamp>@example.test` and a password.
2. Expect redirect to `/sign-up/verify` (the code step), not `/dashboard`. Screenshot.
3. Without entering the code, open `/dashboard`, `/catalogs`, `/clients`, `/settings` directly.
   Expect each to bounce to `/sign-up/verify` (or sign-in) and never render app data. Screenshot one.
4. From the same browser, call three session endpoints with the cookie (browser devtools `fetch`
   with `X-Requested-With: tasnivo`): a GET (e.g. catalogues list), a POST (e.g. create client), and
   the upload preview endpoint. Expect 401/403 with the "verify" error code; record the responses.
5. Sign out, sign in again with the same e-mail/password. Expect `/sign-up/verify` again, not the
   dashboard.
6. Enter a wrong code 6 times. Expect a lockout message after the configured limit. Screenshot.
7. Read the right code from the API log or `tmp/outbox/` (dev fallback), request a resend if locked,
   enter it. Expect `/dashboard`, the trial banner with 14 days left, `planStatus.state = 'trial'`.
   Screenshot.
8. Confirm in the DB: `emailVerifiedAt` set, `organization.trialEndsAt ≈ now + 14 d`, code row used.

### A2. Google and Telegram sign-in

Automated (must pass in `npm test`): Google — authorize URL contains `state`, `code_challenge`,
`code_challenge_method=S256`, correct `redirect_uri` and scopes; callback refuses missing/wrong/
replayed state; ID-token verification with a fixture JWKS (good token accepted; bad signature,
wrong `aud`, wrong `iss`, expired, `email_verified:false` refused); new Google user gets a trial org
and is verified; linking to an existing verified user by e-mail works; linking to an unverified user
is refused. Telegram — hash check accepts a correctly signed payload and refuses a tampered field,
a wrong bot token and a stale `auth_date`; new Telegram user gets a trial org and counts as
verified; bind/unbind in Settings.

Browser (no owner credentials expected locally):
1. With `GOOGLE_CLIENT_ID` and `TELEGRAM_BOT_TOKEN` unset, `/sign-in` and `/sign-up` show neither
   button. Screenshot.
2. With a dummy `GOOGLE_CLIENT_ID` set on the 4015 API (restart), the Google button appears; clicking
   it lands on `accounts.google.com/o/oauth2/v2/auth?...` — stop there, do not sign in. Record the
   query (state, PKCE, redirect_uri = `<site>/api/auth/google/callback`). Screenshot.
3. Hit `/api/auth/google/callback?code=x&state=forged` directly: expect a refusal page/redirect to
   `/sign-in` with an error, no session cookie set. Screenshot.
4. Telegram: with no bot configured, record N/A for the widget; POST a forged payload to the
   Telegram sign-in endpoint: expect refusal.

Manual steps for the owner (documented in the report, executed only with real credentials):
Google — create an OAuth client (Web) in Google Cloud Console, authorised redirect URI
`https://tasnivo.uz/api/auth/google/callback` (and `http://localhost:3000/...` for local), set
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, restart API; sign in with a Gmail account on `/sign-in`
→ lands on `/dashboard` with a 14-day trial; sign out; sign in again → same org. Telegram — create a
bot with @BotFather, `/setdomain` to the site domain, set `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_BOT_USERNAME`, restart; the widget appears on `/sign-in`; sign in → new trial org, or bind
from Settings → Security for an existing account.

### A3. Upload → delete → upload past the trial cap is refused by the API

Automated (must pass in `npm test`): Agent 3's API/domain regression test — trial org, commit
catalogue A of N rows (N ≤ 5 000), delete A, `usageOf.rowsPerMonth` still N, commit catalogue B of
M rows with N + M > 5 000 → refused with reason `rowsPerMonth`. Same for public API
`POST /api/v1/catalogs` and the Telegram bot path (domain-level).

Browser:
1. Create a fresh trial user (A1 flow, or a verified fixture user via the DB) on :3015.
2. Upload a catalogue of ~3 000 rows (generate with `npm run make:sample` or an xlsx from
   `tmp/found-catalogs/`), commit/audit it. Dashboard usage meter shows ~3 000 / 5 000. Screenshot.
3. Delete the catalogue from the catalogues list. Usage meter still ~3 000 / 5 000. Screenshot.
4. Upload a second catalogue of ~3 000 rows and try to commit. Expect refusal with the
   rows-per-month message (uz and ru). Screenshot.
5. Repeat step 4's commit as a raw API call (`fetch` POST with `X-Requested-With: tasnivo`) to make
   sure the refusal comes from the API, not only the UI. Record status code and body.
6. Clients bypass: create 3 clients (trial cap), delete one, restore it / create another → the
   4th live client is refused. Record.
