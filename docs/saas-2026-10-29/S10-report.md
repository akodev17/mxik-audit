# S10 — Isolation and payment test matrix: report (30 Oct 2026)

Branch `feat/s10-test-matrix`, cut from `main` at `cf4c755` (main has since moved to `7979b3a`; that
commit touches `didox/connection.ts`, `didox/service.test.ts` and the web module-states provider,
not the lines changed here). Worktree `.claude/worktrees/agent-a0e4501914595a581`. Not pushed, not
merged.

## Files changed

| File | Why |
|---|---|
| `apps/api/test/e2e/isolation-matrix.test.ts` (new) | The matrix: phases, assertions, coverage summary. |
| `apps/api/test/e2e/isolation-seeds.ts` (new) | Seeds one of every org-owned resource per client and per org; `snapshot()` hashes an org's data. |
| `apps/api/test/e2e/isolation-specs.ts` (new) | Path parameter → seed map, body/query/upload id fields, the allow-list (`OUTSIDE`) and the role-`any` writes (`ANY_ROLE_WRITES`), each with a reason. |
| `apps/api/test/e2e/zod-sample.ts` (new) | A valid sample of a zod schema, so every request passes validation and reaches the ownership check. |
| `apps/api/test/e2e/products.test.ts` (new) | Products e2e. |
| `apps/api/test/e2e/billing.test.ts` | One new `describe` block appended; three imports. |
| `packages/domain/src/usage-ledger.ts` | `LOCKED_TX` (transaction options for capped writes). Pre-existing failure fix. |
| `packages/domain/src/clients.ts` | `createClient` transaction uses `LOCKED_TX`. Pre-existing failure fix. |
| `packages/domain/src/invites.ts` | `createInvite` transaction uses `LOCKED_TX`. Pre-existing failure fix. |
| `packages/domain/src/didox/service.ts` | Hole 1: `listInvoices` filter. 2 lines. |
| `packages/domain/src/products/catalog.ts` | Hole 2: `exportProducts` out-of-scope client. 2 lines. |

No file owned by S7, S8 or S9 was edited.

## 1. The isolation matrix

`apps/api/test/e2e/isolation-matrix.test.ts` reads `allEndpoints()` from `@tasnivo/contracts` and
runs against the real `AppModule`. Every module is switched on for the test app (a global module
provides `MODULE_STATES`), so the shared DB's `/admin/features` cannot hide a route.

Fixtures: org A (subscription running) with an admin, an unscoped accountant, an accountant scoped
to client A1, and a viewer; org B (subscription running) with an admin and an API key; a demo org
with its admin. Org A gets the org-level seeds (saved view, dictionary entry, member, invite, API
key, Telegram link, session, bank format, org-wide bank rule, notification) and, per client A1 and
A2, the client seeds (catalogue with an earlier version, an upload in preview, a failed audit,
findings with a suggestion, a decision, a flag event and a barcode row, a comment, a review, a
share link, purchase list, sales list (uploaded and failed), reminder task, counterparty, bank
statement with records, 1C export, client bank rule, Didox invoice with a PDF, product, product
import batch).

Phases (each collects every problem, then asserts the list is empty):

1. **Registry check.** Every allow-listed id exists. Every session write with role `any` is listed
   in `ANY_ROLE_WRITES` with why a viewer may call it (17 today).
2. **Cross-org.** Org B's admin sends every session operation that names a resource (path
   parameter, or an id in body/query/upload fields) with org A's ids. Assertions: the answer is
   the pinned refusal; no org-A name, file name, e-mail or id that the request did not carry
   appears in the answer; after each write, `snapshot(orgA)` is unchanged.
3. **Scope.** The A1-scoped accountant sends every non-admin operation whose request carries a
   client-A2 id. Same assertions, with A2's marks.
4. **Lists.** Every id-less session read, by org B's admin and by the scoped accountant: nothing
   of org A (resp. client A2) in the answer.
5. **Roles.** Viewer on every `writer`/`admin` operation → `403 forbidden`; unscoped and scoped
   accountant on every `admin` operation → `403 forbidden`; demo admin on every `noDemo` operation
   → `403 demo`. Org A unchanged. Two recorded exceptions (`ROLE_ANSWERS`): `account.reopen` (manual
   session; `reopenAccount` only reopens for an admin, anyone else gets `200 {redirect:'/account-deleted'}`)
   and `billing.checkout` (registered with role `any` in `billing.controller.ts`; the service
   answers a non-admin `200 {ok:false}`).
6. **Platform admin.** Every `platformAdmin` operation answers an org admin `404 not_found`.
7. **API key.** Org B's key: org A's catalogue report → 404; `listCatalogs?clientId=A1` shows
   nothing of A; `uploadCatalog` with A1's client → 4xx and nothing stored.
