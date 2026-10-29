# SaaS hardening programme: plan and Opus briefs (29 Oct 2026)

Planning agent: one Fable session (this document). Implementation: Opus sessions, one per task,
each in its own worktree cut from `main` = `e3c709f`. Four read-only audit agents (security and
tenant isolation; billing and entitlements; audit-workflow reliability; onboarding, dictionary,
team and reports) produced the findings below; every finding was verified in the code before it
was written down. The brief given to a prompt in the user's request ("turn the existing product
into a real, valuable SaaS") was matched against the code: most of it already exists (see §1), so
this programme fixes what is wrong or missing rather than rebuilding anything.

Companion docs the implementer must read: `docs/HANDOFF_2026-10-23.md` (architecture, dev
commands, gotchas), `docs/CONTINUE_2026-10-23.md` (what is verified and what is not),
`docs/DESIGN_SYSTEM.md` (tokens and primitives for the signed-in UI), `apps/api/README.md`
("How auth works", "Adding a module").

---

## 1. What already works (verified, do not rebuild)

- Multi-tenancy: org per firm, clients per org, roles admin / accountant / viewer, `ClientAssignment`
  scoping, `Route()` → `SessionGuard` → `AccessGuard` on every session route, `catalogScope` /
  `findingScope` / `canSeeClient` (`packages/domain/src/access.ts`), ~48 cross-org cases in
  `backend.authz.test.ts`. Team: invites, seat cap under lock, last-admin protection, removal ends
  sessions and keys.
- Billing: plans in `packages/domain/src/billing/plans.ts`, trial 14 days, row allowance recorded
  atomically in `UsageLedger` at catalogue commit, client/seat/API caps under per-org locks, gated
  features refused server-side, Click and Payme callbacks with constant-time signature checks,
  manual activation `npm run billing:activate`. Expired plan: uploads, new clients, invites, API
  blocked; reading never blocked.
- Audit workflow: 20 MB / 60,000-row limits, atomic claim on commit (no double start), remembered
  column map, server-side previews resumable from `/upload?catalog=`, watermark + heartbeat crash
  resume, `ready` written only after all findings persist, exports refuse non-ready catalogues,
  keyset-paged virtualised workspace with filters, bulk bar, reasons rebuilt per locale from facts.
- Dictionary: written on accept, undo restores, auto-accept opt-in (admin), needs ≥1 human
  confirmation, barcode beats name. Dictionary page with search, filters, edit, delete, logging.
- Reports: internal and client PDF (uz/ru, plan-dependent branding), share links (hashed,
  revocable, expiring), dashboard and `/admin` metrics from real queries (no hard-coded numbers).
- Onboarding: email code at sign-up, Google/Telegram sign-in, guided tour persisted per user,
  data-driven getting-started checklist, drafts kept 48 h.
- Security: scrypt + dummy hash, TOTP with replay refusal, hashed reset tokens claimed once, session
  rotation on sign-in, DB-backed rate limits, global CSRF guard, API keys hashed, cron bearer, admin
  routes 404 for non-platform-admins, no secrets in tracked files.

## 2. Findings that drive the programme (by severity)

