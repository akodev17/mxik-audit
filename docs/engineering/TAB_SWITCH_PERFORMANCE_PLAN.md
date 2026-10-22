# Tab switching performance: engineering plan

Written 2026-10-21 from the repository at `main` = `0a33f1a` (clean). Every
statement below is either read from the code (file named) or measured today
(conditions named). Items marked **(unverified)** are hypotheses the
implementer must confirm or reject by measurement before acting on them.

The implementer works in **their own worktree** (never in the main checkout: a
dev server owned by the user runs there on port 3000, and `next build` in that
folder corrupts its `.next`; see Known Problem 7 in `docs/SESSION_STATE.md`),
reads this file first, and reports against the baseline of §4 in
`docs/engineering/TAB_SWITCH_PERFORMANCE_REPORT.md`.

---

## 0. What "tabs" are in Tasnivo, and the stack

| Item | Fact |
|---|---|
| Framework | Next.js 15.5.23, App Router, React 19.2.8, React Server Components. No client data library (no react-query, no SWR, no Redux). Server actions for mutations, Prisma 6 on Postgres 16 (Docker `mxik-audit-db`, host port 54329). |
| "Tabs" (header) | `src/ui/shell/top-nav.tsx`: seven `<Link>`s to `/dashboard`, `/queue`, `/clients`, `/team`, `/catalogs`, `/dictionary`, `/activity`; `src/ui/shell/rail.tsx` adds `/settings`, help and `/upload`. **Each tab is a separate server-rendered page**; switching tabs is a Next soft navigation that fetches a fresh RSC payload and runs that page's database queries. |
| Settings tabs | `src/app/(app)/settings/page.tsx`: `?tab=` links (`src/ui/tabs.tsx`); each is again a server render of the whole settings page. |
| Dashboard tabs | `src/ui/tab-panels.tsx`: client-side, all panels pre-rendered, `hidden` toggled. Already instant; nothing to do. |
| Workspace filters | `src/app/(app)/catalogs/[id]/filter-controls.tsx` `useFilterNav` → `router.replace(?…)`; the page re-renders on the server and `<Workspace key={catalogId|filterKey}>` plus `RouteBoundary` remount the grid on every filter change (by design, see §2.4). |
| Shell | `src/app/(app)/layout.tsx` → `AppFrame` (client) with `RouteBoundary` (a `Suspense` keyed by path+query, `src/ui/shell/route-boundary.tsx`), `NavigationWatchdog` and `ResponseNudge` (`src/ui/shell/same-route-links.ts`, `response-nudge.ts`), `CommandPalette`, `ClientSwitcher`, `NotificationBell`. |
| Existing guards | `e2e/navigation.e2e.ts`, `e2e/refresh.e2e.ts` (navigations and refreshes must commit; run with `E2E_NO_NAV_FALLBACK=1`), `e2e/scale.e2e.ts` (3000-row workspace: first rows < 5 s, j/k median < 100 ms, p95 < 250 ms, production build). 324 unit tests (`npm test`). |

---

## 1. The tab-switch lifecycle as it is today (traced in code)

1. **Click.** `NavigationWatchdog` (capture-phase window listener) records the target and arms an 8 s timer; `next/link` calls `router.push`.
2. **Router cache lookup.** Next 15 defaults `experimental.staleTimes.dynamic` to **0**, and no page sets `prefetch`. `<Link>` on a dynamic route prefetches only down to the nearest loading boundary (`(app)/loading.tsx`), never the page. **So every tab click, including a return to a tab seen two seconds ago, fetches the page from the server.** (`next.config.ts` has no `staleTimes`; grep for `prefetch=` in `src` finds nothing.)
3. **Server render of the page segment.** Per request, the page runs (read from each `page.tsx`):
   - `generateMetadata` **and** the page both call `getI18n()` and `currentUser()`. `currentUser` = cookie unseal + `loadAccess` (React-`cache`d, 1 query) + `recordAccepted → isLive(sid)` (**not** cached, 1 query per call). The workspace page also runs `db.catalog.findFirst` twice (metadata + page).
   - Page loaders, static await counts: dashboard 6 (`dashboard()` = `clientStats` raw SQL + 3 parallel loaders; then `openTasks`, `onboardingSteps`, `activityPage(40 rows)`, `planStatus` in parallel; then **a sequential tail** `pendingAudits` after the `Promise.all`), clients 6, `clients/[id]` 8 parallel, catalogs 6, queue 5 (`queuePage` raw SQL, 50 rows + byClient aggregate), activity 6, dictionary 6, settings 5.
   - `planStatus` (1 + 4 queries, `src/lib/plan.ts`) is run by the layout's `shellData` **and again** by the dashboard page; `isDemoOrg` (1 query) is run by several pages although `loadAccess` already fetched `org.kind`. Only `session.ts` uses `React.cache` anywhere in `src/lib`.
   - The `(app)` layout itself (`shellData`: active client resolution 1–2 queries, `visibleClients`, `unreadCount`, `planStatus`) is a shared segment: Next does not re-render it on a soft navigation between its children **(unverified: confirm with the Prisma query log in §4; if the layout does re-run per navigation it is the first thing to fix)**.
