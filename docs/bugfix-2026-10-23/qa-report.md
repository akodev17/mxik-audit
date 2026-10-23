# QA report, bug-fix programme 23 Oct 2026 (Agent 5, Phase B)

**Verdict: PASS.** `claude/agent4-integration-d41667` at `fb50942` may go to `main`. All builds,
static checks, unit tests and the production-build e2e suite pass, the migrations apply cleanly,
and all three of the owner's acceptance scenarios work in the browser. Five non-blocking FAIL
items are listed at the end (two low-severity security hardening points, two documentation gaps
and one dev-server-only e2e timing case). None of them is a regression against `main` that breaks
a feature, and none is in the scenarios the owner asked for.

- Branch under test: `claude/agent5-qa-bf5d5e` = `main`@`f11abc4` + this QA work + a merge of
  `claude/agent4-integration-d41667`@`fb50942` (merge commit `0d1eee9`). The only conflict was
  `.claude/launch.json` (both sides kept). No code fixes by QA were needed, so the branch adds
  nothing to the integration but docs, launch entries and screenshots.
- Checklist: `qa-checklist.md`. Baseline on `main`: `qa-baseline.md`. Screenshots:
  `docs/bugfix-2026-10-23/agent5/`.
- Servers: API `tasnivo-api-4015`; web `tasnivo-web-3015` (`next dev`) and `tasnivo-web-3015-prod`
  (`next start`), browsed at `http://agent5.localhost:3015` (its own cookie jar).
- Owner's waiver applied: no SMTP, Google or Telegram credentials. Those parts are PASS
  (automated) / NOT RUN (manual).
- `main`'s `384ab76` (removes `docs/pricing/*.png`, `docs/ui-refresh/{preview,u1,u3,u4,u5}/*`):
  nothing in the integration diff references those files. No code anywhere does. Only prose in
  `docs/HANDOFF_2026-10-23.md` and `docs/UI_REFRESH_PLAN.md` (already on `main`) names the folders.

## Results by item

### B. Builds

| # | Item | Result | Evidence |
|---|---|---|---|
| B1 | `npm ci` with the merged lockfile | PASS | exit 0; no new dependency (`package.json` adds only the `mail:test` script) |
| B2 | `npm run typecheck` | PASS | exit 0 |
| B3 | `npm run lint` | PASS | 0 errors, 1 warning `scripts/lib/xlsx.ts:131` (same as baseline) |
| B4 | `npm run build` (web) | PASS | exit 0, 46 s |
| B5 | `npm run build:api` + boot | PASS | `dist/main.mjs` booted on :4095, 170 routes mapped, `/api/health` 200 |
| B6 | `npm run build:worker` | PASS | exit 0 |
| B7 | Docker images api, worker, web | PASS | `docker build --target …` → `mxik-audit-{api,worker,web}:qa-integration` (built, not run) |

### R. Regression

