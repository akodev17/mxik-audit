# Platform bug list, Phase A (Agent 5), 23 Oct 2026

Branch `fix/platform-quality`, cut from the base commit `36ef476` of `integration/tasnivo-2026-10`.
Scope: everything that is a platform bug outside the four new modules (auth, sessions, verification,
trial and quota, upload wizard, workspace, catalogues, clients, team, settings, billing,
notifications, i18n, e2e). The module folders `onec`, `bank`, `didox`, `products` are placeholders on
this base (no endpoints, "Bu boʻlim tayyorlanmoqda" pages), so nothing there was tested.

Severity: **S1** crash, data loss or security hole that needs no special access; **S2** wrong
behaviour, or a security weakness with limited reach; **S3** minor, cosmetic, documentation, test
robustness. Verdict per item: **fix now** (Phase B) or **defer** (with the reason).

## How it was tested

- API `tasnivo-api-4025` (`tsx watch`), web `tasnivo-web-3025-prod` (`next build` with
  `API_INTERNAL_URL=http://localhost:4025`, then `next start -p 3025`), browsed at
  `http://a5q.localhost:3025`; shared dev Postgres with `connection_limit=4`.
- Direct API probes (Node scripts kept out of the repo, under `tmp/agent5/`): one per check below, each with
  fresh `@example.test` accounts confirmed through the dev outbox `tmp/outbox/`.
- A scripted walk of 44 routes as the seed user (`buxgalter@demo.uz`) in installed Edge: uz and ru,
  1280 px light and 375 px dark: HTTP status, console errors, failed API calls, horizontal overflow,
  `undefined`/`NaN`/raw i18n keys, Uzbek text left in Russian pages; one screenshot per page.
- In-app browser: sign-up → code step → dashboard → upload page for a brand-new account.
- `npm run test:e2e` on the production build (results and attribution in the last section).

## Summary