| # | Sev | Area | Finding | Where |
|---|---|---|---|---|
| F1 | Critical | Dictionary | Name key drops size/percent/grade/model (`sortedKey` only), so "Sut 3.2% 1l" and "Sut 2.5% 1l", "Cement M400"/"M500", "Труба 15х2,5"/"20х2,5" share one entry; auto-accept spreads one code to every variant. `attrsKey` exists but is unused. | `packages/core/src/match/dictionary.ts:40`, `normalize/noise.ts:134` |
| F2 | High | Security | Email-bound invite accept sets `emailVerifiedAt` without the mailbox owner proving anything; Google sign-in then auto-links the real owner into the attacker's org. | `packages/domain/src/invites.ts:121`, `security/google.ts:181-186` |
| F3 | High | Billing | Tier taken from the newest paid order while every payment just adds months: one cheap month of the top tier upgrades a whole cheap year (and the reverse downgrades a paid year). | `plan.ts:46-72`, `billing/orders.ts:36-41`, `tiers.test.ts:63` |
| F4 | High | Billing | `markPaid` reads status then updates by id: concurrent Click/Payme confirmations extend twice; provider transaction state written outside the transaction. | `billing/orders.ts:31-34`, `click.ts:86`, `payme.ts:100-118` |
| F5 | High | Audit | Empty `restricted_code` table (or a DB error, swallowed by `.catch(() => [])`) means no RESTRICTED finding ever, with no banner, health item or reason. | `audit-runner.ts:130` |
| F6 | High | Audit | One uncaught row error (pg timeout, provider error) fails the whole audit; BullMQ retries never apply because `runAudit` never throws; `retryAudit` deletes all findings and restarts from row 0. | `audit-runner.ts:395`, `audit-jobs.ts:98-111,184` |
| F7 | High | Audit | Rows with an empty name are dropped at commit and absent from the corrected Excel/1C export, with no marker or count. | `catalog-import.ts:154`, `export-rows.ts:38` |
| F8 | High | Team | A person who already has an account can never accept an invite (`emailTaken`, told to sign in, lands in their own org; no leave/move; admin not warned). | `invites.ts:108`, `team-forms.ts:50` |
| F9 | High | Dictionary | Rejecting a dictionary suggestion or reporting it wrong changes nothing in the dictionary; the entry stays auto-accept eligible. | `decisions.ts:98`, `suggestion-feedback.ts:26` |
| F10 | High | Reports | Dashboard shows open work only: no products checked, issues resolved, audits over time, time saved. | `dashboard.ts:11-35` |
| F11 | Med | Security | `onlyThis` last-client check read outside the transaction: two concurrent removals leave an accountant with zero assignments = access to all clients. | `client-lifecycle.ts:193-205` |
| F12 | Med | Security | Accountants can hard-delete catalogues (cascade of findings and decisions), route lacks `noDemo`. | `contracts/modules/catalogs.ts:299` |
| F13 | Med | Security | Spreadsheet parse loads the whole workbook (100 MB inflate cap, 16k-wide rows) before `MAX_ROWS`; no per-org upload concurrency; some public bodies unbounded inside the API. | `spreadsheet.ts:92-123`, `zip-guard.ts:9`, `http/request-body.ts` |
| F14 | Med | Billing | Products import, Didox upload/commit, 1C counterparty import check only demo, not `uploadsOpen()`; PDF/CSV/diff exports not under `BILLING_REQUIRED_FOR_EXPORT`; trial "no export" not enforced by default. | `products/import.ts:129`, `didox/service.ts:179`, `onec/counterparties.ts:234`, `catalog-exports.ts:84-190` |
| F15 | Med | Billing | No expiry reminders, no grace, no subscription "ending soon" banner, no billing history/receipts, no admin billing view; org purge cascades orders and payment transactions. | `daily.ts:21`, `plan-banner.tsx:23`, `schema.prisma` Order |
| F16 | Med | Audit | Retry not atomic; heartbeat stops before post-row phase and during the commit rebuild (stale sweep at 120 s); resumed audit loses earlier degradation counters; carried-over decisions show carry-over date and no source. | `audit-jobs.ts:66-72,179`, `audit-runner.ts:97,413`, `versions.ts:113` |
| F17 | Med | Dictionary | Reused suggestion shows only "confirmed N times" (no who/when/source entry); any unscoped accountant can edit the whole dictionary and an edit becomes auto-accept eligible at once; scoped accountants teach the org-wide dictionary; firm-wide last-write-wins across clients. | `row-signals.ts:32`, `dictionary.ts:50,198`, `decisions.ts:147` |
| F18 | Med | Team | Removing a member silently deletes their review assignments; a review can be marked done with pending findings and `doneBy`/`doneNote` are not shown. | `team-members.ts:91`, `review-assignments.ts:155`, `review-control.tsx:96` |
| F19 | Med | Onboarding | Checklist ends at "review" (no export/share step, 2FA/Telegram keep it open, hide saved only in a cookie); tour shows modules that are switched off; `GET` catalog/progress resume audits (Q15). | `onboarding.ts:48`, `completion.tsx:22`, `tour-steps.ts:37`, `catalog-pages.ts:82` |
| F20 | Low | Various | Module-flag guard case-sensitive vs Express; 1C host check DNS-rebind; scoped user may delete another client's bank rule; invite join unlimited + reveals emails; Telegram login CSRF; 2FA enable keeps other sessions; no absolute session age; viewers see every email; duplicate-upload leak across clients; Payme test mode on prod DB; Click malformed Complete → 500; month arithmetic; abandoned orders; same file charged twice; no per-row error report; mapping edits lost on diagnose; restriction source not shown; public API Uzbek-only reason; non-streaming export. | see task briefs |

Test holes (all areas): no generic cross-org matrix over the registry; no products e2e; no Click
Complete / Payme Perform / concurrent markPaid tests; no row-level provider-throw, concurrent retry,
stale sweep in post phase, empty restricted table, export-count-equals-upload, auto-accept on
variants, carry-over provenance tests; no invite-accept verification / Google-link tests.

