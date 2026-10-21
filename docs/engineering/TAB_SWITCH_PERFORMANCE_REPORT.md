# Tab switching performance: implementation report

Date: 2026-10-21. Implemented by a separate Claude Opus 5.5 session, started
from the planning session, working only in the git worktree
`.claude/worktrees/tab-switch-perf-8bb533` on branch
`claude/tab-switch-perf-8bb533` (cut from `0a33f1a`). The main checkout and the
user's dev server on port 3000 were never touched. Every build ran in the
worktree and was served with `next start -p 3001`. No migration and no schema
change touched the shared database; the only writes were the app's own (sign-in
session rows, the e2e suites' throwaway orgs, which they delete). Nothing was
pushed or merged.

Plan: `docs/engineering/TAB_SWITCH_PERFORMANCE_PLAN.md` (committed unchanged as
the branch's first commit, `572ec1a`). Raw numbers: `docs/perf-nav-results.json`
(append-only, one entry per run, every run kept, including superseded ones).

## 1. Diagnosis

Measured on production builds, seed org (`npm run seed`: 2 clients, 5
catalogues, 213 rows), Chromium headless 1440x900, 5 cold and 5 warm passes of
`dashboard → queue → clients → catalogs → dictionary → activity → settings →
team → dashboard` (§5 has the full conditions). What the baseline showed:

| Finding | Evidence (baseline `572ec1a`) |
|---|---|
| Every switch is a server round trip, and a revisit is exactly as slow as a first visit | cold p50 333 ms, warm p50 331 ms; 0 of 40 warm switches without a request |
| Nearly every switch takes ~330 ms although the server answers in 20–80 ms | RSC response done at p50 89 ms, content at ~330 ms. React shows the skeleton (30 ms), then holds the reveal until 300 ms after that fallback committed (`FALLBACK_THROTTLE_MS`). The per-address `RouteBoundary` guarantees a new fallback on every switch, so 300 ms is the floor. |
| `/queue` takes 4.6–7 s | one raw query: 3.8 s server-side (query log), 4.5 s in `EXPLAIN ANALYZE` with a cold buffer cache, 1.3 s warm |
| Settings `?tab=` and workspace filter/sort: same ~330 ms floor | same skeleton + throttle, for a page that is already on screen |
| The `(app)` layout does **not** re-run on a soft navigation (plan §1.3, unverified item) | **confirmed by the query log**: a soft navigation to `/dashboard` runs 20 queries, the document load of the same page 30; none of `shellData`'s queries (`Notification.count`, `Client.findMany` of the switcher, the frame's `planStatus`) appear in any soft navigation |
| Link prefetches are cheap | every `<Link>` (auto) prefetch replayed alone: 0 queries, 4–6 ms |
| Duplicate work inside one request | workspace `UserSession.findUnique` ×2 (metadata + page); settings security `UserSession` ×2 and `Organization` ×2; dashboard document `UserSession` ×3, `planStatus` ×2 (4 queries each) |
| Prod RSC payloads per tab (plan §2, unverified) | dashboard 36 KB, queue **361 KB**, clients 25 KB, catalogs 23 KB, dictionary 6 KB, activity 91 KB, settings 13 KB, team 5 KB (decoded). Queue gzip on the wire: 20 KB |
| Client-side render cost | not a bottleneck: React page commits p50 2–3 ms, max 16 ms (profiling build); no long task > 50 ms during any warm switch |
| Back/Forward | already instant (9–44 ms, no request): Next restores history entries from its tree cache |

## 2. Root cause, with the numbers

1. **`/queue`: a type mismatch defeated the classifier's primary key.**
   `mxik_code.code` is `char(17)`, `catalog_item."existingMxik"` is `text`.
   `m.code = i."existingMxik"` makes Postgres cast the column to text, so the
   unit-conflict subquery scanned all 438,925 codes once per unit-conflict row
   (3 rows in the seed queue): 1.24 s per scan, plus 0.8 s of JIT compilation
   that the inflated cost estimate triggered. `EXPLAIN (ANALYZE, BUFFERS)`:
   4,548 ms (cold), 1,344 ms (warm) before; **0.9 ms** after (§4.1).
