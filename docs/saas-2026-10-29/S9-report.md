# S9 — Value metrics and onboarding completion: report (30 Oct 2026)

Branch `feat/s9-value-metrics` (cut from `main` at `cf4c755`), worktree
`.claude/worktrees/agent-a1c2dc1e5dfe7151c`. Findings F10 (High) and F19 (Med; checklist and tour),
decision D8. Not pushed, not merged.

## What was checked in the code first

- F10 held: `dashboard.ts` returned open work only (totals, by type, changes, workload, pending).
- F19 held: the checklist ended at `review`; `twoFactor`/`telegram` were ordinary steps, so the page's
  `steps.some((s) => !s.done)` kept the checklist open until both were done; "hide" was the
  `mxik_onboarding` cookie (`onboarding-pref.ts`, `onboarding-toggle.tsx`); `visibleSteps` filtered by
  abilities only, so bank/didox/onec/products steps showed when their module was off.
  The "GET resumes audits" item was already fixed by S2 (`resumesOnRead`), not redone. The brief
  attributes it to S3; the plan (§4), the S2 report and the code say S2.
- Where the code differed from the brief: there is no "dashboard" or "settings" contracts module.
  The dashboard lives in `packages/contracts/src/modules/workspace.ts` and Settings in `account.ts`,
  so those were changed. The dashboard composition is `overview.ts` (`dashboardView`), which got the
  checklist state. The workspace page passes props to `completion.tsx`, so `workspace.tsx` got one
  prop, and `share-button.tsx` got an optional `size`.

## What was done

### 1. Value measures on the dashboard (F10, D8)

Domain: new `packages/domain/src/firm-results.ts` and `valueMetrics()` in `dashboard.ts`, part of
`dashboard()`. Everything is counted from the database over the clients the dashboard shows: not
archived, within the member's client scope, and narrowed by an admin's accountant filter. Every
audited (`ready`) version of each catalogue counts; uploads still waiting or failed do not.

| Measure | Formula |
|---|---|
| Rows checked | `catalog_item` rows of ready catalogues with `checkError IS NULL` |
| Rows not checked | rows with `checkError` (S3), shown in red under rows checked, never counted as checked |
| Issues found | findings with severity high/medium |
| Issues resolved | of those, `decision <> 'pending'` |
| Decisions | findings of any severity with `decision <> 'pending'`; "of which automatic" = `decisionSource` `dictionary_auto` or `carry_over` |
| Time saved | decisions × `Organization.minutesPerDecision` (default 3), shown in hours to one decimal, with the words "taxminiy, sozlama asosida: N qaror × M daqiqa" (ru: "примерно, по настройке: …") |
| Catalogues audited over time | ready catalogues per week (Monday start, Tashkent time, UTC+5), the last 12 weeks, by the catalogue's `createdAt`, the same moment the existing "audited at" columns use |

Contract: `GET /api/dashboard` answers `value` (totals, `minutesPerDecision`, `minutesSaved`,
`weeks[12]`, `clients` (at most 10, latest audit first), `clientsWithResults`).

New endpoint `GET /api/dashboard/results?format=xlsx|csv[&accountant=]` (role any, session). It
downloads the per-client table for every client the dashboard shows. Columns: client, audited
catalogues, rows checked, rows not checked, issues, resolved, decisions, last audit. Headers are in
the viewer's language, cells are formula-safe, and the CSV has a BOM. The accountant filter only
counts for an admin, and only for an accountant of the admin's own org. The file is not logged in
the audit log (see open questions).

UI blocks (signed-in UI, design-system primitives only: `Card`, `StatRow`, `Table`/`Th`/`Td`,
`ButtonLink`, tokens). They appear under the existing open-work blocks (KPI cards, work queue,
activity, side column), which are unchanged, and only once at least one catalogue is audited:
- **"Bajarilgan ish" / "Проделанная работа"** (card, full width): a `StatRow` of four measures.
  - Rows checked: "N ta tekshirilgan katalogda", plus a red line "N ta qator texnik xato tufayli
    tekshirilmadi" when rows failed. Links to /catalogs.
  - Issues found: a resolved/found progress bar and "N tasi hal qilingan".
  - Decisions: "shundan N tasi avtomatik (lugʻat, oldingi versiya)". Links to the activity log
    filtered to decisions.
  - Time saved: "2,1 soat" with the formula line. For an admin the tile links to the setting.