| Area | Result |
|---|---|
| Unverified user: 129 `auth: 'session'` endpoints (all except `me`, `verify-code`, `verify-code/resend`) | **122 → 403 `unverified`**; the 4 platform-admin routes → 404 (hidden from non-admins before the verified check); the 3 manual routes below |
| The 3 manual-session routes | `telegramBind` → `/sign-in`; `closedStatus` / `reopen` answer for an open org only (`{canReopen:true}`, `/account-deleted`), no data and no state change: **OK** |
| Tenant isolation (user B against org A's catalogue, finding, client, decision event, view, invite, member, session, API key, notification; the seed org's share link and purchase list; ids in query and body; public API with B's key) | **no leak, no change**: every read is 404 or an empty result, every write `ok:false`, org A's snapshot identical before and after. See Q12 for the inconsistent shapes. `/api/onec/...` does not exist yet: re-run in Phase C |
| Trial quota: upload 3 000 → delete → upload 3 000 | **refused** (ledger keeps 3 000 after delete, preview says "limit reached") |
| Trial quota: public API past the cap | **402 `plan_limit`**; 10 rows that fit pass |
| Trial quota: two members commit 2 × 2 400 rows at once with 1 000 used (cap 5 000) | **exactly one passes**; usage 3 400 |
| Same preview committed three times at once | one commit, counted once (100) |
| File deletion frees storage, not the ledger | catalogue gone (`GET` 404), plan usage still 3 000 |
| CSRF: 87 mutating session/public routes without `X-Requested-With` | all **403 `csrf`**, incl. a form post from a foreign origin and sign-out |
| Rate limits | per address: locked after 5 wrong passwords even with a new IP each time; per IP: locked after 30, but see Q5 |
| Secrets in the API log | reset/invite/share tokens logged as `{token}`, no API key, password or cookie in the log; codes appear only in the dev outbox lines (by design) |
| Password reset / change / 2FA / sessions | all correct (other sessions end on change and reset; reset link single-use; 2FA sign-in needs the second factor; a recovery code works once; a TOTP code cannot be replayed in its window; end-others works) |
| Walk, uz, 1280 + 375 dark (88 page views) | no console error, no failed API call, no overflow at 375 px; findings Q7, Q9 |
| Walk, ru (88 page views) | translated except the known B15 pages (Q10) and stored data (product names) |

## Re-verification of the three known bugs (owner's brief)

The brief does not restate them; they are taken to be the three defects the 23 Oct morning programme
was asked to fix (`docs/BUGFIX_PLAN_2026-10-23.md` §1–2).

| # | Bug | Verdict on this base | Evidence |
|---|---|---|---|
| K1 | Registration without e-mail verification gives full access | **Fixed** | In-app browser: sign-up lands on `/sign-up/verify`, the code from `tmp/outbox/` leads to `/dashboard`. API: of the 129 session endpoints that do not allow it, 122 answer 403 `unverified` before the code, the 4 platform-admin routes 404, and the 3 manual routes leak nothing. A link-invite joiner is also unconfirmed until the code (`p8`). Residual weakness: Q2 |
| K2 | Deleting an uploaded file restores the trial allowance (upload → delete → upload) | **Fixed** | 3 000 rows committed and audited, catalogue deleted (`{"ok":true,"rows":3000}`), plan still `rowsPerMonth: 3000`, a second 3 000-row upload refused by the preview ("Bu oy uchun qatorlar chegarasi tugadi") and the public API (402); parallel commits and repeated commits counted once |
| K3 | The 14-day trial with the new sign-up flow | **Fixed** for password sign-up and link invites | `GET /api/billing/plan` of a new account: `state: trial`, `daysLeft: 14`, limits 3 / 5 000 / 2; client cap 3 holds (4th refused). Google and Telegram paths are covered only by unit tests (no credentials on this machine) |

## Bugs

### Q1. S1. One API key can crash the API process: every check loads a fresh embedding model (heap out of memory)

- **Module:** public API v1 `check`, matching setup in the API process (`packages/domain/src/audit-runner.ts`, `apps/api` bootstrap).
- **Steps:** new trial account → create an API key → send 40 `POST /api/v1/check` requests of 20 items at once (well inside the 60/min per-key limit).
- **Expected:** answers or 429s; memory bounded. **Actual:** the API process dies with
  `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory` (4 GB); every
  user of that API instance gets 500s ("Ilovada xatolik yuz berdi") until it is restarted (`tsx
  watch` does not restart it; in Docker the container restarts and loses inline work).
  Measured on the restarted API: idle 153 MB → **1 419 MB and 9.1 s for one check** of one item;
  second check 2.8 s; **5 parallel checks → 1 718 MB**.
- **Root cause:** `auditContext()` → `vectorReadiness()` takes its embedder from `embedders`, which
  defaults to `freshEmbedders` (`audit-runner.ts:141`: "a fresh provider per call"). The dev DB's
  vectors were made by the local model, so readiness rebuilds a `LocalEmbeddingProvider` (~470 MB of
  weights) per call. Only the worker installs a shared source (`apps/worker/src/services/audit-context.service.ts:17`);
  the API never does, and `/api/v1/check` (plus inline audits and doc checks when `JOBS_MODE` is
  not `bullmq`) runs in the API process. Production uses `EMBEDDING_PROVIDER=local` (`.env.example:198`).
- **Proposed fix:** register the worker's `AuditContextService` (or a shared copy of it) in the API
  module so `useEmbedderSource` keeps one provider per name for the process; add a small per-process
  concurrency cap for `/api/v1/check` (e.g. 4 in flight, 429 `busy` beyond) so a burst queues
  instead of multiplying model work.
- **Regression test:** API test that boots the app module and asserts `auditContext()` twice returns
  the same embedder instance; API e2e firing 20 parallel checks with a fake provider that counts
  constructions (must be 1). Re-run the 40-parallel probe and record memory.
- **Verdict:** fix now.

### Q2. S2. Confirming the e-mail code keeps the same session id (QA FAIL-1)

- **Module:** auth, verification. **Steps:** sign up (cookie C1), copy C1, enter the code.
- **Expected:** a new `sid`; the cookie from before the code is worthless. **Actual:** `/api/auth/sessions`
  lists one session created at sign-up; the response sets no new cookie; the copied pre-code cookie
  now gets 200 on `/api/dashboard`.
- **Root cause:** `verifyCodeForm` (`packages/domain/src/security/auth-forms.ts:138`) → `confirmCode`
  (`verification.ts:22`) marks the user verified and leaves the session as it is.
- **Proposed fix:** after `result === 'ok'`, re-open the session through `openSession`/`finish`
  (same user, landing `/dashboard`), which ends the old `sid` and issues a new one. The controller
  must pass the session to the form.
- **Regression test:** domain/API test: sign up, keep the cookie, confirm, assert the old cookie gets
  401 and the new one 200, and that `user_session` has the old row revoked.
- **Verdict:** fix now.

### Q3. S3. Sign-up tells registered addresses apart (QA FAIL-2)

- **Steps:** `POST /api/auth/sign-up` with a new address → `{"redirect":"/sign-up/verify"}` and a
  session cookie; with a registered one → `{"checkEmail":true}`, no cookie.
- **Root cause:** `signup.ts:106`. Limited by `RULES.signupIp` (8/h per address), documented in DEPLOY.md 7c.
- **Proposed fix (brief asks for it):** answer a registered address exactly like a new one: the
  same redirect to the code step with a session that can never verify (bound to no user, or to a
  marker that `verify-code` always answers "wrong code"), keep mailing the owner the "someone tried
  to sign up" note; document the behaviour in DEPLOY.md 7c.
- **Regression test:** API test: both answers have the same shape, status and `Set-Cookie`; the
  registered address's owner gets the note in the outbox; the decoy session cannot reach any session endpoint.
- **Verdict:** fix now.

### Q4. S2. A new org that has not opened the web app cannot upload through the wizard API, and the refusal names the wrong reason

- **Module:** upload wizard, clients. **Steps:** sign up and confirm through the API only, then
  `POST /api/catalogs/preview` with a CSV.
- **Actual:** `{"ok":false,"error":"Bu mijozga yuklash huquqingiz yoʻq."}` ("you may not upload to
  this client"), though the user is the org's admin. After any `GET /api/shell` the same request
  works, because `shell-frame.ts:30` creates the default client on that GET. The public API creates
  it itself (`resolveClient`), so `POST /api/v1/catalogs` works for the same org.
- **Root cause:** `uploadTarget` (`catalog-upload.ts:44-47`) uses `resolveVisibleClient`, which never
  creates the default client; the default client is created as a side effect of a GET.
- **Proposed fix:** create the default client when the org is created (sign-up, Google, Telegram,
  demo), keep `defaultClient()` as a lazy fallback in `uploadTarget` for old orgs; leave
  `shell-frame` read-only. A missing client for an admin should never answer "no right".
- **Regression test:** domain test: a fresh org's admin previews without any GET first; API e2e for
  the same; a test that `GET /api/shell` does not write.
- **Verdict:** fix now (the web user never sees it because the shell loads first, so S2 only for
  API-driven clients such as the coming 1C/Didox automation).

### Q5. S2. Per-IP rate limits trust a client-sent `X-Real-IP` when the API is reached without Caddy (architecture review §1)

- **Steps:** 30 wrong sign-ins from one client with `X-Real-IP: 10.77.1.1` → the 31st says "Juda koʻp
  urinish"; the same client with `X-Real-IP: 10.77.1.2` signs in again at once.
- **Reach:** the documented production route is safe (Caddy sets `X-Real-IP {client_ip}`,
  `infra/routes.caddy:41,54,65`). Any other deployment (API port exposed, `NEXT_PUBLIC_API_URL`
  on another origin, the web's `/api` rewrite without Caddy) lets a client pick its own address and
  bypass `signInIp`, `signupIp`, `resendIp`, `resetIp`, `demo*`, `leadIp`. Reproduced through the
  web's `/api` proxy too (`next start` on 3025: 32 sign-ins with `X-Real-IP: 10.88.1.1` → limited; the next
  one with `10.88.1.2` → accepted), so a web-only deployment without Caddy is exposed. Per-address limits still hold.
- **Root cause:** `packages/domain/src/security/client-ip.ts` and `apps/api/src/http/request.ts:43`
  always believe the headers.
- **Proposed fix:** `TRUST_PROXY` setting (unset = ignore `X-Real-IP`/`X-Forwarded-For` and use the
  socket address; `caddy`/`1` = current behaviour), set in `docker-compose.yml` and DEPLOY.md.
- **Regression test:** unit tests for `clientIp` with and without `TRUST_PROXY`; API test that a
  spoofed header does not reset the IP bucket when it is off.
- **Verdict:** fix now.

### Q6. S3. The public API's monthly check allowance can be overshot by parallel calls

- **Module:** public API v1 (`packages/domain/src/api/handlers.ts:52-61`, `limits.ts:63`).
- **Root cause:** `checkAllowance` reads the month's sum, the matching runs (seconds, Q1), then
  `recordUsage` adds the items. Parallel requests all pass the same check. Bound: in-flight requests ×
  20 items, times the number of keys (each key has its own 60/min window, in memory per process).
- **Reproduced:** trial org (500 checks a month), 24 sequential requests of 20 items (480 used), then
  5 parallel requests of 20: all five answered 200 and the key shows `checksThisMonth: 580` (cap 500).
  The first attempt with 40 parallel requests crashed the API instead (Q1).
- **Proposed fix:** reserve before running: one `UPDATE … SET checks = checks + n … RETURNING` under
  the org's advisory lock (the ledger's `lockOrgUsage`) and refund on failure.
- **Regression test:** API test with N parallel checks at cap − 1 item: total recorded ≤ cap.
- **Verdict:** fix now (same area as Q1).

### Q7. S2. The privacy policy and the offer are published with `[TODO: …]` placeholders

- **Steps:** open `/maxfiylik` or `/oferta` (both locales).
- **Actual:** "Oxirgi tahrir: 19.10.2026 — [TODO: yurist koʻrib chiqqan sana]", "Maʼlumotlarni qayta
  ishlovchi: [TODO: kompaniya nomi], STIR [TODO: STIR], manzil: [TODO: yuridik manzil]", and in the
  offer "[TODO: Ushbu hujjat yurist tomonidan yozilishi yoki tekshirilishi kerak…]".
- **Proposed fix:** owner content (legal entity name, STIR, address, lawyer review). Code side: a
  build-time check that fails `next build` in production when a public page contains `[TODO`.
- **Regression test:** unit test over the legal page sources: no `[TODO` when `NODE_ENV=production`.
- **Verdict:** defer the text (owner must provide it; listed for the final report); the build check can go in now.

### Q8. S3. Record-level "not found" pages answer HTTP 200 (B14, still open)

- `/catalogs/doesnotexist` and `/admin` for a non-admin show "Sahifa topilmadi" with status 200
  (the `/admin` title is now right). **Verdict:** defer, as in B14 (pages are not indexed; the fix
  needs `notFound()` before the `(app)` loading boundary).

### Q9. S3. `/api/docs` publishes the full internal API in production

- Swagger UI and `/api/docs-json` list all 170 first-party operations, including admin and cron
  routes, with no auth, in every environment (`apps/api/src/app.ts:36-43`). No secret leaks, but it
  is a map of the attack surface; external developers already have `/api/v1/openapi.json` and `/api-docs`.
- **Proposed fix:** serve `/api/docs` only when `NODE_ENV !== 'production'` or `API_DOCS_PUBLIC=1`.
- **Regression test:** API test: production config → 404.
- **Verdict:** fix now.

### Q10. S3. Landing, `/maxfiylik`, `/oferta` are Uzbek only in Russian (B15)

- Re-checked with `mxik_locale=ru`: every app page, auth page, `/demo`, `/yordam/ru`, `/api-docs`
  and the error pages are Russian; these three are not. **Verdict:** defer (product decision, B15).

### Q11. S3. QA FAIL-3: no rollback is documented for any migration since `20261027100000`

- Applies to `20261027100000_email_code_google`, `20261027100000_usage_ledger`,
  `20261027130000_notification_text`, `20261101000000_accounting_shared`, and every new workstream
  migration. **Fix:** `docs/accounting-2026-10-23/migrations.md` with the SQL per migration, the
  `_prisma_migrations` row to delete, and what breaks when it is rolled back (dropping
  `usage_ledger` brings K2 back). **Verdict:** fix now (Phase B), extended in Phase C.

### Q12. S3. Foreign or unknown ids get three different answers

- `GET /api/catalogs/{id}`, `/summary`, `/report`, `/progress`, `/clients/{id}` → 404; but
  `GET /api/catalogs/{id}/preview`, `/rows`, `/findings/{id}`, `/findings/{id}/code-request` → **200 `null`**,
  `/comments` and `/share-links` → 200 `[]`, and mutations → 200 `{ok:false, error: …}` with varied
  texts ("Xatolik yuz berdi", "Katalog topilmadi", and for `POST …/review/done` with an empty body
  "Izoh juda uzun", which is the wrong message). No data leaks (checked with org A's ids), but the
  web cannot tell "gone" from "empty", and the contract says 404 uses the error envelope.
- **Proposed fix:** wrap the GETs that return `null` in the controllers' `found()` (404), and fix the
  `bad note` message to "invalid request". **Regression test:** extend `apps/api/test/e2e` isolation
  tests with these four routes. **Verdict:** fix now (small), else defer.

### Q13. S3. QA FAIL-4: DEPLOY.md's local Google redirect URI uses Agent 1's dev port

- `DEPLOY.md:322` `http://localhost:3011/api/auth/google/callback` → `http://localhost:3000/…`. **Verdict:** fix now.

### Q14. S3. A Telegram payload with a bad signature is reported as "expired"

- `packages/domain/src/telegram/login-callbacks.ts:46` returns `telegram_expired` for a failed hash,
  so the sign-in page tells a forged or broken login that it timed out. **Fix:** `telegram_invalid`
  with its own uz/ru text; test in `login-callbacks.test.ts`. **Verdict:** fix now.

### Q15. S3. GET requests with side effects (architecture review §1)

- `GET /api/catalogs/{id}` and `/progress` resume stalled audits (`catalog-pages.ts:81,104`);
  `GET /api/shell` creates the default client (Q4); `GET /api/share/{token}` counts a view.
- **Verdict:** fix the shell write with Q4; defer the audit resume (moving it to the worker's
  scheduler changes audit dispatch, low risk with `SameSite=Lax`); the share view count is a product decision.

### Q16. S3. `AuthCoreModule` provides an unused in-memory `RATE_LIMIT_STORE` and `ApiKeyGuard` (architecture review §1)

- Still in `apps/api/src/auth-core/auth-core.module.ts:20-21`. A second module that uses
  `ApiKeyGuard` without `PublicApiModule`'s Redis provider silently gets a per-process window.
- **Fix:** export `rateLimitStoreProvider` from one place and remove the default. **Test:** the
  existing `http-wiring.test.ts` plus an assertion that the guard's store is the Redis one when
  `REDIS_URL` is set. **Verdict:** fix now (small).

### Q17. S3. Dead code from the split (architecture review §1)

- `formFile` (`catalog-upload.ts:30`) has only its own test; comments in `plan.ts:3,54`,
  `security/sign-in.ts:6`, `health.controller.ts:10` name deleted files; 33 domain files say "server action".
- **Verdict:** delete `formFile` and fix the three wrong file names now; the "server action"
  wording is cosmetic across many files: defer to after the integration merge (merge-conflict risk
  with the four workstreams).

### Q18. S3. Production web builds silently proxy to `localhost:4000` when `API_INTERNAL_URL` is set only at start

- `apps/web/next.config.ts:36-43` writes the rewrite destination at **build** time (the comment says
  so), but the `*-prod` entries in `.claude/launch.json` (e.g. `tasnivo-web-3015-prod`) set
  `API_INTERNAL_URL` only for `next start`. Observed in this audit: the first production build talked
  to the main checkout's API on :4000 (older code, no verification), and a "sign-up" there went
  straight to the dashboard. That is an environment trap, not a product bug, but it makes QA runs
  test the wrong API without any sign.
- **Proposed fix:** `next.config.ts` logs the baked destination at build; the web's `/api/health`
  proxy check (or a header the API sets, e.g. `X-Tasnivo-Api-Port`) shown in the dev footer; document
  in `apps/web/README` and the launch entries' names (`…-prod (build with API_INTERNAL_URL)`).
- **Verdict:** fix now (docs + build log line).

### Q19. S3. QA FAIL-5 / B9: e2e timing cases

- Not seen in this run (production build, see below). FAIL-5 concerns `next dev` only and B9 (demo
  idle flake) did not recur. **Verdict:** defer; optionally skip `refresh` "router.refresh() commits"
  on `isDevServer` like its test 4.

### Q20. S3. `npm test` is red on the base commit: the new module sections are not in robots.txt (fixed on this branch)

- **Steps:** `npm test` on `36ef476` → 1 729 tests, 1 fail: `apps/web/src/app/robots.test.ts` "B16: every
  section of the signed-in app is disallowed" → `/bank`. The base commit added the `(app)/bank`,
  `didox`, `products`, `onec` placeholder pages; `PRIVATE_PATHS` in `apps/web/src/app/robots.ts` did not list them,
  so search engines were told the four signed-in sections may be crawled.
- **Fix (commit on `fix/platform-quality`):** the four paths added to `PRIVATE_PATHS`; the existing test is
  the regression test (2/2 pass). Agents 1–4 will each see this failure on their branches; the
  coordinator should take this one-line change and drop any duplicate at merge.
- **Verdict:** fixed.

## e2e on the production build

`API_INTERNAL_URL=http://localhost:4025 npm run build`, `next start -p 3025`,
`E2E_BASE_URL=http://localhost:3025 E2E_CHANNEL=msedge npm run test:e2e`:
**60 tests, 60 pass, 0 fail, 0 skipped** (11 files, 5 min 05 s). Nothing to attribute. The QA
baseline on this machine was also 60/60; the four new module pages have no specs yet.

`npm run typecheck` exit 0; `npm run lint` 0 errors, 1 warning (`scripts/lib/xlsx.ts:131`, as in
the QA baseline). `npm test` on the base commit: 1 729 tests, 1 726 pass, **1 fail** (Q20), 2 skipped
(the weighted-search tests, as in the QA baseline).

## Not reproduced / not tested here

- Google and Telegram sign-in in a browser (no credentials); covered by unit tests only.
- SMTP delivery (dev outbox only), Click/Payme, BullMQ worker mode, Telegram bot uploads.
- The four new modules (empty on this base): Phase C.

## Environment notes (not bugs)

- An API from the main checkout runs on :4000 (`tsx watch apps/api/src/main.ts`, pid 23336 at
  the time) with pre-verification code against the shared DB. Accounts created through it
  (`a5-walk-1@example.test`) are verified without a code. Whoever owns it should stop it or update it.
- Test accounts left in the shared DB: `a5-*@example.test` (one trial org each).