| # | Item | Result | Evidence |
|---|---|---|---|
| R1 | `npm test` without Redis | PASS | 1729 tests: 1727 pass, 0 fail, 2 skipped (baseline 1647 / 1645 / 0 / 2) |
| R1 | `npm test` with `REDIS_URL=redis://127.0.0.1:63799` | PASS | 1738 tests: 1736 pass, 0 fail, 2 skipped. The Redis files ran; the two skips are the weighted-search tests that need `npm run search:weighted` (as in the baseline) |
| R2 | e2e, production build | **PASS** | **60/60 pass**, 0 skipped, 4 min 40 s (baseline 40 pass / 7 fail / 9 skipped). F1, F2 and F5 from the baseline are gone (Agent 2's B6, B7) |
| R2 | e2e, `next dev` | PASS (dev-only failures) | 57 pass, 2 fail, 1 skipped. Both failures are `refresh` "router.refresh() commits" tests (dashboard round 0, client page round 3), the renamed client not showing within 2 s. Dev-server timing, the baseline's F3 class: both pass on the production build. The skip is `refresh` test 4, which skips itself on `next dev` by design (B8). See FAIL-5 |
| R3 | Both locales | PASS | Code step, 403 `unverified`, wrong-code message, mail subject, upload refusal and plan banner checked in `ru` and `uz` (`r3-r4-code-step-ru-375.jpg`, `a3-4-…-uz.jpg`, `a3-5-…-ru.jpg`). The i18n parity tests pass in `npm test` |
| R4 | Mobile width 375 px | PASS | `/sign-up`, `/sign-up/verify`, `/dashboard` with plan banner: `scrollWidth` = 375 (no horizontal scroll); `r4-*.jpg` |
| R5 | Seed user signs in | PASS | `buxgalter@demo.uz` lands on `/dashboard` (`r5-seed-user-dashboard.jpg`). `seed.ts:134` now sets `emailVerifiedAt`. A fresh `npm run seed` on a scratch DB could not run: it needs the classifier (`npm run load:db`, hours), as on `main` |
| R6 | Core flows | PASS | covered by the green e2e suite (upload wizard → audit → workspace → decisions → export → re-upload, clients, settings, demo, share) and the A3 walk below |
| R7 | S1/S2 bugs fixed with tests | PASS | `bugs.md` has no S1. All five S2 (B1–B5) are fixed with named tests (`agent2-fixes-result.md`). Spot checks: B16 `GET /robots.txt` 200 and disallows the app sections; B11 a text file named `fake.xlsx` is refused with "not an Excel workbook"; B20 the drop zone lists only `.xlsx` `.csv` (`a3-4-…jpg`). B9 is still "not reproduced" and B15 (landing in `ru`) is deferred, both S3 |

### M. Migrations

Three new migrations: `20261027100000_email_code_google`, `20261027100000_usage_ledger`,
`20261027130000_notification_text`.

| # | Item | Result | Evidence |
|---|---|---|---|
| M1 | Additive only | PASS | new tables `email_code`, `usage_ledger`; nullable `user.googleSub` (unique), `notification.text`; `IF NOT EXISTS` throughout; no DROP/RENAME/ALTER TYPE/SET NOT NULL/DELETE |
| M2 | Empty database | PASS | new DB → `migrate deploy` applied all 47, exit 0. `migrate diff` against `schema.prisma` is **byte-identical** to `main`'s known drift (raw-SQL indexes, generated `searchVector`, `catalog.clientId` trigger) |
| M3 | DB at `main`'s state with data | PASS | scratch DB with `main`'s 44 migrations, plus 2 trial orgs, 3 users (2 unverified), 5 catalogues (this month analyzing/ready/failed, one `uploaded`, one last month). `migrate deploy` applied the 3 new ones, exit 0. Row counts of `organization`, `user`, `catalog`, `client` unchanged (2/3/5/2). `migrate status` up to date |
| M4 | Timestamps after `20261026120000`, no clash on the shared DB | PASS | all sort after it; `sort -c` passes. The two `20261027100000_*` folders share a timestamp but keep the exact names already recorded in the shared DB's `_prisma_migrations`, so `migrate status` there says up to date (the risk from Phase A did not happen) |
| M5 | Backfill correctness and existing users | PASS | on the M3 DB the ledger got one row per non-`uploaded` catalogue of this UTC month: org A 600 + 400 = **1000** = old `SUM(rowCount)`, org B **50** = old sum; the `uploaded` and last-month catalogues were left out; `period` = `2026-10-01`. Unit test "the migration counts exactly what usageOf used to" passes. Existing unverified users stay unverified and get the code step at next sign-in; DEPLOY.md 7c gives the SQL to confirm emailed-invite members first |
| M6 | Rollback documented | **FAIL** (doc) | no result note states a manual rollback. See FAIL-3 |
| M7 | Client regenerated, schema valid, status | PASS | `prisma generate`, `prisma validate` exit 0; `migrate deploy` on the shared DB: "No pending migrations"; `migrate status`: up to date |
| M8 | No failed rows from this work | PASS | `_prisma_migrations` on the shared DB has only the three historic resolved rows noted in the baseline; the new three finished cleanly |

### S. Security review (`git diff main...HEAD`, 192 files)

| # | Item | Result | Evidence / note |
|---|---|---|---|
| S1 | Session fixation on sign-in | PASS | every sign-in (password, sign-up, Google, Telegram, invite, e-mail link) goes through `openSession`/`finish` (`sign-in.ts:34`), which ends the old `sid` and creates a new one. No new code writes `session.userId`/`sid` by hand |
| S2 | Pending verification cannot be promoted / rotates `sid` | **FAIL** (low) | an unverified user holds a full session that `AccessGuard` refuses (good), but entering the code marks the user verified **without rotating `sid`** (`auth-forms.ts:138` → `verification.ts:22`). See FAIL-1 |
| S3 | Google `state` + PKCE, CSRF on the callback | PASS | 192-bit state, 384-bit PKCE verifier (S256), nonce, all sealed in the session cookie for 10 min (`google.ts` `startGoogle`); callback spends the state first, compares it timing-safe, and refuses missing, forged or stale state. Probes on a spare API with a dummy client: forged state → `/sign-in?error=google_state`; replaying the right state after use → `google_state`; right state with a bogus code → `/sign-in?error=google`, no session (`/api/auth/me` 401) |
| S4 | ID token verification | PASS | RS256 only (alg `none`/HS256 refused), JWKS key by `kid` with one refetch on rotation, `iss`, `aud`, `exp`/`iat` with 60 s skew, nonce, `email_verified` required. Links by e-mail only to a **confirmed** user, otherwise `google_conflict`. 13 tests in `google.test.ts` with a fixture JWKS |
| S5 | Telegram hash | PASS | unchanged and correct: HMAC-SHA256 with `SHA256(bot_token)`, `timingSafeEqual` on equal lengths, `auth_date` ≤ 5 min, replay guard (`telegram/login.ts`). New callback tests. Forged hash on a spare API with a dummy bot → refused |
| S6 | Open redirect in `next` | PASS | Google stores `safeNext(next)`; code step always lands on `/dashboard`; sign-in keeps `safeNext` and sends unverified users to the fixed `VERIFY_PATH`. `safe-next` tests + web parity test pass |
| S7 | Code storage and compare | PASS | `crypto.randomInt`, 6 digits, keyed hash `keyedHash('email-code', userId:code)`, 15 min expiry, attempt counter capped in the same UPDATE (parallel guesses cannot exceed 5), timing-safe compare, a new code retires older ones (`email-code.ts`) |
| S8 | Rate limits on attempts and resends | PASS | 5 wrong entries per code (seen in the browser: locked on the 5th, the right code refused afterwards), `RULES.verifyCodeUser` 10 per 15 min per user, resend 3/h per mailbox + 10/h per IP. Note: the Google/Telegram callbacks have no per-IP limit of their own; each needs a fresh one-time state or signed data, and new accounts there go through `RULES.signupIp` |
| S9 | Secrets and codes not logged in production | PASS | the code reaches the log only in the outbox mode, which is off when `NODE_ENV=production` (set in the `Dockerfile` and `docker-compose.yml`). Production without SMTP refuses sign-up and logs an error at start-up (`apps/api/src/main.ts:19`). The request log drops the query string (`middleware.ts:58`), so OAuth `code`/`state` are not logged. Google warnings log only status codes and error messages |
| S10 | Unverified refused on every session endpoint | PASS | global: `Route()` adds `SessionGuard` + `AccessGuard` to every `auth: 'session'` entry; `AccessGuard` refuses `!verified` unless `allowUnverified` (only `me`, `verify-code`, `verify-code/resend`). The 3 `session: 'manual'` routes are closed-account status/reopen (a closed org) and the Telegram bind callback, which treats an unverified user as signed out. A guard test walks every registry entry. Browser: GET catalogues, GET dashboard, POST create client and POST upload preview → 403 `unverified` |
| S11 | Quota gate on every entry point | PASS | all three entry points (web wizard `catalog-upload.ts`, public API `api/handlers.ts`, Telegram `telegram/bot.ts`) commit through `applyMapping` → `consumeRows` (`catalog-import.ts:173`). It takes a per-org advisory lock, counts the ledger, and the catalogue consumes once. Clients and seats take the same lock (`clients.ts`, `invites.ts`). Browser: clients cap 3 holds, and archiving a client does not free a slot |
| S12 | CSRF on new mutating endpoints | PASS | no `@SkipCsrf()` added; `verify-code` and resend are POST behind `CsrfGuard`; the Google endpoints are GETs protected by `state` |
| S13 | Cookies | PASS | Google flow lives in the sealed iron-session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production) and is cleared on callback. No new cookie |
| S14 | User enumeration | **FAIL** (low) | sign-up now answers differently for a new address (`{redirect: "/sign-up/verify"}`) and a registered one (`{checkEmail: true}`). On `main` with SMTP on, both answered "check your e-mail". DEPLOY.md 7c states this trade-off. See FAIL-2 |
| S15 | Dependencies | PASS | none added (Google token checks use `node:crypto`); `npm ci` clean |
| S16 | Leftovers | PASS | no `TODO`/`FIXME`/`.only`/`debugger`/committed `.env`/real secrets in added lines. Added `console.*` calls are deliberate operator messages (outbox, Google failure status, production SMTP error, `mail:test` CLI). Added skips are `dbSkipReason()` guards like the existing ones and `refresh` test 4 on `next dev` (B8). The only secret-looking string is a fake value in `apps/api/test/unit/http.test.ts` |