- **"Mijozlar boʻyicha natijalar" / "Результаты по клиентам"** (card, main column): a table with
  client (link), catalogues, rows checked, issues, resolved (green when all are resolved) and last
  audit, at most 10 rows. On the title line are "Excel (.xlsx)" (secondary button with a download
  icon) and "CSV" (ghost). The footer reads "Yana N ta mijoz yuklab olinadigan faylda" when there
  are more.
- **"Tekshirilgan kataloglar" / "Проверенные каталоги"** (card, side column): 12 columns on one
  scale. The current week is solid brand, earlier weeks are tinted brand, and each count is printed
  above its column. The first week's date is at the left and "shu hafta" at the right. Each column
  carries "dd.mm haftasi: N ta katalog, M ta qator" as screen-reader text and as a tooltip. An empty
  period shows "Oxirgi 12 haftada katalog tekshirilmagan."

### 2. Minutes per decision (D8)

- Schema: `Organization.minutesPerDecision Int @default(3)`. Migration
  `20261108000500_value_metrics` (with `User.onboardingHiddenAt`). Rollback note in
  `docs/accounting-2026-10-23/migrations.md`. Applied to the dev DB with `npx prisma migrate deploy`.
- `PUT /api/account/minutes-per-decision` `{ minutes }`: admin, `noDemo`. The contract body is an
  integer from 1 to 60 (400 otherwise), and `account-settings.setMinutesPerDecision` checks the same
  bounds again. `GET /api/account` answers `minutesPerDecision`.
- UI: Settings → Account, admins only, a new card **"Tejalgan vaqt hisobi"** under the dictionary
  card (`minutes-setting.tsx`). It has a one-sentence hint that this is an estimate, a numeric field
  "Bitta qarorni qoʻlda topish, daqiqa" and a "Saqlash" button. The field shows an inline error
  "1 dan 60 gacha butun son kiriting." and the toast "Daqiqalar saqlandi". A failure reuses the
  existing "Sozlama saqlanmadi" toast.

### 3. Checklist (F19)

- New step `export` after `review`: "Natijani yuklab oling yoki ulashing" / "Скачайте или отправьте
  результат". It is done when a `catalog.exported`, `catalog.pdf_exported`,
  `catalog.report_csv_exported` or `share.created` event names a catalogue in the member's scope,
  with the same scoping as the review step (deleted catalogues of those clients included). It leads
  to the newest audited catalogue in scope, whose completion block offers the file, the PDF and now
  the client link (`completion.tsx` shows `ShareButton` to writers). Without an audited catalogue it
  leads to `/catalogs`.
- `twoFactor` and `telegram` are `optional: true`. `checklistOpen(steps)` (pure) is open only while
  a required step is left. The API answers `checklist: { open, hidden }` and the page uses it.
  Progress ("3 / 5 bajarildi") counts required steps only. Optional items are listed under a small
  "Ixtiyoriy" / "Необязательно" heading, in the big first-run card and the small side card. The
  side card shows them only while one is undone.
- Hide: `User.onboardingHiddenAt`, written by `PUT /api/account/onboarding { hidden }` (any role; a
  demo is accepted and nothing is written). The close button saves it with one retry; "show again"
  clears it. The old cookie is **still read, never written**: hidden = DB flag OR old cookie, so
  nobody who hid the checklist sees it come back. "Show again" also deletes the cookie. The cookie
  read can be removed after its one-year life (November 2027); a comment in `onboarding-pref.ts`
  says so.

### 4. Tour (F19)

`visibleSteps(steps, abilities, modules?)` drops a step whose `href` belongs to a module that is
`HIDDEN` or `COMING_SOON`. It uses the same `modulesOfRoute`/`strictest` as the navigation, and a
`COMING_SOON` step is dropped too, because its section cannot be opened. `TourProvider` reads the
states from the existing `ModuleStatesProvider` context, so `app-frame.tsx` is unchanged.

## Files

- **Domain:** `firm-results.ts` (new), `dashboard.ts`, `onboarding.ts`, `account-settings.ts`,
  `overview.ts` (checklist state).
- **Domain tests:** `firm-results.test.ts` (new), `onboarding.test.ts`, `account-settings.test.ts`.
- **DB:** `schema.prisma` (two columns), migration `20261108000500_value_metrics/`.
- **Contracts:** `modules/workspace.ts` (`ONBOARDING_STEPS`, `ClientResult`, dashboard `value` and
  `checklist`, `dashboardResults`), `modules/account.ts` (`MINUTES_PER_DECISION`,
  `setMinutesPerDecision`, `setOnboardingHidden`, `get.minutesPerDecision`), `README.md`
  (regenerated checklist; W3 ticked for the three new operations).
