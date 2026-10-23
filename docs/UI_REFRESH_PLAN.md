# UI refresh: from "works" to a SaaS product

Status: plan, 23 Oct 2026. Owner verdict: the sign-in/sign-up pages are in a bad state and most
app pages do not feel like a real SaaS product. Five sessions work in parallel on disjoint areas.
Base branch: `claude/w4a-cutover-639ee5` (the Wave 4a cutover: apps/web is a thin client over
the API; everything else in the web app is unchanged). All five merge after W4a lands on main.

## 1. What is wrong today (from screenshots of the current build)

- **Auth** (`/sign-in`, `/sign-up`, `/sign-in/2fa`, `/sign-in/forgot`, `/reset`, `/invite`,
  `/demo`, `/account-deleted`): a bare card on a grey page, 13px helper text, no brand panel, no
  value proposition, no visual link to the landing page, password field without show/hide or
  strength hint, Telegram sign-in as an afterthought, language toggle floating top-right.
- **Shell + dashboard**: header tabs without hierarchy, the left rail icons unlabeled, KPI cards
  that are all the same weight, long helper sentences under every heading, no onboarding/empty
  states worth the name, notification bell and palette look unfinished.
- **Settings/team/clients**: form fields at full width with no sections or cards, segmented
  controls and buttons of different heights, no save feedback pattern, tables without density
  control or row hover affordances.
- **Upload wizard / workspace**: functional but dense; the stepper, dropzone, mapping table,
  progress and done pages do not read as one flow; the grid and drawer lack rhythm (spacing,
  type scale, state colours used inconsistently).
- Cross-cutting: inconsistent spacing scale, three heading sizes used interchangeably, muted
  text too light on tinted surfaces, focus rings missing on custom controls, dark mode drifts.

## 2. Design direction (shared by all five)

Reference bar: Linear / Vercel / Stripe dashboards — calm, dense but breathable, strong type
hierarchy, one accent, generous whitespace in forms, instant feedback.

- Keep the token system in `apps/web/src/styles/app-tokens.css` and `docs/DESIGN_SYSTEM.md`;
  **tokens and primitive props may be added, never renamed or removed** (five branches depend on
  them at once).
- Type scale: display (landing), h1 page title 24/32 semibold, h2 section 18/28 semibold,
  body 14/20, data 13/18 tabular, small 12/16. Use them, nothing else.
- Spacing: 4-pt scale; page gutters 24 (md) / 16 (phone); card padding 20; form row gap 16.
- Surfaces: page on `surface`, cards on `raised` with `line` border and 12px radius; no nested
  cards; one elevation for popovers/dialogs.
- Every page states: loading (skeleton that matches the final layout), empty (illustrated,
  one primary action), error (inline, retryable). No layout shift when data arrives.
- Forms: labels above, 40px controls, inline validation under the field, primary button right
  (or full width on auth), disabled+spinner while pending, success toast or inline confirmation.
- Tables: 40px rows (comfortable) / 32px (compact), sticky header, hover row, right-aligned
  numbers, truncation with title, row actions on hover/focus.
- Accessibility: visible focus ring on everything, 4.5:1 text contrast (`styles/contrast.ts`
  test exists), keyboard paths unchanged, `aria-*` names unchanged where e2e relies on them.
- Responsive: 375 / 768 / 1280 / 1536 checked for every page touched; dark mode checked.
- Copy: shorter helper texts; one sentence max under a heading; both uz and ru dictionaries
  updated together (`packages/i18n`).

## 3. Sessions and file ownership (no two sessions touch the same file)

