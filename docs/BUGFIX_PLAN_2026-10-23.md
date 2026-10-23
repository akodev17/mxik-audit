# Bug-fix programme, 23 Oct 2026: plan and coordination

Five Claude Opus sessions, each on its own branch and worktree, coordinated from one Fable session.
Nothing reaches `main` until every workstream is merged on the integration branch, the full check
set is green there, and the QA session has signed it off. This file is the contract every session
works to; the owner's request is reproduced in §1 and the per-agent briefs in §4.

## 1. What the owner asked for

1. Registration must require e-mail verification before protected features are usable; add Google
   and Telegram sign-in; send a verification code by SMTP when a user registers with a Gmail or
   other supported address; make sure the 14-day trial works with the new flow.
2. Hunt bugs across the whole site, reproduce them, write a prioritised list (description,
   severity, steps, proposed fix), then open a second session that fixes them with tests.
3. Fix the trial-quota rollback: deleting an uploaded file restores the consumed trial allowance,
   so upload-delete-upload gives unlimited processing. Enforce on the backend; add regression tests.
4. Two more sessions: architecture review + integration (no duplicated work, conflicts resolved),
   and QA (regression, security review, migrations, builds, everything works together).
5. Push to `main` only when complete, tested and verified.

## 2. Confirmed root causes (read before touching the code)

**Verification is optional today.** `packages/domain/src/signup.ts` sets
`needsVerification = mailEnabled() && !input.verified`, and `signInForm` in
`packages/domain/src/security/auth-forms.ts` only refuses unverified users when `mailEnabled()`
is true. `mailEnabled()` (`packages/domain/src/mailer.ts`) is true only when `SMTP_URL` and
`MAIL_FROM` are both set. The local `.env` sets neither, so every sign-up is signed in at once with
`emailVerifiedAt` set. Verification today is a 48-hour link (`/api/auth/verify/{token}`,
`packages/domain/src/security/verification.ts`, tokens in `email-token.ts`), not a code.

**Telegram sign-in exists** (`packages/domain/src/telegram/login*.ts`, `identity.ts`,
`apps/web/src/ui/telegram-login.tsx`, endpoints `auth.telegramLogin/Bind*` in
`packages/contracts/src/modules/auth.ts`) but is only shown when `TELEGRAM_BOT_TOKEN` and the bot
username are configured. **Google sign-in does not exist** anywhere.

**Trial quota is a live sum, not a ledger.** `usageOf` in `packages/domain/src/plan.ts` computes
`rowsPerMonth` as `SUM(catalog.rowCount)` over catalogues created this month whose status is not
`uploaded`. `deleteCatalog` in `packages/domain/src/catalogs.ts` hard-deletes the `catalog` row
(`tx.catalog.delete`), so the rows vanish from the sum. The same sum feeds `allows()` /
`planGates().gate('rowsPerMonth')`, used by `catalog-upload.ts` (lines ~91 and ~179),
`api/handlers.ts` (public API) and `telegram/bot.ts`. The `clients` limit has the same shape
(`db.client.count`) and is worth checking for the same bypass via client delete/restore.

## 3. Ground rules for every session

- **Branches.** One branch per session, cut from `main` at `7f1f450`+plan commit, in its own
  worktree under `.claude/worktrees/`. Commit early and often with descriptive messages. Never
  push. Never touch `main`. Never rebase a branch another session may have merged.
- **Worktree setup** (Windows; `@tasnivo/*` packages resolve through `node_modules`):
  `cp ../../../.env .env` then `npm ci` in the worktree, then `npx prisma generate`. Do not
  symlink or junction `node_modules` (see `docs/HANDOFF_2026-10-23.md` §3 gotchas).
- **Database.** All five sessions share the dev Postgres on `127.0.0.1:54329` (`docker compose up -d`
  from the main checkout starts db + redis). Append `&connection_limit=4` to `DATABASE_URL` for
  every process. Because the database is shared, **migrations must be additive only** (new tables,
  new nullable columns, new indexes, backfills in the migration SQL). No drops, renames or NOT NULL
  without defaults until integration. Run `npx prisma migrate deploy` from your worktree after
  adding one; never `migrate dev` or `migrate reset`.