4. **Streaming + commit.** The RSC stream arrives; `RouteBoundary`'s key changes, so React commits the `PageSkeleton` fallback (immediate feedback, good) and then mounts the new page tree from scratch. Client components hydrate (the queue/activity/catalog lists are server components; the workspace, dictionary table, filters, menus are client components).
5. **After the response.** `ResponseNudge` schedules two state updates (50 ms, 1 s) on an empty component; the watchdog clears its timer when the address changes. Both are cheap by construction.

**Root cause, in one sentence:** a tab switch is always a cold server round trip (session check + 6–15 Postgres queries, some duplicated, some sequential) followed by a full remount of the page tree, and nothing caches the previous tab, so "warm" switching is identical to "cold" switching and the skeleton flashes every time.

---

## 2. Measured and observed facts (2026-10-21, **dev server**, Windows, webpack `next dev`)

These are from the running dev server and are **not** the baseline (see §4); they
only rank the suspects. React's dev-mode RSC payloads carry debug metadata and
dev compiles routes on first hit, so sizes and times are inflated.

| Observation | Value | Source |
|---|---|---|
| `/sign-in` document, dev, first hit / warm | 11.8 s / 0.8–1.4 s TTFB | curl, 4 runs |
| RSC payload size, dev | dashboard 26 KB, clients 38 KB, catalogs 20 KB, **queue 454 KB** (50 rows rendered twice: an `md:` table and a phone card list, `src/app/(app)/queue/queue-list.tsx`) | in-page `fetch(href, {RSC:1})`, `encodedBodySize` |
| RSC fetch duration, dev, first hit per route | 12–45 s (compile) | same |
| In-page benchmark across 8 tabs | could not complete: the dev server reloaded the document mid-run | — |
| Query-only navigation | page remounts from the skeleton (by design) | `route-boundary.tsx`, `navigation.ts` |
| Mutation invalidation | 48 `revalidatePath(...)` calls across `src/app/actions/*`; the workspace, bell, catalog status use `router.refresh()`; client switch and sign-out are document loads | grep |

### 2.1 Suspect ranking (highest expected impact first)

| # | Suspect | Expected share of a switch | Evidence | Fix in |
|---|---|---|---|---|
| S1 | Server TTFB: duplicated per-request work (`currentUser` ×2, `getI18n` ×2, `planStatus` ×2, `isDemoOrg`, `catalog.findFirst` ×2) and sequential tails (dashboard `pendingAudits`; `planStatus` → `usageOf`; `catalogList` → `auditEvent.findMany` → `user.findMany`) | largest | §1.3 | Phase 1 |
| S2 | No warm path: router cache 0 s, no page prefetch | every revisit = cold | §1.2 | Phase 2 |
| S3 | Heavy pages ship large RSC payloads and render each row twice (queue, maybe activity, clients) | medium on those tabs **(unverified in prod)** | §2 table | Phase 3 |
| S4 | Full remount per address (`RouteBoundary` key = path + query; `Workspace key`), skeleton on every filter change | perceived latency on in-section navigation | §2.4 | Phase 4 (spike, may be left) |
| S5 | Client-side render/hydration cost of the shell and pages | small **(unverified)**: shell contexts are memoised (`useNav`, `LocaleProvider`, `ThemeRoot`), nudges are null components, the grid is virtualised | code read | Phase 5, only if the profile shows > 50 ms |
| S6 | Dev-only cost (webpack compile, dev RSC payloads) | dominates what the user sees locally | §2 | Not a product change; §7 |

### 2.4 Why the remounts exist (do not undo without proof)