### A. Owner's acceptance scenarios (in-app browser, production build, `agent5.localhost:3015`)

**A1. An unverified user cannot reach protected features: PASS.**
1. `/sign-up` → registered a local test address `qa-a1-…@example.test`.
2. Landed on `/sign-up/verify`, not the dashboard (`a1-2-sign-up-lands-on-code-step.jpg`).
3. `/dashboard`, `/catalogs`, `/clients`, `/settings`, `/upload`, `/queue` all end on
   `/sign-up/verify` (`a1-3-dashboard-redirects-to-code-step.jpg`).
4. From the page with the session cookie: `GET /api/catalogs`, `GET /api/dashboard`,
   `POST /api/clients`, `POST /api/catalogs/preview` → **403** `{"code":"unverified"}`; `GET /api/auth/me` 200.
5. Signed out ("Boshqa hisob bilan kirish"), signed in again with the password → `/sign-up/verify`
   again (`a1-5-…jpg`).
6. Wrong codes: "Kod notoʻgʻri" (`a1-6a-wrong-code.jpg`); the 5th wrong entry locked the code; the
   **right** code was then refused with "too many wrong attempts, ask for a new code" (`a1-6b-…jpg`).
7. "Kodni qayta yuborish" → "new code sent" (`a1-7a-resend.jpg`); the new code from
   `tmp/outbox/` → `/dashboard` (`a1-7b-right-code-dashboard.jpg`). `GET /api/billing/plan`:
   `state: "trial"`, `daysLeft: 14`, limits clients 3 / rows 5 000 / seats 2.
