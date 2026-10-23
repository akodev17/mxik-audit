# Agent 4 integration result, round 1 (Agents 3 and 1), 23 Oct 2026

Branch `claude/agent4-integration-d41667`. Round 1 merges Agent 3, then Agent 1. Round 2 (Agent 2's
fix branch and its discovery docs) follows when the coordinator sends it and is appended here.
Phase A (the architecture review and fixes F1–F6) is in `architecture-review.md`.

## Merged

| Order | Branch | Tip | Merge commit |
|---|---|---|---|
| 1 | `claude/agent3-trial-quota-0abc5f` | `4b054e8` | `1bfeda3` |
| 2 | `claude/agent1-auth-e2dff1` | `760cb37` | `bab4827` |

### Conflicts and how each was resolved

| File | Merge | Resolution |
|---|---|---|
| `.claude/launch.json` | both | Each branch appended its port pair. Rebuilt as the union of the configurations by name (ours first), so every session's entries are kept: 4014/3014, 4013/3013, 4011/3011. |
| `packages/db/prisma/schema.prisma` | A1 | Merged cleanly. Agent 1 removed its whole-file `prisma format` realignment before the merge (`5544e28`), after the Phase A heads-up. `npx prisma validate` passes. |
| `apps/api/test/e2e/auth.test.ts` | A1 | Merged cleanly. F4's localized 401 message (`ta.httpX.unauthorized`) is kept. Agent 1 also replaced the fixed `nobody…@test.local` addresses with per-run ones, which fixes the shared-DB flake noted in the review. |
| `apps/api/src/http/*`, `auth-core/*` | A1 | Merged cleanly next to F1–F4. The `http-wiring` test still passes with Agent 1's 4 new auth endpoints (route count 57 in `routes.test.ts`). |
| `package.json`, lockfile | A1 | Merged cleanly: one new script, `mail:test`, and no dependency change, so the lockfile was not regenerated. |

### Migrations

- Two folders share the timestamp `20261027100000`: `_email_code_google` (Agent 1) and
  `_usage_ledger` (Agent 3). Both are already applied to the shared dev DB under these names, so the
  names are kept. Prisma orders folders by name, so `_email_code_google` applies before
  `_usage_ledger`. The two are independent: different tables, and only additive changes to `user`.
- **Empty database:** I created a scratch database `agent4_scratch` and ran
  `npx prisma migrate deploy` on it. All 46 migrations applied, in order, ending with
  `20261027100000_email_code_google` and then `20261027100000_usage_ledger`; `migrate status` says
  "Database schema is up to date!". `prisma migrate diff` from that database to `schema.prisma`
  shows only the drift known before this work (raw-SQL indexes on `mxik_code`/`catalog_item`,
  `catalog.clientId` nullability). Nothing in it involves `usage_ledger`, `email_code` or
  `user.googleSub`. The scratch database was dropped afterwards.
- **Shared dev DB:** `npx prisma migrate status` → "Database schema is up to date!" (46 migrations).
- `npx prisma generate` was run after the merges.

### Duplicated helpers

None found to remove. Agent 1's code flow reuses the existing primitives: `keyedHash` for the stored
code hash, `safeEqualText` for compares (code, Google state and nonce), `hit()`/`RULES` for limits, and
`deliverMail` for the dev outbox, so inline and worker mail behave the same. Agent 3 moved
`monthStart` into `usage-ledger.ts`, and `plan.ts` imports it; no second copy exists. The per-org
advisory lock is now one helper, `lockOrgUsage`, shared by the ledger, clients and seats (below).

## Fixed after the merge (one commit each, tested)

