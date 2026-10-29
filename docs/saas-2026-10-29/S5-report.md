# S5 — Billing integrity: report

Branch `feat/s5-billing` (from `feat/saas-hardening-plan` @ `4288271`), worktree
`.claude/worktrees/agent-a0896b0ec791777d9`. Findings F3, F4, F14 and the S5 items of F20; decisions
D2, D3, D4. Nothing pushed or merged.

## What was done

### F4 — payments are claimed once (High)
- I checked the plan's claims against the code first; they hold. `markPaid` read the status and then
  updated by id, the provider state was written after `markPaid` outside its transaction, and Payme
  counted open transactions before creating one.
- `billing/orders.ts` `markPaid(orderId, provider, { force, testMode, within })` now returns
  `'paid' | 'not_payable' | 'already_paid' | 'plan_change'`. Inside one `$transaction` it:
  1. takes a per-org advisory lock (`pg_advisory_xact_lock(hashtext('billing_org'), hashtext(orgId))`),
     so two renewals of one org cannot both start from the same end date;
  2. re-reads the order and applies the tier rule;
  3. claims the order with `updateMany({ where: { id, status: 'created' } })` and goes on only when
     `count === 1`;
  4. sets `subscriptionUntil`, runs the provider's `within(tx)` and writes the audit event.

  If `within` throws, the claim rolls back with it.
- Click Complete and Payme Perform write their transaction state (`state 2`) through `within`, so the
  order and its transaction move together or not at all. Payme Perform moves the transaction with
  `updateMany where state = 1`, so a concurrent Cancel makes Perform fail and roll back. A Perform
  that loses the race answers what the winner recorded (it is idempotent).
- Payme CreateTransaction counts and creates under a per-order advisory lock
  (`hashtext('payme_order')`) and re-reads the id inside the lock.
- Cancels (Click `error < 0`, Payme Cancel, the 12 h timeout) update `where state = 1` and cancel the
  order in the same transaction.