2. **No warm path.** `staleTimes.dynamic` is 0 and `<Link>` prefetches stop at
   the `(app)` loading boundary, so a tab seen two seconds ago is fetched again.
3. **A 300 ms floor on every switch** from React's fallback throttle, because
   every address has a fresh Suspense boundary (the dropped-ping workaround).
4. Smaller: per-request duplicates (a session check run 2–3 times, `planStatus`
   twice on document loads) and sequential tails (dashboard `pendingAudits`
   after the fan-out, `planStatus` org lookup before usage, catalogue uploaders
   in two round trips). These were 10–60 ms of server time per request, not on
   the critical path once (1) was fixed.

## 3. Files changed

| Area | Files |
|---|---|
| Measurement | `scripts/perf-nav.ts` (new), `package.json` (`perf:nav`), `src/lib/db.ts` (`PRISMA_LOG=1` query log), `src/ui/shell/route-boundary.tsx` (`NEXT_PUBLIC_PERF_PROFILE=1` Profiler), `README.md` |
| Server work | `src/lib/queue.ts`, `src/lib/session.ts`, `src/lib/locale.ts`, `src/lib/demo.ts`, `src/lib/plan.ts`, `src/lib/dashboard.ts`, `src/lib/shell-data.ts`, `src/lib/catalogs.ts`, pages `dashboard`, `clients`, `settings`, `team`, `catalogs/[id]` |
| Warm path | `next.config.ts` (`staleTimes`), `src/ui/shell/intent-prefetch.ts` (new), `top-nav.tsx`, `rail.tsx`, `nav-link.tsx`, `src/ui/tabs.tsx`, `src/ui/shell/router-cache.ts` (new), `app-frame.tsx`, workspace `use-decisions.ts`, `workspace.tsx`, `row-comments.tsx`, `name-from-barcode.tsx`, `sure-accept-dialog.tsx` |
| Payload | `queue/queue-list.tsx`, `activity/activity-table.tsx` |
| In-place navigation | `src/ui/shell/navigation.ts` (+ test), `same-route-links.ts`, `navigation-progress.tsx` (new), workspace `filter-controls.tsx` |
| Tests | `e2e/navigation.e2e.ts` (settings tabs and workspace filters commit in place, no skeleton), `e2e/refresh.e2e.ts` (a section fetched ahead before a workspace decision shows the decision), `src/ui/shell/navigation.test.ts` |

Commits (oldest first): `572ec1a` plan · `be85f10`, `eddb2ee`, `79e27fc`
measurement · `bf7f04f` baseline results · `0a9ad10` queue · `8ccfeb1`,
`5851895` per-request work · `cca3566`, `1407942`, `a2fc9e4`, `9a3b003`,
`50b673d` warm path · `7dbfae0` payload · `494e091` in-place navigation · and
the commit that adds this report.

## 4. The optimisations and why each works

### 4.1 Phase 1: server work

- **Queue lookup by primary key** (`0a9ad10`): `m.code = i."existingMxik"::bpchar`.
  Casting the row's value instead of the column lets the planner use the index
  (`Index Cond: (code = (i."existingMxik")::bpchar)`, 0.015 ms per row); the
  plan's cost falls below the JIT threshold too. bpchar equality ignores
  trailing blanks; 17-digit codes have none, so results are unchanged.
  Query log: queue request **3,815 ms → 9 ms** of database time, same 6 queries.
- **Once per request** (`8ccfeb1`): `currentUser`, `getI18n`, `isDemoOrg` and
  `planStatus` are wrapped in React `cache`. The cache lives for one render of
  one request, so nothing is shared between users or requests (tenancy kept);
  outside a render (server actions, route handlers, scripts, tests) React's
  `cache` does not memoise at all, so their behaviour is unchanged. Pages take
  the demo flag from the access row `currentUser` already loaded (`inDemoOrg`,
  no query of its own); `CurrentUser` is unchanged, so nothing new reaches
  client components. The workspace's tab title and page share one cached
  catalogue read.