| Commit | What | Test |
|---|---|---|
| `ab3de5d` | **Bug in Agent 1's Google sign-in:** the regex in `requestOrigin` (`apps/api/src/http/facts.ts:21`) had lost its backslashes. `/^[w.-]+(:d+)?$/` rejected every real host, so without `APP_URL` the Google `redirect_uri` became the bare path `/api/auth/google/callback`, which Google refuses. Now `/^[\w.-]+(:\d+)?$/`. | `http.test.ts` "requestOrigin" |
| `0162816` | **Agent 3's hand-over item 1:** the clients and seats caps could be passed by parallel requests. `createClient` and `createInvite` now take the plan's cap and count again inside the writing transaction, after `pg_advisory_xact_lock` on the ledger's per-org key (`lockOrgUsage` in `usage-ledger.ts`, which `consumeRows` now uses too). The cap is an argument, so test fixtures and other callers are not limited, and no test org needed a subscription. Callers: `apps/api/src/clients/clients.service.ts`, and `team-forms.ts` (invite, and resend of an expired invite). | `packages/domain/src/plan-caps-race.test.ts`: 6 parallel clients against cap 3 leave 3; 8 parallel invites against 3 seats leave 2 open. Both fail with the lock turned off. Live: 6 parallel `POST /api/clients` on a new trial org → 2 created, 4 refused with the plan message, 3 clients in total. |
| `022057a` | **Agent 1's hand-over item 3:** `demo.test.ts` asserted the global `demo_visit` count grew by exactly 2, which races with the API's demo test and the other sessions. It now asserts at least 2. | itself, 4/4 |

## Checks (verbatim summaries)

Run from the worktree root on `022057a`; logs kept in the session scratchpad.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 (52 s) |
| `npm run lint` | exit 0 (58 s): `✖ 1 problem (0 errors, 1 warning)`, the known `scripts/lib/xlsx.ts:131:11` non-null assertion |
| `npm test` without `REDIS_URL` | exit 0: `# tests 1708 # suites 418 # pass 1706 # fail 0 # cancelled 0 # skipped 2` |
| `npm test` with `REDIS_URL=redis://127.0.0.1:63799` | exit 0: `# tests 1717 # suites 418 # pass 1715 # fail 0 # cancelled 0 # skipped 2` (the 9 Redis tests run) |
| `npm run build` | exit 0 (43 s) |
| `npm run build:api` | exit 0: `apps/api/dist/main.mjs` |
| `npm run build:worker` | exit 0: `apps/worker/dist/main.js` |
| `E2E_BASE_URL=http://localhost:3014 E2E_CHANNEL=msedge npm run test:e2e` (`next dev`) | exit 1: `# tests 57 # pass 39 # fail 9 # cancelled 0 # skipped 9` |
| `npx prisma migrate deploy` on an empty DB | all 46 applied |

The 2 skipped unit tests are the weighted full-text ranking tests (they need `npm run search:weighted`), as in Agent 5's baseline.

### e2e: pre-existing vs new

All 9 failures and all 9 skips are the ones Agent 5 recorded on `main` (`qa-baseline.md`, `next dev`:
56 tests, 9 fail, 9 skipped), with the same errors. **No new failure.** The one extra test (57 vs
56) is Agent 1's "sign-up: nothing opens before the mailed code; the code leads to the dashboard of
a 14-day trial", and it passes.

| Failure | Baseline id | Error seen here |
|---|---|---|
| `review-flow` 4, 5, 6, 7, 8 (+ 7 skips) | F1 | `strict mode violation: … getByRole('heading', { name: 'Nima boʻladi' }) resolved to 2 elements` |
| `scale` 16 (+ 2 skips) | F1 | same |
| `shell-layout` 23 | F2 | `page.waitForFunction: Timeout 30000ms exceeded` |
| `refresh` 20 (dashboard) and 20 (section fetched ahead) | F3, F4 | dev-server only; pass on a production build |

These are B6–B8 in Agent 2's list and are expected to be fixed on the Agent 2 branch.

### Browser check of the merged branch (in-app browser, `http://agent4.localhost:3014`)

1. Sign-up with a new address → the code step `/sign-up/verify` (`agent4/1-merged-sign-up-code-step.jpg`).
2. While unconfirmed, `GET /api/dashboard` from that browser → `403 {"error":{"code":"unverified","message":"Davom etish uchun elektron pochtani tasdiqlang."}}`.
3. The code read from `tmp/outbox/` → the dashboard of the new trial firm (`agent4/2-merged-dashboard-after-code.jpg`).
4. 6 parallel `POST /api/clients` from that session → 2 ok and 4 refused with the localized plan message; 3 clients in total (trial cap 3, including the default client).

## Left open

- **Agent 1 hand-over item 2** (web): client-side React Query calls do not redirect on 403
  `unverified`. Today it is unreachable (a session cannot lose its confirmation while a page is
  open). Deferred: a fetch wrapper in `apps/web/src/lib/api/browser.ts` that sends `unverified` to
  `/sign-up/verify` would close it.