| Session | Owns | Must not touch |
|---|---|---|
| **U1 Foundation + auth** | `apps/web/src/styles/**`, `apps/web/src/ui/*` primitives (button, input, select, checkbox, textarea, card-like `page.tsx`, dialog, drawer, popover, menu, tabs, table*, badge, alert, toast, skeleton, empty-state, stepper, segmented, stat*, kbd, tooltip, logo, telegram-login), new `apps/web/src/ui/auth-layout.tsx`, `docs/DESIGN_SYSTEM.md`, auth pages: `apps/web/src/app/{sign-in,sign-up,invite,reset,account-deleted,demo,verify}/**` | `ui/shell/**`, any `(app)/**` page |
| **U2 Shell + dashboard** | `apps/web/src/ui/shell/**`, `apps/web/src/app/(app)/layout.tsx`, `(app)/dashboard/**`, `(app)/notifications/**`, `(app)/activity/**`, `apps/web/src/app/not-found.tsx`, `(app)/error.tsx` | primitives in `ui/*` (wrap locally if needed) |
| **U3 Upload + catalogues** | `(app)/upload/**`, `(app)/catalogs/page.tsx` + list components (`catalog-row-actions`, `delete-button`), `(app)/catalogs/[id]/{workspace-header,billing-box,export-actions,export-menu,share-button,review-field,completion,classifier-banner}.tsx`, `[id]/report/**`, `[id]/diff/**`, `apps/web/src/app/r/**`, `ui/catalog-status*.tsx`, `ui/preview-table.tsx`, `ui/pay-buttons.tsx` | the grid files below, `page.tsx` of `[id]` beyond header props |
| **U4 Workspace + review** | `(app)/catalogs/[id]/{page.tsx (grid side), workspace,grid,grid-row,group-row,use-decisions,row-drawer,row-comments,bulk-bar,views-menu,code-search,code-compare,code-cell,inline-code-picker,request-text,name-from-barcode,wrong-feedback,sure-accept-dialog,summary-strip,money-at-risk,toolbar,shortcut-hint,card-list}.*`, `(app)/queue/**`, `(app)/dictionary/**`, `ui/row-list.tsx`, `ui/code-chip.tsx`, `ui/ranked-bars.tsx`, `ui/sparkline.tsx` | header components owned by U3 |
| **U5 Clients, team, settings, admin, public** | `(app)/clients/**`, `(app)/team/**`, `(app)/settings/**`, `(app)/admin/**`, `apps/web/src/app/{api-docs,yordam,maxfiylik,oferta}/**`, `apps/web/src/content/**` | shell, primitives |