- **No sequential tails** (`5851895`): the dashboard's `pendingAudits` and its
  accountant list join the existing fan-out; `planStatus` reads the org and the
  usage counts in parallel; the app frame resolves the active client alongside
  the client list, unread count and plan (re-reading the list only when the
  default client was just created); catalogue uploaders come in one join (the
  `user` row only when it belongs to the same org) instead of two round trips.
- Rejected: one SQL statement for `usageOf`'s four counts (they already run in
  parallel, 1–3 ms each); caching `resolveVisibleClient` (only the layout and
  the upload page call it, and the layout does not run on soft navigations).

Per-route queries (each navigation request replayed alone, query log; before
on `be85f10`, after on `9a3b003`):

| Request | Queries before → after | DB ms before → after | Response ms before → after | Duplicates before → after |
|---|---|---|---|---|
| soft nav `/dashboard` | 20 → 20 | 116 → 57 | 47 → 27 | `Invite.count`×2 → same (see §7) |
| document `/dashboard` (layout + page) | 30 → 23 | 121 → 63 | 66 → 40 | session ×3, `planStatus` ×2, `Invite.count` ×2 → none |
| `/queue` | 6 → 6 | **3,815 → 9** | **3,739 → 29** | – |
| `/clients` | 4 → 3 | 19 → 5 | 35 → 15 | – |
| `/catalogs` | 10 → 8 | 70 → 33 | 70 → 19 | – |
| `/catalogs/<id>` (workspace) | 27 → 24 | 125 → 93 | 62 → 31 | `UserSession`×2 → none |
| workspace `?dec=all` / `&sort=row` | 26 → 23 | 135/97 → 78/46 | 77/53 → 31/36 | `UserSession`×2 → none |
| `/dictionary` | 4 → 4 | 9 → 5 | 20 → 12 | – |
| `/activity` | 7 → 7 | 23 → 7 | 73 → 28 | – |
| `/settings` (account) | 4 → 3 | 28 → 4 | 47 → 11 | – |
| `?tab=security` | 9 → 7 | 25 → 16 | 54 → 39 | `UserSession`×2, `Organization`×2 → none |
| `?tab=plan` | 10 → 9 | 20 → 22 | 32 → 17 | – |
| `?tab=integrations` | 13 → 12 | 49 → 19 | 27 → 13 | – |
| `?tab=data` | 4 → 3 | 13 → 4 | 25 → 9 | – |
| `/team` | 11 → 10 | 24 → 29 | 19 → 14 | – |

"DB ms" sums parallel queries, so it can exceed the response time. The
before/after replays ran at different times on a shared database (§5), so
small millisecond differences are noise; the counts, duplicates and the queue
are not.

### 4.2 Phase 2: a warm path

The plan proposed `staleTimes.dynamic = 30`. **I did not do that**: the
workspace keeps its rows in client state (`useDecisions` copies `initialRows`
into `useState` and ignores later props), so a cached copy of a filter view
(say `?dec=pending`) opened again within 30 s would show a row you had just
decided as still pending, and no refresh could correct it. Instead:

- **Intent prefetch** (`src/ui/shell/intent-prefetch.ts`): the header tabs, the
  rail and link tab strips (settings, client imports) call
  `router.prefetch(href, { kind: FULL })` when the pointer rests 50 ms on the
  link, on keyboard focus, and on a touch's `pointerdown`. That renders the
  whole page ahead, so the click finds it ready and the new page mounts without
  suspending, which means no skeleton and no 300 ms throttle. Crossing the tab bar
  fetches nothing (50 ms rest), the open tab is skipped, and Next deduplicates
  an entry it already holds. `prefetch={true}` on every tab was not used (seven
  server renders per page load).