- **Agent 1 hand-over item 1** (trial days hidden on the dashboard until 5 are left) and **Agent 3
  hand-over item 2** (deleting a catalogue mid-audit logs a P2003 error): owner Agent 2's fix session.
  Checked in round 2.
- **Prisma `maxWait`:** a burst of parallel transactions on a cold pool can exceed Prisma's default
  2 s `maxWait` (seen in the race test with `connection_limit=4`). That is a capacity matter, not a cap
  bypass: the request fails rather than passing the cap. Production pools are larger; noted for QA.
- Review items deferred from Phase A (`architecture-review.md` §1): the `TRUST_PROXY`/`X-Real-IP`
  note for DEPLOY.md, the unused defaults in `AuthCoreModule`, GET-with-side-effect audit resume, and
  the dead-code comments.

## For the owner

Nothing new beyond Agents 1 and 3's lists (`SMTP_URL` + `MAIL_FROM`, `GOOGLE_CLIENT_ID` +
`GOOGLE_CLIENT_SECRET`, Telegram bot settings).

---

# Round 2: Agent 2's fixes, `main`'s pricing follow-up, Agent 1's follow-up

## Merged

| Order | Branch | Tip | Merge commit |
|---|---|---|---|
| 3 | `agent2-bug-fixes` (cut from `claude/agent2-bug-discovery-b07a47`, so it also brings `bugs.md` and the discovery docs) | `788a4ba` | `e2866c2` |
| 4 | `main` (pricing follow-up `f95b173`, merged there as `cd7f066`) | `cd7f066` | `9c09995` |
| 5 | `claude/agent1-auth-e2dff1` again (one commit after round 1) | `ce124a7` | `7259cf7` |

### Conflicts and how each was resolved