8. DB: `emailVerifiedAt` set, `trialEndsAt − createdAt` = 14.000 days, 2 codes both used/retired,
   attempts capped at 5.

**A2. Google and Telegram sign-in: PASS (automated) / NOT RUN (manual, needs owner credentials).**
- Automated, all in the green `npm test`: `google.test.ts` (13 tests: fixture JWKS, good token,
  other key, changed payload, iss/aud/exp/iat/nonce, alg none/HS256, RFC 7636 S256 vector, config
  and redirect URI, PKCE/state/nonce in the redirect, forged state spent, new verified user gets a
  confirmed 14-day trial and signs in again as the same user, joins only a confirmed address,
  unverified address/bad token/Google error refused, key rotation); `login-callbacks.test.ts`
  (new Telegram account → confirmed 14-day trial bound to it; replayed, stale, forged or foreign
  data refused; no bot → back to sign-in); `email-code.test.ts` (13 tests, including the outbox
  path and the production refusal).
- Development outbox: PASS. Codes for both test accounts were read from `tmp/outbox/` (uz and ru
  subjects); sign-up with a registered address wrote the "someone tried to sign up" note there.
- Buttons hidden without credentials: PASS. `/api/auth/config` → `{"telegramBot":null,"google":false}`;
  no Google/Telegram button on `/sign-in` or `/sign-up` (`a2-1-…jpg`, `a2-1b-…jpg`). With a dummy
  `GOOGLE_CLIENT_ID` on a spare API, config reports `google: true` and `/api/auth/google` redirects
  to `accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri=…/api/auth/google/callback`,
  `response_type=code`, `scope=openid email profile`, `state`, `nonce`, `code_challenge`,
  `code_challenge_method=S256`. `next=//evil.example` was dropped by `safeNext`.
- Manual steps in DEPLOY.md: complete and correct apart from one detail (FAIL-4). 7c covers Gmail
  app passwords, `SMTP_URL` encoding, `mail:test`, code limits, Google console setup and the
  linking rules. 7d covers the trial and the Telegram manual check (BotFather `/setdomain`,
  new-account → trial, same org on second sign-in, bind from Settings, unbound refused). NOT RUN:
  live Gmail delivery, live Google sign-in, live Telegram widget.

**A3. Upload → delete → upload past the trial cap is refused by the API: PASS.**
1. Same trial account (verified in A1), usage 0 / 5 000.
2. Upload wizard with a 3 000-row CSV → preview 3 000 rows (`a3-1-…jpg`) → mapping → "Tahlilni
   boshlash". Plan page: rows **3 000 / 5 000** (`a3-2-…jpg`).
3. Audit finished; deleted the catalogue from the list (`a3-3a-delete-confirm.jpg`). Catalogue
   list empty (`a3-3c-…jpg`), DB: 0 catalogues, ledger still 1 entry / 3 000 rows; plan page still
   **3 000 / 5 000** (`a3-3b-…jpg`).
