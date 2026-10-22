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