- **`staleTimes: { dynamic: 0, static: 30 }`**: a page opened by a plain
  navigation is still fetched each time. A page fetched ahead is reused for
  at most 30 s (Next's minimum for `static`; its default, 300 s, would keep a
  hovered tab for five minutes).
- **Staleness guard** (`src/ui/shell/router-cache.ts`): server actions that
  call `revalidatePath` (48 sites) already make Next drop its cache. Workspace
  changes deliberately do not (revalidating would re-render the workspace on
  every decision). `serverChange(action)` wraps those calls (decide, decide
  group, undo, bulk, split, accept-all, comment, flag, name from barcode). The
  next address change refreshes the page in place (cached content first, then
  the fresh one), and `router.refresh()` drops every cached page. A navigation
  made while such an action is still on its way (the workspace shows a decision
  before the server has it) refreshes when the action returns. Covered by the
  new e2e test (it also confirmed that the stale prefetched queue is shown
  first and then corrected; an earlier version that marked the change after the
  call failed 1 run in 5 on exactly that race and was fixed in `50b673d`).
- Two corrections found by measurement: a full prefetch started by a mouse
  `pointerdown` replaced Next's ready loading entry with a pending one, and on
  Fast 3G the click then showed nothing for ~600 ms (`a2fc9e4`: mouse presses no
  longer prefetch). A quick click also let the hover timer fetch the page a
  second time after the navigation had started (`9a3b003`: a press cancels the
  wait).

### 4.3 Phase 3: payload

The queue and activity log render each row twice (table from `md`, cards
below). Their per-row pieces are now built once and placed in both layouts;
React's Flight serialiser sends a repeated element as a reference. Markup is
identical. Queue **377 → 291 KB decoded (−23 %), but gzip on the wire only
20.4 → 19.4 KB (−5 %)**; activity 102 → 95 KB. Gzip had already absorbed the
repetition, so payload was not on the critical path once the queue query was
fixed. The change stays because it is markup-neutral and cuts parse work on
slow devices. `dictionary-table.tsx`: a 6 KB payload, nothing to gain.

### 4.4 Phase 4: in-section navigation without the skeleton

**Gate passed.** A spike keyed the page boundary by pathname only (query
ignored, every page) and ran `e2e/navigation.e2e.ts` + `e2e/refresh.e2e.ts`
with `E2E_NO_NAV_FALLBACK=1` against the production build: **10 of 10
consecutive runs green** (6 tests each, no watchdog warning). The dropped-ping
bug does not reproduce on Next 15.5.23 / React 19.2.8 in these suites.

Applied narrower than the spike: `/settings` and the workspace
(`/catalogs/<id>`) now change their query in place under one boundary
(`QUERY_IN_PLACE` in `navigation.ts`). Each settings tab is its own panel and
the workspace grid stays keyed by catalogue and filter, so their state resets as
before. Density, grouping and columns already follow their props. List pages
(clients, queue, activity, dictionary, catalogs) keep a boundary per address:
their filter forms hold uncontrolled inputs (`defaultValue`) that only a remount
resets, so a "reset" link would otherwise clear the address but not the fields.

In place, the old content stays until the new one is ready, so a click needs a
visible sign. **`NavigationProgress`** is a 2 px bar along the top of the page,
driven by the navigation watchdog's real "not committed yet" state. It fades
in from the first frame (a page served from memory commits before it becomes
visible). Workspace filters now go through `goTo`, so the watchdog covers them
like links. The final implementation passed the gate again: 10/10 runs with 7
tests, then 10/10 with 8 tests after the staleness test was added. The new
navigation test asserts that settings tabs and a workspace filter commit
without the watchdog and without the skeleton ever appearing.

### 4.5 Phase 5: client profile