- **Ports.** Each session runs its own API and web dev servers so they never collide:

  | Session | API port (`API_PORT`) | Web port (`next dev -p`, `API_INTERNAL_URL=http://localhost:<api>`) |
  |---|---|---|
  | Agent 1 auth | 4011 | 3011 |
  | Agent 2 discovery (and its fix session) | 4012 (fix: 4016) | 3012 (fix: 3016) |
  | Agent 3 trial quota | 4013 | 3013 |
  | Agent 4 integration | 4014 | 3014 |
  | Agent 5 QA | 4015 | 3015 |

  Add your pair to `.claude/launch.json` in your worktree (same shape as `tasnivo-api-4010` /
  `tasnivo-web-3002`) and start them with the app's preview tool, not from a shell.
- **Checks before you report done.** From the worktree root: `npm run typecheck`, `npm run lint`,
  `npm test` (needs the DB), and for anything the browser can show, drive it in the in-app browser
  against your own ports. e2e: `E2E_BASE_URL=http://localhost:<web> E2E_CHANNEL=msedge npm run test:e2e`
  (the sign-in rate limit trips if two full runs are back to back; clear `auth_attempt` rows).
- **Ownership (do not duplicate).** Auth, sign-up, verification, OAuth, SMTP delivery, trial
  creation: Agent 1. Plan limits, `usageOf`, quota ledger, catalogue delete/restore accounting:
  Agent 3. Everything else that is a bug: Agent 2's fix session. Cross-cutting refactors, conflict
  resolution, shared primitives: Agent 4. Agent 5 fixes only what blocks its verification and
  reports the rest to Agent 4. If you find a bug in another session's area, write it into
  `docs/bugfix-2026-10-23/handoff-<your-agent>.md` on your branch instead of fixing it.
- **Secrets the owner must supply** (document the variable, ship a safe default, never invent
  credentials): `SMTP_URL` + `MAIL_FROM` (real delivery), `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`,
  `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME`. Without SMTP the verification code must still be
  required: in development the code is written to the API log and to `tmp/outbox/` so tests and
  the owner can read it; in production (`NODE_ENV=production`) a missing SMTP config is a startup
  error for sign-up, not a bypass.
- **Report format.** Finish your turn with: branch name, commits, what was verified and how (test
  names, screenshots under `docs/bugfix-2026-10-23/<agent>/`), what is not done, and anything the
  owner must provide. Write the same into `docs/bugfix-2026-10-23/<agent>-result.md` on your branch.

## 4. Workstreams

### Agent 1: authentication, verification code, Google, Telegram, trial (branch `agent1-auth`)

Scope and acceptance:
1. **Verification is mandatory.** A new password sign-up creates the org (trial) and user with
   `emailVerifiedAt = null`, sends a 6-digit code (replace or complement the 48-hour link;
   store a hash with expiry and attempt counter in `EmailToken` or a new additive table), and
   shows a "enter the code" step at `/sign-up/verify`. Sign-in for an unverified user leads to the
   same step instead of the dashboard. Every `auth: 'session'` endpoint refuses an unverified user
   (`SessionGuard` / `AccessGuard` in `apps/api/src/auth-core/`) except the verification, resend,
   sign-out and `me` endpoints. Rate-limit code attempts and resends with the existing `RULES`.
2. **SMTP delivery.** Keep `nodemailer` and `deliverMail`; add the dev fallback above; add a
   one-shot `npm run mail:test -- <address>` script that sends a test message so the owner can
   confirm Gmail delivery once `SMTP_URL` is set. Document Gmail app-password setup in `DEPLOY.md`.
3. **Google sign-in.** OAuth 2.0 authorization-code flow with PKCE and `state`, endpoints
   `GET /api/auth/google` and `GET /api/auth/google/callback` declared in
   `packages/contracts/src/modules/auth.ts`, implemented in `apps/api/src/auth/`, domain logic in
   `packages/domain/src/security/google.ts`. Verify the ID token (issuer, audience, expiry,
   signature via Google JWKS) with no new heavy dependency if `jose` is not already present
   (check `package-lock.json`; `jose` is acceptable). A Google account with a verified e-mail
   counts as verified; link to an existing user by e-mail only when that user is verified,
   otherwise refuse. New users get a trial org like password sign-ups. Buttons on `/sign-in` and
   `/sign-up`, hidden when `GOOGLE_CLIENT_ID` is unset, like the Telegram button today.
4. **Telegram sign-in.** Audit the existing flow end to end (widget, hash check in
   `telegram/login.ts`, `telegramSignIn`, bind/unbind in Settings), fix what is broken, make sure
   it creates a trial org for a new user and that an account opened through Telegram is treated as
   verified. Test with the domain tests; the widget itself needs a real bot, so document the manual
   check.