- **API:** `workspace/workspace.controller.ts`, `account/account.controller.ts`.
- **API tests:** `test/e2e/value-metrics.test.ts` (new); counts in `test/unit/routes.test.ts`
  (63 → 65) and `test/e2e/workspace-docs.test.ts` (44 → 45); `test/e2e/account.test.ts` (the new
  field).
- **Web:**
  - `dashboard/`: `page.tsx`, `dashboard-data.ts`, `onboarding.tsx`, `onboarding-toggle.tsx`,
    `onboarding-pref.ts`, `value-summary.tsx`, `results-table.tsx` and `audits-chart.tsx` (the last
    three are new).
  - `settings/`: `account-tab.tsx`, `minutes-setting.tsx` (new).
  - `catalogs/[id]/`: `completion.tsx`, `workspace.tsx` (one prop), `share-button.tsx` (optional
    `size`).
  - `ui/tour/`: `tour-steps.ts`, `tour-context.tsx`, `tour.test.ts`.
- **i18n:** `firm.ts` (`firmX.value.*`, `onboarding.optional`, `onboarding.steps.export`) and
  `settings.ts` (`setX.account.minutes*`), uz and ru. The Uzbek copy uses ʻ/ʼ only.
- **Docs:** `accounting-2026-10-23/migrations.md`, this report.

Not touched: S7 files (billing, admin, plan banner and tab), S8 export/import/upload files, S10
test-matrix files.

## How it was tested

All runs were from the worktree root against the dev DB (127.0.0.1:54329, `&connection_limit=4`).

- `npx tsx --test packages/domain/src/firm-results.test.ts`: 8/8.
  - Pure tests: weeks start on Monday in Tashkent time; 12-week series; per-client sums and sort;
    the CSV is formula-safe and has a BOM.
  - DB tests use two clients, an archived client, another org and a scoped accountant. Admin totals:
    3 catalogues, 7 rows checked, 1 failed row, 6 issues, 4 resolved, 5 decisions, 2 automatic,
    4 min × 5 = 20 min. The scoped accountant sees only their client. The admin's accountant filter
    narrows the totals. The download lists exactly the dashboard's clients; a non-admin's accountant
    parameter is ignored; xlsx is produced.
- `npx tsx --test packages/domain/src/onboarding.test.ts`: 7/7.
  - The export step sits after review, its link is scoped, and only an event in scope ticks it.
  - The optional steps undone leave the checklist closed, and removing the delivery event reopens
    it.
  - Hide is per person; a demo's hide is not written.
  - The pure completion rule.
- `npx tsx --test packages/domain/src/account-settings.test.ts`: 3/3. Bounds 1–60; 0, 61, 2.5, -1,
  "5", null and NaN are refused without a write; the domain and contract bounds are equal.
- `npx tsx --test apps/web/src/ui/tour/tour.test.ts`: 17/17, two of them new. With bank `HIDDEN`
  and didox `COMING_SOON`, both steps are gone and the rest keep their order. With the audit module
  off, upload, catalogues, queue and dictionary go, and the steps without a section stay.
- `npx tsx --test apps/api/test/e2e/value-metrics.test.ts`: 3/3.
  - Download: 401 without a session. The admin's CSV has both clients with the right numbers and not
    the other org's. A scoped accountant and a scoped viewer each get only their client. Another
    org's admin passing our accountant id gets only their own clients. The admin's accountant filter
    narrows the file. xlsx is the default; `format=pdf` gets 400.
  - Minutes: an accountant and a viewer get 403 `forbidden`, a demo 403 `demo`; 0, 61 and 2.5 get
    400. The admin saves 7; `GET /api/account` and the dashboard then show 7 and 21 minutes (3
    decisions), and the scoped accountant's dashboard shows 7 minutes over their own client.
  - Checklist: `export` is required and `twoFactor` optional. Hiding for the admin does not hide it
    for the accountant; showing it again works; a bad body gets 400.
