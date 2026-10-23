# Agent 3: trial quota rollback, result

**Branch:** `claude/agent3-trial-quota-0abc5f` (worktree `.claude/worktrees/agent3-trial-quota-0abc5f`), cut
from `f11abc4`. Not pushed.

**Commits** (oldest first):

| Commit | What |
|---|---|
| `cbbf891` | Failing domain test reproducing the rollback; launch entries for API 4013 / web 3013 |
| `7f4723d` | `usage_ledger` table and migration with backfill |
| `2664f79` | The commit consumes rows through the ledger; `usageOf` reads it; callers handle `over_allowance` |
| `c3f239a` | Tests: clients and seats cannot be recycled into more processing |
| `c38abea` | API regression test: upload → delete → upload past the trial cap is refused |
| `78ef294` | Result, handoff notes, screenshots (this file) |

## Root cause

As stated in the plan (§2), confirmed. `usageOf` (`packages/domain/src/plan.ts`) computed the
month's rows live as `SUM(catalog.rowCount)` over this month's catalogues past `uploaded`, and
`deleteCatalog` (`packages/domain/src/catalogs.ts`) hard-deletes the catalogue row. Deleting a
committed catalogue therefore removed its rows from the sum, and the trial allowance came back.

Reproduced three ways before the fix:

1. Domain test (`cbbf891`): commit 40 rows → `usageOf` 40 → `deleteCatalog` → `usageOf` **0**.
2. HTTP against the API on port 4013, trial org (5,000 rows), cookie session:
   ```
   POST /api/auth/sign-in                         -> 200 {"redirect":"/dashboard"}
   GET  /api/billing/plan                         -> usage.rowsPerMonth 0
   POST /api/catalogs/preview   (3,000-row CSV)   -> 200 ok
   POST /api/catalogs/{A}/commit {mapping}        -> 200 ok
   GET  /api/billing/plan                         -> usage.rowsPerMonth 3000
   DELETE /api/catalogs/{A}                       -> 200 {"ok":true,"rows":3000}
   GET  /api/billing/plan                         -> usage.rowsPerMonth 0      <- the bug
   POST /api/catalogs/preview   (3,000-row CSV)   -> 200 ok
   POST /api/catalogs/{B}/commit {mapping}        -> 200 ok                    <- 6,000 rows on a 5,000 trial
   ```
   (Writes carry `X-Requested-With: tasnivo`; the public `/api/v1/catalogs` path had the same flaw.)
3. A second, independent gap: the gate was read-then-write (`gate()` then `applyMapping` in separate
   statements), so concurrent commits could pass the cap together, on any entry point.

## Design

- **Ledger.** New table `usage_ledger` (`UsageLedger` in `schema.prisma`): `id`, `orgId` (FK to
  organization, cascade only when the org itself is deleted), `key` (`'rowsPerMonth'`), `amount`,
  `period` (UTC month start), `catalogId` (nullable, **no relation**, so the entry outlives the
  catalogue), `reason` (`catalog.committed` | `backfill`), `createdAt`. Unique `(catalogId, key)`;
  index `(orgId, key, period)`. Migration `20261027100000_usage_ledger`, additive only.
- **One write point.** All three entry points (web wizard `commitCatalogUpload`, public API
  `uploadCatalogOperation`, Telegram `importFile`) commit through `applyMapping`
  (`packages/domain/src/catalog-import.ts`). Its final transaction now calls `consumeRows`
  (`packages/domain/src/usage-ledger.ts`) as the last statement: it takes a per-org advisory lock
  (`pg_advisory_xact_lock`), skips a catalogue already in the ledger, re-checks
  `used + rows <= cap` against the plan's monthly cap, and inserts the entry. Over the cap it throws,
  the transaction rolls back, the claim is released, and `applyMapping` returns
  `{ error: 'over_allowance' }`. The lock is held only for the moment of commit (taken after the
  item inserts).
- **Callers.** Keep their early `gate()` for the message; on `over_allowance` the wizard answers
  `msg.gate.rowsPerMonth`, the public API `402 plan_limit` (and deletes the stray preview), the bot
  the localized gate message (and deletes the stray preview). Expiry stays enforced by the callers'
  gate (it is time-based, not raceable); the in-transaction check is the cap only.
- **Read.** `usageOf` sums the ledger for the current UTC month (`rowsUsed`). `planStatus`, `gate`,
  `allows`, `/api/billing/plan`, `/api/shell` and the dashboard read it, so the three web meters
  (`settings/plan-usage.tsx`, `dashboard/usage-panel.tsx`, `ui/shell/plan-banner.tsx`) show the
  ledger numbers with no contract change.
- **Re-audit.** Does not consume again: a retry (`retryAudit`) or resumed audit never goes through
  `applyMapping`, and `consumeRows` skips a catalogue that already has an entry; the unique index on
  `(catalogId, key)` is the backstop.
- **Delete.** `deleteCatalog` is unchanged: the ledger entry stays (no FK), so the rows stay counted
  for the month. A new month starts at zero (`period`).
- **Previews.** Unchanged: uncommitted uploads do not consume; they have their own 24-hour cap
  (`previewGate`) and are swept after 48 hours.
- **Backfill.** The migration inserts one `backfill` entry per catalogue of the current UTC month
  past `uploaded` (exactly what `usageOf` counted), `ON CONFLICT DO NOTHING`, so no org's usage
  changes at deploy. Rollout note: catalogues committed by old code between the migration and the
  new code going live would not be counted for the rest of that month; deploy both together.

## Clients and seats (brief §3)

Not bypassable by delete/restore, so not changed:

- **Clients** are counted including archived ones, so archive → restore frees nothing. Deleting a
  client frees its slot by design (a standing capacity, like a seat), but it deletes every catalogue
  of that client, and their rows stay in the ledger, so recycling clients gives no extra processing.
- **Seats** = members + open invites. Accepting an invite moves the seat from invite to member
  (count unchanged); revoking or expiry frees it; again a standing capacity, not consumption.

Both are pinned by tests (below). One different gap remains: the clients and seats gates are
read-then-write, so parallel requests could overshoot by a few. Written up with a proposed fix in
`handoff-agent3.md` §1 for Agent 4 (it needs test-fixture changes across other areas).

## Tests

Domain, `packages/domain/src/usage-ledger.test.ts` (10 tests, all pass):
- UTC month boundary of `monthStart`;
- a commit writes one ledger entry and `usageOf` reads it;
- **deleting a committed catalogue does not give its rows back** (the inverted reproduction);
- **upload, delete, upload again cannot pass the trial cap**, and past the callers' gate
  `applyMapping` itself returns `over_allowance`, leaves the upload a preview and writes nothing;
- dedupe: recording the same catalogue twice consumes once (even with no room left);
- two concurrent 3,000-row commits on a 5,000 trial: exactly one succeeds;
- only the current month counts; an uncapped plan is never refused;
- **backfill**: the migration's `INSERT` is read from `migration.sql` and run twice (idempotent)
  on the dev database inside a transaction that is rolled back; for a test org with catalogues in
  `ready`, `failed`, `analyzing`, `uploaded` and last month, it yields exactly the old `usageOf` sum
  (123 rows, 3 entries);
- clients: archived still count, deleting a client frees the slot but its rows stay consumed;
- seats: invite holds a seat, acceptance keeps the count, revocation frees it.

API, `apps/api/test/e2e/quota.test.ts` (3 tests, all pass), through the Nest app:
- web wizard: commit 3,000 → `DELETE /api/catalogs/{id}` → `/api/billing/plan` still 3,000 → a
  3,000-row preview is refused with the localized message → 2,000 fits → full → 1 more refused;
- public API: `POST /api/v1/catalogs` answers `402 plan_limit` and stores nothing;
- another org is unaffected.
- **Verified as a regression test:** with the five domain files reverted to `f11abc4`, the first two
  fail ("deleting does not give the allowance back"); with the fix they pass.

Existing tests touched by the change, all pass: `catalog-import`, `preview-sweep`, `catalog-upload`,
`catalogs`, `client-lifecycle`, `billing/plans`, `billing/tiers`, `api/idempotency`,
`telegram/linking`.

## Checks

- `npm run typecheck`: pass.
- `npm run lint`: pass (0 errors; 1 existing warning in `scripts/lib/xlsx.ts`).
- `npm test`: 1,660 tests, 1,652 pass, 2 skipped, 6 fail, none from this change:
  `apps/api/test/e2e/auth.test.ts` "forgot password" / "resend confirmation" hit the shared
  per-e-mail rate limit ("Juda koʻp urinish", the flake Agent 4 documented for the shared DB);
  `demo.test.ts` / `demo-access.test.ts` failed on template counts (441 vs 442) while other sessions
  wrote to the shared DB and pass when re-run alone (14/14).
- `tests/pricing-parity.test.ts` named in the brief does not exist on this base; the pricing parity
  test is `tests/web-parity/pricing.test.ts`, which is in `npm test` and passes. `plans.ts` numbers
  are unchanged.
- `npx prisma migrate deploy` on the shared dev DB: applied cleanly. `prisma migrate diff` from the
  database to `schema.prisma` shows nothing for `usage_ledger` (schema and SQL agree). Backfill
  checked after deploy for every org: ledger sum for this month = old live sum, 17 orgs, 0 mismatches.

## Verified in the browser (web 3013 → API 4013, fresh trial org)

Screenshots in `docs/bugfix-2026-10-23/agent3/`:
1. `1-after-commit-3000-of-5000.jpg`: Settings → Plan after committing a 3,000-row file: 3,000 / 5,000.
2. `2-delete-dialog.jpg`: deleting that catalogue from the catalogue list.
3. `3-deleted-catalogue-3000-rows.jpg`: deleted ("3 000 ta qator"), list empty.
4. `4-after-delete-still-3000-of-5000.jpg`: the meter still reads 3,000 / 5,000.
5. `5-second-upload-3000-refused.jpg`: a second 3,000-row file is refused in the wizard: "Bu oy
   uchun qatorlar chegarasi tugadi. Tarifni yangilang."

The database confirmed it afterwards: the org has no catalogues and one ledger entry of 3,000.
The same flow over HTTP after the fix: usage stays 3,000 after the delete and the second preview
answers `{"ok":false,"error":"Bu oy uchun qatorlar chegarasi tugadi. Tarifni yangilang."}`.

Browser caveat: the in-app browser shares cookies across all sessions' `localhost` ports, so I drove
the app at `http://agent3.localhost:3013` (see `handoff-agent3.md` §3).

## Not done / for others

- Clients/seats parallel-request overshoot: `handoff-agent3.md` §1 (Agent 4).
- Audit of a catalogue deleted mid-audit logs a P2003 error: `handoff-agent3.md` §2 (Agent 2 fixes).
- Merge notes for Agent 4: migration `20261027100000_usage_ledger` (rename if another branch's
  migration needs to sort after it; it only depends on `organization` and `catalog`).
  `schema.prisma` adds one relation line on `Organization` and the `UsageLedger` model before
  `ApiUsage`. `.claude/launch.json` adds `tasnivo-api-4013` / `tasnivo-web-3013`.
- Nothing for the owner to supply.