`src/ui/shell/navigation.ts` documents a production bug: under Next 15.5's React 19.2 canary, a same-boundary transition that suspends on a streamed RSC chunk resolving mid-render drops its ping and never commits. `RouteBoundary` (fresh Suspense per address), `ResponseNudge` (state tick after every server response) and `NavigationWatchdog` (8 s fallback to a document load) are the workarounds, guarded by `e2e/navigation.e2e.ts` and `e2e/refresh.e2e.ts`. Any change to boundary keys or to the nudges must pass those files with `E2E_NO_NAV_FALLBACK=1` against a **production** build, repeatedly (the bug was intermittent: 16/16 on the dashboard, 12/16 on a client page).

---

## 3. Targets

| Metric | Target | Measured how (§4) |
|---|---|---|
| Warm tab switch (tab visited < 30 s ago), click → content visible | p95 < 100 ms, no network request | nav script, `switch.contentMs`, `rscFetches === 0` |
| Cold tab switch (first visit or stale), click → skeleton | next frame (< 50 ms) | `switch.feedbackMs` |
| Cold tab switch, click → content visible | p50 < 400 ms, p95 < 800 ms on the local prod build with the seed org; report the number if the DB makes it impossible | `switch.contentMs` |
| Long tasks during a switch | none > 50 ms | `longtask` observer |
| Server work per page request | query count and ms per route, before/after; no duplicate query inside one request | Prisma query log |
| Duplicate `_rsc` fetches per switch | 0 | resource timing |
| Initial load (`/dashboard` document, prod) | not worse than baseline (±5 %) | Playwright `navigation` timing |
| Memory | JS heap after 40 switches within 15 % of after 5 | CDP `Performance.getMetrics` |
| Functionality | `npm run typecheck && npm run lint && npm test` green; `npm run test:e2e` green against the prod build on port 3001 with `E2E_NO_NAV_FALLBACK=1` | — |

Render/commit time and end-to-end interaction time are reported separately: a
`<Profiler>` around the page (behind `NEXT_PUBLIC_PERF_PROFILE=1`, zero cost
otherwise) logs `actualDuration` per commit to `window.__perf`; the nav script
collects it next to `contentMs`.

---

## 4. Measurement protocol (phase 0, repeated in phase 6)

1. **Build where the dev server is not.** In the worktree: `npm run build` then `npx next start -p 3001`. The database is the shared local one; create nothing destructive in it. Never `npm run build` in `C:\Users\User\Desktop\pets\mxik-audit` itself.
2. **Server-side instrumentation (new, permanent, opt-in).** `src/lib/db.ts`: when `PRISMA_LOG=1`, construct the client with `log: [{ emit: 'event', level: 'query' }]` and aggregate per request (count, total ms, slowest query) keyed by a request id from `AsyncLocalStorage` set in the `(app)` layout and page entry points, or, simpler, print each query with its duration and let the script sum them per RSC request by timestamps. Keep it off by default; it must not change production behaviour.
3. **Navigation script (new): `scripts/perf-nav.ts`**, modelled on `e2e/scale.e2e.ts` and `e2e/fixture.ts` (Playwright library; signs in with the seed org `buxgalter@demo.uz` / `demo12345` from the README on `PERF_BASE_URL`, default `http://localhost:3001`). For the sequence `dashboard → queue → clients → catalogs → dictionary → activity → settings → team → (repeat)`, 5 cold passes after a fresh sign-in and 5 warm passes, per switch record:
   - `feedbackMs`: click → first frame where `main [aria-busy]` (skeleton) or the new `h1` is present;
   - `urlMs`: click → `location.pathname` changed;
   - `contentMs`: click → skeleton gone and the page's `h1` present;
   - `rscFetches`, `rscBytes`, `rscMs` from `performance.getEntriesByType('resource')` (`?_rsc=` URLs);
   - `longTasks` (count, max) from a `PerformanceObserver({type:'longtask'})` armed before the click;
   - `inpMs` from `PerformanceEventTiming` for the click (`durationThreshold: 16`);
   - React `commitMs` from `window.__perf` when the profiling build is used.
   Also: the settings `?tab=` strip (5 tabs), the workspace on the seed catalogue (open, change the decision filter, change sort, back), and browser Back/Forward across 6 entries. Report p50/p95 per transition. Append `{ label, commit, date, conditions, results }` to `docs/perf-nav-results.json` (same spirit as `docs/perf-results.json`).
