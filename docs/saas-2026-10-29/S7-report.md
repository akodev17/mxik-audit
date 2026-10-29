# S7: Billing lifecycle and visibility (report)

Branch `feat/s7-billing-lifecycle`, cut from `main` @ `cf4c755`. Worktree:
`.claude/worktrees/agent-a82f4e74138056c4c`. Finding F15, decision D9. Nothing was pushed or merged.

## Checking the plan against the code
- **F15 as stated.** It holds: there were no reminders, the banner covered only the trial (at 5 days or fewer), and
  there was no billing history, receipt or admin billing view. S5 had already fixed the "org purge
  cascades orders" part (`Order.orgId` is `SetNull`).
- **Order status.** `Order.status` is the Prisma enum `OrderStatus` (`created | paid | cancelled`), not
  free text. Adding `refunded` therefore needs a migration (below).
- **Notification kinds.** `Notification.kind` is free text, so the new kind `billing.expiring` needs no schema
  change. Deduplication uses the existing unique `(orgId, dedupeKey)` through `notify()`.
- **Banner roles.** `plan-banner.tsx` has no role check today: every member sees it, viewers included. That
  is unchanged.
- **Platform admin.** `/admin` is guarded by `OptionalSessionGuard` + `PlatformAdminGuard`, which answer 404 to
  anyone else. The new admin endpoint uses the same `AdminRoute`.
- **Mail.** Mails go out through `jobs().enqueueMail` (the password-reset path): SMTP when configured, the
  development outbox otherwise, and nothing in production without SMTP. The reminders use this path too.

## What was done

### 1. Expiry reminders (`packages/domain/src/billing/expiry-reminders.ts`)
- **Hook.** `daily.ts` gained one line, `expiryReminders: await attempt(() => sendExpiryReminders(now))`, plus
  its import.
- **Which orgs.** The job takes customer orgs whose `trialEndsAt` or `subscriptionUntil` falls between today's
  local midnight and 7 days later.
  - Skipped: `demo`, `demo_template`, `internal`, and closed (`deletedAt`) orgs.
  - The end that counts is the **later** of the trial end and the paid end (`accessEnd`). This is how "already
    paid beyond the date" is skipped. A subscription that ends before a trial still running is skipped too.
- **When.** Reminders go out when the days left, counted in Tashkent calendar days (`daysUntil`), are 7, 3, 1
  or 0.
- **Notice.** Each reminder makes one notice through `notify()`:
  - kind `billing.expiring`, link `/settings?tab=plan`, text in uz and ru;
  - `external: false`, so it is not sent to Telegram (not asked for);
  - `dedupeKey: billing.expiring:<trial|subscription>:<local end date>:<days>`.

  If the key already exists for the org, nothing is sent, so a re-run or a second worker sends nothing twice.
  A renewal moves the end date, so its reminders start again.
- **Mail.** Each admin of the org gets one e-mail in the admin's own language. Reserved placeholder addresses
  (`*.invalid`, `*.local`: Telegram and demo accounts) are skipped. One org's failure is logged and counted
  without stopping the others.
- **Copy.** In `i18n-parts/settings.ts` → `setX.expiry`: "Sinov muddati 3 kundan keyin tugaydi / ertaga /
  bugun", "Obuna …", with Russian mirrored. The body says that at the end uploads, new clients and invites
  close and the data stays (no grace period, D9).

### 2. "Ending soon" banner
- **`plan.ts`.** `planStatus().daysLeft` is now also set while the subscription runs (`state === 'firm'`), from
  `subscriptionUntil`, with the same rounded-up formula as the trial. Every existing reader checks
  `state === 'trial'` first, so nothing else changes.
- **`plan-banner.tsx`.** The banner shows the trial at 7 days or fewer (it was 5) and the subscription at 7 or
  fewer (`setX.plan.endingSoon`), with the existing link to the plan tab. The expired and limit states are
  unchanged.