Profiling build (`next build --profile`, `NEXT_PUBLIC_PERF_PROFILE=1`): page
commits p50 2–3 ms, p95 ≤ 16 ms, max 16 ms (queue); workspace open 12 ms; no
long task > 50 ms in any warm switch. Nothing reached the plan's 50 ms
threshold, so **no change**. The two candidates the plan named: `CommandPalette`
is not visible in the size table. Both locale dictionaries sit in one shared
client chunk of 289 KB (81 KB gzip). That costs the first document load, not
tab switching, so it is listed in §7.

## 5. Before and after

**Conditions.** Windows 10, Intel i5-14400F (16 threads), 26 GB. Production
builds served by `next start -p 3001` from the worktree. Postgres 16 in Docker
(`mxik-audit-db`), **shared**: during part of the day another session ran a
classifier workload on it (13–16 active queries, ~1,100 % container CPU), and
the user's dev server ran on port 3000. Seed org, Chromium headless 1440x900,
locale uz, 5 passes (fresh browser profile each) for cold and warm. Each switch
is followed by a 500 ms pause. "Content" means the address changed, the new
heading or grid is present and no skeleton is left. "Feedback" means the
skeleton or the new content. "Any feedback" also counts the new progress bar.
"Pointer rests" is the time between hover and click: 0 ms is a robot click,
200 ms is closer to a person with a mouse.

The comparison pairs are `before, rerun back to back with after` (build of
`572ec1a`) and `after` (build of `9a3b003`), run within 30 minutes of each other
with the database quiet. The original `before` (13:19) is kept; its queue
numbers are worse (cold buffer cache). The last code commit, `50b673d`, came
after these runs and changes only how workspace mutations are tracked (§4.2),
which no benchmark pass exercises; the e2e suites ran on its build.

**Tab switches** (ms, p50 / p95):

| | Before (`572ec1a`) | After (`9a3b003`) | Target |
|---|---|---|---|
| Warm switch, pointer rests 200 ms | 331 / 1,429 | **31** / 347 | p95 < 100, no request |
| Warm switches without any request | 0 / 40 | **35 / 40** | all |
| Cold switch, pointer rests 200 ms | 331 / 2,115 | **31** / 346 | p50 < 400, p95 < 800 |
| Cold switch, robot click | 331 / 1,435 | 331 / 2,098 | p50 < 400, p95 < 800 |
| Cold switch, first feedback (skeleton) | 31 | 31 (any feedback 13) | < 50 |
| `→ /queue` cold, robot click | 1,429 (4,989 in the first baseline) | **365** | |
| Settings `?tab=` cold / warm, robot click | 332 / 331 | **53 / 56** | |
| Settings `?tab=` cold / warm, pointer rests 200 ms | 333 / 331 | **31 / 31** | |
| Workspace open from the list | 351 | 359 | |
| Workspace decision filter | 319 | **122** (43 with 200 ms rest; the select has no prefetch) | |
| Workspace sort | 323 | **63** | |
| Back / Forward | 14 / 15 | 14 / 15 | |
| Rapid double click (second tab wins) | 5 / 5 | 5 / 5 | all |
| Long tasks > 50 ms during warm switches | 0 | 0 | none |
| JS heap growth, 5 → 40 switches (after GC) | +17.9 % (6.7 → 7.9 MB) | +13.8 % robot clicks, +6.2 % with 200 ms rest (6.4–6.5 → 6.8–7.4 MB) | < 15 % |
| Fast 3G cold: first feedback / content p50 | 30 / 1,248 | 32 (any 14) / 1,231 | |
| Fast 3G warm: content p50 / p95 | 664 / 2,016 | 662 / 1,131 | |

Per transition, after, pointer rests 200 ms, cold/warm content p50: queue 106/53,
clients 31/30, catalogs 42/31, dictionary 30/31, activity 32/31, settings
30/31, team 30/30, **dashboard 331/347**. The warm p95 of 347 ms is entirely
that one transition (5 of 40 switches). The page a session starts on is seeded
into Next's router cache from the document and counts as complete, so a full
prefetch of it is skipped for the first 30 s and the revisit loads like a cold
switch (skeleton at 30 ms, content at ~330 ms). Without it, warm p95 is ~33 ms.