4. **Slow network pass:** CDP `Network.emulateNetworkConditions` (Fast 3G profile) for one warm and one cold pass; report only `feedbackMs` and `contentMs`.
5. **Large data pass:** `E2E_SCALE_ROWS=3000 npm run test:e2e -- e2e/scale.e2e.ts` numbers before and after (the workspace budget), and the queue tab with that catalogue's findings (the queue page is capped at 50 rows per page; measure its payload size).
6. **Baseline label:** `before`, on the worktree branch's first commit, with the build's commit hash.

---

## 5. Implementation phases

Do them in order; measure after each; stop a phase that measurement shows is not on the critical path.

### Phase 1: remove duplicated and sequential server work (S1)
- Wrap in `React.cache` (per request only; never a cross-request cache): `getSession`/`currentUser` (the second call must not re-run `isLive`), `getLocale`/`getI18n`, `isDemoOrg`, `planStatus`, `resolveVisibleClient`, and the workspace's `catalog.findFirst` (make `generateMetadata` and the page share one cached loader). Tenancy is preserved because `cache` is scoped to one render of one request.
- Replace `isDemoOrg(user.orgId)` calls with what `loadAccess` already knows where the user object is at hand (expose `demoOrg` on `CurrentUser` only if it does not widen what client code receives; the user object stays server-side).
- `src/lib/dashboard.ts` + `dashboard/page.tsx`: run `pendingAudits` inside the same fan-out as the other loaders (it needs `clientStats` rows; restructure so `clientStats` resolves first and everything else, including `pendingAudits`, runs in one `Promise.all`), and do not call `planStatus` twice (pass the layout's result down is impossible across segments; cache it instead).
- `src/lib/plan.ts` `usageOf`: the four counts can be one SQL statement if the query log shows them as material.
- `src/lib/catalogs.ts` `catalogList`: the `auditEvent` and `user` lookups after the list are two sequential round trips; fetch actors inside the same statement or in parallel with the count.
- With `PRISMA_LOG=1`, `EXPLAIN (ANALYZE, BUFFERS)` any single query over 20 ms on the seed data (candidates: `clientStats` raw SQL, `queuePage`, `workspaceChipCounts`, dashboard `byType`). An index change is a hand-authored migration (`prisma migrate diff` → SQL → `migrate deploy`, never `migrate dev`) and **requires the owner's go-ahead; propose it in the report, do not apply it to the shared database.**
- Acceptance: per-route query count and server ms down, no duplicate statement in any request, all tests green.

### Phase 2: a warm path (S2)
- `next.config.ts`: `experimental.staleTimes = { dynamic: 30, static: 300 }` (Next's own router cache; no second cache). Then audit every mutation path for invalidation: server actions already call `revalidatePath` (48 sites) which purges the router cache; `router.refresh()` sites (workspace decisions, bell, catalog status polling) refresh the current route; document-load paths (client switch, sign-out, locale change — confirm `src/app/actions/locale.ts` and `user-menu.tsx`) start a clean cache. Add `revalidatePath` or `router.refresh()` wherever a mutation only navigates. Background changes made by another browser or a finished audit may be up to 30 s stale on a revisited tab: state this in the report; if the owner wants zero staleness for the queue/dashboard, use `dynamic: 0` for those by calling `router.refresh()` on tab activation after a cache hit (measure; it still shows cached content instantly and updates in place).
- Intent-based prefetch of the full page for the seven header tabs and the rail: on `pointerenter`/`focus` (and `pointerdown` on touch) call `router.prefetch(href, { kind: 'full' })` (Next 15 `PrefetchKind.FULL`; the loading-boundary-only default is what makes `<Link>` prefetch useless here). Do **not** set `prefetch={true}` on all tabs: that renders seven pages on every page load. Cap to one in-flight prefetch, skip the active tab, and verify the prefetched payload is actually consumed (one `_rsc` fetch before the click, zero after).
- Keep the skeleton for cold switches; a warm switch must render the cached page with no skeleton (verify `feedbackMs`/`contentMs` collapse together).
- Rapid switching: confirm no stale page wins (click A, click B within 100 ms, address and content must be B) with the nav script; `RouteBoundary` keys already isolate addresses.
- Acceptance: warm p95 < 100 ms with zero requests; cold unchanged or better; e2e navigation/refresh suites green with `E2E_NO_NAV_FALLBACK=1`.

### Phase 3: payload and render cost of heavy tabs (S3, only if prod measurement confirms)
- Measure prod `rscBytes` per tab. If the queue (and activity/clients) is still large: render each row once. The table (`md:`) and the card list are two server renders of the same 50 rows; share the per-row cell fragments and move the responsive split to one markup with CSS where the structure allows, or render the card variant only below `md` using the existing `useMedia` hook in a thin client wrapper that receives the already-rendered row fragments (server-rendered children, so no data is re-serialised). Confirm by bytes, not by feel.
- Check `dictionary-table.tsx` (client component): what it receives as props and whether the table could be a server component with small client islands.
- Acceptance: bytes and `contentMs` on those tabs down; markup and accessibility unchanged (the e2e empty-state and review-flow suites still pass).

### Phase 4: in-section navigation without the skeleton (S4, a spike with a hard gate)
- Test whether the dropped-ping bug still exists on Next 15.5.23 / React 19.2.8: build a branch where `routeBoundaryKey` ignores the query for list pages and run `E2E_NO_NAV_FALLBACK=1 npm run test:e2e -- e2e/navigation.e2e.ts e2e/refresh.e2e.ts` ten times against the prod build. If any run fails, revert and record it; the boundary stays.
- If it passes, keep the per-pathname boundary and use `useTransition`/`isPending` feedback (a thin progress bar or dimmed content) for query-only changes, so filters and pagers update in place. The workspace keeps its `key` by `catalogId` only if `useDecisions` state is safe across filter changes (it holds optimistic decisions: resetting on filter change is current behaviour, so keep the filter in the key unless the rows and the decision map are reconciled explicitly).
- Acceptance: the two e2e files pass ten consecutive times without the fallback; settings and workspace filter changes show no skeleton.

### Phase 5: client-side profile (S5, only for what remains)
- Build with `next build --profile`, run the nav script with `NEXT_PUBLIC_PERF_PROFILE=1`, read `commitMs`. Act only on commits > 50 ms: candidates are the workspace's first commit (120 rows; virtualised already), `CommandPalette` (always mounted with the client list; lazy-load with `next/dynamic` on first open if the shared chunk is material in `next build`'s size table), and both locale dictionaries being in the client bundle (`src/lib/i18n*.ts`, 283 KB source: check the chunk size; splitting per locale is only worth it if it shows in the size table).
- Acceptance: no long task > 50 ms during a warm switch; initial-load JS not larger than baseline.

### Phase 6: verification and report
- Rerun §4 completely with label `after`; `npm run typecheck && npm run lint && npm test`; `npm run test:e2e` (all files, prod build on 3001, `E2E_NO_NAV_FALLBACK=1`); `npm run build` output size table before/after.
- Write `docs/engineering/TAB_SWITCH_PERFORMANCE_REPORT.md`: diagnosis, root cause with the numbers, files changed, each optimisation and why it works, before/after tables with conditions, test/type/lint/build results, remaining bottlenecks and next steps (index proposals, staleness trade-off, anything left from phases 3–5).

---

## 6. Constraints the implementer must keep

- No commits on `main`; one worktree branch, small reviewable commits in the repository's style (one descriptive subject line, see `git log`).
- No schema migrations against the shared database; propose indexes in the report.
- No `unstable_cache`/`"use cache"` keyed without `orgId`; no `force-static`; no cross-user caching of anything from `currentUser`, `shellData`, or any page loader.
- Do not disable or weaken `RouteBoundary`, `ResponseNudge` or `NavigationWatchdog` unless phase 4's gate passes; do not touch React Strict Mode; do not loosen any test or budget in `e2e/scale.e2e.ts`.
- No fake loading states, no arbitrary timeouts, no optimistic UI that can show a decision the server rejected.
- Prisma logging and the Profiler are opt-in by environment variable and must be inert otherwise.
- Keep `npm run dev` on port 3000 (the user's) untouched; use port 3001 for `next start`.
- Worktree housekeeping on this machine: `node_modules` in a worktree is a junction to the main checkout's folder; remove that junction before `git worktree remove`, or the shared `node_modules` is deleted.

---

## 7. Known limits to state honestly in the report

- Local dev (`next dev`, webpack, Windows) will stay slow regardless: route compiles of 10–45 s on first hit and dev-mode RSC payloads. The product target is the production build. (`--turbopack` is probably incompatible with the `extensionAlias` webpack hook in `next.config.ts`; a quick check is allowed, a migration is out of scope.)
- Cold switches are bounded by Postgres latency for that page's queries; after phase 1 the remaining server time per route is reported, not hidden.
- With `staleTimes.dynamic = 30`, a revisited tab can show data up to 30 s old when something changed outside this browser; the report must name which tabs this affects and how the owner can tighten it.