5. **Trial.** Confirm `trialEndsAt` is set at creation for all three paths, that the 14 days show
   on the dashboard/plan banner, and that `planStatus` reports `trial`. Do not change quota maths
   (Agent 3 owns `plan.ts`).
6. Tests: domain tests for the code flow (issue, verify, expiry, wrong code lockout, resend
   limit), guard tests in `apps/api/test/unit/guards.test.ts`, Google token verification with a
   fixture JWKS, and one e2e in `apps/web/e2e/account-flows.e2e.ts` for sign-up → code → dashboard.
   i18n: every new string in both `uz` and `ru` in `packages/i18n`.

### Agent 2: bug discovery, then a dedicated fix session (branch `agent2-bug-discovery`)

Phase A, discovery (this session): run the API and web on your ports, sign in as the seed user
(`buxgalter@demo.uz` / `demo12345`), and walk every page and flow: landing, pricing, demo
(`/demo`), sign-up/sign-in, dashboard, upload wizard (use the files in `tmp/found-catalogs/` and
`apps/web/e2e` fixtures), catalogue workspace (grid, drawer, bulk, filters, exports), catalogues
list, clients and client pages, imports, purchases, queue, activity, notifications, dictionary,
team/invites, settings (every tab), share links, public API (`/api/docs`), 404/error pages, both
locales, mobile width, dark mode. Also read `docs/HANDOFF_2026-10-23.md` §4 item 2 (the UI refresh
was never e2e-verified) and run `npm run test:e2e` once to harvest failures. For each bug record:
id, title, severity (S1 crash/data loss, S2 wrong behaviour, S3 cosmetic), exact reproduction
steps, expected vs actual, file(s) involved, proposed fix. Write them to
`docs/bugfix-2026-10-23/bugs.md`, sorted by severity, and commit. Exclude the three areas owned by
Agents 1 and 3 (list them in a separate "handed to other agents" section instead).

Phase B, fixing: start a new session yourself with `start_session` (`initiation: "user_asked"`,
`model: opus`, `use_worktree: true`, `source_branch` = your branch so `bugs.md` is present,
`branch_name: agent2-bug-fixes`, ports 4016/3016) whose brief is the full bug list plus the ground
rules of §3. That session fixes every S1 and S2 and as many S3 as time allows, adds a regression
test per fix (unit, API or e2e), re-runs the reproduction in the browser, and writes
`docs/bugfix-2026-10-23/agent2-fixes-result.md`. If `start_session` is refused, report the bug list
to the coordinator instead, who will start the fix session.

### Agent 3: trial quota rollback (branch `agent3-trial-quota`)

1. Reproduce with a domain test first: trial org, commit a catalogue of N rows, `usageOf` shows N,
   `deleteCatalog`, `usageOf` shows 0. That test becomes the regression test (inverted).
2. Fix by making consumption durable: an additive `usage_ledger` table (orgId, key
   `rowsPerMonth`, amount, period month, catalogId nullable, reason, createdAt) written inside the
   same transaction that commits a catalogue (the places that call `gate(.., 'rowsPerMonth', ..)`:
   `catalog-upload.ts` commit, `api/handlers.ts`, `telegram/bot.ts`), and `usageOf` reading the
   ledger's monthly sum instead of `SUM(rowCount)`. Backfill the ledger in the migration from
   existing non-`uploaded` catalogues of the current month so nobody's usage drops at deploy. A
   deleted catalogue leaves its ledger rows in place (nullable `catalogId`, no cascade). Decide and
   document whether a re-audit of the same catalogue consumes again (it should not: same catalogId).
3. Check the other limits for the same bypass: `clients` (client delete / restore in
   `client-lifecycle.ts`) and `seats` (invites). Fix if bypassable, with tests.
4. Make sure the gate is enforced server-side on every entry point (web upload, public API,
   Telegram bot) and that the web usage meters (`apps/web/src/app/(app)/settings/plan-usage.tsx`,
   `dashboard/usage-panel.tsx`, `ui/shell/plan-banner.tsx`) read the same numbers from the API.
5. Tests: domain tests for ledger, gates and backfill; an API test that upload → delete → upload past
   the cap is refused; keep `tests/pricing-parity.test.ts` green. Do not change `plans.ts` numbers.

### Agent 4: architecture review and integration (branch `agent4-integration`)

