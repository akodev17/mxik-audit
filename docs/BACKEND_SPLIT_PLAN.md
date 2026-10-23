# Backend split: Next.js monolith → NestJS API + worker + thin Next.js web

Status: plan, 22 Oct 2026. Owner decision: the backend is the product's core and must be a
separate service. This document is the single source for every session that works on it.

## 1. Decision

**NestJS** (on Express) for the API and the worker. Not plain Express, because:

- The codebase already has ~20k lines of domain services in `src/lib` grouped by area
  (security, billing, api, telegram, pdf, review, imports…). Nest modules + DI map onto
  those areas one to one, so the move is mechanical instead of a redesign.
- Three auth schemes exist today (session cookie, `mxk_` API keys, `CRON_SECRET`, plus
  Click/Payme/Telegram signatures). Nest guards express that per route; in Express it is
  hand-rolled middleware per router.
- `@nestjs/swagger` replaces the hand-built `src/lib/api/openapi.ts` and documents the
  first-party API too. Zod stays (we reuse the existing schemas through a `ZodValidationPipe`).
- `@nestjs/bullmq` + `@nestjs/schedule` give a real job queue and scheduler. Today audits
  run fire-and-forget inside the web process with an in-memory `running` Set; that is the
  one architectural bug the split must fix.

What stays: PostgreSQL + pgvector, Prisma (46 models, 45 migrations — unchanged), the
matching engine in `src/core` (pure, no Next imports), the Playwright e2e suite, the
Next.js frontend (as a thin client with SSR), iron-session's seal format and
`SESSION_SECRET` (TOTP secrets and recovery codes are derived from it; rotating it breaks
every user's 2FA).

## 2. What the inventory found (facts the plan rests on)

| Area | Size | Notes |
|---|---|---|
| `src/lib` | 20.3k LOC prod, 9.4k test | domain services; **12 files** import Next/React (`session.ts`, `locale.ts`, `security/sign-in.ts`, `api/respond.ts`, `security/redirect.ts`, `demo-limits.ts`, `catalog-page.ts`, `workspace-redirect.ts`, `plan.ts`, `demo.ts`, `locale-client.tsx`, `help-mdx.tsx`); 0 `revalidatePath` |
| `src/core` | 5.3k prod, 3.7k test | pure; raw `pg` Pool only in `match/store.ts`, `position-store.ts`, `rerank-cache-pg.ts`, `vector-readiness.ts` |
| `src/app/actions` | 26 files, **96 server actions** | 17 take `FormData`; 61 `revalidatePath`, 15 `redirect`; 11 are reads |
| `src/app/api` + 3 others | **24 route handlers** | 9 cookie-auth downloads/exports, 4 public API v1, 2 cron, 2 payment callbacks, telegram webhook, health, share PDF, verify, sign-out, upload progress |
| pages | 19 app pages + public | 21 server files call `db.*` directly (34 sites); 152 `'use client'` files; 61 client files import actions; 38 `router.refresh()` |
| tests | 161 unit files (55 need the DB), 10 e2e | `node --test` via tsx; e2e writes fixtures through Prisma |
| in-process state that breaks across processes | `audit-jobs.ts` and `docs.ts` `running` Sets, `api/limits.ts` rate map, lead-guard window, `MAX_LIVE_DEMOS`, classifier status file in `./data` | |
| heavy runtime | ONNX e5-small fp32 (470 MB) rebuilt per audit (`embeddingProviderFromEnv()` has no singleton), pdfkit (font path from cwd), exceljs | |
| i18n in backend | `Finding.reason` stored as Uzbek text; notifications/Telegram/mail/PDF render strings server-side from `i18n-app*` + `i18n-parts` | shared i18n package needed |

## 3. Target architecture

```
tasnivo.uz ──► caddy (HTTPS, one container)
                 ├── /api/*            → api    (NestJS, port 4000)
                 └── everything else   → web    (Next.js, port 3000, no DB access)
api ──► postgres (prisma + pg pool), redis (BullMQ)
worker (NestJS standalone) ──► same DB/redis: audit, doc-check, mail, telegram delivery,
                               scheduled jobs (purge, classifier update, daily), stale-audit resume
bot (optional, long polling) ──► enqueues audits, same image as worker
backup ──► nightly pg_dump
```

Repository layout (npm workspaces; one `package.json` per workspace, root scripts fan out):

```
apps/web        Next.js: src/app (pages, components), src/ui, src/components. Imports only
                @tasnivo/contracts, @tasnivo/api-client, @tasnivo/i18n. ESLint forbids
                @tasnivo/domain, @tasnivo/db, @tasnivo/core here.
apps/api        NestJS HTTP. One Nest module per domain area; controllers are thin and call
                @tasnivo/domain services. Swagger at /api/docs.
apps/worker     NestJS standalone: BullMQ processors + @nestjs/schedule. Same image as api.
packages/db     prisma/schema.prisma, migrations, generated client, PrismaService factory.
packages/core   former src/core (unchanged code).
packages/domain former src/lib minus the 12 Next-coupled files, minus i18n. Services take an
                explicit `actor`/`locale` instead of reading cookies.
packages/i18n   i18n.ts, i18n-ru.ts, i18n-app*.ts, i18n-parts/*. Used by web, api, worker.
packages/contracts  zod request/response schemas + TS types for every endpoint; the OpenAPI
                document is generated from these (nestjs-zod).
packages/api-client  typed fetch client generated/handwritten over contracts; used by web
                (browser and SSR, cookie forwarded on the server).
infra/          Caddyfile, docker-compose.yml, Dockerfiles, DEPLOY.md.
```

### 3.1 Auth in the API

- Cookie `mxik_audit_session`, sealed with iron-session's `sealData`/`unsealData` (framework-
  free API) and the same `SESSION_SECRET`; same fields (userId, orgId, email, demo, clientId,
  sid, pending 2FA, tgBind). `SessionGuard` reproduces `currentUser()`: unseal → `loadAccess`
  (role, clientIds, org kind/expiry) → `recordAccepted(sid)` (revoked/idle checks, lastSeen refresh).
