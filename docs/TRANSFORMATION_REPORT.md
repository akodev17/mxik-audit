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
- **Stuck navigations, root cause and fix:** in the production build, navigations inside one
  section (`/clients` → `/clients?filter=…`, `/clients` ↔ `/clients/<id>`, filter and pager
  links on the queue and activity log) could leave the address and page unchanged forever.
  Measured before the fix: 5–6 of 6 such navigations hung right after a page load, and 4–5 of
  40 random navigations.

  How the hang happened (Next.js 15.5.23 with its bundled React 19.2 canary):
  1. In production, `<Link>` prefetches dynamic pages only down to `(app)/loading.tsx`. A
     navigation inside one section keeps that boundary's state key (the query is not part of
     it, and the section segment does not change). React therefore renders the new page as a
     transition under a Suspense boundary that is already showing content.
  2. The page arrives as streamed server component (Flight) chunks. React reads one that is
     still loading, suspends, and yields to the browser. If the chunk arrives during that
     yield, React finds it resolved but not yet unpacked, and gives up on the render.
  3. Under a boundary that already shows content, React first decides to hold the transition,
     and only then subscribes to the chunk (`throwException`: `renderDidSuspendDelayIfPossible`,
     then `attachPingListener`). The chunk is already there, so it calls back immediately,
     inside the render. In that state `pingSuspendedRoot` ignores the call. The render ends
     with the transition marked suspended, and nothing is left to wake it. The address and
     page stay put until some unrelated state update makes React retry.
  4. Cross-section navigations never hung: they mount a new loading boundary, and React
     commits its fallback and retries instead of holding the transition.

  Evidence: React DOM was instrumented to record a ping that arrives inside the render in
  that state, and the fix was switched off. 5 of 16 in-section navigations hung, and every
  one of them had a dropped ping; of the 11 that committed, 10 had none. Each hung
  navigation committed about 26 ms after an unrelated update (opening the command palette).
  With the fix and the same instrumentation: 0 of 24 hung. React still dropped a ping in 2
  of them, and both committed in 26 ms anyway, because the render no longer ends in the held
  state that only that ping could undo. The instrumentation was removed afterwards.

  The fix: `src/ui/shell/route-boundary.tsx` wraps the page in a Suspense boundary keyed by
  its address, so every navigation takes the cross-section path. The key leaves out what a
  page rewrites in its own address with `history.replaceState`: `/upload` is keyed by path
  only (the wizard's `?catalog=`), and `?row=` (workspace) and `?tg=` (settings) are
  ignored. A unit test lists every such call site, so a new one has to be added to the key
  rules first.

  The trade-off: an in-section navigation now shows the skeleton briefly and remounts the
  page, so its local state (open menus, typed text) starts over, as it did with the old
  document loads. Focus moves to `#main` when the focused link went away with the page. The
  two "start over" links in the upload wizard point at the address the wizard already has,
  so they now load as documents.

  After the fix: 0 hangs in all repro runs; navigations commit in about 26 ms; the e2e suite
  passes with the watchdog's fallback switched off (`E2E_NO_NAV_FALLBACK=1`).

  The same-route document loads were removed. The watchdog remains only as a safety net:
  - It records the address a navigation starts from. Any change of address (the target, a
    redirect, a later navigation, Back) counts as committed.
  - If the address has not changed after 8 s, it logs `[navigation] … did not commit`, then
    makes an unrelated state update, which retries a held transition.
  - If the address still has not changed 1.5 s later, it loads the target as a document.
    `window.__mxikNavigationFallback = false` turns this last step off; the e2e fixture
    sets it under `E2E_NO_NAV_FALLBACK=1` and fails any test that logs the warning.

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
- **Sessions** store no IP or location.
- **Held transitions outside navigation:** the same React behaviour can hold any transition
  that renders streamed server data under a boundary already showing content, without
  changing the address: `router.refresh()` after a mutation, or a server action that
  revalidates the page. RouteBoundary does not cover these, and neither does the watchdog
  (it watches navigations only). None was seen in e2e. Mutations are usually followed by a
  toast or another state update, which would retry the transition.
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
2. When upgrading Next.js or React, re-run `E2E_NO_NAV_FALLBACK=1 npm run test:e2e`. If the
   bundled React no longer drops a ping that arrives during the render (`pingSuspendedRoot`),
   `RouteBoundary` and the watchdog can go.
3. Audit throughput: batch the per-row queries, measure with a real embedder and reranker.
4. Store finding reasons as code plus parameters, so the API and exports can localize them.
5. CSP nonces through middleware; per-session IP and approximate location.
6. Native-speaker review of the Russian copy, and legal review of the help center and offer
   pages.

## 8. End-to-end results (final build)
`E2E_NO_NAV_FALLBACK=1 npm run test:e2e` against `next start`: 25 of 25 pass, with no navigation watchdog warning. Covered: sign-in, client creation (two in a row), upload, column
mapping correction, audit completion, type filters, drawer, accept/reject/pick, attribution in the database, activity log,
export contents, re-upload with version diff, scoped accountant and other-org isolation, viewer restrictions, error on an
invalid file, a 3,000-row catalogue (audit 863 s; first rows 2.4 s cold, then 0.9 s and 0.9 s; j/k median 8.6 ms, p95 14.9 ms),
empty states, query-only navigation, list-to-record-and-back navigation and keyboard-only review.