- `PAY_TX = { maxWait: 10 s, timeout: 20 s }`: a callback waits for a busy pool or lock instead of
  failing (the race test hit Prisma's 2 s default on a cold pool).

### F3 / D2 — tier rule, no schema change (High)
- New pure module `billing/period.ts`:
  - `addMonths` adds calendar months with the day clamped, in UTC (31 Jan + 1 = 28/29 Feb; F20).
  - `creditDays(remainingMs, from, to) = floor(remainingDays × oldMonthly / newMonthly)`.
  - `nextPeriod(active, plan, now, force)` decides the period:

  | Case | Result |
  |---|---|
  | No subscription, or it has ended (the trial included) | Starts now (`new`); trial days are discarded |
  | Same tier | Extends from the current end (`renew`), monthly or yearly |
  | Dearer tier (higher monthly price) | Starts now plus `creditDays` (`upgrade`) |
  | Cheaper tier | `plan_change`; with `force`, converted like an upgrade (`forced`) |
- The rule is applied at all of these points:
  - checkout: `createOrder` returns `{ ok: false, reason: 'plan_change' }`, and
    `billing.service.ts` throws `ApiError(403, 'plan_change', ta.setX.plan.planChange)` (uz and ru);
  - the providers' pre-checks, Click Prepare and Payme CheckPerform/Create, which refuse before any
    money moves;
  - inside `markPaid`, against an order made earlier or in a race;
  - in `recordTransfer` / `scripts/billing-activate.ts`, which has a new `--force` flag. A refused
    transfer cancels its order.
- `planStatus` still takes the tier from the newest paid subscription order. Under the rule that is
  now always the tier in force.
- The plan tab (`plan-tab.tsx`) adds one sentence in the "pay" card: the tier rule while a
  subscription runs (`tierRule`), or, during the trial, that paying starts the period now and drops
  the trial's remaining days (`trialStart`).

### F14 / D3, D4 — gates (Medium)
- **D4 (uploads).** These now call `uploadsOpen()` right after the demo check and answer the
  existing `ta.msg.gate.expired`:
  - `products/import.ts`: preview and commit;
  - `didox/service.ts` `uploadGate`: upload and sheet commit (one line and an import; S2's
    duplicate message is untouched);
  - `onec/counterparties.ts` `importCounterparties`: returns `error: 'expired'`, and
    `apps/api/src/onec/onec.service.ts` `refused()` maps it to the same message.

  None of them use `rowsPerMonth`.
- **D3 (exports).** `catalog-exports.ts` `paymentRequired(orgId, catalogId)` is
  `BILLING_REQUIRED_FOR_EXPORT` and no `catalogPaid`. When it holds:

  | Download | Behaviour |
  |---|---|
  | Corrected xlsx and 1C files | 402 `payment_required` (as before) |
  | Client PDF | 402 `payment_required` |
  | Diff CSV | 402 `payment_required` |
  | Internal report PDF | Served, with `chosen` blanked on every row |
  | Report CSV | Served, with `chosen` blanked on every row |
- **D3 in the web.** The export menu drops "PDF for the client" when locked; "Pay and download" stays.
  The report page (client view) and the diff page show a disabled button with
  `ta.setX.billing.locked`. That text now names the client PDF and CSV too, and it is the same reason
  the billing box shows.
- `catalog-pages.ts` is not touched: its `exportLocked` already computes the same condition, so
  there are no edits to coordinate with S2.
- The share link's PDF (`sharePdf`) is **not** gated. A link needs the client-links feature
  (accountant tier or higher), and the public share page has no locked state to show. Owner
  question 3 covers this.
- `DEPLOY.md` now says production sets `BILLING_REQUIRED_FOR_EXPORT=true`, and adds a Payme
  test-mode line.
- Stale `tests/pricing-parity.test.ts` comments are fixed in `plans.ts:4` and
  `apps/web/src/components/landing/config.ts:68`. `docs/landing-2026-10-23/feature-inventory.md:30`
  is corrected. `tests/web-parity/pricing.test.ts` needed no change: its own header is right.

### F20 items (Low)
- **Orders survive an org purge.** `Order.orgId` is nullable with `onDelete: SetNull`; new columns
  `orgName` (snapshot at creation, backfilled) and `testMode`. Migration
  `packages/db/prisma/migrations/20261108000400_order_keep/` (idempotent); rollback in
  `docs/accounting-2026-10-23/migrations.md`. `purgeDeletedAccounts` is unchanged apart from its
  comment: deleting the org now nulls `orgId` instead of cascading. Payme CheckTransaction and
  GetStatement still answer after the delete (e2e). An order without an org is never paid.
  The test fixtures (`dropOrgs` in `packages/domain/src/test-fixtures.ts` and `apps/api/test/helpers.ts`)
  delete test orders, so the dev DB does not collect orphans.
- **Payme test mode.** `config.ts` turns Payme off when `PAYME_TEST_MODE=true` and
  `NODE_ENV=production`, unless `PAYME_TEST_ALLOW_PROD=1`. Payme calls carry `{ test }`, and orders
  they confirm are stamped `testMode: true`.
- **Click.** A missing or malformed `merchant_prepare_id` (non-digits, more than 10 digits, outside
  int4) answers -8 instead of a 500. A well-formed unknown id answers -6. A retried Prepare for a
  transaction that is cancelled answers -9, and one that is completed answers -4; neither is
  reopened.
- **Abandoned orders.** `expireStaleOrders(now)` in `billing/orders.ts` cancels `created` orders
  older than 24 h. It skips any order with a provider transaction still open inside Payme's 12 h
  window. `daily.ts` calls it in one line (`staleOrders`) plus an import.
- **Paid catalogue.** `createOrder` refuses a second order for a paid catalogue (or under an active
  subscription) with `already_paid`. The API answers `ta.setX.billing.alreadyPaid`. `markPaid` also
  refuses an older open order for a catalogue another order paid.

## Files changed
- **Domain:** `billing/{orders,click,payme,config,checkout,plans}.ts`, new `billing/period.ts`,
  `catalog-exports.ts`, `products/import.ts`, `didox/service.ts`, `onec/counterparties.ts`,
  `security/account.ts` (comment), `daily.ts`, `test-fixtures.ts`.
- **Database:** `packages/db/prisma/schema.prisma` (Order) and the new migration.
- **API:** `apps/api/src/billing/billing.service.ts`, `apps/api/src/onec/onec.service.ts` (`refused()`).
- **Web:** `(app)/settings/plan-tab.tsx`, `(app)/catalogs/[id]/{export-menu.tsx,report/page.tsx,diff/page.tsx}`,
  `components/landing/config.ts` (comment).
- **i18n:** `packages/i18n/src/i18n-parts/settings.ts`. New keys `tierRule`, `trialStart`,
  `planChange` and `billing.alreadyPaid`; `billing.locked` reworded. uz uses U+02BB and ru mirrors
  the shape.
- **Script:** `scripts/billing-activate.ts` (`--force`).
- **Docs:** `DEPLOY.md`, `docs/accounting-2026-10-23/migrations.md`,
  `docs/landing-2026-10-23/feature-inventory.md`.
- **New tests:** `billing/payments-race.test.ts`; rewritten `billing/tiers.test.ts`; additions to
  `billing/plans.test.ts`, `catalog-exports.test.ts`, `apps/api/test/e2e/billing.test.ts`.
- **Trials added to test orgs.** The new gate refuses the plain expired test orgs, so these tests now
  give their org a running trial: `apps/api/test/e2e/{didox,onec}.test.ts`,
  `packages/domain/src/didox/service.test.ts` and `packages/domain/src/onec/export.test.ts`. The
  last one also asserts the `expired` refusal.

## How it was tested
Dev DB 127.0.0.1:54329. Single files run with `node node_modules/tsx/dist/cli.mjs --test <file>`.

- **Migration.** `npx prisma migrate deploy` applied `20261108000400_order_keep` on the shared dev DB.
  The siblings' `20261108000100..0300` were already applied there.
- **`billing/payments-race.test.ts`: 5/5.**
  - Two concurrent `markPaid` of one order give exactly one `paid` and one `not_payable`. `within`
    runs once, there is one `billing.paid` event, and `subscriptionUntil` equals `addMonths(paidAt, 1)`.
  - Two concurrent renewals of one org add two months.
  - A throwing `within` rolls the claim back.
  - `testMode` is stamped.
  - Expiry after 24 h, with an open transaction protected.
  - The org delete keeps the order and its transaction.
- **`billing/tiers.test.ts`: 9/9.**
  - Trial; one calendar month; payment during the trial starts now.
  - Same-tier yearly renewal: `addMonths(end, 12)`. This replaces the old line 63, which asserted the
    exploit.
  - Upgrade company → accountant with the exact `creditDays`.
  - A cheaper tier is refused by `createOrder`, `markPaid` and `recordTransfer`; `--force` converts it
    (credit about 2.3×); a downgrade after expiry is allowed.
  - The legacy `firm_monthly` order and the manual subscription; features.
  - Bank transfer with `orgName`; a catalogue is paid once (`already_paid` for a new order, for a
    transfer and for an older open order).
- **`billing/plans.test.ts`: 8/8.** The pure `addMonths` cases (31 Jan, a leap year, 31 Mar, across
  the year end, time of day) and the `nextPeriod`/`creditDays` cases.
- **`catalog-exports.test.ts`: 6/6.**
  - With the flag on, client PDF, diff CSV and 1C are 402. The internal PDF is served, and the report
    CSV shows the suggestion but not the chosen code.
  - After a paid order, all are served and the chosen code is back. Without the flag nothing is held
    back.
- **`apps/api/test/e2e/billing.test.ts`: 18/18.** It uses the test env the file already used: Click
  service 777 / `click-test-secret`, Payme `payme-test-key` and a sandbox key for test mode. The
  cases:
  - **Click Complete success** extends one month; a retried Complete and a later Prepare get -4.
  - **Click `error < 0`** cancels the order and its transaction (-9); Prepare and Complete afterwards
    get -9.
  - **Click amount mismatch** gets -2 on Prepare and on Complete.
  - **Click `merchant_prepare_id`:** missing, `abc`, `1.5`, 11 digits or `-1` get -8 with HTTP 200;
    an unknown id gets -6.
  - **Click Prepare** of a cheaper tier under a dearer subscription gets -9 and cancels the order.
  - **Payme CheckPerform:** OK, a wrong amount, an unknown order.
  - **Payme Create:** a retry answers the same; a second open transaction is refused with -31051.
  - **Payme double Perform sent concurrently:** the same answer and one extension; a later retry too;
    Cancel after Perform gets -31007.
  - **Payme Cancel before Perform:** idempotent; Perform afterwards gets -31008; reason 3 is kept.
  - **Payme 12 h timeout:** Perform gets -31008 and the transaction is cancelled with reason 4; Create
    afterwards gets -31008.
  - **Payme GetStatement:** the window and a bad parameter. CheckTransaction and GetStatement still
    answer after the org is deleted.
  - **Payme test mode:** the order is stamped `testMode`; with `NODE_ENV=production` Payme is off
    unless `PAYME_TEST_ALLOW_PROD=1`.
  - **Checkout:** a cheaper tier gets 403 `plan_change` with the uz message and makes no order;
    renewal and upgrade are allowed; a paid catalogue gets `alreadyPaid`.
  - **Expired org:** product preview and commit, Didox upload and 1C counterparty import all refuse
    with `ta.msg.gate.expired` and store nothing. After a trial starts they succeed, and
    `rowsPerMonth` stays 0.
- **`npm run typecheck`.** It passed in full once (all workspaces plus the root `tsconfig`). A second
  run under heavy load timed out (`timeout 900`) during the root `tsc`, after every workspace had
  passed. Owner question 4 covers re-running it.
- **`npm run lint`.** The full run timed out at 900 s under load. ESLint over every file this branch
  changed: 4 errors in my tests, fixed in `2903090`, then clean.
- **`npm test` (full).** 1665 tests: 1569 pass, 76 fail, 14 cancelled, 6 skipped.
  - About 70 of the failures came from the dev Postgres resetting mid-run: "FATAL: the database
    system is in recovery mode" ×46 and "Can't reach database server" ×5. Six agents share the DB, and
    I did not restart Docker.
  - All 27 failing files were then re-run: 194 tests, 190 pass, 3 fail, 1 skipped. Those 3:
    - `apps/api/test/e2e/imports.test.ts:85`: "timed out waiting for the cheque check".
    - `packages/domain/src/products/import.test.ts:91`: `packageName` empty, after a 302 s
      background check.
    - `packages/domain/src/products/import.test.ts:153`: depends on the test at line 91.
  - The products test uses an `internal` org, so my `uploadsOpen` gate is open there, and it passed
    in my earlier targeted run (116 s). I believe all three are load timing, not this change; see the
    final re-run below.

- **Final re-run** of `products/import.test.ts` and `apps/api/test/e2e/imports.test.ts` alone:
  15/15 pass (cheques 84 s, product flow 167 s). Every test file is therefore green in a run that
  did not hit the database reset or the load timeouts. No failure is attributable to this branch, and
  none is pre-existing.

## Production configuration
- `BILLING_REQUIRED_FOR_EXPORT=true`: required. It locks the corrected and 1C files, the client PDF
  and the diff CSV for unpaid catalogues.
- `APP_URL=https://tasnivo.uz`: the return links after payment.
- Click: `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY`. Prepare and Complete URLs are
  `https://tasnivo.uz/api/payments/click`.
- Payme: `PAYME_MERCHANT_ID`, `PAYME_KEY`, endpoint `https://tasnivo.uz/api/payments/payme`.
- `PAYME_TEST_MODE`: unset or `false` in production. `true` (with `PAYME_TEST_KEY`) turns Payme off
  when `NODE_ENV=production`, unless `PAYME_TEST_ALLOW_PROD=1`; orders confirmed in test mode carry
  `testMode = true`.
- `NEXT_PUBLIC_ONLINE_PAYMENT=true` in the web build once a provider works.
- Migration `20261108000400_order_keep` must be deployed with the code.
- No Click or Payme credentials exist yet. Every provider case above runs against our own handlers
  with test secrets; no real or sandbox payment was made.

## Not done or not verified
- The plan tab and admin do not show `testMode` yet. The column and the audit payload carry it;
  S7 (billing history and the admin billing page) should display it.
- The tier rule is enforced on the server and explained in one sentence. The plan picker does not
  grey out cheaper tiers, and a refusal shows the 403 message under the pay buttons.
- The upgrade credit uses each tier's monthly list price, also for yearly plans (D2 as written). A
  yearly subscriber's days are valued at the monthly price, not at the discounted yearly one.
- Expired upload refusals are tested through the API for preview, commit and upload. The Didox sheet
  commit shares `uploadGate` with upload and has no separate test.
- The browser was not checked for the disabled buttons. They are typechecked server components using
  existing primitives.

## Questions for the owner
1. Should a downgrade bought by bank transfer keep `--force` converting the unused days at the price
   ratio, or should it start only after expiry?
2. Should the upgrade credit use the yearly price ratio for yearly subscribers?
3. Should an existing share link's client PDF also be locked when payment is required and the
   subscription has lapsed? The share page would then need its own locked state.
4. Full `npm run typecheck` and `npm run lint` should be re-run when the machine is quiet (S11).