- `ApiKeyGuard` for `/api/v1/*` (`mxk_` tokens, SHA-256 hash lookup, org active, creator still admin).
- `CronGuard` (`CRON_SECRET`, timing-safe), `TelegramWebhookGuard`, Click/Payme signature checks
  stay inside their controllers as today.
- CSRF: cookie is `SameSite=Lax`; every mutating first-party endpoint additionally requires
  header `X-Requested-With: tasnivo` and an `Origin` matching `NEXT_PUBLIC_SITE_URL`.
- Rate limits: DB-backed ones (`auth_attempt`) move as-is; the in-memory API rate limit and
  the demo/lead windows move to Redis (`@nestjs/throttler` with a Redis store, or a tiny
  `INCR`/`EXPIRE` helper).
- Locale: `mxik_locale` cookie read by a `LocaleInterceptor`; services get `locale` as an argument.

### 3.2 Jobs

BullMQ queues: `audit` (one job per catalogue, jobId = catalogId → no duplicates across
instances), `doc-check`, `mail`, `telegram`, `classifier-update` (single-concurrency, keeps the
Postgres advisory lock), `daily`. The worker keeps the heartbeat columns so the existing
progress endpoint and `resumeStaleAudits` keep working; resume runs on worker boot and from
the scheduler, never from a page render. One embedding provider singleton per worker process.

### 3.3 Web

- Pages stay server components for SSR but fetch through `@tasnivo/api-client` with the
  request cookie forwarded. No `@/lib/db`, no server actions.
- Mutations: React Query (`@tanstack/react-query`) mutations + query invalidation replace
  `useTransition` + `router.refresh()`. `useActionState` forms become plain forms posting to
  the API client.
- Uploads: `FormData` to `/api/catalogs/preview` etc.; progress polling unchanged in shape.
- Downloads: same URLs under `/api/...`, served by the API (Content-Disposition kept).

### 3.4 First-party endpoint map (from the 96 actions + 24 handlers)

| Nest module | Endpoints (first-party, cookie auth unless noted) |
|---|---|
| auth | POST sign-in, sign-up, sign-out, 2fa/submit, 2fa/start, 2fa/finish, 2fa/off, recovery-codes, password/forgot, password/reset, password/change, confirmation/resend, GET verify/:token, GET/POST telegram login + bind, sessions list/end/end-others, GET me |
| account | branding, retention, close, reopen, export (xlsx), locale, theme, sidebar, telegram link/unlink, api-keys CRUD |
| clients | CRUD, archive/restore, accountants, active client switch, schedule, activity, stats |
| catalogs | preview (multipart), diagnose, commit, discard, retry, delete, list, progress, summary, versions/diff, exports (xlsx, 1c, csv, pdf, diff-csv), share links, review assignment |
| workspace | rows (paged), row detail, decide, decide-group, split, accept-all-above, preview-sure, undo, bulk dry-run/apply/undo, comments, views, lookup codes, new-code request, wrong-suggestion feedback, name-from-barcode |
| dictionary | list, accept, update, delete, auto-accept setting |
| imports | purchases upload/apply/remove/activity, docs upload/apply/restart/remove, templates |
| team | members, invites (create/resend/revoke/join), roles |
| reminders | schedule, tasks |
| notifications + search | list, preview, mark read, command-palette search |
| billing | checkout start, Click + Payme callbacks (signature auth), plan status, usage |
| demo + lead | request demo, open demo link, lead form (public, rate-limited) |
| public-api (v1) | check, catalogs list/upload, report, openapi.json — contract unchanged (OpenAPI 3.0.3, version 1.1.0) |
| admin | metrics csv, traction, pipeline status (platform admin) |
| share | GET /r/:token data, /r/:token/pdf (token auth) |
| cron | daily, classifier-update (CRON_SECRET; these only enqueue) |
| health | /api/health |