8. **Controls.** Every request of phases 2–3 is sent again by the owner (org A's admin, or the
   scoped accountant on its own client; writes on fresh seeds). The owner's answer must not be 404
   or 5xx and must differ from the refusal; a filtered JSON read must show the owner's own
   resource. This proves each refusal is the ownership check, not a bad seed or a validation error.
   (Phases 2–3 also refuse any 400: every body is a valid sample of the contract.)
9. **Coverage summary** (printed; `MATRIX_VERBOSE=1` prints every answer).

### Coverage

```
isolation matrix: 201/244 operations covered by at least one check; 43 outside (allow-list)
  cross-org 137, scoped 111, list-leak 26, viewer 107, accountant 37, demo 59, platform-admin 10, api-key 3
  cross-org answers: 200 ×12, 404 not_found ×42, 200 null ×7, 200 [] ×2, 200 ok:false ×69, 200 false ×5
  scoped answers: 200 ×8, 404 not_found ×41, 200 null ×6, 200 [] ×2, 200 ok:false ×51, 200 false ×3
```

The 43 outside: public/auth forms and token-credential routes (sign-in, sign-up, reset, verify,
Google, Telegram login/bind, invite read/join/joinCheck/joinWithAccount, demo links, share view/PDF),
provider callbacks (Click, Payme, Telegram webhook), cron, health, OpenAPI, cookie preferences, the
public `check` (no id), and the caller's own account (2FA, password, sessions-end-others, Telegram
bind/unbind, tour, mark-all-read). Each has its one-line reason in `OUTSIDE`. Those with `noDemo`
are still covered by the demo phase.

### What each module answers another tenant today (recorded, pinned in the test)

- **404 `not_found`** (42): clients get/accountants; catalogue get, summary, versions, diff,
  report, progress, review, and the four downloads (`/api/export`, diff CSV, report CSV, PDF);
  workspace counts, failed rows, money at risk; dictionary provenance; purchases and docs reads;
  reminder schedule; billing catalogue purchase; every 1C operation (batch, prepare, export,
  transfer, file, decisions, counterparties); bank statement, records, export, reconcile (+CSV);
  Didox invoice, PDF, suggestion, export; product detail, packages, import batch.
