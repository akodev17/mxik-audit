# MXIK Audit: product transformation report (branch `transform-2026`)

Date: 20.10.2026. Base: `main` at 429ac94. All work is on `transform-2026`; nothing is merged or pushed.
Scale: 617 files changed (+49k / −5.6k lines), 4 additive migrations.

## 1. What was inspected

A parallel audit of eight areas: shell and design system, catalogue workspace, dashboard and
clients, import and export, matching pipeline, security and tenancy, settings and billing, and
localization with accessibility. Every critical or high finding was checked by a second
reviewer before being acted on. A test baseline was taken (338 tests, 1 known data-drift
failure; lint had 2 config errors), and the running app was reviewed visually at desktop and
mobile widths.

Main problems found:
- **Tenancy:** notifications, purchase actions, the dashboard activity feed and code requests
  ignored client assignments.
- **Security:**
  - a linked Telegram chat could sign in as an admin;
  - password sign-in had no rate limit;
  - closed accounts kept API keys and share links working.
- **Data integrity:**
  - decision carry-over paired different SKUs;
  - undo did not revert dictionary learning;
  - cp1251 and `;` CSVs (including the app's own 1C export) could not be read;
  - previews were never cleaned up;
  - raw-cell retention was retroactive.
- **Honesty:** raw match scores were shown as "confidence %" and "Aniq" (certain); the real
  reason for purchase and privilege findings was hidden.
- **UX:** no mobile shell (the workspace grid had 0 px height on phones), clipped decision
  column, no confirmation on catalogue-wide bulk accept, dead controls for viewers.

## 2. What was implemented

### Foundation
- Migrations:
  - `20261020100000_product_foundation`: per-user notification reads, audit provenance
    (`snapshotId`, `pipelineMeta`, `importMeta`, `decisionSource`), dictionary confirmations,
    client archive, platform-admin flag, Telegram login binding, email token purpose,
    `auth_attempt`, `rawRetentionSince`, list metadata, API idempotency.
  - `20261021100000_replay_unique`.
  - `20261022100000_search_prefix_indexes`.
- Per-area dictionaries (`src/lib/i18n-parts/*`), Tashkent-time formatting
  (`src/lib/format.ts`), Russian plurals (`src/lib/plural.ts`).

### Design system (`docs/DESIGN_SYSTEM.md`)
- Semantic tokens: surfaces, text, lines, brand, and status families with ink colours at
  ≥ 4.5:1.
- Scales for type, radius, shadow, z-index, motion and control height.
- A complete dark theme with a system/light/dark switch.
- Base CSS moved into `@layer base`.
- Primitives: Dialog, ConfirmDialog, Popover and Menu (with collision placement), Select,
  Checkbox, Textarea, Progress, Stat, Segmented, Breadcrumbs, IconButton, Tooltip, CopyField,
  Spinner and Kbd.
- Upgraded Button, Badge, Toast, Drawer, Table, Tabs, EmptyState and Page.

### Shell
- Responsive navigation: off-canvas below md, grouped sidebar, cookie-backed collapse, skip
  link.
- Theme switch, `<html lang>` that follows the locale, a scoped active client and switcher.
- Per-user, client-scoped notifications with a bell preview.
- Command palette (Ctrl+K and `/`) with scoped search across clients, catalogues, products
  and classifier codes.
- Localized 404 and error pages.

### Audit workspace
- Honest labels (Yuqori / Oʻrtacha / Past moslik; a score, not a probability), the finding
  reason at the top of the drawer, type-specific actions, an AI-analysis disclosure, notes on
  degraded pipeline runs, and the classifier version the audit used.
- Safe decisions:
  - typed conflict responses when two users decide at once;
  - one code per row, enforced with row locks;
  - undo restores the dictionary;
  - bulk dry-run with a confirmation dialog;
  - automatic decisions are attributed and can be undone;
  - decision source and decider shown.
- Review workflow:
  - numeric "riskiest first" sort;
  - flag, decision and source filters;
  - `?row=` deep links;
  - a completion state;
  - grouped decisions as one event;
  - column visibility and a resizable drawer.
- Keyboard: matched on `e.code`, so it works on Cyrillic layouts; ignored while typing; help
  overlay with `?`; ARIA grid.
- Mobile: card layout and a full-screen sheet.

### Firm screens
- Operational dashboard: every number links to the filtered view; next step; onboarding
  checklist; workload per accountant.
- New cross-client review queue (`/queue`).
- Clients list with search, filters, assignees and freshness.
- Client detail with a summary, rename, archive, and a guarded delete (it cannot widen a
  member's access).
- Honest activity log: catalogue deletion keeps the append-only events, and automatic runs
  are titled separately.

### Import and export
- Sniffing parser: magic bytes, zip-bomb guard, UTF-8 or cp1251, delimiter, header row, real
  truncation flag.
- Guided wizard with server-side diagnostics, mapping remembered by header names per client,
  resume or discard, and an atomic commit that cannot run twice.
- Previews replaced, capped and swept after 48 h.
- Exports: offered only for ready catalogues; downloads report errors; formula injection
  neutralized; a 1C `.xlsx` option; the effective code per row is the latest decision; PDF
  wording and scope line made honest.
- Purchases: client-scope checks, zero-code guard, resumable mapping.

### Settings, billing and API
- Settings as tabs: account, security, team, plan, integrations, data.
- Team: explicit "all clients / selected clients" access; protection for the last admin.
  Removing a member ends their sessions and revokes their API keys and Telegram links.
- Honest plan tab: the price comes from `PLAN_FIRM_PRICE` and is never invented; pay buttons
  only for admins.
- Public API: rate-limit headers on every response, `Idempotency-Key`, `GET /api/v1/catalogs`,
  an OpenAPI spec checked against the handlers, and a docs page.
- Help center: locale-aware, a link back to the app, three new articles.

### Security
- Telegram sign-in only through a personal binding the user creates, with a replay guard.
- Rate limits stored in the database: per email, per IP (rightmost proxy hop) and per
  two-factor attempt.
- Password change and reset, resend of the confirmation email, invites that verify the
  address.
- Closed accounts cut off API keys, share links, the bot and reminders.
- CSP and security headers; recovery codes hashed with HMAC; the platform admin needs the
  database flag; library-level role checks (share links, invites, upload discard, audit
  retry, Telegram linking).

### Matching
- Margin-step ranking bug fixed: the runner-up was promoted with unpenalised confidence.
- Absolute full-text normalization, stored AI veto, GTIN check-digit and restricted-prefix
  validation.
- Pipeline metadata saved per audit; a cache key that respects the candidate set.
- Dictionary confirmations count only individual decisions.
- Eval before and after is recorded in `docs/scoring.md`.

### Reliability
- **Navigation watchdog:** a router transition that never commits (seen intermittently in
  the production build) falls back to a full page load after 5 s, and same-route links load
  as documents. Root cause not found; see §7.

## 3. Tests and checks actually run (final state)
- `npx tsc --noEmit`: clean.
- `npm run lint`: 0 errors, 1 pre-existing warning (`scripts/lib/xlsx.ts:131`).
- `npm test`: 943 tests, 942 pass. The one failure is the known classifier data drift
  (`src/lib/sample-report.test.ts`: code 02201001001401003 is absent from the local
  classifier). It includes 45 backend authorization tests (`src/lib/backend.authz.test.ts`)
  for viewer, scoped-accountant and other-org access across every library.
- `npm run build`: passes.
- `npm run test:e2e` (Playwright library + node:test against `next start`, with its own
  throwaway org): see §8.
- Workspace performance (e2e, 3,000-row catalogue, 1,990 open findings): first rows in about
  0.9 s; j/k median 9.7 ms, p95 16.8 ms; 18 DOM rows (virtualized).
- Visual QA: Playwright screenshots at 1440 light uz, 1280 dark ru and 375 light uz on every
  signed-in and public screen. 101 findings, 93 fixed in the same round, the rest closed in a
  follow-up pass.

## 4. Known issues and not implemented
- **Payments:** Click and Payme flows were not tested against live providers. The firm price
  is unset by default, so the plan is shown as not for sale.
- **Telegram:** the bot and login widget were not tested with a live bot; tests use locally
  signed data.
- **SMTP:** not configured or tested live. Without it, invite links show in the app and
  password reset is an operator script (`npm run password:set`).
- **Audit throughput:** 3.8 rows/s on this machine (hashing vectors, no reranker), so a
  3,000-row catalogue takes about 13 minutes. The matching pipeline was not optimized for
  throughput.
- **Finding reasons** are stored as Uzbek prose. The drawer localizes them by type, but the
  API returns the stored Uzbek text (documented as human-readable; `type`, `severity` and
  `suggestedMxik` are the stable fields).
- **CSP** keeps `'unsafe-inline'` for scripts; nonces are not implemented.
- **Private pages answer HTTP 200 when not found:** the (app) segment streams behind
  `loading.tsx`, so these pages return 200 with the not-found UI and `noindex`. No
  out-of-scope data is rendered (checked by e2e).
- **Navigation hang:** the intermittent stuck transition is contained by the watchdog. Its
  root cause in the production build is not identified.
- **Sessions** store no IP or location.
- **Google Sheets add-on** is source only and not published.
- **Review needed:** the Russian copy, the help-center texts and the legal pages (which are
  Uzbek only) need native and legal review.

## 5. External services and credentials still required
`SMTP_URL`, `MAIL_FROM`, `APP_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, the
Click/Payme credentials, `PLAN_FIRM_PRICE`, plan and API limits (`PLAN_*`, `API_*`),
`ANTHROPIC_API_KEY` (reranker), an embeddings provider, `ADMIN_EMAILS` plus the
`platformAdmin` flag set by SQL, and `CRON_SECRET`. All are documented in `.env.example` and
`DEPLOY.md`.

## 6. Migrations and environment changes
Run `npx prisma migrate deploy`. The new migrations are additive, apart from one cleanup:
`20261021100000_replay_unique` deletes duplicate `tg_replay` rows from `auth_attempt` before
adding its unique index.

Behaviour changes after deploy:
- Cookies issued before server-side sessions existed are signed out.
- `/admin` stays closed until `platformAdmin` is set.
- Existing orgs get `rawRetentionSince = deploy time`, so retention is never retroactive.

Use `127.0.0.1` rather than `localhost` in `DATABASE_URL` on Windows: each connection to
`localhost` costs about 2 s.

## 7. Recommended next priorities
1. Configure and test SMTP, Telegram and one payment provider end to end on staging; set
   `PLAN_FIRM_PRICE`.
2. Find the root cause of the intermittent stuck router transition in the production build
   (React and Next.js versions, Suspense boundaries in the shell), then remove the watchdog.
3. Audit throughput: batch the per-row queries, measure with a real embedder and reranker.
4. Store finding reasons as code plus parameters, so the API and exports can localize them.
5. CSP nonces through middleware; per-session IP and approximate location.
6. Native-speaker review of the Russian copy, and legal review of the help center and offer
   pages.

## 8. End-to-end results (final build)
See the session summary for the final run: 24 tests covering sign-in, client creation,
upload, mapping, audit, filters, drawer, decisions, attribution, activity log, export, version
diff, tenant isolation, viewer restrictions, errors, the 3,000-row scale test, empty states
and keyboard review.