## 4. Work plan (waves; each bullet is one Opus session in its own worktree)

Sessions in the same wave do not touch the same files. Each wave merges to `main` before the
next starts. Every session: typecheck + lint + unit tests green, commit on its branch, report
what it could not verify.

### Wave 0 — foundation (single session, blocks everything)
**W0 Monorepo and package extraction.** npm workspaces; move `src/core` → `packages/core`,
`prisma` → `packages/db`, i18n files → `packages/i18n`, `src/lib` → `packages/domain`
(keeping the 12 Next-coupled files in `apps/web/src/lib` as thin adapters that call domain);
`src/app`, `src/ui`, `src/components` → `apps/web`. Rewrite imports (`@/lib/*` →
`@tasnivo/domain/*` etc.), tsconfig project references, test runner walks all packages, scripts
in `scripts/` keep working, Dockerfile builds the workspace. Behaviour unchanged: the Next app
still imports domain directly for now. Done = 1263 tests green, `next build` green, e2e
review-flow green against the dev server.

### Wave 1 — services skeletons (parallel after W0)
- **W1a API skeleton** (`apps/api`): Nest app, config via zod env, `PrismaService`, Swagger,
  error envelope compatible with `api/contract.ts`, `SessionGuard` (iron-session unseal, loadAccess,
  recordAccepted), `ApiKeyGuard`, `CronGuard`, `LocaleInterceptor`, CSRF check, request logging,
  `/api/health`, `/api/auth/me`, `/api/auth/sign-in`, `/api/auth/sign-out`. Supertest tests.
- **W1b Worker skeleton** (`apps/worker`): Nest standalone, Redis + BullMQ, queues listed in 3.2,
  `audit` processor calling domain `run()` with heartbeat, resume-stale on boot, scheduler jobs
  (purge 03:15, classifier 04:00, daily 06:15 UTC+5) replacing `scripts/scheduler.mjs`,
  embedding provider singleton, graceful shutdown. Domain change: `startAudit` enqueues when
  `AUDIT_QUEUE=bullmq`, else runs inline (keeps tests and dev fast).
- **W1c Contracts + client** (`packages/contracts`, `packages/api-client`): zod schemas for
  every endpoint in 3.4 derived from the action signatures and route handlers; typed client
  with cookie forwarding for SSR; OpenAPI generation wired (`nestjs-zod`).
- **W1d Infra**: `infra/docker-compose.yml` (caddy, web, api, worker, bot, db, redis, backup),
  Caddyfile with automatic HTTPS for `tasnivo.uz`, per-service Dockerfiles (api/worker share one),
  healthchecks that match what each container serves, `DEPLOY.md` rewritten, `.env.example`
  split by service.

### Wave 2 — API modules (parallel after W1a + W1c)
- **W2a auth + account + team** — module folders `auth/`, `account/`, `team/`; domain: strip
  `cookies()`/`headers()`/`redirect()` from `security/*`, `invites`, `signup` (actor + ip + ua as args).
- **W2b catalogs + imports + share + exports** — `catalogs/`, `imports/`, `share/`; multipart via
  `@nestjs/platform-express` + multer memory storage with the 20 MB cap; streaming exports.
- **W2c workspace + dictionary + reminders + notifications + search** — `workspace/`, `dictionary/`,
  `reminders/`, `notifications/`.
- **W2d clients + billing + demo + lead + admin + cron + public-api v1** — `clients/`, `billing/`,
  `demo/`, `admin/`, `cron/`, `public-api/` (parity test: generated OpenAPI == current contract
  for v1 paths; `routes.test.ts` rewritten with supertest).

### Wave 3 — web rewiring (parallel after the matching W2 module)
- **W3a auth/account/team/settings pages and forms** → api-client + React Query; remove those actions.
- **W3b upload wizard, catalogs list, catalog header/exports, diff/report pages.**
- **W3c workspace (use-decisions, drawer, bulk, comments, views, dictionary, queue, dashboard).**
- **W3d clients, purchases, imports, reminders, notifications, shell (palette, bell, client switch),
  demo, landing lead form, admin.**