**Where targets are not met, and why:**

- *Warm p95 < 100 ms*: met for every tab except the document's own page in its
  first 30 s (above). With a robot click (no rest) there is no intent, so a
  warm switch is a cold one (331 ms). That is by design: nothing is fetched
  without intent, and plain navigations stay uncached (§4.2).
- *Cold p95 < 800 ms*: met at p50 everywhere. Some p95/max values of 2.0–2.6 s
  in both builds came from the shared machine. 240 sequential RSC requests
  straight to the server right afterwards had p50 17 ms, p95 34 ms, max 77 ms,
  and a verbose 145-switch run with the database idle had no switch above
  400 ms. The spikes appeared only while another session's workload was
  running, and they also appear in the rerun baseline (cold max 4,132 ms).
- *Cold content below the 300 ms floor without intent*: not reached. A cross-
  section click with no prefetch still shows the skeleton at 30 ms and the page
  at ~330 ms, because of React's fallback throttle (§7).

**Initial load** (`/dashboard` document, p50 over 5 loads): TTFB 25 → 22 ms,
FCP 116 → 100 ms, DOMContentLoaded 110 → 95 ms, JS transferred 239.5 →
240.4 KB (+0.4 %). The first baseline's DOMContentLoaded of 2,451 ms did not
reproduce in any later run of either build (110–257 ms) and is treated as an
outlier of that run.

**Build size table** (`next build`, First Load JS): shared by all 102 kB →
102 kB; `/dashboard` 194 → 194; `/queue` 189 → 189; `/settings` 207 → 207 (page
12.4 → 12.7 kB); `/catalogs/[id]` 259 → 261 kB (+2 kB: in-place navigation and
the change tracking); `/upload` 224 → 224 (page chunk 7.07 → 9.04 kB, a chunk
reshuffle, first load unchanged). No other route changed by more than 0.25 kB.

**Large data** (`e2e/scale.e2e.ts`, 3,000 rows, both builds back to back, database quiet):

| | Before | After | Budget |
|---|---|---|---|
| Audit | 87 s | 87 s | – |
| First rows on screen (3 loads) | 4,487 / 2,446 / 2,141 ms | 905 / 899 / 368 ms | < 5,000 |
| j/k median / p95 / max | 8.9 / 15.6 / 18.1 ms | 9.3 / 17.0 / 22.3 ms | < 100 / < 250 |

j/k is unchanged within noise. First rows were faster on the after build in
this pair, but I did not isolate why: none of the changes targets that path
directly, so treat it as measured, not explained. The queue page is capped at
50 rows, so its payload with that catalogue's findings is the 50-row figure
above (~291 KB decoded after, ~19 KB gzip).

## 6. Tests, types, lint, build

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 1 warning (pre-existing, `scripts/lib/xlsx.ts:131`, non-null assertion) |
| `npm test` | 1,140 tests: 1,138 pass, 0 fail, 2 skipped (database-dependent skips that report their reason; 3 skipped in an earlier run of the same suite on this branch) |
| `npm run test:e2e` with `E2E_BASE_URL=http://localhost:3001 E2E_NO_NAV_FALLBACK=1`, production build | **30 / 30 pass** on the build of `50b673d` (5 files: empty states, navigation, refresh, review flow, scale; 3,000 rows: first rows 408 / 895 / 395 ms, j/k median 9.0 ms, p95 15.3 ms); 29 / 29 earlier on the build of `9a3b003` |
| Navigation + refresh gate, final code | 10 / 10 consecutive green runs (8 tests each) |
| `npm run build` | succeeds; size table above |

Disk note: drive C: ran out of space mid-way (0 bytes free, mostly outside this
worktree). I deleted this worktree's own webpack cache and built the remaining
builds with webpack's persistent cache switched off through a local,
uncommitted `next.config.ts` line (`LOCAL_NO_WEBPACK_CACHE`). That only changes
the cache, not the output, and it is not on the branch.

## 7. Remaining bottlenecks and next steps