### 3. Billing history and receipts
- **Domain.** `billing/history.ts` holds `orderHistory` (the org's orders, newest first, at most 200) and
  `orderReceipt` (one paid or refunded order of the org). The period end comes from the order's `billing.paid`
  audit event (`until`).
- **Contracts.** `billing.orders` is `GET /api/billing/orders` and `billing.receipt` is
  `GET /api/billing/orders/{orderId}`. Both use `role: 'admin'`, so an accountant or viewer gets 403. The
  receipt answers 404 for another org's order or an order that was never paid.
- **Web.** `settings/billing-history.tsx`, shown in `plan-tab.tsx` under the plan card, for admins only.
  - Columns: date, plan, period (months, "… gacha"), amount, provider, status chip, a test-payment badge, and a
    receipt link.
  - The receipt page `settings/receipt/[orderId]/page.tsx` shows the order number, payer (`orgName`), paid
    time, plan, period, provider and amount. It has notes for test mode and for a refund, and uses
    `PrintButton` (the shell is left out of the printout). There is no PDF library.

### 4. Admin billing view
- **Domain.** `billing/admin-billing.ts` `billingOverview()` returns every customer org with:
  - closed flag, state, tier, trial end and paid end;
  - last paid order (with `testMode`);
  - paid orders of the last 30 days, as count and sum.

  Test-mode orders are counted apart and stay out of the sums. Refunded orders are left out of both. The page
  also shows the same totals across all orgs.
- **API and web.** `admin.billing` is `GET /api/admin/billing` (platformAdmin, 404 to anyone else). The page is
  `(app)/admin/billing/page.tsx`, with a button on `/admin`.

### 5. Refunds (`billing/refunds.ts` and `scripts/billing-refund.ts`, `npm run billing:refund`)
- **Migration.** `20261108000600_billing_lifecycle` runs `ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS
  'refunded'`. The rollback (rebuilding the type) is in `docs/accounting-2026-10-23/migrations.md`.
- **What `refundOrder` does.** It takes the same per-org advisory lock as `markPaid`, then claims
  `paid → refunded` once (`updateMany where status = 'paid'`).
  - For a subscription it shortens `subscriptionUntil` by `--days N`, or without `--days` by the months the
    order bought (`addMonths(until, -months)`). It never goes before now, and an end already past is left
    alone.
  - It writes a `billing.refunded` audit event with the plan, amount, provider, test mode, days, note, and the
    period end before and after.
  - Errors: an unknown order is `not_found`; one that is open, cancelled or already refunded is `not_paid`; a
    bad `--days` is `bad_days`.
  - An order whose org was purged is marked refunded without an audit event (that table needs an org).
- **Script.** It prints what changed and says that no money moved. Click and Payme are not called: there is no
  refund API here, so the money is returned by hand.
- **Refund-related edits outside S7's files** (the minimum needed):
  - `orders.ts` `activeSubscription` and `plan.ts` `lastSubscription` now take the tier from the latest
    **paid or refunded** subscription order. Without this, refunding part of an org's only order left its
    remaining days on the top tier (`'firm'`, the fallback for "no order").

    Every period change converts the remaining days into the newest order's tier. So the days a refund leaves
    are always that order's tier, and a full refund of an upgrade leaves exactly the credited days.
  - `click.ts` Prepare answers "cancelled" (-9) for a refunded order, as for a cancelled one. Payme already
    refuses any order that is not `created`.
  - `activity.ts` and `i18n-app(.ts|-ru.ts)` put `billing.refunded` in the activity log's team group at org
    level, with uz and ru labels. `activity-actions.test.ts` requires every written action to be grouped.

### 6. Docs
- `DEPLOY.md` §7b covers the billing history, `/admin/billing` and the refund script (money moves by hand; the
  migration is needed).
- `DEPLOY.md` §7e covers the reminder mails: thresholds, who gets them, dedup, the SMTP behaviour, no grace
  period, and no catch-up for a missed day.
- `apps/api/README.md` route table; `packages/contracts/README.md` regenerated.

## Files changed
- **Schema:** `packages/db/prisma/schema.prisma` (`OrderStatus.refunded`) and
  `packages/db/prisma/migrations/20261108000600_billing_lifecycle/migration.sql`.
- **Domain:**
  - new: `billing/expiry-reminders.ts`, `billing/refunds.ts`, `billing/history.ts`, `billing/admin-billing.ts`;
  - changed: `daily.ts`, `plan.ts`, `billing/orders.ts` (one where clause), `billing/click.ts` (one condition),
    `activity.ts` (two lists).
- **Contracts:** `modules/billing.ts` (`OrderRow`, `orders`, `receipt`), `modules/admin.ts` (`OrgBilling`,
  `billing`), `README.md`.
- **API:** `billing/billing.controller.ts`, `billing/billing.service.ts`, `admin/admin.controller.ts`, `README.md`.
- **Web:**
  - changed: `ui/shell/plan-banner.tsx`, `(app)/settings/plan-tab.tsx`, `(app)/admin/page.tsx` (one button);
  - new: `(app)/settings/billing-history.tsx`, `(app)/settings/receipt/[orderId]/page.tsx`,
    `(app)/admin/billing/page.tsx`.
- **i18n:**
  - `i18n-parts/settings.ts`: `setX.plan.endingSoon`, `setX.billing.history`, `setX.billing.receipt`,
    `setX.expiry`, `setX.adminBilling`;
  - `i18n-app.ts` and `i18n-app-ru.ts`: one activity label each.
- **Scripts:** new `scripts/billing-refund.ts`; `package.json` (`billing:refund`).
- **Docs:** `DEPLOY.md`, `docs/accounting-2026-10-23/migrations.md`, this report.
- **Tests (new):**
  - `packages/domain/src/billing/expiry-reminders.test.ts`;
  - `packages/domain/src/billing/refunds.test.ts`;
  - `apps/api/test/e2e/billing-history.test.ts`;
  - `apps/api/test/e2e/admin-billing.test.ts`.

## How it was tested
Dev DB 127.0.0.1:54329 with `connection_limit=4`. Single files were run with
`node node_modules/tsx/dist/cli.mjs --test <file>`.

- **Migration.** `npx prisma migrate deploy` applied `20261108000600_billing_lifecycle` on the shared dev DB,
  then `npx prisma generate`.
- **`expiry-reminders.test.ts`: 6/6.** `now` is set in March 2031, so no other org of the shared DB is in the
  window.
  - Pure checks: Tashkent day counting (00:30 local is the next day) and `accessEnd`.
  - Orgs at 7, 3 and 1 days and on the day each get exactly one notice and one mail. The mail has a uz or ru
    subject per admin, the end date in the body and the plan link.
  - These get nothing:
    - a 5-day trial;
    - a trial with payment past it, and a payment ending before the trial;
    - demo, internal and closed orgs;
    - a second admin with a `telegram.invalid` address, and an accountant.
  - Re-running the same day and 6 hours later sends nothing.
  - The next threshold sends again. Days in between and the day after the end send nothing.
  - A renewal moves the end and starts a new 7-day reminder.
  - Telegram is never called.
- **`refunds.test.ts`: 7/7.**
  - `shortenedUntil` cases.
  - A renewal refunded: its month comes off, the tier stays, and the exact audit payload is written.
  - `--days 10`: the only order keeps its tier, not `firm`.
  - A full refund of a new period ends it now (`expired`).
  - A catalogue refund locks the catalogue again and leaves the period alone.
  - Unknown, unpaid and bad-days requests are refused with no change. Two concurrent refunds give one refund
    and one audit event.
  - An orphan order is refunded without an audit event.
- **`billing-history.test.ts`: 4/4.**
  - The list is newest first and fits the contract, with `testMode`, a `periodEnd` equal to the audit event's
    `until`, and the open and refunded statuses.
  - Another org's orders are never listed, and its receipts are 404 both ways.
  - A receipt works for a paid or refunded order; an unpaid or unknown one is 404.
  - An accountant or viewer gets 403 `forbidden`; no session gets 401.
- **`admin-billing.test.ts`: 2/2.**
  - 404 without a session, for an org admin, for an accountant, and for a flagged user missing from
    `ADMIN_EMAILS`.
  - A platform admin gets the org's state, tier, ends, last paid order (test-mode flagged) and `last30 =
    { count: 1, sum: 390000, test: 1 }`. That count leaves out a refunded order and a 40-day-old one. Demo orgs
    are not listed.
- **Refund script by hand.** On a scratch org with two bank-recorded months:
  - `npm run billing:refund -- <id> --note "manual check"` printed `subscriptionUntil` before 2026-12-29 and
    after 2026-11-29, with status `refunded`;
  - a second run printed the `not_paid` refusal;
  - the usage message and the unknown-order path also work.

  The scratch org was deleted afterwards.
- **`npm run typecheck`: exit 0** (all workspaces and the root).
- **`npm run lint`: exit 0.** One warning that predates this branch: `scripts/lib/xlsx.ts:131`
  (no-non-null-assertion).
- **`npm test` (full): 2338 tests, 2318 pass, 15 fail, 5 skipped.**
  - **`activity-actions.test.ts`: caused by this branch, now fixed.** `billing.refunded` was not grouped. It is
    fixed in `d9dc365`, and `activity-actions` and `activity` now pass 10/10.
  - **Load timeouts (13 failures).** On the shared DB under load: `apps/api/test/e2e/catalogs.test.ts` (8,
    "timed out waiting for the audit"), `imports.test.ts` (cheque check timed out), `audit-jobs.test.ts` and
    `audit-retry-access.test.ts` ("catalogue still analyzing"), and `demo.test.ts` (2, `startDemoSession`
    returned null). Re-run one file at a time, all pass: demo 4/4, audit-jobs 10/10, audit-retry-access 1/1,
    imports 5/5, catalogs 12/12.
  - **Not caused by this branch: `packages/domain/src/didox/service.test.ts:141`.** "an ended trial closes the upload, the
    sheet commit and the sync". It expects `'Срок подписки истёк.'` but gets `ta.msg.gate.expired`. Main's
    `cf4c755` ("one plan message for Didox and 1C refusals (D4)") changed the message and did not update this
    test. It fails the same way when run alone. Not fixed (not S7's file).
  - **`plan-caps-race.test.ts`.** The known failure on this machine did not occur in this run.
- **Browser.** The API was started on 4057 and the web on 3057 (`next dev`). Signing in worked, but every
  `(app)` page showed Next's dev overlay before rendering: "Element type is invalid. Received a promise that
  resolves to: Context", at `(app)/layout.tsx:17` `ModuleStatesProvider`. That is
  `ui/shell/module-states.tsx` (`export const ModuleStatesProvider = Ctx.Provider` from a `'use client'`
  module). This branch does not touch it.

  So the banner, history card, receipt and admin page were **not seen in a browser**. They are typechecked,
  linted, and build on primitives already used elsewhere (`Card`, `Table`, `StatusChip`, `Badge`, `Fact`,
  `Stat`, `PrintButton`, `Notice`).

## Not done or not verified
- **Browser check.** The four UI pieces were not checked in a browser; see the dev-overlay error above. It
  probably affects every `(app)` page under `next dev` in this checkout. A production build and the Playwright
  run are S11's.
- **Missed days.** A day the daily job does not run is not caught up: a 3-day reminder missed on its day is not
  sent the day after. Owner question 1.
- **Lost mail.** If the mail queue fails after the notice was stored, that threshold's mail is lost. The notice
  stays, and the failure is logged and counted as `failed`.
- **Banner and mail day counts can differ by one.** The banner counts days rounded up from now (as the trial
  always did), while reminders count Tashkent calendar days. A subscription ending tomorrow at 14:00, seen at
  10:00, shows "2 kun qoldi" in the banner while the mail says "ertaga".
- **Refund shares.** The refund share is the order's months (or `--days`). For an upgrade, a full refund leaves
  the credited days on the upgraded tier, which is consistent with how the credit was computed (see §5). The
  money is not pro-rated by the script: the operator decides the amount returned.
- **Paging.** The admin page lists every customer org with no paging, and the history shows at most 200 orders.
- **Receipt contents.** The receipt carries no seller requisites (INN, address, bank). None exist in the code,
  and inventing them was out of scope. Owner question 3.

## Questions for the owner
1. Should a reminder missed because the job did not run be sent the next day (for example, "3 days" on day 2)?
2. Should expiry reminders also go to the org's Telegram chats? The notice has `external: false` now.
3. Should the receipt carry Tasnivo's legal requisites (company name, INN, address)? If so, where should they
   come from (env or a config file)?
4. Should refunded orders appear in the admin page's 30-day figures, for example as a negative line, instead of
   being left out?
5. The dev overlay error in `module-states.tsx` (`Ctx.Provider` exported from a client module) blocks every
   signed-in page under `next dev` here. Should S11 (or a small fix) export a wrapper component instead?