Each W3 session deletes the actions/route handlers it replaced, removes `router.refresh()` in
its area, and adds the ESLint restriction for its files.

### Wave 4 — cutover (sequential)
- **W4a** Delete `src/app/actions`, `src/app/api` (except Next metadata routes), `instrumentation.ts`
  audit resume, `serverActions.bodySizeLimit`; ESLint rule repo-wide; e2e suite against the Caddy
  stack; perf check (`perf:nav`, scale e2e); docs updated.
- **W4b** Production deploy on tasnivo.uz per the new DEPLOY.md, restore test of a backup, smoke run
  with a real catalogue.

## 5. Estimate and risks (honest)

- Lines touched: ~64k in `src` plus scripts. Pure moves dominate (W0), but W2+W3 rewrite the
  edges of 96 actions, 24 handlers, 61 client files and 21 pages. With 4 Opus sessions running
  in parallel per wave and a person reviewing merges, expect **3–5 weeks** calendar time, not days.
  Each wave is shippable on its own: after W1 the old app still works unchanged; after W2 the
  API exists next to it; W3 swaps the UI area by area.
- Audit speed does not improve by itself (2.4–3.8 rows/s); the worker only stops it from
  freezing the web process. The embedding singleton (W1b) is the first real speed win.
- `Finding.reason` stays Uzbek text in the DB; translating it is a separate project.
- e2e fixtures write through Prisma; keep that (worker and api share the DB), do not convert
  them to HTTP.
- Do not rotate `SESSION_SECRET` during the migration.

## Wave 0 result (22 Oct 2026)

Done on branch `claude/clever-feistel-609e8d`. What later waves must know:

**Package map.** `packages/core` (@tasnivo/core, former `src/core`), `packages/db` (@tasnivo/db:
`prisma/` plus `src/index.ts` = the former `src/lib/db.ts`, and `finding-type.ts` +
`finding-type-extension.ts`, which the client extension needs), `packages/i18n` (@tasnivo/i18n:
`i18n*.ts`, `i18n-parts/`, plus `format.ts` and `plural.ts` which the dictionaries call, a pure
`locale.ts` (LOCALE_COOKIE, parseLocale, i18nFor, formatTag, I18n) and `type-labels.ts`),
`packages/domain` (@tasnivo/domain, the rest of `src/lib`, same folders), `apps/web` (@tasnivo/web).
An old path maps as `src/lib/x` → `packages/domain/src/x` (or i18n/db as above), `src/core/x` →
`packages/core/src/x`, `src/{app,ui,components,content,styles}` → `apps/web/src/…`; older docs
still use the old paths.

**apps/web/src/lib** holds 18 files: the 12 Next/React-coupled ones plus `guard.ts` (needs the
cookie-reading `currentUser`) and `shell-data.ts` (layout-only, needs the per-render `planStatus`),
and 4 tests that import web routes or adapters (`api/routes.test.ts`, `classifier-health.test.ts`,
`help.test.ts`, `demo-access.test.ts`). Four of the 12 are split: the framework-free half is in
the package, the web file adds the Next part and re-exports the rest —
`session.ts` (domain: SessionData, sessionOptions, assertSecret, Role, CurrentUser, `loadAccess`;
web: getSession, `currentUser`, `inDemoOrg`, React-cached), `plan.ts` (domain: uncached
`planStatus` and `planGates(statusOf)`; web: `planStatus = cache(...)` and gates built on it),
`demo.ts` (web: `isDemoOrg = cache(...)`), `api/respond.ts` (domain: Outcome, failure,
rateHeaders; web: send/enter/crashed with NextResponse), `locale.ts` (i18n: pure part; web:
getLocale/getI18n). A W1 `SessionGuard` is `unsealData` + `loadAccess` + `recordAccepted`.
`buildAccountExport` and `accuracyCsv`/`reasonsCsv` no longer read the locale cookie themselves:
the caller passes the locale (the web routes pass `await getLocale()`).

**Resolution.** Packages are TypeScript source, no build step. Each `package.json` has
`"type": "module"` and `exports` mapping `"./*"` to `"./src/*.ts"` (plus `"."` for db and directory
entries `@tasnivo/core/normalize`, `@tasnivo/core/embed`, `@tasnivo/i18n/i18n-parts`). Specifiers
are extensionless (`@tasnivo/domain/security/headers`); relative imports inside a package keep
their style (`./x.js` or `./x`). npm workspaces link `node_modules/@tasnivo/*` to the folders, so:
Node/tsx resolve through `exports` and tsx compiles the .ts; tsc (`moduleResolution: bundler`)
resolves the same `exports`; Next bundles them via `transpilePackages` and keeps the
`extensionAlias` (.js → .ts) for the relative `.js` imports. No tsconfig `paths` for packages. The
only `paths` entry is `@/*`: in `apps/web/tsconfig.json` (→ `./src/*`) and in the root
`tsconfig.json` (→ `./apps/web/src/*`), because tsx reads the root tsconfig when the test runner
loads the web tests from the root.