- Contracts, api-client and API unit tests: 135/135 after the route-count update.
- UI, checked in the Browser pane against `next dev` on 3059 and the API on 4059, with a seeded
  4-client firm (deleted afterwards):
  - Dashboard at 1440 px: the three new blocks, the numbers matching the API, "2,1 soat" and
    "taxminiy, sozlama asosida: 42 qaror × 3 daqiqa".
  - At 375 px: no horizontal page scroll (`scrollWidth` 375); the table scrolls inside its frame.
  - The checklist with the "Ixtiyoriy" group.
  - Settings: 75 shows the bounds error; saving 5 shows "Daqiqalar saqlandi" and the dashboard then
    reads "× 5 daqiqa".
  - Hiding the checklist survives a reload (DB, not cookie), and "Boshlash roʻyxati · 3 / 5
    bajarildi" brings it back.
  - The CSV link from the page downloads with the right file name.
  - A fully reviewed catalogue's completion block shows "Mijoz uchun havola".
  - The server-rendered HTML of /dashboard (fetched with curl) also has every block.
- `npm run typecheck`: exit 0. `npm run lint`: 0 errors, 1 pre-existing warning
  (`scripts/lib/xlsx.ts:131`, non-null assertion).
- `npm test` (full run, with three sibling sessions on the same Postgres): 2255 tests, 2191 pass,
  52 fail, 7 cancelled, 5 skipped. The Postgres container went into recovery mode during the run.
  Most failures are "database system is in recovery mode", "Connection terminated unexpectedly" or
  "Server has closed the connection", plus audit-wait timeouts that followed from them. Two
  failures were mine: the `GET /api/account` shape in `account.test.ts` and the operation count in
  `workspace-docs.test.ts`. Both were fixed. The other failing files were re-run one at a time
  (results below).

  Re-runs of every file that failed, one at a time with `npx tsx --test <file>`:
  - API e2e:
    - `account` 11/11 (after the fix), `notifications` 5/5, `public-api` 17/17, `workspace` 14/14.
    - `workspace-docs` 2/2 (after the count update).
    - `catalogs` 12/12, `imports` 5/5.
  - Domain:
    - `review-assignments` 16/16, `search` 13/13, `search-codes` 2/2.
    - `products/import` 11/11, `products/catalog` 7/7, `products/products` 21/21.
    - `dictionary-review` 6/6, `matching-provenance` 5/5, `schedule-assignee` 2/2.
    - `didox/didox-real` 2/2.
    - `audit-retry-access` 1/1, `audit-jobs` 10/10.
  - **`didox/service.test.ts` 14/15**: pre-existing on this branch's base and already fixed on
    `main` (see below).
  - `plan-caps-race.test.ts`, the known flaky race test on this machine, passed in the full run this
    time.

## Pre-existing problems met on this base (both already fixed on `main`)

`main` moved while this task ran: `7979b3a` landed after the branch point `cf4c755`. It fixes the
two problems below, so a merge of this branch picks the fixes up. This branch was not rebased.

- **Every signed-in page crashed in the browser after hydration** under `next dev`: "Element type
  is invalid. Received a promise that resolves to: Context". The cause was `ModuleStatesProvider =
  Ctx.Provider` exported from a client module and rendered by `(app)/layout.tsx`. To take the
  screenshots I wrapped it in a component locally, then reverted that; `7979b3a` makes the same fix
  on `main`. The server-rendered HTML was fine throughout.
- `packages/domain/src/didox/service.test.ts` ("an ended trial closes the upload, the sheet commit
  and the sync…") fails on `cf4c755`: it expects the old "Срок подписки истёк." text. `7979b3a`
  fixes it on `main`.

## What remains or is unverified

- The Playwright suite was not run. The browser checks above were manual, on `next dev`.
- Performance: the value query counts the rows and findings of every audited version in scope
  (lateral counts per catalogue, the same style as `client-stats.ts`). It is fine on the dev data.
  It was not measured on a firm with hundreds of 60k-row versions (no heavy runs here).
- The download is not written to the audit log. A new action would need an activity group and
  labels in both languages (`activity.ts`, outside this task).
- The demo export cap (`demoExportRefused`) is not applied to the results file, which holds only
  summary numbers.

## Open questions for the owner

1. Should "time saved" count automatic decisions (dictionary auto-accept and carry-over) as it does
   now? They are shown as "of which automatic" next to the decisions.
2. Every audited version counts, so a client re-uploaded monthly adds its rows every month. That is
   work done, but say if you would rather count only the latest version per client.
3. Should the results download be logged in the audit log and counted against the demo download cap?
4. A `COMING_SOON` module's tour step is dropped, like a `HIDDEN` one. Keep it if the tour should
   advertise coming modules.
