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