**Working directory = repository root, always.** Root `npm run dev|build|start` run
`next <cmd> apps/web` from the root; Docker runs `npm run start` in `/app`. Code still resolves
`data/` (embedding models, the classifier status file, classifier downloads), `node_modules/dejavu-fonts-ttf`
(PDF fonts) and `scripts/update-classifier.ts` (spawned by classifier-start) against
`process.cwd()`. apps/api and apps/worker must either run from the root too or replace those with
explicit paths (e.g. a DATA_DIR) — do that in W1, not by `cd apps/api`. Next reads `.env` files
from apps/web only, so `apps/web/next.config.ts` adds the root `.env*` with `@next/env`'s
`processEnv` (same precedence and expansion as Next; a change needs a dev-server restart).

**Prisma.** Default generator output (`node_modules/.prisma/client` at the root, one hoisted
`@prisma/client` for all workspaces); the root `package.json` has
`"prisma": { "schema": "packages/db/prisma/schema.prisma" }`, so `npx prisma generate|migrate deploy`
work from the root unchanged (compose `app` command untouched). The generated client loads the
root `.env` only if `prisma generate` ran while it existed: after pulling Wave 0 run `npm install`
and `npx prisma generate` at the root. Details: packages/db/README.md.

**Tooling.** `npm run typecheck` = each workspace's `tsc --noEmit -p tsconfig.json` (all extend
`tsconfig.base.json`, so strict/noUncheckedIndexedAccess are identical) + the root tsconfig for
`scripts/` and `eval/`. `npm test` walks `apps`, `packages`, `eval`. `npm run lint` lints
`apps/web/src packages scripts eval` (packages/db/prisma ignored, as prisma/ was never linted).
Dependencies are declared per workspace with the previous ranges; the lockfile kept every resolved
version. npm 11 (local) gates install scripts (`allowScripts`); Docker's npm 10 does not. No
`allowScripts` policy was added — after a fresh local install run `npx prisma generate`.

**Known type-only back-reference:** `packages/i18n/src/i18n-parts/imports.ts` imports
`type PresetId` from `@tasnivo/domain/import-presets` (erased at runtime; i18n does not list
domain as a dependency). `packages/db/prisma/seed.ts` imports domain's `load-env` and `password`.

**Not changed:** matching/audit logic, the schema and migrations, `scripts/` names (all root
`npm run` names kept), docker-compose services. The web app still imports @tasnivo/domain and
@tasnivo/db directly; the ESLint ban from section 3 comes in W3.

## Wave 3a (23 Oct 2026): web scaffolding; auth, account, team and settings on the API

**Scaffolding every W3 area uses (apps/web):**
- `src/lib/api/browser.ts`: `api = createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '' })`
  (same origin, cookies included, `X-Requested-With: tasnivo` on mutations).
- `src/lib/api/server.ts`: `serverApi()`, one shared `createServerApiClient({ baseUrl: API_INTERNAL_URL ??
  'http://localhost:4000', incoming: () => headers() })`; forwards cookie and Accept-Language per request.
- `src/lib/api/me.ts`: `signedIn()`, React-cached `auth.me()`, `null` on 401 (pages redirect to /sign-in);
  `me.demo` stands in for the old "demo org" check (demo users only enter through the demo link).
- `src/lib/api/query.ts`: `queryKey(method, input?)` = `[operationId, input]`; `useSeededQuery(method, initial)`
  keeps data a server component fetched current in the browser (staleTime Infinity, gcTime 0): mutations call
  `queryClient.invalidateQueries({ queryKey: queryKey(api.x.y) })` instead of `router.refresh()`.
- `src/lib/api/follow.ts`: `useFollow()` navigates on `{ redirect }` answers and keeps the form busy until the
  next page; `formFields(form)`.
- `src/ui/query-provider.tsx` (one QueryClient, no retries) wraps `<body>` in `src/app/layout.tsx`.
- `next.config.ts`: `transpilePackages` gains `@tasnivo/api-client` and `@tasnivo/contracts`; `rewrites()` sends
  `/api/:path*` to `${API_INTERNAL_URL}/api/:path*` as an afterFiles rule (route handlers not yet moved still win)
  unless NEXT_PUBLIC_API_URL is set (the destination is fixed at `next build`: build with API_INTERNAL_URL set
  for `next start` without Caddy); `/verify/:token` redirects to `/api/auth/verify/:token` for mails already
  sent (new mails link to the API directly).
