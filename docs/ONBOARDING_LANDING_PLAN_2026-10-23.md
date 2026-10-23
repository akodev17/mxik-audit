# Onboarding tour + landing update: plan and Opus prompts (23 Oct 2026)

Planning agent: one Fable session (this document). Implementation: Opus sessions, one per subtask
below. Nothing in this file was implemented; every statement in §1 was read from the code on
`main` = `c6e8179`.

Companion docs the implementer must read: `docs/HANDOFF_2026-10-23.md` (architecture, dev
commands, gotchas), `docs/CONTINUE_2026-10-23.md` (what is verified and what is not),
`docs/accounting-2026-10-23/FINAL_REPORT.md` (what the 1C / bank / Didox / products modules really
do), `docs/DESIGN_SYSTEM.md` (tokens, primitives, rules for the signed-in UI).

---

## 1. Current state (verified from code)

### 1.1 Stack and layout

- npm-workspaces monorepo. `apps/web` = Next.js 15.5 (App Router, React 19, Tailwind 4, TanStack
  Query), **no database access**: pages call the API through `@tasnivo/api-client`.
  `apps/api` = NestJS 11 on :4000, owns Postgres (Prisma, `packages/db/prisma/schema.prisma`).
  `apps/worker` = BullMQ. `packages/contracts` = every endpoint as a zod `endpoint({...})` in
  `packages/contracts/src/modules/*.ts` (162+ operations; registry and OpenAPI tests check them).
- Checks: `npm run typecheck && npm run lint && npm test` (2 007 tests, needs the dev DB on
  54329), `npm run build` (web, with `API_INTERNAL_URL`), `npm run test:e2e` (Playwright, 66 tests,
  `E2E_CHANNEL=msedge`, against a running `next start` + API).
- No CI workflow in the repo (`.github/` absent). Checks are run by hand.

### 1.2 What a signed-in user can do today (routes under `apps/web/src/app/(app)/`)