- **200 `{ ok: false, error }`** (the actions' shape, 69 + body-id operations): clients
  rename/archive/restore/delete/set-accountants; catalogue upload steps, retry, delete, review
  assign/finish; workspace decisions, split, accept-sure, bulk, undo, flag undo, wrong suggestion,
  remove view; dictionary accept/edit/confirm/remove; purchases and docs writes; team member and
  invite writes; reminder writes; bank and Didox writes; product confirm, import decide/apply/export,
  from-audit; Telegram unlink; and the upload endpoints given another tenant's `clientId`.
- **200 with an empty value**: `null` (catalogue preview, rows, row detail, code request, removal
  check, create share link, post comment), `[]` (share links, comments), `false` (set flag, name from
  barcode, revoke share link, end session, revoke API key).
- **200, filtered to the caller's own data** (id in a query or body): activity, catalogue list,
  queue, dashboard, default view, invite (`fieldErrors.clients`), mark read, 1C batches, bank list,
  Didox list, product list/check.

## Holes found

| # | Where | What | Status |
|---|---|---|---|
| 1 | `packages/domain/src/didox/service.ts` `listInvoices` | `{ ...batchScope(user), ...(clientId ? { clientId } : {}) }`: the requested `clientId` replaced the scope's `clientId: { in: [...] }`. A scoped accountant calling `GET /api/didox/invoices?clientId=<unassigned client>` got that client's invoices (batch ids, client name, file name, seller, totals). | **Fixed**: `AND: [batchScope(user), { clientId }]`. The matrix scoped phase failed on `didox.list` before (`answer shows <A2 batch id>, A2 mijoz …, A2-didox-…`) and passes after. |
| 2 | `packages/domain/src/products/catalog.ts` `exportProducts` | An out-of-scope `clientId` was dropped and every product the member could see was exported: the member asked for client A2 and got a 1C export batch of client A1, written to the org. Not a cross-client leak, but an unrequested write. | **Fixed**: a client the user cannot open matches nothing (`ta.productsX.empty.filtered`, the answer another org gets). The matrix flagged `products.exportAll: changed org A's data` before; it passes after. |

Not holes, recorded for the owner / siblings (no change made):

- `billing.checkout` is `role: 'admin'` in the registry but registered as `role: 'any'` in
  `apps/api/src/billing/billing.controller.ts`, so the guard does not refuse; the service answers
  non-admins `200 { ok:false, error: admin_only }`. Refused, nothing stored (checked). S7 owns the
  file; if a 403 is wanted, S7 can drop the override.
- `products.check` with `unchecked: true` and an out-of-scope `clientId` re-checks every unchecked
  product the member can see (it does not touch the other client). Same pattern as hole 2 but
  only refreshes the member's own products; left as is.
- Many writes answer `200 { ok:false }` or an empty `200` instead of 404 (list above). They are
  refusals (data unchanged, nothing leaked); the shape is the old server actions'.
- `workspace.setDefaultView` with another org's view id and `notifications.markRead` with another
  org's notification ids answer `ok:true` and change nothing (checked by the snapshot, which
  includes `notification_read` rows on org A's notifications).

## 2. `products.test.ts`

Six tests through the API, with a fake Tasnif client:

1. Preview → commit → background check → `set_code` decision → save: two products created for the
   client; `usageOf().rowsPerMonth` stays 0 (D4).
2. An ended plan refuses the preview and the commit with `ta.msg.gate.expired` and stores no batch.
   A demo org gets `403 demo` from the guard.
3. Scope: the scoped accountant's preview and commit for another client, or for "own" (no client),
   answer `ta.importX.errors.client`. Its own client's commit works. The admin's batch for client B
   is 404 to it; decide and apply are refused and change nothing. Client B's product is absent
   from its list and 404 on detail. The unscoped accountant reaches both clients and "own".
4. A viewer reads the list and a product; preview, commit, confirm, check, export, import
   decide/apply/export are all `403 forbidden`, and nothing changes.
5. Confirm MXIK and the dictionary (S4): the admin's and the unscoped accountant's confirmations
   give `confirmations: 1, needsReconfirm: false`; the scoped accountant's gives
   `confirmations: 0, needsReconfirm: true`; an unscoped member confirming the same code
   afterwards makes it trusted.
6. Confirm refuses another client's product (`notFound`), a malformed code (`format`) and a code
   that is not live (`notLive`); product and dictionary unchanged.

"Delete/edit rights": the registry has no product delete or edit endpoint. The edits are Confirm
MXIK and the import decisions, covered in 3–5 and by the matrix.

## 3. `billing.test.ts` additions (gaps S5 left)

A new `describe` block, 5 tests:

1. **Trial → ended → paid**, as `GET /api/billing/plan` shows it (the brief's `GET /api/plan` is
   `/api/billing/plan` in the registry) and as the gates apply it.
   - Trial: `state trial`, 7 days left, limits 3/5 000/2; a client is created; an API check passes.
   - Trial ended: `state expired`, all three limits full. New client, invite and catalogue upload
     answer `ta.msg.gate.expired`; the API check is `402 plan_expired`. Reading the clients works.
   - Paid with `scripts/billing-activate.ts --org <email> --plan company_monthly`: `state firm`,
     `tier company`, limits 1/20 000/3. A second client is `ta.msg.gate.clients` (the trial's client
     fills the tier's one); invite, upload and API check work; paid until about one calendar month.
2. **The transfer script**, run as a child process as the owner runs it.
   - `accountant_monthly` succeeds. `company_monthly` then exits 1 with the "dearer tier is
     running" message; the end date, the tier and the paid orders are unchanged.
   - With `--force` the tier becomes company, and the end is now + `creditDays` + one month.
   - An unknown plan, an unknown e-mail or a missing `--org` exit 1 and change nothing.
3. **Seats on invite accept, in parallel.** Trial (2 seats): admin + one invite is full. The same
   invite joined twice at once makes exactly one account. Company tier (3 seats): two invites hold
   the last seats; both are joined at once, both fit; usage is 3 of 3 and a new invite is
   `seatsFull`.
4. **rowsPerMonth, two commits at once at the edge.** The ledger holds 4 990 of 5 000. Two members
   each preview 6 rows, then both commit at once. One passes; the other gets
   `ta.msg.gate.rowsPerMonth`. Usage is 4 996 and the ledger has one new entry.
5. **apiChecks follow the plan.** Trial at 499 of 500: 2 items → `402 plan_limit`, 1 item → 200,
   then 402. After a company payment, 2 items → 200. Usage is 502. (Parallel requests at the edge
   are already in `public-api.test.ts` Q6, not repeated.)

## 4. Pre-existing failure: `plan-caps-race.test.ts`

Cause, measured on this machine:

- A fresh Prisma connection to `localhost:54329` takes **~2.1 s** (`Promise.all` of six queries on
  a fresh client: 2 148 ms). To `127.0.0.1:54329` it takes **89–96 ms**. The Prisma engine tries
  IPv6 `::1` first; Node's `pg` with happy-eyeballs does not wait (31–62 ms on `localhost`).
- The main checkout's `.env` says `localhost` without `connection_limit`, so the pool is 16 × 2 + 1
  = 33 connections. The test warms 4 connections, then starts 6 interactive transactions. Two of
  them must open a new connection, which takes about 2 s.
- Prisma's default `maxWait` is 2 s, so those two fail with "Unable to start a transaction in the
  given time".

Reproduced (`DATABASE_URL=postgresql://mxik:mxik@localhost:54329/mxik?schema=public`, alone):
fails 2/2. With `127.0.0.1` it passes 2/2; with `&connection_limit=4` it passes.

Fix: `LOCKED_TX = { maxWait: 10_000, timeout: 20_000 }` in `usage-ledger.ts`, used by the two
transactions that queue on `lockOrgUsage` and that the test exercises (`createClient`,
`createInvite`), the same values as S5's `PAY_TX`. A capped write should wait for a busy or
opening pool rather than fail; waiting also covers the lock queue itself under load. With the
original failing URL the test now passes 3/3, and the test was not changed.

Recommendation for the owner: set the main checkout's `.env` `DATABASE_URL` host to
`127.0.0.1`, as `.env.example` already says. Every new Prisma connection then opens about 2 s
faster.

Not changed: `catalog-import.ts` (the commit's `consumeRows` transaction, S8's file this wave) and
`invite-move.ts` also take `lockOrgUsage` under the default `maxWait`. S8 may want `LOCKED_TX` on
the commit transaction.

## How it was tested

All from the worktree root against the dev DB on 54329 (`&connection_limit=4`), shared with
sibling agents.

- `node node_modules/tsx/dist/cli.mjs --test apps/api/test/e2e/isolation-matrix.test.ts`:
  - Before the fixes: fails only on holes 1 and 2.
  - After the fixes: every phase passes (run 6). The roles phase had 7 transient
    `500 server_error` answers while the DB was under heavy sibling load (the run took 9.6 min
    instead of 4); the same phase passed in runs 3 and 5 and in the full `npm test` run.
- `apps/api/test/e2e/products.test.ts`: 6/6 alone (150 s).
- `apps/api/test/e2e/billing.test.ts`, new block: 5/5 (257 s). The whole file passed in `npm test`.
- `packages/domain/src/plan-caps-race.test.ts`: see §4.
- `npm run typecheck`: exit 0 (8 min).
- `npm run lint`: exit 0. 0 errors; 1 warning that predates this work (`scripts/lib/xlsx.ts:131`).
- `npm test` (full, 10.5 min, DB shared with three sibling agents): **2 349 tests, 2 339 pass,
  5 fail, 5 skipped.** The isolation matrix, both billing blocks and `plan-caps-race` passed. The
  five failures, each file then re-run alone:
  - `apps/api/test/e2e/products.test.ts:85`: "timed out waiting for the product check" (my
    120 s wait under the full suite's load). The wait is now 600 s, the same bound as the
    domain's `settleBatch`. Alone: 6/6.
  - `apps/api/test/e2e/imports.test.ts:85`: "timed out waiting for the cheque check". Load;
    alone 5/5. S5 saw the same.
  - `packages/domain/src/audit-jobs.test.ts:184`: "catalogue still analyzing". Load; alone 10/10.
  - `packages/domain/src/products/products.test.ts:246`: `packageName` empty. Load; alone 21
    pass, 0 fail, 1 skipped.
  - `packages/domain/src/didox/service.test.ts:141`: **pre-existing on the branch base
    `cf4c755`.** It expects 'Срок подписки истёк.' while the code answers `ta.msg.gate.expired`.
    `main` fixed this in `7979b3a`, after this branch was cut. It fails alone too, and is
    unrelated to the `listInvoices` change.

## Open questions for the owner

1. Should first-party "not yours" answers converge on 404 (the API README says "not yours / missing
   is a 404")? Today 69 writes answer `200 { ok:false }` and 14 answer an empty 200. All are
   refusals; changing the shape touches the web client.
2. `billing.checkout`: keep the role-`any` override (answer `admin_only` in the form) or let the
   guard answer 403? (S7.)
3. Should an out-of-scope client filter be refused everywhere (as `exportProducts` now does), or
   ignored as `catalogs.list`, `products.list` and `products.check` do today (they answer every
   client the member can see)? `bank.list` and `onec.batches` answer an empty list instead. It is
   never a leak, but it is inconsistent.
4. Switch the main `.env` to `127.0.0.1` (see §4)?