- `apps/web/eslint.migrated.mjs` exports `MIGRATED_WEB_PATHS`; `eslint.config.js` forbids `@tasnivo/domain`,
  `@tasnivo/db`, `@tasnivo/core` (and their subpaths, type imports included) and `@/app/actions/*` there.
  Tests are exempt, so a web copy of a pure rule (safe-next, WARN_AT) is held to the domain original by a test.
- Session-changing calls (sign-in, 2FA, sign-up, invite join, Telegram bind start, close, reopen, sign-out) run
  in the browser; a Set-Cookie from an SSR call never reaches it.

**Moved:** sign-in (2FA, forgot, reset), sign-up, invite join, the closed-account page, every settings tab (account
and branding, data with export and retention, integrations, plan, security), the team page, the language switch.
Deleted: actions auth, security, signup, team, settings, api-keys, locale; routes /api/auth/telegram(+bind),
/api/account/export, /verify/[token]; lib/request-facts.ts. Contract additions: `auth.twoFactorPending`
(GET /api/auth/2fa/pending, the 2FA page's hasPending check) and `account.get.closeAfterDays`.
**Left for other areas:** /api/sign-out (the shell's user menu still posts to it), settings/theme-setting.tsx
(setTheme), ui/pay-buttons.tsx (billing checkout), lib/security/sign-in.ts (clearPending for the demo action).
## Wave 3b result: upload wizard, catalogues, header, diff, report, share pages (23 Oct 2026)
These screens read and write only through `@tasnivo/api-client` (`serverApi()` in server
components, `api` + React Query in client components); `apps/web/eslint.migrated.mjs` lists them.
- **Gone:** actions `catalog.ts`, `share.ts`, `reviews.ts`; route handlers `/api/export`,
  `/api/catalog-diff`, `/api/catalog-report-csv`, `/api/report-pdf`, `/api/doc-template`,
  `/api/purchase-template` (same URLs, now answered by the API through the `/api/*` rewrite or
  Caddy), `/upload/progress` (→ `GET /api/catalogs/{id}/progress`), `/r/[token]/pdf`
  (→ `GET /api/share/{token}/pdf`), and `lib/download.ts`.
- **Polling:** the wizard's progress step and the "audit running" block are React Query reads with
  `refetchInterval` (1.5 s with the old back-off; 2 s). The block re-renders the server page once the
  audit is ready (the grid is a server render), its only `router.refresh()`.
- **Lists:** `/catalogs` is seeded by the server render and kept in React Query (`['catalogs', …]`);
  deleting invalidates it. `CatalogList`/`DraftUploads` are client components that still accept
  Date or ISO `createdAt` and call `router.refresh()` after a delete unless `refreshAfterDelete` is
  false — for the client page (W3d) until it reads the API.
- **Contract additions:** `catalogs.uploadOptions` (`GET /api/upload/options`: the upload page's
  clients, default first, and whether the plan lets anything be uploaded) and
  `billing.catalogPurchase.maxRows` (the price text "for up to N rows").
- **Browser copies of pure domain code** (column mapping issues, import presets, file lines,
  upload types, report type lines, degraded-run notes, the classifier banner rule, Tashkent today,
  `withQuery`, decision grouping) live in `apps/web/src/lib/catalogs/`; `catalogs-drift.test.ts`
  compares them with the originals.
- **Seam with W3c** (`catalogs/[id]/page.tsx`): the top reads `signedInUser()` and `catalogHeader(id)`
  (API `catalogs.get`, React-cached with the metadata); the grid section uses `catalog.client.id`,
  `catalog.exportLocked`, and `MoneyAtRisk` takes only the catalogue id (`workspace.moneyAtRisk`).
**For W4:** `ui/catalog-status-client.tsx` keeps `AutoRefresh` only for the cheque/sales list page
(W3d); `ActivityFeed` (report history) still takes Date-typed entries — the report page converts the
API rows; `lib/catalogs/server.ts` and W3a's `lib/api/me.ts` both wrap `auth.me`; the legacy
`/export`, `/report`, `/review` redirects still use `lib/workspace-redirect.ts` + `lib/catalog-page.ts`
(domain). Small known differences: a legacy catalogue without a client shows writers the review
field (the API answers an empty one); the report history is two 50-row activity pages filtered to
the catalogue (it was one 100-row read).
## Wave 3c result: review workspace, dictionary, queue, dashboard, notifications (23 Oct 2026)
These areas now read and write through `@tasnivo/api-client` (branch `claude/w3c-web-workspace-ce3bbf`).
- **Workspace grid** (`catalogs/[id]`, the grid half): page.tsx reads the default view, `catalogs.summary`,
  `workspace.counts` and the first `workspace.rows` page (with `row` for queue links) through `serverApi()`.
  `workspace.tsx` keeps rows in a `useInfiniteQuery` (key `['catalog', id, 'rows', filterKey]`) and summary/counts in
  queries, all seeded from the server render (`staleTime: Infinity`, `gcTime: 0`). `use-decisions.ts` patches the
  rows cache optimistically and rolls back as before. A change to many rows invalidates summary and counts
  (`recount()`) instead of calling `router.refresh()`. The drawer (`workspace.rowDetail`, cancelled on j/k), comments,
  saved views and code lookup (`useCodeLookup`) are queries; every write calls `api.*` wrapped in `serverChange()`,
  so W3d's router-cache refresh-on-next-navigation still works. The filter sent to the API is `apiFilter()`
  (lib/workspace-url.ts, the web copy of the domain's filter/view helpers, with parity tests). `apiFilter()` also
  fixes the old case where `?source=…&dec=pending` loaded later pages as `dec=all`.
- **Dictionary**: page + `DictionaryView` (query `['dictionary', …]`, invalidated by edit and delete); the settings
  toggle (`settings/dictionary-setting.tsx`) calls `dictionary.setAutoAccept`.
- **Notifications page**: `NoticeList` + `useNotices` (key `['notifications', 'list', …]`); "mark read" and
  "mark all read" invalidate `['notifications']` (W3d's bell can share the prefix).
- **Queue**: one `workspace.queue` read (queue-params.ts holds the web copies of readQueueFilter, workspaceHref and
  withQuery, with parity tests). **Dashboard**: one `workspace.dashboard` + `billing.plan` read (dashboard-data.ts
  turns the ISO dates back into Date for the existing components). Closing a task calls `reminders.finishTask`,
  hides the task at once and still calls `router.refresh()`: the totals (overdue checks) are part of the one
  server read.
- **Deleted actions:** review, workspace, bulk, comments, views, feedback, barcode-name, dictionary, and
  `reminders.ts#finishTask`. `reminders.ts#saveSchedule` stays: `clients/[id]/schedule-form.tsx` (W3d) uses it.
  shell.ts (notifications preview/mark read, used by the bell) is W3d's.
- **Session in pages:** W3a's `signedIn()` (lib/api/me.ts) with a redirect to /sign-in; writers are `role !== 'viewer'`.
Seams:
- `catalogs/[id]/page.tsx` is shared with W3b: W3b owns the top (catalog header read), W3c the grid half. At
  merge, the grid half should use W3b's `catalog.client.id`, `catalog.exportLocked` and `user` (auth.me). Both
  branches changed money-at-risk.tsx to `workspace.moneyAtRisk`; the two versions are equivalent.
- notifications/notice-actions.tsx: take W3c's version (W3d agreed and dropped its glob). W3d's bell uses the key
  ['notifications', 'preview'], so W3c's ['notifications'] invalidation refreshes it too.
- actions/reminders.ts: W3c removed finishTask and W3d removed saveSchedule. With both merged nothing is left, so
  delete the file.
For W4:
- Files left out of MIGRATED_WEB_PATHS, because they still use pure domain/core helpers:
  - the dashboard's presentational parts: work-queue (arrangeQueue …), client-stats rowProgress/attentionReasons
    (that module also imports the db), client-attention, client-kpi, activity-groups, billing/limits;
  - `catalogs/[id]/unit-label.ts` (`@tasnivo/core` unit tables);
  - `catalogs/[id]/page.tsx` until W3b's half lands.
  Move those helpers into apps/web or contracts, then make the rule repo-wide.
- The dashboard is still one server read refreshed with `router.refresh()` after a task closes. A client query for
  the totals would remove that last refresh.
- The web copies (workspace-url.ts, queue-params.ts, dictionary-params.ts) are tested against the domain. Drop the
  tests and keep the copies when the web stops depending on @tasnivo/domain.
Verified on the branch, merged with main 96d3ef5:
- Root typecheck, lint (only the known xlsx.ts warning) and `npm run build` pass.
- Unit tests: 1552, all green after rerunning three API e2e files on their own. Run alongside the other W3
  sessions, those files failed on the shared database's rate-limit rows and on audit timeouts.
- E2E against `next start` on 3103 (built with `API_INTERNAL_URL=http://localhost:4203`), the API on 4203 and the dev
  database, in Edge (`E2E_CHANNEL=msedge`, new in fixture.ts): dictionary-review 2/2, navigation 5/5, refresh 4/4,
  review-flow 17/17, scale 3/3 (j/k).
- review-flow tests 8 and 14 now capture `POST /api/findings/{id}/decision` and replay it as the viewer (403
  `forbidden`) instead of the server action.
- Run servers and e2e with `connection_limit=4` in DATABASE_URL while several sessions share the dev Postgres
  (max_connections 100).
## Wave 3d result (23 Oct 2026)
Branch `claude/w3d-web-clients-257f1e`. The clients area (list, client page and its forms,
purchases, cheque/sales imports, schedule and activity), the app shell, the billing pay buttons,
the demo pages, the landing lead form, the admin pages and /api-docs read and write through
`@tasnivo/api-client` only (`MIGRATED_WEB_PATHS` in `apps/web/eslint.migrated.mjs` enforces it).
- **Shared scaffolding: W3a's files, taken from its branch unchanged** (lint rule: no @tasnivo/domain,
  @tasnivo/core or @tasnivo/db in migrated files, types included). Db-free helpers the W3d pages need are
  web-local copies in `src/lib/pure/` (access, query-string, relative-day, reminder-dates, client-kpi,
  activity-groups, constants) checked against their originals by `lib/pure/pure.test.ts`; shapes come from
  `@tasnivo/contracts` (`lib/pure/types.ts`). Before that, W3d had written its own copies: `src/lib/api/browser.ts`
  (`api`), `src/lib/api/server.ts` (`serverApi()`), `src/ui/query-provider.tsx` in the root layout,
  the `/api/:path*` afterFiles rewrite to `API_INTERNAL_URL` when `NEXT_PUBLIC_API_URL` is empty
  (Next bakes rewrites in at build time: build with the `API_INTERNAL_URL` it will run with), and the
  ESLint rule (a regex allows only the pure `@tasnivo/domain` modules in `PURE_DOMAIN_MODULES`; types
  are always allowed). W3d helpers: `lib/api/refusal.ts` (a 4xx refusal back to the actions'
  `{ ok: false, error }` with the API's translated message), `lib/api/page-data.ts` (401 → sign-in,
  403/404 → notFound), `lib/api/me.ts` (`auth.me` once per render).
- **New endpoint `GET /api/shell`** (`endpoints.notifications.shell`, domain `shell-frame.ts`): the
  frame's visible clients, active client (an unscoped user without clients still gets the default
  one created), unread count and plan warnings. The `(app)` layout reads only this.
- **Shell:** bell and palette are React Query reads (`ui/shell/shell-queries.ts`); the bell preview
  is fetched when the pointer rests on the bell. Client switch, demo open and sign-out run in the
  browser and then load the next page as a document. `router-cache.ts` keeps its contract for API
  calls: `serverChange(api.x(...))` makes the next page opened refresh once (the API cannot
  revalidate Next's router cache) and drops the shell's React Query answers; components that stay on
  their page call `router.refresh()` once after a successful call. `intent-prefetch.ts` is unchanged
  (pages are server components reading the API, so `router.prefetch` still fetches them whole).
- **Contract changes:** `clients.STALE_DAYS`; doc lists carry `sample`, `totalSeen`, `truncated`;
  report groups carry `names` and `suggestedName` (domain `list-pages.ts` sends them).
  `rowProgress` moved to the pure `client-kpi.ts` (re-exported from `client-stats.ts`).
- **Deleted:** actions `clients`, `shell`, `locale`, `purchases`, `docs`, `billing`, `demo`, `lead`
  and `saveSchedule` from `reminders.ts`; route handlers `api/admin/metrics`, `api/doc-template`,
  `api/purchase-template`; `lib/shell-data.ts`.
- **e2e:** `E2E_CHANNEL=msedge` runs the suite with an installed browser.
**At the W3a + W3d merge:** delete `app/api/sign-out/route.ts`, `lib/security/redirect.ts` and
`lib/security/sign-in.ts` (with both branches in, nothing uses them; on W3d's branch alone W3a's pages still do).
**Left for W4 (still used outside W3d's files):** `lib/guard.ts`, `lib/session.ts` (`currentUser`),
`lib/plan.ts`, `lib/demo.ts`, `lib/locale.ts` (`getI18n` stays for server components; only its
cookie part is web-only), `lib/workspace-redirect.ts` + `lib/catalog-page.ts`, `lib/download.ts`,
`lib/request-facts.ts`, `lib/security/*`, `lib/demo-limits.ts` (test only); `finishTask` in
`actions/reminders.ts` (W3c's dashboard); `app/api/sign-out` (the account-deleted page still posts to
it); the remaining `app/api/*` route handlers; `instrumentation.ts` (audit resume) and
`experimental.serverActions.bodySizeLimit` in `next.config.ts`; `billing.plan` for the layout row
(the layout reads `/api/shell` instead) and `PREF_COOKIE_OPTIONS`/`readSidebar` in `ui/shell`,
which nothing calls any more.