| File | Merge | Resolution |
|---|---|---|
| `packages/domain/src/demo.test.ts` | Agent 2 | Both sides fixed the `demo_visit` count race (my `022057a`, Agent 2's B10). I kept Agent 2's version, which counts visits since the test began and records the sessions first for cleanup; it supersedes `022057a`. |
| `packages/domain/src/plan.ts` | main | Import lines only. Both are kept: `main`'s `PLAN_FEATURES`/`Feature` (for `planHas` and `orgHasFeature`) and Agent 3's `rowsUsed`. The new feature gates (branding, reminders, client links) are separate from the clients, seats and rows caps. |
| `apps/api/test/unit/http.test.ts` | Agent 1 again | `ce124a7` contains the same one-line `requestOrigin` regex fix as my `ab3de5d`, so `facts.ts` merged identically, with no source diff. Both branches had added a `requestOrigin` test: I kept Agent 1's (it also covers a forwarded host list) and dropped mine. The imports were merged. |
| auto-merged, checked by hand | Agent 2 | `packages/domain/src/api/handlers.ts` (Agent 3's ledger gate plus Agent 2's B12 draft filter), `schema.prisma` (`Notification.text`), i18n `security.ts`/`imports.ts`/`i18n-app*.ts`, e2e specs (Agent 1's account flows plus Agent 2's selector fixes), `notifications.controller.ts`. The listed overlaps (`session-rows.ts`, `mapping-guess.ts`, `workspace.ts`, the CSV writers) were changed by Agent 2 only. No branch changed `app.module.ts`, the i18n index, `package.json` or the lockfile, so the lockfile was not regenerated. |
| `.claude/launch.json` | — | Agent 2's 4016/3016 entries are uncommitted on its branch; I added them (`0a86d47`). I also added `tasnivo-web-3014-prod` (`c4768a1`) for the production-build check below. |

### Migrations

- New: `20261027130000_notification_text` (Agent 2; additive nullable `notification.text`), already applied to the shared DB. `main` adds none.
- **Empty database:** `npx prisma migrate deploy` on a scratch database `agent4_scratch` → `All migrations have been successfully applied.` (47 migrations, ending with `20261027100000_email_code_google`, `20261027100000_usage_ledger`, `20261027130000_notification_text`). `migrate status` → `Database schema is up to date!`. The schema diff mentions none of the new tables or columns. Re-run on the final union; the scratch database was dropped afterwards.
- **Shared dev DB:** `Database schema is up to date!` `npx prisma generate` was run after the merges.

### Duplicated helpers

Only one duplicate: the `requestOrigin` test, removed as described above. Agent 2's fixes add no second mail, token or rate-limit helper.

## Fixed in round 2 (items handed over in round 1 that nobody picked up)

| Commit | What | Test |
|---|---|---|
| `1583925` | **Agent 3's hand-over item 2:** deleting a catalogue while it is audited made the running audit fail on a foreign key (P2003) and log an error with a stack trace. `runAudit` now checks whether the catalogue still exists and, if it was deleted, logs one info line and returns. | `audit-jobs.test.ts` "stops quietly … when the catalogue was deleted under the audit" (fails without the fix) |
| `472ceaf` | **Agent 1's hand-over item 1 / plan §4 Agent 1 item 5** ("the 14 days show on the dashboard"): the shell banner only speaks in the last 5 days, by design; the dashboard's Tarif card now shows "Sinov muddati: N kun qoldi" for every trial day. | Browser: `agent4/3-dashboard-trial-days-and-clients-cap.jpg` (new trial: "14 kun qoldi", clients 3/3 after the parallel-create check) |

## Checks (verbatim summaries)

The full set ran on `9c09995` (Agent 2 plus `main` merged). The two later commits only change
`launch.json`, one unit test file and docs, so for them I re-ran typecheck and the API unit tests,
as the coordinator asked.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 (107 s); again on `7259cf7`: exit 0 |
| `npm run lint` | exit 0 (83 s): `✖ 1 problem (0 errors, 1 warning)`, the known `scripts/lib/xlsx.ts:131:11` warning |
| `npm test` without `REDIS_URL` | exit 0: `# tests 1728 # suites 423 # pass 1726 # fail 0 # cancelled 0 # skipped 2` |
| `npm test` with `REDIS_URL=redis://127.0.0.1:63799` | exit 0: `# tests 1737 # suites 423 # pass 1735 # fail 0 # cancelled 0 # skipped 2` |
| API unit tests on `7259cf7` (`apps/api/test/unit/*.test.ts`) | `# tests 52 # pass 52 # fail 0 # skipped 0` |
| `npm run build` | exit 0 |
| `npm run build:api` | exit 0 |
| `npm run build:worker` | exit 0 |
| `npx prisma migrate deploy` on an empty DB | 47 applied |
| `E2E_BASE_URL=http://localhost:3014 E2E_CHANNEL=msedge npm run test:e2e` (`next dev`) | exit 1: `# tests 60 # pass 58 # fail 1 # cancelled 0 # skipped 1` |

The 2 skipped unit tests are the weighted full-text ranking tests (they need `npm run search:weighted`), as before.

### e2e: what is left

| Test | Status | Cause |
|---|---|---|
| `refresh` 20 "router.refresh() on the dashboard commits without any other update" | **fail on `next dev`** | Baseline F3, pre-existing. Dev-server timing: the renamed client does not show within `SETTLE_MS` = 2 000 ms after the first refresh. It also fails alone on `next dev`. **It passes on the production build:** `next build` + `next start` on 3014 (`tasnivo-web-3014-prod`), `refresh.e2e.ts` → `# tests 4 # pass 4 # fail 0 # skipped 0`. Agent 2 records the same (`agent2-fixes-result.md`, Checks). Not a product bug. |
| `refresh` 20 "a section fetched ahead …" | skip on `next dev` | Baseline F4, now skipped by design on a dev server (Agent 2's B8: "router.prefetch is a no-op under next dev"). It runs and passes on the production build (included in the 4/4 above). |

Everything else in the baseline is fixed: F1, the 6 review-flow/scale failures and their 9 skips (Agent 2's B7), and F2, shell-layout 23 (B6). Agent 2 added 3 tests (B14, B17, B18 in `navigation.e2e.ts`) and they pass. Agent 1's sign-up code-step test passes.

## Left open after round 2

- **Agent 1 hand-over item 2:** a browser-side call does not redirect on 403 `unverified`. It cannot happen today, so it stays deferred, as in round 1.
- **Agent 2:** B9 (demo-access flake) not reproduced. B15 (landing and legal pages in Uzbek only) is a product decision that needs the owner's Russian legal texts.
- **Prisma `maxWait`** under a cold-pool burst: a capacity note for QA, as in round 1.
- The `architecture-review.md` §1 items listed as deferred in round 1.

The branch is ready for Agent 5.