1. **React's 300 ms reveal throttle on cold cross-section switches.** With a
   prefetch it disappears. Without one (robot clicks, the command palette,
   keyboard shortcuts) a switch is 30 ms to skeleton and ~330 ms to content even
   though the server answers in 10–40 ms. The fix would be the in-place
   approach for cross-section navigations too: keep the old page with the
   progress bar until the new one is ready, and show the skeleton only when it
   takes longer. That changes the deliberate "skeleton at once" design and
   Next's `(app)/loading.tsx` behaviour, so it needs the owner's call. The
   Phase 4 evidence says the React bug no longer blocks it.
2. **The page a session started on** is not fetched ahead for its first 30 s
   (Next seeds its cache entry from the document). Accepted; it affects one
   tab for 30 s.
3. **Staleness trade-off, stated plainly.** A tab fetched ahead on hover can
   show data up to **30 s** old if something changed *outside this browser*
   (a colleague's decision, an audit finishing, a Telegram upload). Affected:
   every header tab, settings tabs and client-import tabs, only after a hover,
   focus or touch within the last 30 s. Not affected: anything opened by a
   plain navigation, and changes made in this browser (revalidating actions,
   `serverChange`, `router.refresh()`). To tighten it: lower nothing (30 s is
   Next's minimum for `static`). Either drop intent prefetch for the queue and
   dashboard (the two live lists), or call `router.refresh()` after a cache hit
   on those two.
4. **Same type mismatch elsewhere (follow-up, not tab switching):**
   `code = ANY(${list})` against `mxik_code.code` with a `text[]` parameter
   seq-scans the classifier: **236 ms vs 0.05 ms** with `::bpchar[]`
   (`EXPLAIN ANALYZE`, two codes). Sites: `src/lib/decide-many.ts:37` (group
   and bulk decisions), `src/lib/dictionary.ts:163`, `src/lib/export-rows.ts:26`,
   `src/lib/versions.ts:85`.
5. **Index proposal (not applied; needs the owner).** No query on the seed data
   is over 20 ms after §4.1, so no index is needed today. One lookup will grow
   with use, since every decision writes an audit event and the only index is
   `("orgId", "createdAt")`. The uploaders of a catalogue page (`catalogList`)
   and the workspace's audit lookups filter `audit_event` by org, action and
   target:

   ```sql
   -- prisma/schema.prisma, model AuditEvent: @@index([orgId, action, targetId])
   -- hand-authored migration (prisma migrate diff → this SQL → prisma migrate deploy; never migrate dev)
   CREATE INDEX "audit_event_orgId_action_targetId_idx" ON "audit_event" ("orgId", "action", "targetId");
   ```

   Today's plan (337 rows in the table):

   ```
   Nested Loop Left Join (actual time=0.039..0.177 rows=4)
     ->  Seq Scan on audit_event e (actual time=0.036..0.168 rows=4)
           Filter: (("orgId" = '…') AND (action = 'catalog.uploaded') AND ("targetId" = ANY ($0)))
           Rows Removed by Filter: 333
   Execution Time: 0.207 ms
   ```

   At tens of thousands of events per org this becomes a scan of every event of
   the org per catalogue-list request. Apply it when an org's `audit_event`
   count reaches that order. No other candidate: `finding`, `catalog_item`,
   `catalog`, `notification` and `finding_comment` are already indexed on the
   columns the tab pages filter by.
6. **`Invite.count` twice on the dashboard**: `usageOf` (plan) and
   `onboardingSteps` count the same open invites; 1–2 ms each. Not worth a
   shared helper today.
7. **Locale dictionaries in the client bundle**: one shared chunk of 289 KB
   (81 KB gzip) with both languages, loaded on the first document of every
   session. Splitting per locale would roughly halve it for the first load. It
   does not affect tab switching.
8. **Local development stays slow** (plan §7): route compiles of 10–45 s and dev
   payloads. Nothing here changes that; the product numbers are the production
   build's.