| Section | Route | What it does | Status |
|---|---|---|---|
| Dashboard | `/dashboard` | Summary, work queue, "getting started" checklist (6 data-driven steps: client, upload, review, invite, 2FA, Telegram), activity/changes/workload tabs | live |
| Review queue | `/queue` | Open high/medium findings across clients | live |
| Clients | `/clients`, `/clients/[id]` (+ `/imports`, `/purchases`) | One client per company; header client switcher; per-client catalogues, purchase lists, schedules | live (the landing's `SHOW_MULTI_CLIENT` flag that hides it is **stale**) |
| Team | `/team` | Roles admin / accountant / viewer, invites, client assignments | live |
| Catalogues | `/catalogs`, `/catalogs/[id]` (+ `/report`, `/diff`) | Audit workspace: findings, suggestions with classifier path, accept/reject/undo, PDF report, Excel export in the original shape, 1C CSV, version diff, share links `/r/[token]` | live |
| Upload | `/upload` | Excel/CSV wizard, column guessing, remembered mapping, background audit with progress | live |
| Firm dictionary | `/dictionary` | Confirmed name → code memory, auto-accept option | live |
| Activity | `/activity` | Decision log | live |
| Notifications | `/notifications` | In-app notices, Telegram chats | live |
| Settings | `/settings` tabs account / security / plan / integrations / data | Language (uz/ru), theme, 2FA, sessions, plan + Click/Payme (behind a flag), API keys, Telegram, export, close account | live |
| Bank statements | `/bank`, `/bank/[batchId]`, `/bank/[batchId]/reconcile`, `/bank/upload`, `/bank/review` | Excel/CSV statement → parsed, normalised, counterparties and operations matched by rules → review → `kl_to_1c.txt` (1CClientBankExchange 1.02) + reconciliation CSV | implemented; verified on **synthetic** statements only, no real bank file exists |
| Didox invoices | `/didox`, `/didox/[batchId]`, `/didox/settings` | Upload a Didox zip / JSON / ЭСФ-xlsx **or** connect with a token and sync; lines folded, products matched against the MXIK classifier, review, 1C receipt + nomenclature xlsx | file path implemented and tested; direct sync tested only against a **fake Didox** (only `GET /v1/measures/all` ever hit the real API, no credentials). The page itself shows an "unverified" banner (`didoxX.unverified`) |
| Products | `/products`, `/products/import` | Product catalogue for the firm and its clients: import from Excel or 1C «Номенклатура», MXIK validity/activity/restriction checks, packaging code and unit checks, suggestions, "add to products" from a finished audit, 1C nomenclature export | live (verified in browser + 50 tests) |
| 1C import & history | `/onec`, `/onec/[batchId]`, `/onec/review`, `/onec/settings` | History of every bank / Didox / catalogue batch; "prepare for 1C" preview; file exports; counterparties; connection settings `none` / `odata` / `http` | file exports live (golden-file tested); **OData direct transfer tested only against a fake server** |
| Admin | `/admin`, `/admin/metrics` | Platform operator pages | live, hidden |
| Public | `/` landing, `/demo` (e-mail link → private sample copy), `/yordam` help centre (uz + ru, 8 articles), `/maxfiylik`, `/oferta`, `/api-docs` (Swagger of public API v1), `/r/[token]` shared report | live (legal texts are placeholders: Q7) |

Other live integrations: public API v1 (API keys, `POST /api/v1/check`, catalogues), Telegram
bot (notifications, send a file to audit, sign-in: widget works only on the bot's domain),
Google sign-in (works on localhost), Google Sheets add-on (source only, `integrations/google-sheets`).

Billing: `PLAN_FEATURES` in `packages/domain/src/billing/plans.ts` gates export, reminders,
branding, client links. **The accounting modules (bank / Didox / products / 1C) are not plan-gated
at all today.**

### 1.3 Auth flow and "first login"

- Password sign-up → `/sign-up/verify` (mandatory 6-digit e-mail code; without SMTP the code is
  in the API log and `tmp/outbox/`) → `/dashboard`. Google sign-up → `/dashboard` directly.
  Sign-in → `landing ?? '/dashboard'` (`apps/web/src/app/sign-in/page.tsx:24`).
- **There is no first-login flag.** `User` (`schema.prisma:309`) has `createdAt`,
  `emailVerifiedAt`, `locale`, no onboarding field. The dashboard checklist is derived from data
  (`dashboardData().onboarding`) and hidden per browser by the cookie `mxik_onboarding=hidden`
  (`dashboard/onboarding-pref.ts`). The workspace shows three one-time tips for **demo** visitors
  only via localStorage (`catalogs/[id]/onboarding-hint.tsx`). Neither is a product tour.
- The signed-in user reaches the browser as `auth.me` (`CurrentUser` in
  `packages/contracts/src/modules/auth.ts:26`: userId, orgId, email, demo, clientId, role,
  clientIds, verified) and the persistent frame gets `notifications.shell()` (`ShellData`:
  clients, activeClient, unread, plan, demo, canWrite, canManageTeam, email).
- Browser preferences (theme, sidebar, locale) are **cookies** set by `PUT /api/account/{theme,
  sidebar, locale}` (`apps/api/src/account/prefs.ts`); the sidebar PUT writes nothing to the DB.
  A tour flag therefore needs a new nullable column and a new endpoint.
- The signed-in frame (`apps/web/src/ui/shell/app-frame.tsx`) is a client component that stays
  mounted across route changes: header tabs (`top-nav.tsx`: dashboard, queue, clients, team,
  catalogs, bank, didox, products, onec, dictionary, activity; tabs that do not fit fold into a
  "more" `Menu`), left rail (`rail.tsx`: upload, notifications, clients, help, settings), client
  switcher, search/command palette, bell, user menu (`user-menu.tsx`: account, language, theme,
  settings, help, sign-out). Below `md` the tabs are hidden and `MobileNav` (a drawer) holds them.
- Overlay plumbing that a tour can reuse: `ui/portal.tsx` (portals **into** `.app` so the theme
  applies), `ui/layers.ts` + `ui/overlay.ts` (`useEscape` closes only the topmost layer,
  `useScrollLock`, `useReturnFocus`), `ui/focus.ts` (`focusables`, `trapTab`),
  `ui/placement.ts` + `ui/use-placement.ts` (popover positioning), `ui/dialog.tsx` as the model.
  z-index tokens: `z-modal` 40, `z-toast` 50 (`DESIGN_SYSTEM.md`). No tour library is installed.

### 1.4 Landing page, copy source, languages, design system

- `apps/web/src/app/page.tsx` composes `apps/web/src/components/landing/*`: Hero, Problem,
  Consequences, Capabilities, DemoBand (live sample audit), Workflow (4 steps), Outcomes, Trust,
  Pricing, Faq, FinalCta (lead form), StickyCta. Header links: `#qanday-ishlaydi`, `#narxlar`,
  `#savollar`, help, demo, Telegram.
- **Copy is hardcoded Uzbek Latin JSX** in those files plus `data.ts` (checks, consequences with
  legal sources, data-flow wording, portal examples) and `shell-copy.ts` (header/footer, uz + ru).
  Only the pricing section reads the i18n package (`i18n-parts/pricing.ts`, uz). The landing is
  **Uzbek-only by design** (`shell.tsx`: "Public pages are Uzbek unless they say otherwise");
  the help centre has uz and ru trees. There is no ru landing.
- SEO: `TITLE` / `DESCRIPTION` / OG / twitter in `page.tsx`; `opengraph-image.tsx` (generated
  PNG, Latin-only font: avoid `oʻ`/`gʻ` there); root `layout.tsx` default title uses
  `t.appName — t.tagline` (i18n `i18n.ts` / `i18n-ru.ts`, tagline = "Katalogingizdagi xavfli
  pozitsiyalarni toping" / "Найдите рискованные позиции в вашем каталоге"); `sitemap.ts` (landing +
  help), `robots.ts` (`PRIVATE_PATHS` already disallow `/bank`, `/didox`, `/products`, `/onec`).
- Flags in `landing/config.ts`: `DEMO_URL` (`.env.example` sets `/demo`; the comment "no public
  demo exists" is stale), `SHOW_MULTI_CLIENT=false` (stale: clients are built), `SHOW_LEGAL_223`,
  `ONLINE_PAYMENT`, `PRICING` (a checked copy of the domain plans; `tests/web-parity` holds the
  parity test). Every figure on the page is measured (`sample-report.generated.ts`), never
  invented: keep that discipline.
- Landing design system is separate from the app's: `lp-*` tokens in `landing.css`, light only,
  `CONTAINER` from `container.ts`, `ButtonLink` from `landing/button.tsx`, `lp-display` headings,
  `rounded-lp(-lg|-xl)`, icons from `@/ui/icons`. Tests next to it: `sample-report.test.ts`,
  `workspace-model.test.ts`.
- App i18n for the tour: `packages/i18n/src/i18n-parts/<area>.ts` exports `uz` and `ru` objects of
  the same shape (typed, a missing ru key does not compile), merged in `i18n-parts/index.ts`
  (`partsUz`, `partsRu`); reached in components as `ta.<area>X`. Apostrophes must be U+02BB (ʻ)
  / U+02BC (ʼ), never ASCII.
- Migrations: additive only, `IF NOT EXISTS` style, `prisma migrate deploy` never `migrate dev`.
  Folders sort after `20261105000100_default_client_backfill`. **Every migration since
  `20261027100000` must have a rollback section in `docs/accounting-2026-10-23/migrations.md`;
  `packages/db/src/migrations-doc.test.ts` fails otherwise.**

### 1.5 Process constraints (from the owner's memory)

- The owner wants to **see UI work before it lands**: each task's branch stays unmerged until the
  owner has looked at screenshots or the running app. Merges of these two branches are not
  pre-authorised.
- Worktrees: `cp ../../../.env .env`, `npm ci`, `npx prisma generate`; shared dev Postgres with
  `&connection_limit=4`; pick free ports (`npm run dev:api` honours `PORT`, web
  `npx next dev apps/web -p <port>`); never run `npm run build` beside a running `next dev` on the
  same checkout.

---

## 2. Open questions and the assumption each subtask works under

| # | Question | Assumption used below (change the prompt if the owner decides otherwise) |
|---|---|---|
| Q1 | Tour library or in-house? | **In-house** (~300 lines on the existing Portal / layers / focus / placement primitives). Reasons: zero new dependency in a repo with strict type-aware lint and a 16 MB-conscious bundle; the app's dark theme only works for DOM portalled into `.app` (driver.js and react-joyride append to `document.body`, so their popover would ignore the theme tokens); the overlay stack (`layers.ts`) must know about the tour so Escape closes the right layer; Shepherd.js is AGPL since v12; react-joyride drags `react-floater` and has had React 19 issues. driver.js (MIT, ~5 kB) is the fallback if the owner insists on a library: then T1.2 wraps it, overrides `.driver-popover` with tokens, and accepts that dark mode needs a manual CSS mirror. |
| Q2 | Should the landing pricing say anything about the accounting modules? | The modules are not plan-gated in code, so the pricing section gets one factual sentence: "1C, bank va Didox modullari hozircha barcha tariflarga kiradi" ("for now"). Prices and `PLAN_FEATURES` stay untouched. Owner decision if a separate tier is wanted. |
| Q3 | How to label Didox direct sync and 1C OData transfer, which were never run against the real systems? | Both appear with a small "sinov rejimida" (beta) badge and one honest sentence; the **file** paths (Didox archive upload, 1C file exports, bank Excel) are presented as live because they are fully exercised. Nothing is called "coming soon" because the code exists and is reachable. |
| Q4 | Russian landing? | Out of scope: the landing is Uzbek-only by design. The tour copy is uz + ru (app i18n). |
| Q5 | `SHOW_MULTI_CLIENT` flag | Remove the flag; the clients module is built and shipped. |
| Q6 | Do existing accounts get the tour? | No production deploy exists, so no backfill. Dev users see it once and can skip. The e2e fixture and `npm run seed` create users with the tour already marked done so the 66 e2e tests are not blocked by an overlay. |
| Q7 | Where does "show the tour again" live? | Two places: the user menu (next to Help) and a button on Settings → Account. |
| Q8 | What counts as a "section" for the tour | 12 content steps + welcome + done = 14 steps (list in T1.3). The config is one array; the owner can delete steps without touching logic. |
| Q9 | Branches | `feat/onboarding-tour` (T1.1–T1.5) and `feat/landing-2026-10` (T2.1–T2.5), both cut from `main`. The two do not touch the same files except `packages/i18n/src/i18n.ts` (tagline, T2.4) vs new `i18n-parts/tour.ts` (T1.3): disjoint, merges cleanly. |

---

## 3. Subtasks, order, dependencies

Size: S ≈ 1–2 h, M ≈ half a day, L ≈ a day of one Opus session.

| ID | Title | Depends on | Size | Files likely touched |
|---|---|---|---|---|
| T1.1 | Tour flag: schema, contract, endpoint, shell field | — | S | `packages/db/prisma/schema.prisma`, new migration `20261106000100_user_tour`, `docs/accounting-2026-10-23/migrations.md`, `packages/contracts/src/modules/{account,notifications}.ts`, `apps/api/src/account/account.controller.ts`, `apps/api/src/notifications/*` (shell), `apps/api/test/**` |
| T1.2 | Tour engine + step targets in the shell | — (parallel with T1.1; uses a local state until T1.4 wires the API) | M | new `apps/web/src/ui/tour/{tour-steps.ts,tour-context.tsx,tour-overlay.tsx,tour-card.tsx,tour-target.ts,tour.test.ts}`, `data-tour` attributes in `ui/shell/{top-nav,rail,user-menu,search-button,client-switcher,notification-bell}.tsx`, `(app)/dashboard/onboarding.tsx`, `ui/shell/app-frame.tsx` |
| T1.3 | Tour copy, uz + ru, in the i18n package | — (parallel; the step keys are fixed in this plan) | S | new `packages/i18n/src/i18n-parts/tour.ts`, `i18n-parts/index.ts`, a shape test |
| T1.4 | First-login trigger, mark-done, re-open entry points, mobile + a11y | T1.1, T1.2, T1.3 | M | `ui/shell/app-frame.tsx`, `ui/tour/*`, `ui/shell/user-menu.tsx`, `(app)/settings/account-tab.tsx`, `apps/web/e2e/fixture.ts`, `packages/db/prisma/seed.ts`, `scripts/seed-demo.ts` (if it creates users) |
| T1.5 | QA pass of the tour | T1.4 | M | `docs/onboarding-2026-10-23/qa-report.md` + screenshots; fixes in `ui/tour/*`; maybe `apps/web/e2e/onboarding-tour.e2e.ts` |
| T2.1 | Feature inventory + landing section plan (doc) | — | S | new `docs/landing-2026-10-23/feature-inventory.md` |
| T2.2 | Hero, problem, nav, CTAs, config flags | T2.1 | M | `landing/{hero,problem,site-header,site-footer,shell-copy,config,outcomes}.tsx|ts` |
| T2.3 | Capabilities, new accounting section (1C / Didox / bank / products), workflow | T2.2 (same branch, sequential) | M | `landing/{capabilities,workflow}.tsx`, new `landing/accounting.tsx`, `landing/data.ts`, `app/page.tsx` (section order) |
| T2.4 | FAQ, pricing note, SEO/meta/OG, tagline | T2.3 | S–M | `landing/{faq,pricing}.tsx`, `i18n-parts/pricing.ts`, `app/page.tsx` (metadata), `app/opengraph-image.tsx`, `packages/i18n/src/{i18n,i18n-ru}.ts` (tagline) |
| T2.5 | Landing QA: links, anchors, forms, build, screenshots | T2.4 | S | `docs/landing-2026-10-23/qa-report.md`, fixes |
| T2.6 (optional) | Help-centre article "1C, bank va Didox" uz + ru | T2.3 | S | `apps/web/src/content/yordam/{uz,ru}/1c-bank-didox.mdx`, `apps/web/src/lib/help.ts`, `api-va-integratsiyalar.mdx` |

Waves (each wave = sessions that may run at the same time):

1. **Wave A:** T1.1, T1.2, T1.3, T2.1 (four sessions; T1.x on three worktrees of the same branch
   name is not possible, so T1.1 → branch `feat/onboarding-tour`, T1.2 → `feat/tour-engine`,
   T1.3 → `feat/tour-copy`; the coordinator merges T1.2 and T1.3 into `feat/onboarding-tour`
   before T1.4 starts). T2.1 on `feat/landing-2026-10`.
2. **Wave B:** T1.4; T2.2.
3. **Wave C:** T1.5; T2.3 then T2.4 (one session, sequential, same files).
4. **Wave D:** T2.5 (and T2.6 if wanted). Owner review of both branches; merge only on the owner's OK.

---

## 4. Opus prompts

Every prompt below starts with the same COMMON RULES block. Copy a prompt whole.

### COMMON RULES (the first lines of every prompt)

```
You are implementing one subtask of the plan in docs/ONBOARDING_LANDING_PLAN_2026-10-23.md in the
Tasnivo monorepo (Next.js 15 web app + NestJS API + Prisma). Rules:
- Inspect before editing. Read docs/HANDOFF_2026-10-23.md §2–3, the plan's §1 for your area, and
  `git log --oneline -30` on your files. Verify every claim of the plan against the code; if the
  code differs, follow the code and say so in your report.
- Minimal, focused changes. Do not refactor, rename or "tidy" anything outside your subtask. Do
  not touch files owned by another subtask (listed in the plan's §3 table).
- Keep files small and single-purpose. Comments: few, single-line, English, explaining why.
- Do not invent features, numbers or claims. Where a thing is not verified, say so.
- Uzbek copy uses U+02BB (ʻ) / U+02BC (ʼ) apostrophes, never ASCII quotes. Russian mirrors the
  Uzbek shape (the i18n types enforce it).
- Signed-in UI: only design-system tokens and primitives (docs/DESIGN_SYSTEM.md); no hard-coded
  colours, no raw z-index, no `text-sm`-style sizes. Landing: the `lp-*` system in
  apps/web/src/components/landing/landing.css.
- Work on the branch named in your subtask, in a worktree: `cp ../../../.env .env`, `npm ci`,
  `npx prisma generate`; append `&connection_limit=4` to DATABASE_URL; use free ports
  (`PORT=40xx npm run dev:api`, `npx next dev apps/web -p 30xx`). Never run `npm run build` beside a
  running `next dev` on the same checkout. Commit early with clear messages; never push, never
  merge, never touch `main`.
- Before you finish: `npm run typecheck && npm run lint && npm test` from the repo root (tests
  need the dev DB). Fix what your change broke; report pre-existing failures without fixing them.
- Final report (write it to the path your subtask names AND paste it in chat): files changed,
  what was done, how it was tested (commands + results), what remains or is unverified, open
  questions for the owner.
```

---

### T1.1 — Tour flag: schema, contract, endpoint, shell field

```
<COMMON RULES>

Branch: feat/onboarding-tour (cut from main). Report: docs/onboarding-2026-10-23/t1.1-result.md.

CONTEXT
A guided product tour will open once for every new account and must be re-openable. The flag has to
live in the database, not in a cookie or localStorage (a person signs in from several browsers).
Today User (packages/db/prisma/schema.prisma, `model User`) has no such field; browser preferences
(theme, sidebar) are cookie-only (apps/api/src/account/prefs.ts). The persistent signed-in frame
receives `notifications.shell()` (ShellData) once per server render; that is where the web app will
read the flag (T1.4).

CURRENT PROBLEM
No column, no endpoint, no field in the shell payload. The migration rollback guide test
(packages/db/src/migrations-doc.test.ts) fails for any new migration that is not documented in
docs/accounting-2026-10-23/migrations.md.

INSPECT FIRST
- packages/db/prisma/schema.prisma (`model User`), the two newest migration folders under
  packages/db/prisma/migrations (style: IF NOT EXISTS, additive), docs/accounting-2026-10-23/
  migrations.md (one section per migration, with rollback SQL and "what breaks").
- packages/contracts/README.md, packages/contracts/src/endpoint.ts, src/registry.ts, src/checklist.ts
  and their tests: what a new endpoint must declare (summary, auth, role, body, response,
  `replaces`/notes) to pass the registry, checklist and OpenAPI tests.
- packages/contracts/src/modules/account.ts (`setSidebar` as the model of a tiny PUT) and
  modules/notifications.ts (the `shell` endpoint's response schema).
- apps/api/src/account/account.controller.ts (`@Route(e.setSidebar)`), apps/api/src/notifications/**
  (where the shell payload is built), apps/api/test/** (how endpoints are tested with supertest).
- packages/api-client: confirm the client is derived from the contracts (no hand-written method
  needed) and how `api.account.setSidebar` is reached from the web app (apps/web/src/lib/api/browser.ts).

REQUIREMENTS
1. Schema: `User.tourCompletedAt DateTime?` with a one-line doc comment ("Guided tour finished or
   skipped; null = show it on the next visit"). Migration folder `20261106000100_user_tour`, SQL
   `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "tourCompletedAt" TIMESTAMP(3);`. Add its section to
   docs/accounting-2026-10-23/migrations.md (rollback SQL, `_prisma_migrations` delete, what breaks:
   "the tour opens on every visit and the mark-done call answers 500").
2. Contract + API: `PUT /api/account/tour` body `{ done: boolean }`, auth session, any role
   (viewers and accountants take the tour too), response `{ ok: true }`. `done: true` sets
   tourCompletedAt = now(); `done: false` clears it (used by "show the tour again"? No: re-opening
   does not clear the flag; `false` exists only for tests and support. Keep it, document it).
   Demo users: accept and no-op (demo orgs are purged anyway).
3. Shell payload: add `tour: 'pending' | 'done'` to the `shell` response (`pending` when
   tourCompletedAt is null and the org is not a demo; demo = 'done'). Keep every existing field.
4. Prisma client regenerate; `npx prisma migrate deploy` on your dev DB; `npx prisma migrate status`
   clean.
5. Tests: an API test for the PUT (sets, clears, 401 without a session, demo no-op) and an
   assertion in the shell test that `tour` is present. Run the contracts package tests.

CONSTRAINTS
- Additive migration only. Do not backfill existing users (plan §2 Q6).
- Do not add the field to `auth.me` / CurrentUser unless the shell route turns out not to be the
  frame's data source; say which you used and why.
- No web-app changes in this subtask except regenerated types.

IMPLEMENTATION STEPS
schema → migration + rollback doc → prisma generate → contract (account.setTour, notifications.shell
response) → controller + service → tests → full check set.

HOW TO TEST
- `npm run typecheck && npm run lint && npm test` (packages/db migrations-doc test must pass).
- `curl -X PUT http://localhost:40xx/api/account/tour` with a signed-in cookie and the CSRF header
  the API expects (see apps/api/src/auth-core/* and an existing e2e/api test for the header name);
  then `GET /api/notifications/shell` shows `tour: "done"`.

FINAL REPORT: per COMMON RULES; name the exact endpoint key (e.g. `account.setTour`) and the shell
field so T1.4 can use them without reading your diff.
```

---

### T1.2 — Tour engine and step targets in the shell

```
<COMMON RULES>

Branch: feat/tour-engine (cut from main; the coordinator merges it into feat/onboarding-tour).
Report: docs/onboarding-2026-10-23/t1.2-result.md.

CONTEXT
Decision Q1 of the plan: the tour is built in-house on the app's own overlay primitives, no library.
It runs inside the persistent signed-in frame (apps/web/src/ui/shell/app-frame.tsx, a client
component that stays mounted across routes), so a React context there can hold "current step"
while the user navigates. All step targets are elements of the frame or the dashboard, marked with
`data-tour="<key>"`, so the tour never depends on deep page content.

CURRENT PROBLEM
Nothing exists. Primitives to reuse: ui/portal.tsx (portals into `.app` so dark theme applies),
ui/layers.ts + ui/overlay.ts (`useEscape` closes only the topmost layer; `useScrollLock`,
`useReturnFocus`), ui/focus.ts (`focusables`, `trapTab`), ui/placement.ts + ui/use-placement.ts
(popover placement), ui/dialog.tsx and ui/popover.tsx as models, ui/button.tsx, ui/icon-button.tsx,
ui/visually-hidden.tsx. Tokens and z-index names in docs/DESIGN_SYSTEM.md (`z-modal`, `z-toast`).
The existing dashboard "getting started" checklist ((app)/dashboard/onboarding.tsx) stays; the
tour's welcome step points at it when it is on screen.

INSPECT FIRST
- ui/shell/app-frame.tsx, top-nav.tsx (tabs; tabs that do not fit are in a "more" Menu and are
  NOT in the DOM), rail.tsx, mobile-nav.tsx, user-menu.tsx, search-button.tsx, client-switcher.tsx,
  notification-bell.tsx, nav.ts (NavKey list), nav-items.tsx.
- ui/dialog.tsx end to end (focus placement, trapTab, Escape, Portal, scroll lock, aria wiring).
- ui/placement.ts + use-placement.ts: can they place a card beside an arbitrary rect? If not,
  write a 30-line placement in the tour folder rather than changing them.
- (app)/dashboard/onboarding.tsx (where to put data-tour="checklist").
- apps/web/src/lib/locale-client.tsx (`useI18n`) — T1.3 adds `ta.tourX`; until it lands, keep a
  local placeholder dictionary in tour-steps.ts typed as the final shape (plan §4 T1.3 lists the
  keys) and mark it `// placeholder until i18n-parts/tour.ts lands (T1.3)`.

REQUIREMENTS
1. Config file `apps/web/src/ui/tour/tour-steps.ts`: one exported array `TOUR_STEPS` in this order
   and with exactly these keys: welcome, dashboard, upload, catalogs, queue, clients, products,
   bank, didox, onec, dictionary, activity, settings, done. Each step: `{ key, targets: string[],
   href?: string, roles?: Role[] }` where `targets` are data-tour keys in priority order (first one
   present in the DOM wins; none present → the card is centred with no spotlight), `href` is the
   section the optional "open section" link goes to, `roles` restricts a step (e.g. `upload` only
   when `shell.canWrite`). Copy is NOT in this file (keys only); order and targets are.
   Suggested targets: welcome → ['checklist'] ; dashboard → ['nav-dashboard'] ; upload →
   ['rail-upload'] ; catalogs → ['nav-catalogs','nav-more'] ; queue → ['nav-queue','nav-more'] ;
   clients → ['nav-clients','nav-more'] ; products → ['nav-products','nav-more'] ; bank →
   ['nav-bank','nav-more'] ; didox → ['nav-didox','nav-more'] ; onec → ['nav-onec','nav-more'] ;
   dictionary → ['nav-dictionary','nav-more'] ; activity → ['nav-activity','nav-more'] ;
   settings → ['user-menu'] ; done → [].
2. `data-tour` attributes: on every header tab (`nav-<key>`), the "more" button (`nav-more`), rail
   upload (`rail-upload`), rail settings/help if present, user menu trigger (`user-menu`), search
   button (`search`), client switcher (`client-switcher`), bell (`bell`), dashboard checklist
   section (`checklist`). Attribute only; no behaviour change in those components.
3. Engine (`tour-context.tsx`): `TourProvider` (state: open, index, mode 'spotlight' | 'centred'),
   `useTour()` with `start()`, `next()`, `back()`, `skip()`, `finish()`. `start()` navigates to
   /dashboard first when the current route is not under /dashboard (so the welcome step can find
   the checklist), then opens. `onDone(reason: 'finished' | 'skipped')` callback prop so T1.4 can
   call the API; the engine itself knows nothing about the API.
4. Target resolution (`tour-target.ts`): find the first `[data-tour=<key>]` that is visible
   (`getClientRects().length > 0`); poll with requestAnimationFrame for up to 1 500 ms after a step
   change (the dashboard may still be rendering); if none, fall back to centred mode for that step
   (do not skip the step: the copy is still useful; the card just has no spotlight). Re-measure on
   resize, scroll and `ResizeObserver` of the target; `scrollIntoView({ block: 'center' })` once per
   step. Below the `md` breakpoint (`useMediaQuery` exists in ui/shell/use-media-query.ts) always
   use centred mode (the tabs are inside a closed drawer there).
5. Overlay (`tour-overlay.tsx`): rendered through Portal into `.app` at `z-modal`; a full-screen
   layer using the `overlay` colour token with a transparent cut-out over the target rect (an SVG
   mask or four rects; 6 px padding, `rounded-md`); the target itself must stay visible and NOT
   clickable through the overlay (the tour is modal). Registers with layers.ts so Escape closes
   only the tour when it is the topmost layer; while open, `document.querySelector('.app
   [aria-modal="true"]')` is true so the command palette shortcut stays off (see app-frame.tsx).
6. Card (`tour-card.tsx`): `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title,
   `aria-describedby` the body; step counter "3 / 14" with `aria-live="polite"`; buttons Back
   (hidden on the first step), Next (last step: Done label), Skip (text button; hidden on the last
   step); optional "open section" link when the step has `href`. Placed beside the target
   (bottom preferred, then top, right, left; 12 px gap; clamped to the viewport with 16 px gutter);
   centred when there is no target. Width `min(22rem, calc(100vw - 2rem))`. Uses Button, text
   tokens (`text-h2` title, `text-body` body, `text-small` counter), `bg-raised`, `shadow-overlay`,
   `rounded-lg`. Reduced motion respected (`motion-safe:` only).
7. Keyboard: Tab trapped inside the card (trapTab), initial focus on Next, ArrowRight/ArrowLeft =
   next/back, Escape = skip (confirm nothing), focus returns to the opener on close
   (useReturnFocus).
8. Mount `TourProvider` + overlay in app-frame.tsx **without** any auto-start: add a temporary dev
   trigger `?tour=1` on the dashboard URL (removed in T1.4) so you and QA can open it.
9. Unit tests (`tour.test.ts`, node:test like the neighbours): target priority resolution,
   role filtering, index clamping, placement choice for a few rects. No browser tests here.

CONSTRAINTS
- No new dependency. No changes to ui/dialog.tsx, placement.ts, layers.ts beyond what is strictly
  necessary (prefer none; copy a small helper into the tour folder instead).
- The frame must render identically when the tour is closed (no layout shift, no extra DOM besides
  attributes).
- Files ≤ ~200 lines each.

IMPLEMENTATION STEPS
attributes → tour-steps.ts → tour-target.ts (+tests) → tour-context.tsx → tour-overlay.tsx →
tour-card.tsx → mount in app-frame → dev trigger → run the app (api + web on your ports), walk all
14 steps in light and dark theme, at 1440 px, at 1024 px (some tabs in "more"), at 375 px (centred
mode) → unit tests → full check set.

HOW TO TEST
- `npm run typecheck && npm run lint && npm test`.
- Manual: sign in as the seed user, open /dashboard?tour=1; Tab never leaves the card; Escape
  closes; the palette shortcut does nothing while open; dark theme renders with tokens; at 1024 px
  the bank/didox/products/onec steps spotlight the "more" button; at 375 px cards are centred and
  readable; a step whose target is absent (e.g. upload as a viewer) is filtered or centred.
- Take screenshots of 3 steps (desktop light, desktop dark, phone) into
  docs/onboarding-2026-10-23/screenshots/t1.2-*.png.

FINAL REPORT: per COMMON RULES; list the final `data-tour` keys and the exported API of useTour()
so T1.4 can wire it blind.
```

---

### T1.3 — Tour copy (uz + ru) in the i18n package

```
<COMMON RULES>

Branch: feat/tour-copy (cut from main; the coordinator merges it into feat/onboarding-tour).
Report: docs/onboarding-2026-10-23/t1.3-result.md.

CONTEXT
The tour (T1.2) reads its words from `ta.tourX`. Copy lives in the i18n package so order and
wording can change without touching logic. Audience: accountants and small-business owners.
Sentences must be very short and plain: what the section is FOR, never how it works inside.

INSPECT FIRST
- packages/i18n/src/i18n-parts/accounting.ts, onec.ts, firm.ts (`firmX.onboarding.steps`) for
  tone, the `_area` convention, function-valued strings, and the `uz` / `ru` same-shape rule;
  i18n-parts/index.ts (how parts are merged); i18n-parts/pricing.test.ts or firm.test.ts for the
  shape-test style; packages/i18n/README or the header comment of i18n.ts for the apostrophe rule.
- The step key list is fixed by the plan (T1.2): welcome, dashboard, upload, catalogs, queue,
  clients, products, bank, didox, onec, dictionary, activity, settings, done.

REQUIREMENTS
1. New `packages/i18n/src/i18n-parts/tour.ts` exporting `uz` and `ru` with the shape
   `{ tourX: { _area: 'tour', label, counter(n, total), next, back, skip, done, open, menuEntry,
   settingsTitle, settingsHint, settingsButton, steps: Record<StepKey, { title: string; body: string }> } }`.
   Merge it in i18n-parts/index.ts (both spreads). Add a small test that `ru` has every key of `uz`
   (if the type does not already guarantee it) and that no string contains an ASCII apostrophe.
2. Use this draft, improve wording where you can make it simpler, keep each body ≤ 2 sentences and
   ≤ 160 characters:

   label: "Platforma bilan tanishuv" / "Знакомство с платформой"
   counter: (n, total) => `${n} / ${total}` (both)
   next "Keyingi" / "Далее"; back "Orqaga" / "Назад"; skip "Oʻtkazib yuborish" / "Пропустить";
   done "Boshlash" / "Начать"; open "Boʻlimni ochish" / "Открыть раздел";
   menuEntry "Platformani oʻrganish" / "Экскурсия по платформе";
   settingsTitle "Platforma bilan tanishuv" / "Знакомство с платформой";
   settingsHint "Asosiy boʻlimlar boʻyicha qisqa yoʻl-yoʻriq, 2 daqiqa." /
     "Короткая экскурсия по основным разделам, 2 минуты.";
   settingsButton "Tanishuvni qayta koʻrish" / "Показать экскурсию снова".

   steps:
   welcome — "Xush kelibsiz!" / "Tasnivo bilan 2 daqiqada tanishib chiqamiz. Istalgan payt
     «Oʻtkazib yuborish»ni bosing." || "Добро пожаловать!" / "За две минуты покажем, где что
     находится. Пропустить можно в любой момент."
   dashboard — "Bosh sahifa" / "Bu yerda nima qilish kerakligi koʻrinadi: yangi topilmalar,
     mijozlar va birinchi qadamlar roʻyxati." || "Главная" / "Здесь видно, что требует внимания:
     новые находки, клиенты и список первых шагов."
   upload — "Katalog yuklash" / "Excel yoki CSV faylni shu yerdan yuklang. Ustunlarni dastur oʻzi
     taniydi." || "Загрузка каталога" / "Загрузите файл Excel или CSV. Столбцы распознаются
     автоматически."
   catalogs — "Kataloglar va natija" / "Har bir yuklangan katalog shu yerda. Ichida: xavfli
     qatorlar, taklif qilingan MXIK kodlari va hisobot." || "Каталоги и результат" / "Каждый
     загруженный каталог здесь. Внутри: рискованные строки, предложенные коды ИКПУ и отчёт."
   queue — "Koʻrib chiqish navbati" / "Qaror kutayotgan qatorlar bir roʻyxatda. Taklifni
     tasdiqlaysiz yoki rad etasiz." || "Очередь проверки" / "Строки, ждущие решения, в одном
     списке. Предложение можно принять или отклонить."
   clients — "Mijozlar" / "Har bir korxona uchun alohida mijoz: kataloglari va tarixi ajratilgan.
     Hamkasblarga faqat kerakli mijozlarni ochasiz." || "Клиенты" / "Отдельный клиент для каждой
     компании: каталоги и история хранятся раздельно. Коллегам можно открыть только нужных
     клиентов."
   products — "Mahsulotlar katalogi" / "Firmangiz va mijozlaringiz mahsulotlari bir joyda: MXIK,
     qadoq kodi va oʻlchov birligi tekshiriladi, 1C uchun fayl tayyorlanadi." || "Каталог товаров" /
     "Товары фирмы и клиентов в одном месте: проверяются ИКПУ, код упаковки и единица измерения,
     готовится файл для 1С."
   bank — "Bank koʻchirmalari" / "Bankdan olingan Excel koʻchirmani yuklang: operatsiyalar va
     kontragentlar aniqlanadi, 1C uchun fayl chiqadi." || "Банковские выписки" / "Загрузите выписку
     из банка в Excel: операции и контрагенты распознаются, на выходе файл для 1С."
   didox — "Didox hisob-fakturalar" / "Kiruvchi hisob-fakturalarni Didox arxividan yuklang.
     Mahsulotlar MXIK bilan solishtiriladi va 1C ga tayyorlanadi." || "Счета-фактуры Didox" /
     "Загрузите входящие счета-фактуры из архива Didox. Товары сверяются с ИКПУ и готовятся для 1С."
   onec — "1C import va tarix" / "Bank, Didox va katalog paketlari shu yerda: tekshiring,
     tasdiqlang va 1C uchun faylni yuklab oling." || "Импорт в 1С и история" / "Пакеты из банка,
     Didox и каталогов здесь: проверьте, подтвердите и скачайте файл для 1С."
   dictionary — "Firma lugʻati" / "Bir marta tasdiqlangan kod eslab qolinadi: keyingi katalogda shu
     tovar toʻgʻri kodni oʻzi oladi." || "Словарь фирмы" / "Подтверждённый код запоминается: в
     следующем каталоге тот же товар получит его автоматически."
   activity — "Harakatlar" / "Kim, qachon, nimani tasdiqlagani yoki rad etgani: hammasi shu
     jurnalda." || "Журнал действий" / "Кто, когда и что подтвердил или отклонил: всё в этом
     журнале."
   settings — "Sozlamalar va yordam" / "Hisob, xavfsizlik, tarif va integratsiyalar shu menyuda.
     Bu tanishuvni ham shu yerdan qayta ochasiz." || "Настройки и помощь" / "Аккаунт, безопасность,
     тариф и интеграции в этом меню. Здесь же можно снова открыть эту экскурсию."
   done — "Tayyor!" / "Birinchi qadam: katalog yuklang. Savol boʻlsa, Yordam markazi doim yonida."
     || "Готово!" / "Первый шаг: загрузите каталог. Если возникнут вопросы, Центр помощи всегда
     рядом."

3. No jargon: never "integratsiya", "sinxronizatsiya", "parser", "OData", "API" in step copy.
   Section names must match the app's own labels (accountingX.nav.*, nav.*, shellX.nav.*): read
   them and reuse the exact words.

CONSTRAINTS
- Only the i18n package changes (plus its tests). No web-app files.
- Do not change any existing string.

HOW TO TEST
`npm run typecheck && npm run lint && npm test -- packages/i18n` (or the repo's filter form; see
scripts/test.mjs).

FINAL REPORT: per COMMON RULES, plus the final uz/ru table so the owner can review the words
without opening the code.
```

---

### T1.4 — First-login trigger, mark-done, re-open entry points, mobile and a11y hardening

```
<COMMON RULES>

Branch: feat/onboarding-tour, after the coordinator merged feat/tour-engine (T1.2) and
feat/tour-copy (T1.3) into it. Report: docs/onboarding-2026-10-23/t1.4-result.md.

CONTEXT
T1.1 added `User.tourCompletedAt`, `PUT /api/account/tour { done }` (contract key named in
docs/onboarding-2026-10-23/t1.1-result.md) and `tour: 'pending' | 'done'` on the shell payload.
T1.2 built the engine (`ui/tour/*`, `useTour()`, `onDone`) with a dev trigger `?tour=1`. T1.3 added
`ta.tourX`. Nothing opens automatically yet and nothing is persisted.

INSPECT FIRST
- The three result notes. ui/shell/app-frame.tsx (where TourProvider is mounted; `shell.tour`,
  `shell.demo`, `shell.canWrite`), ui/tour/tour-context.tsx, ui/shell/user-menu.tsx (help entry),
  (app)/settings/account-tab.tsx (card layout, Button usage), apps/web/src/lib/api/browser.ts
  (`api.account.*`, CSRF handling is inside the client), apps/web/e2e/fixture.ts (how users are
  created: `db.user.create` with passwordHash), packages/db/prisma/seed.ts and scripts/seed-demo.ts.
- apps/web/src/app/sign-up/verify/page.tsx and sign-in/page.tsx: both land on /dashboard; the frame
  renders there with the shell payload.

REQUIREMENTS
1. Auto-start: when `shell.tour === 'pending'`, not `shell.demo`, the route is `/dashboard`, no
   other `[aria-modal="true"]` is open and the page has been mounted for ≥ 600 ms, call `start()`
   once per page load. Never auto-start on any other route (a deep link from an invite should not
   be interrupted) and never twice in one session (a ref).
2. Persist: `onDone` (finished or skipped) → `api.account.setTour({ done: true })`; on failure,
   retry once after 2 s, then give up silently (the tour will show again next time; never block the
   user). Update the local shell state so a client-side navigation does not restart it.
3. Re-open: (a) user menu: a new item "Platformani oʻrganish" (`ta.tourX.menuEntry`) directly
   under Help, with an icon from ui/icons or ui/shell/icons; (b) Settings → Account: a small card
   `ta.tourX.settingsTitle` / `settingsHint` with a secondary Button `settingsButton`; both call
   `start()` (which first navigates to /dashboard). Re-opening does not change the DB flag.
4. Remove the `?tour=1` dev trigger.
5. Mobile: confirm centred mode below `md` (T1.2) and that the card never exceeds the viewport
   on a 375 × 667 screen with the phone address bar (use `dvh`); body text ≥ 14 px; buttons ≥ 40 px
   tall (`h-control-lg`); the Skip button stays reachable without scrolling.
6. A11y pass: screen-reader name of the dialog = `ta.tourX.label`; the step counter is announced;
   the spotlighted element is referenced by `aria-describedby`? No: keep it simple, the card's text
   names the section. Verify Tab trap, Escape, arrow keys, focus return, no focus lost when a
   step's target is absent. `prefers-reduced-motion` disables the overlay fade and card pop.
7. Missing-target resilience: a step whose targets are all absent AND has no copy fallback must not
   throw; the engine renders the centred card. Role filtering: `upload` only when `shell.canWrite`;
   team-only content stays out (no team step exists).
8. Fixtures: apps/web/e2e/fixture.ts creates every user with `tourCompletedAt: new Date()` so the
   66 e2e tests are not blocked; packages/db/prisma/seed.ts likewise for the seed user; demo users
   are 'done' by rule. Add ONE e2e test file `apps/web/e2e/onboarding-tour.e2e.ts` (node:test +
   Playwright like the neighbours): a fresh user (tourCompletedAt null) signs in → the dialog with
   the tour label is visible on /dashboard → Next twice → Skip → reload → no dialog; the user-menu
   entry reopens it. Keep it under 60 s.
9. Locale: switch the interface to ru (user menu) and check every step reads from `ta.tourX` (no
   Uzbek leaks).

CONSTRAINTS
- Do not change the dashboard checklist behaviour. Do not add the tour to the demo flow.
- No auto-start for users whose `verified` is false (the frame does not render for them anyway;
  confirm).

HOW TO TEST
- Fresh account end to end on your ports: `/sign-up` with a new address → code from the API log or
  tmp/outbox/ → /dashboard shows the tour → Skip → DB row has tourCompletedAt → sign out, sign in:
  no tour → user menu reopens it; Settings → Account button reopens it.
- Existing seed user (buxgalter@demo.uz): no tour (fixture marks it done).
- Viewer role (create via /team invite or the e2e fixture): no `upload` step.
- 375 px (DevTools), dark theme, ru.
- `npm run typecheck && npm run lint && npm test`; `npm run test:e2e` for navigation.e2e.ts,
  shell-layout.e2e.ts, settings-nav.e2e.ts and your new file (web `next start` + API, see
  HANDOFF §1 gotchas on `E2E_CHANNEL=msedge` and the sign-in rate limit).
- Screenshots: welcome on desktop light, bank step at 1024 px (more menu), a centred step on the
  phone, dark theme — into docs/onboarding-2026-10-23/screenshots/t1.4-*.png.

FINAL REPORT: per COMMON RULES; state explicitly which of the checks in "how to test" you ran and
their results.
```

---

### T1.5 — QA pass of the onboarding tour

```
<COMMON RULES>

Branch: feat/onboarding-tour (after T1.4). Report: docs/onboarding-2026-10-23/qa-report.md with
screenshots under docs/onboarding-2026-10-23/screenshots/.

CONTEXT
The tour is complete on this branch. You are the tester: find what breaks, fix small things in
ui/tour/* yourself, and list anything bigger as a bug with steps to reproduce. The owner will decide
on merging after seeing the screenshots.

INSPECT FIRST
docs/onboarding-2026-10-23/t1.1..t1.4 result notes; ui/tour/*; the e2e file onboarding-tour.e2e.ts;
docs/accounting-2026-10-23/qa-checklist.md for the house style of a QA report (PASS/FAIL table).

CHECKLIST (each row: PASS / FAIL + evidence)
1. Fresh password account (new e-mail, code from tmp/outbox/): tour opens on /dashboard once; skip
   persists across sign-out/sign-in and across a second browser.
2. Fresh Google account cannot be tested without credentials: state so; instead set
   tourCompletedAt = null on an existing user in the DB and sign in → tour opens.
3. Existing seed user: no tour. Demo org (request a demo at /demo, link from tmp/outbox/): no tour.
4. All 14 steps at 1440 px: each spotlight lands on the right element; the card never covers the
   spotlighted element; no horizontal scroll.
5. 1024 px: steps whose tab is in the "more" menu spotlight the more button; nothing is off-screen.
6. 375 × 667 (phone emulation): centred cards, readable, Skip reachable, no page scroll underneath.
7. Dark theme and `system` theme: overlay and card use tokens (no white flash, text contrast ≥ 4.5:1
   by eye; the token test covers the pairs).
8. Keyboard only: Tab trapped, Shift+Tab, Enter on Next, Escape skips, arrows work, focus returns
   to the opener when re-opened from the user menu; a screen reader (Windows Narrator or NVDA if
   available) announces the dialog name and the step counter.
9. Missing target: temporarily remove one `data-tour` attribute (do not commit) → the step is
   centred, no console error.
10. Role filtering: viewer sees no upload step; accountant sees the tour; admin sees everything.
11. Interplay: open the command palette (/) during the tour → nothing happens; open the tour while
    a dialog is open (Settings → close account) → it waits or does not start; Escape closes the
    topmost layer only.
12. ru locale: every string Russian; counter format; no apostrophe glitches in uz.
13. Performance: the frame with the tour closed renders no extra DOM except attributes (inspect);
    no layout shift on /dashboard (compare before/after screenshots).
14. Full checks: typecheck, lint, `npm test`, `npm run build` (web, with API_INTERNAL_URL), and the
    full `npm run test:e2e` once on a production build (`next start`) with the API: report
    pass/fail counts; the suite was 66/66 on main.

CONSTRAINTS
Fix only inside ui/tour/*, the e2e file and copy typos in i18n-parts/tour.ts; anything else goes
to the bug list with a proposed owner.

FINAL REPORT: the qa-report.md (table + screenshots list + bug list + the exact commands run) and
a one-paragraph verdict: ready for the owner's visual review or not.
```

---

### T2.1 — Feature inventory and landing section plan

```
<COMMON RULES>

Branch: feat/landing-2026-10 (cut from main). Output: docs/landing-2026-10-23/feature-inventory.md.
No product code changes in this subtask.

CONTEXT
The landing (apps/web/src/app/page.tsx + components/landing/*) still sells "MXIK audit only". The
product now also has bank statements → 1C, Didox invoices → 1C, a product catalogue with MXIK
intelligence, and 1C file exports (plus the older clients, team, dictionary, API, Telegram). The
plan's §1.2 table is the planning agent's reading of the code; your job is to verify it row by row
and turn it into the content brief the next three subtasks write from.

INSPECT FIRST
- docs/ONBOARDING_LANDING_PLAN_2026-10-23.md §1.2–1.4 and §2 (Q2, Q3, Q5).
- docs/accounting-2026-10-23/FINAL_REPORT.md §1 and §3 (verified vs implemented), the four
  agent<N>-result.md notes (what each module can and cannot do; Didox auth models; bank layouts;
  1C formats in onec-formats.md), docs/CONTINUE_2026-10-23.md "Not verified".
- The i18n parts bank.ts, didox.ts, products.ts, onec.ts, accounting.ts: the product's own words
  for every feature (reuse them on the landing so the page and the app say the same thing).
- Every landing component and data.ts (what is claimed today, which claims are sourced), config.ts
  flags, the help centre article api-va-integratsiyalar.mdx.
- packages/domain/src/billing/plans.ts PLAN_FEATURES (what is gated).

REQUIREMENTS
Write feature-inventory.md with:
1. A table: feature | where in the app | what the user gets (one plain sentence, Uzbek, reusing the
   app's own labels) | status: live / live-but-unverified-against-the-real-system / partial / not
   built | evidence (file or report section) | landing decision: show as live / show with "sinov
   rejimida" badge / omit, with one line of reasoning. Cover at least: MXIK audit (the four checks
   + restricted/privilege/purchase/marking findings), suggestions with classifier path, decisions
   and history, Excel export in the original shape, 1C CSV of a catalogue, PDF report, share links,
   versions/diff, clients and client switcher, team roles and invites, firm dictionary, Telegram
   notifications and file-to-audit, Google sign-in, public API v1 + Google Sheets add-on, bank
   statements (layouts, rules, reconciliation, kl_to_1c.txt), Didox (archive/JSON/xlsx upload;
   token connection and sync), products (import, checks, packaging codes, nomenclature xlsx), 1C
   (file kinds; OData/http direct transfer; counterparties), demo, pricing/plans, security (2FA,
   sessions, data export, retention).
2. The final landing section list in order, each with: id/anchor, purpose, which inventory rows it
   uses, and which existing component it changes or replaces. Default (adjust if the code says
   otherwise): Hero (broadened) → Problem (keep; add one row about re-typing documents into 1C) →
   Consequences (keep as is) → Capabilities (MXIK audit, keep) → NEW "Buxgalteriya: bank, Didox,
   mahsulotlar, 1C" section with four cards and the flow strip "manba → oʻqish → solishtirish →
   tekshiruv → tasdiqlash → 1C fayli" → DemoBand (keep) → Workflow (keep 4 steps, note that the
   same review-and-approve loop applies to documents) → Outcomes (show the clients row; add "1C ga
   tayyor fayl") → Trust (keep; add one line that documents follow the same data rules: check what
   bank/Didox data leaves the server and say it precisely, read packages/domain bank/didox code for
   any external call) → Pricing (keep + Q2 sentence) → FAQ (rewrite: add 1C/Didox/bank questions)
   → FinalCta (keep).
3. Draft copy for the four accounting cards (title, "nima uchun", "muammo", "qanday ulanadi",
   badge?) and two hero headline options, Uzbek, ≤ 2 sentences each, no jargon, benefit first.
4. A list of every claim on the current page that is now wrong or stale (e.g. config.ts "no public
   demo", SHOW_MULTI_CLIENT, the FAQ "qaysi ustunlar" wording if the products flow reads more
   columns), with the fix owner (T2.2 / T2.3 / T2.4).
5. Open questions for the owner, each with your default.

CONSTRAINTS
Do not describe anything the code cannot do. Where a report says "implemented, not verified
against the real system", the landing decision must be the badge or omission, never "live".

FINAL REPORT: the document itself plus the chat summary per COMMON RULES.
```

---

### T2.2 — Hero, value proposition, navigation, CTAs, stale flags

```
<COMMON RULES>

Branch: feat/landing-2026-10 (after T2.1 is committed on it). Report:
docs/landing-2026-10-23/t2.2-result.md.

CONTEXT
docs/landing-2026-10-23/feature-inventory.md is the agreed content brief. This subtask rewrites the
top of the page and the frame: the product is now "MXIK audit + documents into 1C", for the same
audience (accountants, outsourcing firms, small businesses).

INSPECT FIRST
feature-inventory.md; landing/hero.tsx, problem.tsx, site-header.tsx, site-footer.tsx,
shell-copy.ts, config.ts, outcomes.tsx, product-preview.tsx (what the hero visual shows: a catalogue
workspace; keep it, it is real), sticky-cta.tsx, landing.css, button.tsx; app/page.tsx (section
order; T2.3 owns adding the new section, you only touch what is listed here).

REQUIREMENTS
1. Hero: eyebrow unchanged; new H1 from the inventory's options (≤ 14 words, keep the `<em>`
   rhythm); new lead paragraph (≤ 2 sentences) naming the three jobs: check MXIK in the catalogue,
   turn bank statements and Didox invoices into 1C-ready files, keep every decision in history.
   CTAs stay: "Bepul boshlash" → /sign-up, "Qanday ishlashini koʻrish" → #demo, the free-audit line
   → #audit. Under the preview, keep the "this is a sample" note.
2. Problem: keep the code-decoder half; in the "Qoʻlda / Tasnivo bilan" table add one row for
   documents (before: re-type the bank statement and the invoice lines into 1C; after: upload the
   file, review the exceptions, download the 1C file). Keep the three portal examples.
3. Header links: add "Buxgalteriya" → `/#buxgalteriya` (the anchor T2.3 creates) between "Qanday
   ishlaydi" and "Narxlar"; keep the rest. shell-copy.ts gets the uz and ru words (the help centre
   frame uses ru). Footer unchanged except nothing stale.
4. Outcomes: delete the SHOW_MULTI_CLIENT flag and show the clients row; add one row "1C ga tayyor
   fayl" using the inventory's wording; keep the rest.
5. config.ts: fix the stale DEMO_URL comment (a demo exists at /demo via e-mail link); remove
   SHOW_MULTI_CLIENT and its env var from .env.example and DEPLOY.md if mentioned (grep).
6. Sticky CTA label unchanged.

CONSTRAINTS
- Same components, same `lp-*` classes, same layout; no new sections here.
- Every sentence must be true per the inventory; no numbers that are not already on the page.
- Uzbek apostrophes U+02BB.

HOW TO TEST
- `npm run typecheck && npm run lint && npm test` (landing tests next to the components;
  tests/web-parity).
- Run web on your port (API not needed for the landing except the lead form): check 1440 / 1024 /
  375 px, header menu below lg, the new anchor link (404 until T2.3: note it), keyboard focus
  styles. Screenshot hero at desktop and phone into docs/landing-2026-10-23/screenshots/t2.2-*.png.

FINAL REPORT: per COMMON RULES.
```

---

### T2.3 — Capabilities, the new accounting section (1C / Didox / bank / products), workflow

```
<COMMON RULES>

Branch: feat/landing-2026-10 (after T2.2). Report: docs/landing-2026-10-23/t2.3-result.md.

CONTEXT
The page still has no word about bank statements, Didox invoices, the product catalogue or 1C. The
inventory (docs/landing-2026-10-23/feature-inventory.md) has the agreed cards and badges; this
subtask builds the section and adjusts the neighbours.

INSPECT FIRST
feature-inventory.md; landing/capabilities.tsx (Tile pattern), workflow.tsx (STEPS reading export
column names from i18n so copy cannot drift: imitate that for the accounting words, read them from
i18n-parts/accounting.ts, bank.ts, didox.ts, products.ts, onec.ts), data.ts (CHECKS, DATA_FLOW),
outcomes.tsx, app/page.tsx; ui/icons.tsx and ui/shell/icons.tsx (IconBuilding, IconSend, IconBox,
IconSwitch are the app's icons for the four modules: reuse them so the landing and the app match);
docs/accounting-2026-10-23/onec-formats.md (the exact 1C file kinds and names).

REQUIREMENTS
1. New `landing/accounting.tsx`, section `id="buxgalteriya"`, placed after Capabilities and before
   DemoBand in page.tsx. Content: eyebrow "Buxgalteriya", H2 (benefit: documents in, 1C-ready file
   out, you review the exceptions), a flow strip of six short words (manba → oʻqish → solishtirish →
   tekshiruv → tasdiqlash → 1C fayli), then four cards in a 2 × 2 grid (1 column on phones):
   Bank koʻchirmalari, Didox hisob-fakturalar, Mahsulotlar katalogi, 1C import va tarix. Each card:
   the module's icon, title = the app's nav label, three labelled lines "Nima uchun", "Muammo",
   "Qanday ulanadi" from the inventory draft, and where the inventory says so a small badge
   "sinov rejimida" on the specific line (Didox token sync; 1C direct transfer), never on the
   whole card. One closing line under the grid: "Fayllar 1C «Buxgalteriya 8 Oʻzbekiston uchun» ga
   yuklanadigan formatlarda: <names from onec-formats.md>".
2. Capabilities: keep the four checks tile; retitle the section H2 to cover the catalogue only
   ("Katalogni tekshirish" scope) so it does not claim to be the whole product; no other change.
3. Workflow: keep the four steps; add a one-sentence note under the heading that bank statements
   and invoices go through the same review → approve → file loop (true per FINAL_REPORT §1).
4. data.ts: add `ACCOUNTING_FLOW` (the six words) and the four cards' copy as data, so T2.4 and the
   FAQ can reuse the same strings; keep the "every figure is measured" discipline (no figures in
   this section at all).
5. Honesty text for the two beta lines, one sentence each, e.g. "Toʻgʻridan-toʻgʻri ulanish hali
   haqiqiy Didox bilan sinovdan oʻtmagan; arxiv yuklash ishlaydi." Mirror what the app's own
   `didoxX.unverified` banner says.

CONSTRAINTS
- Reuse `Tile`-like markup and the `lp-*` tokens; no new CSS beyond landing.css additions ≤ 10 lines.
- No screenshots or invented UI images; the section is text + icons (the real UI is in DemoBand).
- Keep page.tsx changes to the import and the one new element.

HOW TO TEST
- Checks as in COMMON RULES. Visual at 1440 / 768 / 375; the header anchor from T2.2 now lands on
  the section with the correct scroll offset; badges readable; icons render.
- Screenshots: the section at desktop and phone → docs/landing-2026-10-23/screenshots/t2.3-*.png.

FINAL REPORT: per COMMON RULES, including the final card texts.
```

---

### T2.4 — FAQ, pricing note, SEO / meta / OG, app tagline

```
<COMMON RULES>

Branch: feat/landing-2026-10 (after T2.3). Report: docs/landing-2026-10-23/t2.4-result.md.

CONTEXT
The remaining places that still say "catalogue audit only": FAQ, pricing lead/notes, the page
<title>/description/OG, the generated OG image, and the app-wide tagline used as the default
<title> and on auth pages.

INSPECT FIRST
landing/faq.tsx, pricing.tsx (+ i18n-parts/pricing.ts prX: lead, oneOff, payTransfer),
app/page.tsx metadata, app/opengraph-image.tsx (Latin-only font: no oʻ/gʻ), app/layout.tsx
generateMetadata, packages/i18n/src/i18n.ts + i18n-ru.ts `tagline` and where it is rendered (grep
`tagline`), app/sitemap.ts, app/robots.ts, the help centre tariflar-va-limitlar.mdx (pricing
details page the section links to), plan §2 Q2.

REQUIREMENTS
1. FAQ: keep the five current answers (update "qaysi ustunlar oʻqiladi" if the inventory changed
   it) and add four: "1C ga qanday yuklanadi?" (file kinds, load through 1C's own import; direct
   connection is beta), "Didox bilan qanday ishlaydi?" (archive upload works; token connection
   beta), "Bank koʻchirmasi qaysi formatda boʻlishi kerak?" (Excel/CSV from the bank; layouts
   recognised or mapped once and remembered), "Hujjatlardagi maʼlumotlar qayerga ketadi?" (precise
   per the inventory's data check: reuse DATA_FLOW wording style). Short, plain, no jargon.
2. Pricing: one sentence under the plan cards per Q2 ("1C, bank va Didox modullari hozircha barcha
   tariflarga kiradi."), added to i18n-parts/pricing.ts (uz + ru) and rendered in pricing.tsx. Do
   not change PRICING numbers, PLAN_FEATURES or the parity test.
3. page.tsx metadata: TITLE "Tasnivo | MXIK auditi, bank koʻchirmalari va Didox hisob-fakturalari
   1C uchun" (or better, ≤ 60 chars if you can), DESCRIPTION ≤ 160 chars covering the three jobs
   and "Risk auditi bepul"; OG and twitter follow.
4. opengraph-image.tsx: headline and the two rows updated to the broader product with the Latin-
   only constraint (no U+02BB characters); `alt` updated; check it renders (`/opengraph-image` on
   your dev server).
5. Tagline: i18n.ts/i18n-ru.ts `tagline` → one short line that fits a browser tab, e.g. "MXIK
   auditi va 1C uchun hujjatlar" / "Аудит ИКПУ и документы для 1С". On main it is rendered only by
   app/layout.tsx (default <title> and description); grep `tagline` across apps/ and packages/ to
   confirm there is no other render site before changing it.
6. sitemap/robots: confirm nothing to change (the new section is an anchor); say so.

CONSTRAINTS
Only the files above. The Russian tagline needs a native-speaker flag in the report (the ru
dictionary header says texts need review before launch).

HOW TO TEST
Checks per COMMON RULES; open the page, read the FAQ at 375 px; curl the page and check <title>,
meta description, og:* tags; open /opengraph-image; switch the app to ru and check the tab title on
/sign-in. Screenshot the OG image → docs/landing-2026-10-23/screenshots/t2.4-og.png.

FINAL REPORT: per COMMON RULES, with the final title/description strings.
```

---

### T2.5 — Landing QA: links, anchors, forms, build, visual

```
<COMMON RULES>

Branch: feat/landing-2026-10 (after T2.4). Report: docs/landing-2026-10-23/qa-report.md.

CONTEXT
Content and structure changed in T2.2–T2.4. Verify nothing broke and the page is honest, then hand
the owner a screenshot set for the visual review (the owner decides on merging).

CHECKLIST (PASS / FAIL + evidence)
1. Every link and anchor on the landing: header (desktop + the `<details>` menu below lg), hero
   CTAs, sticky CTA, pricing CTAs, help links, footer, FAQ links, the new #buxgalteriya anchor,
   /maxfiylik, /oferta, /yordam, /demo, /sign-up, /sign-in, external lex.uz / t.me links open in a
   new tab with rel noopener. Use a script or Playwright to collect every href and request each
   internal one (expect 200; /demo and auth pages are app routes and need the API running).
2. Lead form (#audit): submit with a small xlsx on your dev stack (API up) → the API accepts it
   (POST /api/lead) and the success state renders; validation messages still show.
3. Pricing switch monthly/yearly still works; parity test passes.
4. Visual: 1440 / 1024 / 768 / 375 px, light only (the landing is light by design): no horizontal
   scroll, no overlapping text, badges legible, the accounting cards align, headings fit in two
   lines at 375 px. Screenshots of the full page at 1440 and 375 →
   docs/landing-2026-10-23/screenshots/final-*.png.
5. Claims audit: read the whole page once as an accountant; list every sentence that promises
   something the inventory marks unverified or absent; fix wording in place (small) or list.
6. SEO: `<title>`, description, canonical (with NEXT_PUBLIC_SITE_URL set), og:image URL absolute,
   sitemap.xml and robots.txt unchanged and valid.
7. Accessibility: headings order (one h1), landmarks, `details/summary` keyboard, focus visible on
   every link/button, colour contrast of the new badge (compute with src/styles/contrast.ts or by
   eye against the `lp-` tokens), skip link.
8. Checks: typecheck, lint, `npm test`, `npm run build` with `API_INTERNAL_URL=http://localhost:
   <api port>` (never beside a running next dev on the same checkout), `next start` and repeat
   items 1 and 4 on the production build. e2e: run demo-access.e2e.ts and navigation.e2e.ts if they
   touch the landing (read them first).

CONSTRAINTS
Fixes limited to apps/web/src/components/landing/* and app/page.tsx wording; anything else is a
bug for the list.

FINAL REPORT: the QA report (table, screenshot list, open issues) and a verdict: ready for the
owner's visual review or not.
```

---

### T2.6 (optional) — Help-centre article for the accounting modules

```
<COMMON RULES>

Branch: feat/landing-2026-10 (after T2.3) or its own branch feat/help-accounting. Report:
docs/landing-2026-10-23/t2.6-result.md.

CONTEXT
The help centre (apps/web/src/content/yordam/{uz,ru}/*.mdx, index in apps/web/src/lib/help.ts) has
no article about bank statements, Didox invoices, the product catalogue or 1C files; its
"API va integratsiyalar" article says Tasnivo connects "in three ways". The landing's FAQ (T2.4)
needs somewhere to link for details.

INSPECT FIRST
help.ts (HELP_ARTICLES shape, slugs are Uzbek, both languages required), two existing articles in
both languages (structure, headings, the <ApiRate /> style components in help-mdx.tsx), the four
module result notes and onec-formats.md for facts, the app's own strings (bank.ts, didox.ts,
products.ts, onec.ts) for names of screens and buttons.

REQUIREMENTS
1. New article slug `1c-bank-didox` ("1C, bank va Didox" / "1С, банк и Didox"): what each section
   does, step by step as the user sees it (upload → review → approve → download), the 1C file
   kinds and how to load each in 1C (only what onec-formats.md states; mark the direct connection
   as beta), what is checked on invoice lines, what "unresolved" means, where settings live.
   uz and ru, same headings.
2. Register it in HELP_ARTICLES; update api-va-integratsiyalar.mdx's first sentence in both
   languages to mention the new article; sitemap picks it up automatically (confirm).
3. Add the link to the landing FAQ answers of T2.4 (one link each, "Batafsil").

HOW TO TEST
Checks per COMMON RULES (help.test.ts covers the index); open /yordam/1c-bank-didox and
/yordam/ru/1c-bank-didox; language switch; phone width.

FINAL REPORT: per COMMON RULES.
```

---

## 5. Definition of done for the whole effort

Tour (branch `feat/onboarding-tour`):
- A brand-new account (password or Google) sees the tour exactly once on its first dashboard
  visit; skipping or finishing persists in `user.tourCompletedAt`; it never auto-opens again on
  any device; the user menu and Settings → Account reopen it.
- 14 configurable steps in one file, copy in `i18n-parts/tour.ts` (uz + ru), no jargon; every
  main section covered.
- Spotlight + card on desktop, centred cards below `md`; a missing target never breaks a step;
  keyboard-complete (Tab trap, Esc, arrows, focus return), `aria-modal` dialog, reduced motion
  honoured, dark theme via tokens, no new dependency.
- Demo orgs, e2e fixtures and seed users are pre-marked done; the e2e suite stays green (66 + the
  new tour spec); typecheck, lint, `npm test`, web build green; migration documented in the
  rollback guide.
- QA report with screenshots; the owner has reviewed it visually and said OK before the merge.

Landing (branch `feat/landing-2026-10`):
- Hero, problem, capabilities, new "Buxgalteriya" section, workflow note, outcomes, pricing note,
  FAQ, title/description/OG/OG image and the app tagline describe the product as it is on `main`:
  MXIK audit + bank/Didox/products → 1C files, with the two unverified direct connections badged
  "sinov rejimida" and nothing invented.
- `SHOW_MULTI_CLIENT` removed; stale comments fixed; every new app string exists in uz and ru
  (landing-only strings are Uzbek, as before).
- All links, anchors, forms and the pricing switch verified on a production build; typecheck, lint,
  tests, parity test and build green; QA report with full-page screenshots at 1440 and 375 px.
- The owner has reviewed the screenshots and said OK before the merge; the two branches merge
  into `main` without conflicts (disjoint files; `i18n-parts/index.ts` keeps both spreads).