Phase A (now): read `docs/HANDOFF_2026-10-23.md`, `docs/BACKEND_SPLIT_PLAN.md`, `apps/api/README.md`,
the guards in `apps/api/src/auth-core/`, the contracts registry and the web `api-client` usage.
Produce `docs/bugfix-2026-10-23/architecture-review.md`: cross-cutting defects (auth/authz gaps,
error handling, CSRF, rate limiting, job dispatch, i18n gaps, dead code from the split), risks for
the other four workstreams (e.g. where Agent 1's guard change and Agent 3's gate change touch the
same files), and a conflict map by file. Fix only cross-cutting issues nobody else owns (list them
in the review first). Keep this phase to the review plus small, well-tested fixes.

Phase B (when the coordinator messages you that branches are ready): merge, in this order,
`agent3-trial-quota`, `agent1-auth`, `agent2-bug-fixes` (and `agent2-bug-discovery` for the docs)
into your branch. Resolve conflicts by hand (expect `apps/api/src/app.module.ts`, `package.json` +
lockfile, `packages/i18n/src/i18n-parts/index.ts`, `schema.prisma`, migrations ordering:
rename migration folders so timestamps stay increasing and `migrate deploy` applies cleanly on a
copy of the database). Remove duplicated helpers the sessions created in parallel. Run typecheck,
lint, unit tests, both builds (`npm run build`, `npm run build:api`, `npm run build:worker`) and the
e2e suite on your ports. Then tell the coordinator the branch is ready for QA.

### Agent 5: quality assurance (branch `agent5-qa`)

Phase A (now): establish the baseline on `main` in your worktree: run typecheck, lint, unit tests,
e2e on your ports, both builds, `npx prisma migrate status`; record the result in
`docs/bugfix-2026-10-23/qa-baseline.md` (which tests fail today and why, so later failures can be
attributed). Prepare the QA checklist: security review items (session fixation after sign-in,
CSRF on the new OAuth callbacks, open-redirect in `next`, token hashing and timing-safe compares,
rate limits, secrets in logs), migration review items (additive, reversible, backfill correctness,
applies on an empty DB and on a copy of the dev DB), build items (web, api, worker, Docker images if
Docker is up), and the owner's three acceptance scenarios (unverified user blocked; Google/Telegram
sign-in; upload-delete-upload refused past the cap).

Phase B (when the coordinator says the integration branch is ready): merge `agent4-integration`
into your branch, run the whole checklist, drive the acceptance scenarios in the in-app browser
with screenshots, review the diff `main..agent4-integration` for security and for leftovers
(debug code, TODOs, console output, skipped tests). Fix only what blocks a check; report everything
else to Agent 4 through the coordinator. Deliver `docs/bugfix-2026-10-23/qa-report.md` with a
clear PASS / FAIL per item.

## 5. Sequence and dependencies

```
now ──► A1 auth ─────────────┐
   ──► A2 discovery ─► A2 fixes ─┤
   ──► A3 quota ──────────────┼─► A4 phase B (merge, resolve, full checks) ─► A5 phase B (QA) ─► coordinator: merge to main, final checks, push
   ──► A4 phase A (review) ───┘
   ──► A5 phase A (baseline)
```

- A1 and A3 both touch sign-up/trial creation only at the boundary: A1 owns `signup.ts`, A3 owns
  `plan.ts`; neither edits the other's file. A3's ledger write in `catalog-upload.ts` and A1's guard
  change in `auth-core/` do not overlap.
- A2's fix session must skip anything in A1's and A3's areas, and must not refactor shared
  primitives (A4's job).
- A4 merges in the order A3, A1, A2 because A3 is the smallest and most self-contained diff.
- Final merge to `main`: fast-forward or merge commit from `agent4-integration` after A5 PASS, then
  the coordinator re-runs typecheck + lint + unit tests on `main` and pushes. No push if any check
  fails or any S1/S2 bug remains open.

## 6. Definition of done

- Every `auth: 'session'` endpoint refuses an unverified user; sign-up requires the e-mailed code;
  Google and Telegram sign-in work (Telegram and Google verified locally with the owner's
  credentials or, failing that, with the documented manual steps and automated tests of the
  verification logic).
- Upload → delete → upload past the trial cap is refused by the API, with a regression test.
- Every S1 and S2 from `bugs.md` fixed with a test; S3 either fixed or listed as deferred.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`,
  `npm run build:api`, `npm run build:worker` green on `agent4-integration` and again on `main`.
- QA report PASS; `main` pushed; this file updated with the outcome and the branch map.
