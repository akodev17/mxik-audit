# Agent 5 result: platform bug audit, authentication, regression

## Phase A (discovery) and Phase C preparation: done, 23 Oct 2026

- **Branch:** `fix/platform-quality` (renamed from the app's worktree branch), cut from the base
  commit `36ef476` of `integration/tasnivo-2026-10`. Not pushed.
- **Commits:** `871f26b` launch entries API 4025 / web 3025 (dev, prod) · `afb9fe4` bug list,
  known-bug re-verification, probes · `db4ce42` probe helper fix · `791757d` Phase B brief ·
  `db50d52` Q20 robots.txt fix · and the commit adding this note, the Phase C checklist and the e2e spec.
- **Deliverables:** `bugs.md` (Q1–Q20), `agent5-phase-b-brief.md`, `qa-checklist.md` (Phase C),
  `agent5/probes/` (re-runnable probes + README), `apps/web/e2e/accounting-platform.e2e.ts`,
  screenshots `agent5/q1-web-while-api-oom.jpg`, `agent5/q7-maxfiylik-todo-placeholders.jpg`.

### What was verified and how

| Area | How | Result |
|---|---|---|
| K1 verification mandatory | in-app browser sign-up → code step → dashboard; `p1-unverified.mjs` over 129 session endpoints | fixed: 122 → 403 `unverified`, 4 platform-admin → 404, 3 manual routes leak nothing |
| K2 delete restores quota | `p3-quota.mjs`, `p8-parallel.mjs` (3 000 rows, delete, re-upload; public API; parallel and repeated commits) | fixed |
| K3 14-day trial | `GET /api/billing/plan` on new accounts; client cap; link-invite joiner | fixed (password sign-up, invites); Google/Telegram unit tests only |
| Tenant isolation | `p2-isolation.mjs`: user B vs org A's and the seed org's ids on every id-bearing session route, ids in query/body, public API | no leak, no change; inconsistent answer shapes (Q12) |
| CSRF | `p4-csrf-rate.mjs`: 87 mutating routes without the header | all 403 `csrf` |
| Rate limits | sign-in per address / per IP, direct and through the web proxy | per address holds; per IP spoofable without Caddy (Q5) |
| Secrets in logs | API log search for tokens, keys, passwords | clean |
| Auth flows | `p11`, `p12`: reset, change, 2FA, recovery codes, sessions | correct |
| Walk | `walk.mjs`: 44 routes × uz/ru × 1280 light / 375 dark in Edge | no console errors, no overflow; Q7, Q8, Q10 |
| Real files | `p13-files.mjs` on `tmp/found-catalogs` | sensible mappings and refusals |
| e2e | production build, `E2E_BASE_URL=http://localhost:3025 E2E_CHANNEL=msedge` | **60/60 pass**, 5 min 05 s |
| Static checks | `npm run typecheck`, `npm run lint`, `npm test` | typecheck 0; lint 0 errors / 1 known warning. `npm test` run 1 (base code): 1 729 tests, 1 fail = Q20 (fixed here, `robots.test.ts` 2/2). Runs 2 and 3 on the final tip, while the four other workstreams loaded the shared Postgres: 4 and 2 failures in DB-backed API files (`notifications`, `public-api` "check: … plan_expired (402)" got 500 after 3 s in both, `team`, `stale-client`) next to "database not reachable" skips in the same runs; **each failing file passes alone** (5/5, 14/14, 5/5, 6/6, telegram 3/3). Not a clean full run yet: attributed to shared-DB saturation, to be re-run in Phase C (B3) |

### Findings (details in `bugs.md`)

- **S1 Q1:** the API process builds a fresh local embedding model (~470 MB) for every public
  `/api/v1/check` call (and every inline audit); 1 check = 153 → 1 419 MB and 9 s; **40 parallel
  checks from one trial key crashed the API with a heap OOM**. Root cause: only the worker installs a
  shared embedder (`useEmbedderSource`).
- **S2:** Q2 (= FAIL-1, sid not rotated after the code; reproduced), Q4 (wizard upload refused with a
  wrong reason for orgs without the lazily created default client), Q5 (per-IP limits trust
  client headers without Caddy), Q7 (legal pages published with `[TODO]` placeholders; owner text).
- **S3:** Q3 (= FAIL-2), Q6 (check allowance overshoot: 580/500 measured), Q8, Q9 (`/api/docs`
  public in production), Q10 (= B15), Q11 (= FAIL-3), Q12, Q13 (= FAIL-4), Q14, Q15, Q16, Q17, Q18
  (production web builds bake the API URL; the `*-prod` launch entries mislead), Q19 (= FAIL-5/B9,
  not seen), Q20 (base `npm test` red; fixed).

### Phase B

`start_session` was refused (this session's turn came from the coordinator, not the user), so the
coordinator was asked to start the fix session from `agent5-phase-b-brief.md` (source branch
`fix/platform-quality`, branch `platform-quality-fixes`, ports 4026/3026). Its result will be
`agent5-fixes-result.md` on its branch.

### Phase C preparation

- `qa-checklist.md`: preparation, builds (incl. Docker), migrations on an empty DB and on a populated
  copy, authentication, trial enforcement on the new entry points, tenant isolation including the new
  tables, duplicate-import prevention, the four acceptance workflows, no unsafe automatic accounting
  changes, and a security review of `git diff 36ef476...HEAD`, each with steps and the expected result.
- `apps/web/e2e/accounting-platform.e2e.ts`: runs today (3 pass): the four sections wait behind the
  code step, render in uz and ru at 375 px without sideways scroll, and the `(org, kind, fingerprint)`
  duplicate key holds. Three API tests (another firm's batch/export via `/api/onec/...`, mutations
  on it, CSRF) skip themselves until the 1C module's routes are served. Bank, Didox and product
  endpoints are not in the plan's contract, so their API checks are in the checklist (I1–I2), not in the spec.

### Open items / for the coordinator

- Phase B: started by the coordinator on `fix/platform-quality-fixes` (worktree
  `platform-quality-fixes`, cut from `db50d52`, ports 4026/3026). Q20: the base branch already has the
  same fix as `7dbb083`; `robots.ts` is byte-identical in both, so the Phase C merge is clean there.
- Agents 1–4: none of the Phase A findings is in their files (Q1's fix is in the API bootstrap and
  `packages/domain/src/audit-runner.ts` glue, not in `packages/core/src/match`).
- Owner: legal entity name, STIR, address and lawyer review for `/maxfiylik` and `/oferta` (Q7).
- Environment: an API from the main checkout runs on :4000 with pre-verification code on the shared
  DB; throwaway `a5-*@example.test` accounts are in the shared DB.
- `npm test` has not been run with Redis in Phase A (Phase C B3 does both).