Shared files everyone may append to: `packages/i18n/src/**` (only your own keys; keep uz and ru
in step), `apps/web/e2e/*.e2e.ts` (only the spec of your own flow), this document (append a
"Result" note under your session's name). `packages/contracts` only if a page needs one more
field — add, never change shapes.

If a session needs a primitive change (e.g. a new Button size), it adds a local wrapper in its own
folder and lists it under "Primitive requests" in its result note; U1 consolidates after merge.

## 4. Acceptance (every session)

1. Every page in your area reads as one product with the others: tokens, type scale, spacing
   and states from §2; screenshots at 375/768/1280 light+dark attached to the result note
   (commit them under `docs/ui-refresh/<session>/`).
2. No regressions: root `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` green;
   the e2e specs for your flows green against your local stack (web 311x + API 421x, see brief);
   accessible names/roles kept or the spec updated in the same commit.
3. Both languages updated; no hardcoded strings.
4. Commits in logical steps on your branch; a "Result" note appended here.

## U2 result (shell + dashboard + notifications + activity)

Branch `claude/u2-shell-dashboard-ebf217`. Screenshots: **not captured** (wrap-up called first); the script that takes
them (375 / 768 / 1280 light+dark, 1536, folded sidebar, new firm) is ready in the session scratchpad and should write
to `docs/ui-refresh/u2/`.

**Shell** (`apps/web/src/ui/shell/**`, `(app)/layout.tsx`, `(app)/loading.tsx`)
- The frame is a grid: a full-height sidebar from md (brand, "Katalog yuklash", notifications with the unread count,
  up to five clients with the active one first, help, settings, fold toggle) beside the header and the page. Names show
  from xl (or lg once expanded); folded it is a column of icons with tooltips to the right. The choice goes to the
  existing `mxik_sidebar` cookie through `api.account.setSidebar` and is server-rendered (`data-rail` on the frame,
  CSS decides per width: `RAIL` in `prefs.ts`), so it never flashes.
- Header: the section tabs are unchanged (fit, or overflow into "Yana"); the client control is a combobox (search,
  "Barcha mijozlar" first — `allClientsTarget()` sends it to the same page unfiltered —, initials, list/add links);
  search is a field with the shortcut from xl; the bell panel has kind marks, read/unread, the new count and a compact
  "mark all read"; the account button shows initials.
- Command palette: a "Yaqinda ochilgan" group (clients, catalogues, products opened from it or visited) before any
  text, ↵ hint on the selected row; the store is per browser and validated (internal addresses only).
- Plan banner is a quiet status strip (icon + words on the page surface). Navigation progress grows, completes and
  fades; it stays invisible for commits within a frame or two. Route skeletons follow the page being opened
  (dashboard, lists, settings, workspace, client, upload) and keep `aria-busy` / `data-page-skeleton`.
- Phone: the drawer lists upload, notifications, every section, help, settings and the signed-in account.

**Dashboard**: KPI cards (icon, label, primary number — the first card wider and status-coloured —, one line of context,
change in risky rows since the previous versions, each a link); the work queue card (filter chips with counts, order
menu, per-client rows with one action); a side column with the checklist (closable once work has started, remembered
in the `mxik_onboarding` cookie the page reads; a link brings it back), assigned reviews, monthly checks, the issue
chart (RankedBars as is) and plan usage; activity, changes and workload share one tabbed card. A firm that has uploaded
nothing sees the checklist alone (empty-states e2e).

**Notifications**: grouped by day (Bugun / Kecha / date), kind marks, unread tint + dot + bold, mark read and open per
notice, all/unread segmented control and topic chips. **Activity**: kind chips, a compact client/person/date form,
removable chips for the filters in use, a day-grouped timeline with a mark per kind, 17-digit codes as code chips and
catalogue chips, "Yana koʻrsatish" reading the next pages from the API. **Not-found / error**: brand tile, code, one
sentence, primary way home plus "back"; the error page shows its digest as the reference.

**Copy**: shorter helper sentences in uz and ru (dashboard, queue, issue chart, notifications, log, not-found).

**e2e changed with the behaviour**: shell-layout 23 (names on screen at 1440; folded → tooltips beside the icon at
1440/1024/768, the fold survives a reload, then unfold), settings-nav 1 (bell → help → gear order instead of "first
three links", gear named at 1440 and its tooltip at 1024), review-flow 10 (the log is a region, not a table).

**Primitive requests for U1** (local wrappers today, consolidate after merge):
1. `Card` (raised, 12px, h2 + one-line hint + actions + footer) — `dashboard/card.tsx`.
2. Filter chip (link with `aria-current`, optional count, `bg-fg`/`text-inverse` when active) — four local `chip()`s.
3. Avatar / initials mark (sizes 20–36, neutral and brand tone) — rail, switcher, queue, user menu.
4. `Tooltip` `disabled` (or "only when the trigger's label is hidden") — the rail has its own bubble for this.
5. `animate-slide-in-left` for left-side drawers (the phone menu fades in today).
6. `StatusIcon` taking its tone colour (wrapped in an ink span today).
7. `RowList` without the outer border when inside a card (`ActivityFeed` in the dashboard card).
8. `Page` title at the plan's 24/32 (the dashboard uses `Page` now, so it follows U1's change).

**Verified / not verified** (wrap-up called before the e2e run finished):
- Green: web typecheck, root typecheck, lint on every touched path, unit tests of shell/activity (nav, shell-model,
  entry-text), `next build` of apps/web. Checked by hand in the browser at 1440/1280/375: sidebar labelled and folded
  (cookie survives reload), dashboard, notifications, activity (load more 50 → 100 of 108), bell, client switcher.
- **Not run to the end**: the five e2e specs (navigation, shell-layout, settings-nav, refresh, empty-states) — the
  machine was saturated by sibling sessions (1–2 GB free RAM, dev compiles of 80 s) and the run stalled at sign-in;
  root `npm test` and full `npm run lint` not run. Run them before merging.
- Done pages: shell (all parts), dashboard, notifications, activity, not-found, (app) error. Untouched in my area:
  nothing; the palette's "recent" group was not exercised in a browser (the pane could not type into it).