## 3. Decisions and assumptions (change the brief if the owner decides otherwise)

| # | Question | Assumption used |
|---|---|---|
| D1 | Catalogue delete policy (F12) | Delete becomes `admin` + `noDemo`. Accountants keep upload, decide, export. (Soft delete deferred.) |
| D2 | Tier mixing (F3) | No schema change: checkout refuses a *different* tier while a subscription is active, except an **upgrade**, which starts the new tier now and credits the unused days as extra days of the new tier at the price ratio (`remainingDays × oldMonthly / newMonthly`, floored). Downgrade only after expiry. The owner can replace this with proration later; the exploit is closed either way. |
| D3 | Export gate (F14) | Keep the env flag, but when `BILLING_REQUIRED_FOR_EXPORT=true` it also covers the client PDF, report CSV (chosen-code column) and diff CSV; DEPLOY.md says production sets it. Not enforced in dev so e2e flows stay runnable. |
| D4 | Products / Didox / 1C under the plan (F14) | They call `uploadsOpen()` (expired trial blocks new uploads) but do **not** count against `rowsPerMonth`. Counting is a pricing decision for the owner. |
| D5 | Existing account joins a firm (F8) | A signed-in user may accept an invite and move when their current org has **no other users and no catalogues** (the throwaway org is closed); otherwise the invite page explains and offers to contact the admin. Google is offered on the invite page. |
| D6 | Dictionary key (F1) | Key becomes `sortedKey|attrsKey|unit`. Existing name entries whose normalised name had attributes are marked `needsReconfirm` (confirmations reset to 0, so auto-accept ignores them until a human confirms again); barcode entries untouched. |
| D7 | Row failures (F6) | Each row is retried 3× with backoff inside the runner; a row that still fails is recorded as a technical failure on the item (`checkError` text) and the audit continues; the catalogue becomes `ready` with a `rows_failed` degradation count and a banner, and the workspace can filter those rows. `retryAudit` re-runs only failed rows. |
| D8 | Time saved (F10) | `Organization.minutesPerDecision` (default 3, editable in Settings → Account), shown next to the number with the words "taxminiy, sozlama asosida". |
| D9 | Reminders (F15) | Daily job e-mails org admins at 7, 3, 1 days and on the day, for trial and subscription, deduplicated through `Notification` kind + org + day. No grace period (owner's call). |
| D10 | Merge rule | Each wave merges into `main` after typecheck, lint, `npm test` green in the worktree; the owner authorised merge+push per wave. The main checkout is in use by another orchestration session: merge only when `git status` there shows no merge in progress. |

## 4. Tasks, waves, files

Size: S ≈ 1–2 h, M ≈ half a day, L ≈ a day of one Opus session. Tasks in one wave touch disjoint
files (i18n spreads `packages/i18n/src/i18n-parts/*` and `app.module.ts` are the known conflict
points; each task adds its own keys and resolves on merge).

### Wave 1 (parallel, 6 sessions)

| ID | Title | Findings | Size | Files owned |
|---|---|---|---|---|
| S1 | Identity and invites | F2, F8, F20 (invite rate limit, Telegram login state, 2FA sessions, absolute session age) | M–L | `packages/domain/src/invites.ts`, `team-forms.ts`, `security/google.ts`, `security/rate-limit.ts`, `security/two-factor.ts`, `security/session-store.ts`, `security/session.ts`, `telegram/login-callbacks.ts`, `packages/contracts/src/modules/team.ts`, `apps/api/src/team/*`, `apps/api/src/auth/*`, `apps/web/src/app/invite/**`, schema (`User.verifiedVia`) + migration, `apps/api/test/e2e/{team,security,telegram}.test.ts` |
| S2 | Scope, roles, team and review integrity | F11, F12, F18, F19 (GET resume gate), F20 (bank rule scope, viewer email leak, duplicate leak) | M | `packages/domain/src/client-lifecycle.ts`, `catalogs.ts`, `catalog-pages.ts`, `activity-view.ts`, `client-page.ts`, `team-members.ts`, `review-assignments.ts`, `bank/service.ts`, `bank/store.ts`, `didox/service.ts` (duplicate message only), `packages/contracts/src/modules/catalogs.ts`, `apps/web/src/app/(app)/team/**`, `(app)/catalogs/[id]/review-control.tsx`, the catalogue delete button, `backend.authz.test.ts`, `apps/web/e2e/review-assignment.e2e.ts` |
| S3 | Audit lifecycle hardening | F5, F6, F16, F20 (restriction source) | L | `packages/domain/src/audit-jobs.ts`, `audit-runner.ts`, `audit-heartbeat.ts`, `pipeline-meta.ts`, `work-pool.ts`, `catalog-import.ts` (heartbeat during rebuild only), schema (`CatalogItem.checkError`) + migration, `apps/web/src/lib/catalogs/report.ts`, `classifier-health.ts`, `(app)/catalogs/[id]/workspace-header.tsx`, `reason-text.ts`, workspace filter for failed rows, `audit-jobs.test.ts`, `apps/worker/src/worker.test.ts` |
| S4 | Dictionary safety and provenance | F1, F9, F17, F16 (carry-over provenance) | M–L | `packages/core/src/match/dictionary.ts`, `pipeline.ts`, `packages/domain/src/dictionary.ts`, `dictionary-accept.ts`, `dictionary-ops.ts`, `decisions.ts`, `decide-many.ts`, `suggestion-feedback.ts`, `row-signals.ts`, `versions.ts`, schema (`FirmMapping.needsReconfirm`, `attrsKey`; `Finding.carriedFromCatalogId`, `originalDecidedAt`) + migration + re-key, `(app)/catalogs/[id]/decision-info.tsx`, `drawer-body.tsx`, `(app)/dictionary/**`, tests |
| S5 | Billing integrity | F3, F4, F14, F20 (Payme test mode, Click NaN, month arithmetic, abandoned orders, paid twice, Order cascade) | M | `packages/domain/src/billing/{orders,click,payme,config}.ts`, `plan.ts`, `billing/overview.ts`, `catalog-exports.ts`, `catalog-pages.ts` (export gate lines only, coordinate with S2 on merge), `products/import.ts`, `didox/service.ts` (uploadsOpen line only), `onec/counterparties.ts`, schema (Order `onDelete`) + migration, `security/account.ts` (purge keeps orders), `tests/web-parity/pricing.test.ts` comment, `apps/api/test/e2e/billing.test.ts`, new `billing/payments-race.test.ts` |
| S6 | Input and DoS limits | F13, F20 (module-flag case, 1C DNS pinning) | M | `packages/domain/src/spreadsheet.ts` (parse side only; `buildExport` is W2), `security/zip-guard.ts`, `apps/api/src/http/request-body.ts`, `apps/api/src/http/multipart.ts`, `packages/contracts/src/feature-modules.ts`, `packages/domain/src/onec/connection.ts`, tests |

### Wave 2 (after wave 1 is merged; parallel, 4 sessions)

| ID | Title | Findings | Size | Files owned |
|---|---|---|---|---|
| S7 | Billing lifecycle and visibility | F15 | M | `packages/domain/src/daily.ts`, new `billing/expiry-reminders.ts`, `packages/contracts/src/modules/{billing,admin}.ts`, `apps/api/src/billing/*`, `apps/api/src/admin/*`, `apps/web/src/ui/shell/plan-banner.tsx`, `(app)/settings/plan-tab.tsx`, new `(app)/admin/billing/*`, new `scripts/billing-refund.ts`, mail copy |
| S8 | Export completeness and import error report | F7, F20 (per-row error CSV, mapping saved on diagnose, same-file hash warning, streaming export) | M | `packages/domain/src/export-rows.ts`, `catalog-exports.ts`, `spreadsheet.ts` (`buildExport`), `import-diagnostics.ts`, `catalog-upload.ts`, `catalog-import.ts` (keep skipped originals), `(app)/upload/diagnostics-panel.tsx`, export tests |
| S9 | Value metrics and onboarding completion | F10, F19 (checklist, tour filter), per-client summary export | M | `packages/domain/src/dashboard.ts`, new `firm-results.ts`, `onboarding.ts`, `account-settings.ts`, schema (`Organization.minutesPerDecision`, `User.onboardingHiddenAt`) + migration, `(app)/dashboard/**`, `(app)/catalogs/[id]/completion.tsx`, `ui/tour/tour-context.tsx`, `(app)/settings/account-tab.tsx` |
| S10 | Isolation and payment test matrix | test holes | M | new `apps/api/test/e2e/isolation-matrix.test.ts`, new `apps/api/test/e2e/products.test.ts`, extra cases in `billing.test.ts` (Click Complete, Payme Perform/Cancel/double Perform), fixes for anything the matrix finds (report, do not silence) |

### Wave 3 (one session)

| ID | Title | Size |
|---|---|---|
| S11 | Programme QA: `prisma migrate deploy` on an empty DB, full `npm test`, API/web/worker builds, Playwright e2e against a production build, 60k-row smoke (overnight only, see memory rule), final report `docs/saas-2026-10-29/FINAL_REPORT.md` | M |

Deferred (named, not scheduled): per-row `matchOutcome` evidence for clean rows; per-client
dictionary entries; share-link passwords and a firm-wide link list; Russian landing and legal pages
(B15); production deploy on tasnivo.uz (W4b, needs VPS); Payme/Click sandbox smoke (needs keys).

## 5. Common rules (the first lines of every brief)

```
You are implementing one task of docs/SAAS_HARDENING_PLAN_2026-10-29.md (branch feat/saas-hardening-plan
until merged; read it from the main checkout's sibling worktree .claude/worktrees/saas-plan if it is not
on your branch yet) in the Tasnivo monorepo (Next.js 15 web + NestJS 11 API + BullMQ worker + Prisma).
Rules:
- Inspect before editing. Read docs/HANDOFF_2026-10-23.md §2–3, apps/api/README.md "How auth works" and
  "Adding a module", and `git log --oneline -20 -- <your files>`. Verify every claim of the plan against
  the code; if the code differs, follow the code and say so in your report.
- Minimal, focused changes. Do not refactor, rename or "tidy" outside your task. Do not touch files
  owned by another task in the same wave (plan §4); if you must, keep it to the lines named there.
- Keep files small and single-purpose. Comments: few, single-line, English, explaining why.
- Do not invent features, numbers or claims. No fake buttons, no UI-only enforcement, no hard-coded
  business numbers. Server-side checks first, UI second.
- Uzbek copy uses U+02BB (ʻ) / U+02BC (ʼ) apostrophes, never ASCII quotes. Russian mirrors the Uzbek
  shape (the i18n types enforce it). Add your keys to the existing i18n parts; do not reorder spreads.
- Signed-in UI: only design-system tokens and primitives (docs/DESIGN_SYSTEM.md); no hard-coded colours,
  no raw z-index, no `text-sm`-style sizes.
- Schema changes: a Prisma migration under packages/db/prisma/migrations/<yyyymmddhhmmss>_<name>/ with a
  rollback note in docs/accounting-2026-10-23/migrations.md; never `prisma migrate dev`, never data loss
  (new columns nullable or defaulted; backfills in the migration or a script named in the report).
- Contracts: every new or changed endpoint lives in packages/contracts/src/modules/*.ts (zod) and the
  registry/OpenAPI tests must pass; the web calls it through @tasnivo/api-client only.
- Worktree setup: you are in your own worktree. `cp <main checkout>/.env .env`, `npm ci`,
  `npx prisma generate`; append `&connection_limit=4` to DATABASE_URL; free ports (`API_PORT=40xx npm run
  dev:api`, `npx next dev apps/web -p 30xx`). Never run `npm run build` beside a running `next dev` on
  the same checkout. Do not restart Docker or WSL; if the DB is unreachable, report it. No 60k-row perf
  runs. Commit early with clear messages on your branch; never push, never merge, never touch `main`.
- Before you finish: `npm run typecheck && npm run lint && npm test` from your worktree root (tests
  need the dev DB on 54329). Fix what your change broke; report pre-existing failures without fixing
  them (name the file and the error).
- Final report: write docs/saas-2026-10-29/<task-id>-report.md (files changed, what was done, how it
  was tested with commands and results, what remains or is unverified, open questions for the owner)
  and paste the same in chat.
```

## 6. Briefs

The brief of each task is the text sent to its Opus session (kept in the session, not duplicated
here; the task rows in §4 and the decisions in §3 are the contract). Each brief names the
findings, the decision rows it works under, the files it owns, the tests it must add, and the
definition of done. Wave 2 and 3 briefs are written when wave 1 has merged, from the wave-1 reports.

## 7. Definition of done for the programme

- All Critical/High findings closed with tests; Medium closed or explicitly deferred with a reason.
- `npm run typecheck && npm run lint && npm test` green on `main`; API, web and worker builds green;
  `prisma migrate deploy` applies on an empty database; the Playwright suite passes against a
  production build (failures that predate the programme named).
- A customer can: register, verify, create or join an org (including with an existing account),
  upload, map, preview, audit (with row failures surfaced and retried), review with provenance, reuse
  dictionary decisions safely, export a complete file, share within permissions, see plan, usage,
  expiry and billing history, and be refused correctly when the plan does not allow something.
- Final report `docs/saas-2026-10-29/FINAL_REPORT.md`: features implemented, bugs and security issues
  fixed, tests and builds run with results, env/migrations/external configuration required,
  remaining blockers and the next highest-value improvement.