4. A second 3 000-row upload is refused: "Bu oy uchun qatorlar chegarasi tugadi. Tarifni yangilang."
   (`a3-4-…-uz.jpg`); in Russian "Лимит строк на этот месяц исчерпан. Обновите тариф." (`a3-5-…-ru.jpg`).
5. Raw API from the page: `POST /api/catalogs/preview` with 3 000 rows →
   `{"ok":false,"error":"Bu oy uchun qatorlar chegarasi tugadi…"}`; with 1 500 rows (fits) →
   `{"ok":true,"preview":…}` (the preview was then discarded). So the refusal comes from the API.
   The commit-time gate (`consumeRows`, under the per-org lock) is covered by `usage-ledger.test.ts`
   (upload/delete/upload, concurrent commits, once per catalogue) and `apps/api/test/e2e/quota.test.ts`
   (web wizard and public API `plan_limit`).
6. Clients: created clients 2 and 3 (cap 3) → the 4th refused "mijozlar soni chegarasiga yetdingiz";
   archiving one and creating another → still refused; restored.

## FAIL items (none blocks the merge)

| # | Severity | Item | Where | What to do |
|---|---|---|---|---|
| FAIL-1 | Low (security hardening) | S2: confirming the e-mail code upgrades the session to verified without a new `sid`. An attacker who could plant their own unverified session cookie in a victim's browser, and get the victim to type a code mailed to the victim's address, would end up with a verified session of an account whose address they control. That needs cookie injection and an account registered with the victim's address, so the risk is small | `packages/domain/src/security/auth-forms.ts:138` (`verifyCodeForm` → `confirmCode`, `verification.ts:22`) | after `result === 'ok'`, re-open the session (`openSession`/`finish` with the same user) so `sid` rotates, as every other sign-in does. Owner: Agent 1's area, via Agent 4 |
| FAIL-2 | Low (privacy) | S14: sign-up reveals whether an address is registered (new → code step, registered → "check your e-mail"). `main` with SMTP on did not. Limited by `RULES.signupIp` (8/h per address), documented in DEPLOY.md 7c | `packages/domain/src/signup.ts:106-108` | accept as documented, or answer a registered address the same way (`{redirect: VERIFY_PATH}` with a session that can never verify) if the owner wants no oracle |
| FAIL-3 | Low (docs) | M6: no manual rollback is written down for the three migrations | `docs/bugfix-2026-10-23/agent1-result.md`, `agent3-result.md`, `agent2-fixes-result.md` | add: `DROP TABLE "usage_ledger"; DROP TABLE "email_code"; DROP INDEX "user_googleSub_key"; ALTER TABLE "user" DROP COLUMN "googleSub"; ALTER TABLE "notification" DROP COLUMN "text";` plus deleting the three `_prisma_migrations` rows, and note that dropping `usage_ledger` brings back the delete-restores-quota bug |
| FAIL-4 | Trivial (docs) | DEPLOY.md's local Google redirect URI uses Agent 1's dev port | `DEPLOY.md:322` (`http://localhost:3011/...`) | use `http://localhost:3000/api/auth/google/callback` (the default web port) |
| FAIL-5 | Dev only | `refresh` "router.refresh() commits" can miss the 2 s window on `next dev` (dashboard and, this run, client page round 3). Passes on the production build, which is how the suite is meant to run | `apps/web/e2e/refresh.e2e.ts:44` | none needed for release; optionally skip on `isDevServer` like test 4, or raise `SETTLE_MS` in dev |

Also noticed, pre-existing and not counted: a Telegram payload with a bad signature is reported
as `telegram_expired` rather than "invalid" (`packages/domain/src/telegram/login-callbacks.ts:46`);
Agent 4's deferred item stands (a browser-side call that gets 403 `unverified` shows an error
instead of moving to the code step, unreachable today).

## Left behind on the shared environment

- Test accounts in the dev DB: `qa-a1-1792751752@example.test` (verified, 2 extra clients, one
  deleted catalogue's ledger entry) and `qa-a1b-1792751752@example.test` (unverified), each with
  its own trial org. Throwaway; delete the two orgs if wanted.
- Docker images `mxik-audit-{api,worker,web}:qa-baseline` and `:qa-integration` (shared layers).
- Scratch databases `mxik_qa_empty` and `mxik_qa_empty2` were dropped.
- API 4015 and the production web server on 3015 are still running.
