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

## U1 result (foundation + auth)

Branch `claude/u1-foundation-auth-265a04`. Nothing was renamed or removed: every token, primitive
and prop that existed still exists and behaves as before; everything below is either a value
change of an existing token or an addition. Details: `docs/DESIGN_SYSTEM.md`.

**What changes for everyone after merge (no code change needed):**

- Type scale is §2, under the existing names: `text-title` 24/32 (= new `text-h1`),
  `text-section` 18/28 (= new `text-h2`), `text-body` 14/20, `text-data` 13/18, `text-small` 12/16,
  `text-micro` 12/16; new `text-display` 32/40 for hero lines. So all app text gets ~1px smaller and
  titles bigger. `Page` h1 now uses `text-title` (it was a hard-coded 28px medium); page hints are
  `text-body` muted, section hints `text-data`.
- Colours: `muted` #4f5c69 / dark #a3afbb and `subtle` #5a6774 / #8f9ca9 now pass 4.5:1 on `sunken`
  and on every tint (tested); `line` #dce3ea / #2c3742 and `line-strong` #c5cfd9 / #3a4651 are a step
  stronger; new `focus-halo` (a soft 4px halo around a focused field, inside the existing 2px ring
  rule); a pointer-focused native select shows the ring too.
- Primary and secondary buttons carry `shadow-sm`; field labels are `text-data` medium, hints and
  errors `text-small`; Dialog/Drawer get a little more air (header pt-5, body pb-5); Tabs counts are
  pills; Alert borders are softened; EmptyState icon sits in a rounded tile; Stepper's current step
  has a tint halo.

**What to adopt (additions):**

- Forms: `size="lg"` (40px) on `Button`, `Input`, `Select`, `Segmented` — all four line up.
  Toolbars keep `md` (36).
- `Button`/`ButtonLink`: `leadingIcon`, `trailingIcon`, size `lg`, `BUTTON_ICON_SIZE`.
- `Input`: `leadingIcon`, `trailingIcon`, `trailing` (interactive), `wrapperClassName`;
  `PasswordInput` (show/hide); `Field.labelAside`; `Select.leadingIcon`.
- `Card` + `cardClass()` in `ui/page.tsx` (title, description, actions, footer, padding) — use it for
  settings sections and dashboard tiles instead of ad-hoc bordered divs.
- `Table`: `density` (comfortable 40 / compact 32) and `hoverRows`.
- `Alert`: `title`, `action`, `icon`. `SkeletonLine` / `SkeletonText` / `SkeletonCard`.
- `OtpInput` (settings → two-factor setup could use it), new icons (Eye, EyeOff, Mail, Lock, Key,
  Shield, ArrowRight/Left, Building, Clock, Sparkle, Send).
- Strings for new primitives: `ta.uiX`; auth: `ta.authX` (`packages/i18n/src/i18n-parts/auth.ts`).

**Auth:** every page in `sign-in` (incl. 2FA, forgot), `sign-up`, `invite`, `reset`, `demo` (+verify)
and `account-deleted` renders inside `ui/auth-layout.tsx` (route `layout.tsx` files are one line).
Same API calls, redirects, field names/ids and button names as before; `verify` stays a redirect
in `next.config.ts`. Screenshots: `docs/ui-refresh/u1/<page>-<width>-<theme>.png` (14 states × 375 /
768 / 1280 × light / dark), made by a throwaway Playwright script against web 3111 + API 4211 with
temporary seeded tokens.

**Notes and limits:**

- Telegram sign-in is Telegram's own iframe button: it cannot be restyled into our secondary
  button. It now sits under an "yoki / или" divider, with an 8px radius to match our controls and its
  40px height reserved. A real secondary button would need the `oauth.telegram.org` redirect flow
  (bot id + a fragment-reading callback page) — a follow-up for the API side.
- The rate-limit notice recognises the API's throttle messages by their exact text
  (`app/sign-in/rate-limit.ts`, tested in both languages); a structured `retryAfter` field in
  `SignInState` would be cleaner (contracts change, not done).
- The forgot-password link sits in the password label row (GitHub/Stripe pattern), so it comes
  before the password field in Tab order.

**Verification (stopped early on the owner's wrap-up call):**

- Root `npm run typecheck` and `npm run lint` green (lint: one old warning in `scripts/lib/xlsx.ts`).
- `npm test`: 1532/1551 pass. The 17 failures are API/domain database tests (catalog and import
  e2e, audit-jobs, demo, stale-client) that ran while the e2e specs loaded the shared database;
  `demo.test.ts` and `stale-client.test.ts` pass when re-run alone (10/10); the API e2e ones were not
  re-run. None of them touches web UI or the new i18n keys.
- E2e against web 3111 + API 4211, all under heavy load from the parallel unit run:
  account-flows — the sign-in test passes; three tests time out on `page.goto('/team' | '/settings')`
  (dev-server first compile, not auth pages). demo-access — 4/5 pass, including the demo request
  form; "the link opens a demo once" ended on `/sign-in` instead of `/catalogs` after pressing the
  open button: **not diagnosed** (load or a real regression in the open flow — the button now uses
  `loading`, the call and `window.location.assign` are unchanged); re-run it first. navigation —
  two client-list tests timed out (not auth pages). empty-states and review-flow were not run.
- `npm run build` not run (it shares `.next` with the dev server).
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
## U3 result: upload + catalogues
Branch `claude/u3-upload-catalogs-e592ab` (from the W4a cutover). Screenshots: `docs/ui-refresh/u3/`
(`<page>-<width>-<theme>.webp`, 375 / 768 / 1280, light and dark; the share dialog and export menu at
375 and 1280; the long diff overview is cropped to its top 2600 px).
What changed (behaviour and API calls kept; names and roles the e2e specs use kept):
- **Upload wizard** (`(app)/upload/**`): `WizardStepper` (local) with done / current / upcoming said
  in colour, icon and screen-reader text; on a phone "Ustunlar · 3/6-qadam" over a segmented bar.
  Every step is one `StepCard` (raised card, h2, footer with the primary action last). Dropzone with a
  steady drag state (enter/leave counted), type chips from `UPLOAD_EXTENSIONS`, a tips card and the
  sample file (`/demo/namuna-katalog.xlsx`, the landing's sample). File check: a summary strip (file,
  rows, columns, how it was read) over `PreviewTable`, now with a sticky header, striped rows, row
  numbers, truncation with title and a value-kind line per column (text / number / code / empty,
  `ui/preview-columns.ts`, unit-tested). Mapping: "field → file column" rows with the origin badge,
  an example value from the chosen column and inline errors; diagnostics beside it (sticky on lg),
  grouped by severity (Import qilinmaydi / Tekshirib chiqing / Maʼlumot uchun), import share bar, the
  diagnostics texts unchanged. Confirm: a checklist card (chosen settings / what happens next).
  Processing: percent, progress bar, ETA, "you can leave this page" note. Done: tiles, finding types
  as badge links to `/catalogs/<id>?type=…`, next actions as rows (workspace, report, diff).
- **Catalogue list**: status filter beside the client filter (`catalogs.list` takes an optional
  `status` — added to the contract and `catalogList`, nothing else changes), sticky header, hover
  rows, the risky count as a badge, row actions shown on hover/focus on pointer screens (always on
  touch), a filtered-empty state with a reset, drafts as a warning card. `STATUS_TONE` moved to
  `catalogs/status-tone.ts` (shared by the list and the header).
- **Workspace header** (props from `[id]/page.tsx` unchanged): title + status chip, one metadata
  line (client · date · rows · classifier, newer-classifier badge), review task with an avatar
  initial (the `dl` with "Tekshiruv:" stays for review-assignment.e2e), quiet links to the report
  and diff; billing popover as a compact card; export menu items with icons and descriptions;
  sharing is now a **Dialog** (new link form, one-time copy field, link list with status chips,
  revoke through ConfirmDialog). Classifier and degraded-run banners share one notice shape.
- **Report**: summary tiles (risky share of rows), review progress bar, findings by type with type
  badges and a relative bar, an internal / client **audience switch** in the URL (`?for=client`
  hides the staff split, CSV and internal history and offers the client PDF), print rules
  (`print:` utilities: no breaks inside tiles and rows, audience printed).
- **Diff**: tiles link to their tab; `Tabs` with counts replace the filter links; changed rows read
  old → new (struck-through danger tint → good tint) for name, unit and code; added/removed rows get
  an edge mark; identical versions say so.
- **/r/[token]**: a product bar (logo + language switch), the firm's brand card with a read-only
  badge and the PDF button, tiles, type badges, a striped findings table with a sticky header,
  "Tasnivo yordamida tayyorlangan" footer. `ui/catalog-status.tsx` (audit running in the workspace)
  got the same progress card; `ui/pay-buttons.tsx` per-provider loading and token colours.
- i18n: new keys under `ta.importX.flow` (uz + ru), nothing renamed.
### Primitive requests (for U1)
1. **Stepper**: promote `upload/wizard-stepper.tsx` (connectors edge to edge, states in text, phone
   summary + segmented bar) to `ui/stepper.tsx`, or give Stepper those states; the old Stepper is now
   unused by the wizard.
2. **Card**: `upload/step-card.tsx` (`StepCard`, `StepFooter` with a full-bleed top rule) maps onto
   U1's new `Card` (title, description, actions, footer); swap after merge.
3. **Notice vs Alert**: `upload/notice.tsx` (tone, title, action, role=alert for danger) is used by
   upload and the clients/imports pages; fold into `Alert` (U1 added title/action/icon). The report's
   classifier/degraded banners use the same shape inline.
4. **Table**: a `striped` prop and row numbering helper (PreviewTable and the share page stripe rows
   with `[&>td]:bg-surface`); a header-cell "eyebrow" slot (mapped field above the header name).
5. **Segmented as links**: a link variant of Segmented for server pages (the report's audience
   switch is a local link group with the Segmented look).
6. **Badge size**: a `size="md"` for clickable chips (done step finding types override padding and
   text size).
7. **Row actions**: a list-row pattern with actions revealed on hover/focus on pointer devices
   (`md:pointer-fine:opacity-0 group-hover:… group-focus-within:…` in `catalog-list.tsx`).
8. **Chip/Tag**: small mono chips (dropzone file types) — no primitive exists.
### Verification and what is unfinished
- Green: root `npm run typecheck`; `npm run lint` (0 errors, one older warning in `scripts/lib/xlsx.ts`);
  `next build apps/web`; the contracts, i18n and ui unit tests (`npm test` as a whole was not run).
- E2E against web 3113 (`next start`) + API 4213, stopped early on the owner's wrap-up: demo-access 5/5,
  empty-states 2/2, review-assignment 5/5 passed; refresh 3/4 (the failing one is
  "router.refresh() on the dashboard", a timing check on U2's page on a loaded machine; not rerun).
  review-flow (upload/mapping/export/diff) and scale did **not** finish: the upload flow's e2e is
  unverified.
- Not checked visually: the before → after row diff (the local data had no changed rows; review-flow
  test 12 covers one), the print preview of the report.
- Local data: the screenshots added one audited catalogue `namuna-katalog.xlsx` (186 rows) and a share
  link to the seed org "Demo Savdo MChJ"; delete it from /catalogs if unwanted.
## U4 result (workspace, queue, dictionary) — 23 Oct, partial
Branch `claude/u4-workspace-6eb144`. Screenshots: `docs/ui-refresh/u4/<page>-<375|768|1280>-<light|dark>.png`
(workspace, drawer, bulk, grouped, empty-filter, sure, queue, dictionary; production build on 3114 + API 4214, seed
demo catalogue). The dictionary shots predate the last layout fix (explainer moved from a side card to a band above
the search). The demo catalogue has no similar rows, so the "grouped" shots show the flat list.
Done:
- Grid: one-line rows at 40 / 32 px (`ROW_HEIGHT` in columns.ts), header 36 px with sort buttons on # (file order)
  and Muammo (risk) with `aria-sort`; finding-type colour only in the status chip; match column is a neutral
  three-bar meter + band word (`confidence-meter.tsx`, `match-chip.tsx` deleted; the suggestion cell shows bars when
  the match column is hidden); decision column in two fixed slots (no shift on hover/active/decided); group header
  rows on the surface tone with a member count and a pending bar, members indented; skeleton rows while more pages
  exist; "end of list · n muammo" line; empty-filter state with icon, search echo and reset.
- Summary strip as KPI chips + progress bar; toolbar on one line at 1280 (32 px controls; views/table settings as
  ghost icon buttons); type chips with counts plus removable chips for every non-default filter (`filter-chips.tsx`);
  floating bulk bar (role=toolbar) over the grid bottom; quiet shortcut strip with Kbd keys and a "?" dialog.
- Drawer: product + type chip, current/proposed code side by side with the changing blocks underlined
  (`CodePair`), sticky section bar (Details / Evidence / Comments / History, scroll-to, all sections stay in the
  DOM so the e2e text checks still see them), keyboard combobox code search, comment thread with initials avatars
  and Ctrl+Enter, history section, sticky footer. Request text and "wrong suggestion" are now Dialogs; the
  sure-accept dialog has a summary card. Phone cards use the same meter/decision pieces.
- Queue: client cards (findings, rows, share of queue, filter-to-client, open-in-workspace), removable filter chips,
  tidier table/cards. Dictionary: chip filters with counts, explainer band (how it works + auto-accept, settings link
  for admins), "Tasdiqlash" for unverified entries (dictionary.update with the same code = one confirmation).
- i18n: new `wsUi` group at the end of the uz and ru objects in packages/i18n/src/i18n-parts/workspace.ts.
Verified: `npm run typecheck` green; eslint on the touched folders green; `next build` green.
NOT run (stopped on the owner's instruction): `npm test`, root `npm run lint`, and the e2e specs (review-flow,
scale, dictionary-review, refresh, navigation). Accessible names/roles the specs use were kept on purpose (grid
roles and ids, chip link names "Label: n muammo", drawer complementary name and headings, `Choose: code` buttons,
decision button names, the decision `<select>`), but this is unproven until the specs run.
Unfinished / follow-ups:
- Queue cards have no assignee, due date or review progress: `workspace.queue` byClient only has findings/rows.
  Needs an additive contract field (per client: open review assignee, dueOn, reviewed/total) plus the API.
- Row height changed (64/40 → 40/32): the scale spec's j/k budget should be rechecked on a production build.
- `ui/row-list.tsx`, `ui/code-chip.tsx`, `ui/ranked-bars.tsx`, `ui/sparkline.tsx` untouched.
Primitive requests for U1:
- `Popover`: an `iconOnly`/`hideLabel` prop (columns menu passes an sr-only label span today).
- `Kbd`: a compact size for dense strips; `Button`: a fixed-width slot option, or accept the `w-[6.75rem]` pattern.
- `Drawer`: a `header` slot under the title (the section bar is sticky inside the body with negative margins now).
- `Dialog` footer: a start-aligned slot (request-text puts a link left with `mr-auto`).
- A shared `FilterChip` (pill with count / removable) — workspace, queue and dictionary each style one locally.
- `Textarea`: a borderless variant for composers (row-comments overrides border and focus).
## U5 result: clients, team, settings, admin, public docs
Branch `claude/u5-clients-settings-e28bb4` (from `claude/w4a-cutover-639ee5`). Screenshots at
375 / 768 / 1280, light and dark: `docs/ui-refresh/u5/<page>-<width>-<theme>.jpg` (legal pages are
light by design; the dark files show the same).
What changed:
- **Local kit** `apps/web/src/app/(app)/_manage/`: `Card` (title, hint, actions, footer for the
  card's own save, `flush` for edge-to-edge tables, `tone="danger"`), `FLUSH_TABLE`, `Fact`,
  `Avatar` / `PersonChip` / `AvatarStack` (initials, colour per person from the status tints),
  `Notice`, `FileDrop`, `ListPreview`, `ListFlow` (file → columns → result stepper), `ROLE_TONE`.
  The pages no longer import the upload wizard's `Dropzone`, `Notice`, `PreviewTable` or
  `AutoRefresh`.
- **Clients**: underline filter tabs with counts (same hrefs and `aria-current`), table in a flush
  card with accountants as avatars, mobile cards; add-client dialog validates inline (required,
  2+ characters) before the API call. Client page: header line (activity type, monthly check,
  accountants as chips with the editor), KPI tiles, catalogues section, history card, a lists card
  (purchases, cheques/sales), activity type and monthly check as cards with their own save.
  Purchases and cheque/sales lists: stepper, upload card, mapper card with a preview, results
  tables; the report page uses Stat tiles and a flush table.
- **Team**: members table (avatar, role badge, client access, last activity, edit/remove), pending
  invites table (status chip, expiry, resend/revoke); on a phone the actions sit under the person.
  `GET /api/team` gained `members[].lastSeenAt` (optional; latest session activity).
- **Settings**: every section is cards; save buttons in each card's footer plus a toast. Account
  (profile, language/theme rows, PDF branding, dictionary), security (two-factor status card with a
  three-step setup dialog — scan, verify, recovery codes — and code dialogs for new recovery codes
  and switching off; password; Telegram sign-in; sessions table with "this device"), plan (plan
  card with price and usage meters, pay card, comparison table with the current plan tinted),
  integrations (Telegram linking as two steps with a QR code and a t.me deep link; API keys card
  with the one-time secret and a keys table), data (export, retention, danger zone). Section ids,
  `?tab=` URLs and the vertical menu are unchanged. `POST /api/account/telegram/code` gained
  optional `link` and `qr`.
- **Admin**: KPI tiles, count tables and pipeline status in flush cards; metrics with CSV buttons
  per card and a breadcrumb back.
- **Public**: `/api-docs` has a sticky header, a grouped sidebar that marks the section in view
  (no address rewriting), endpoint cards built from `@tasnivo/contracts` (`endpoint-info.ts`, tested:
  method, path, status, idempotency, paging, parameters, error codes) and copyable code blocks.
  `/yordam`: article cards on the index; articles with the article list on the left, the TOC on
  the right and long-form typography. `/maxfiylik`, `/oferta`: `LegalDoc` (readable column,
  numbered sections, TOC). `components/landing/legal-page.tsx`'s `LegalPage` is now unused (only
  `Todo` is imported) and can go with the landing owner.
- i18n: new part `packages/i18n/src/i18n-parts/manage.ts` (`ta.mgX`, uz + ru); `HELP_COPY.articles`.
- e2e: `account-flows.e2e.ts` reads API-key and session rows as `row` (they were list items).
Primitive requests (for U1):
1. `Card` primitive with the props of `_manage/card.tsx` (title, hint, actions, footer, flush,
   tone danger) — used on 15+ screens here.
2. `Table`/`TableFrame`: a `bare` (no border/radius) variant for tables inside a card; today
   `FLUSH_TABLE` uses `!` overrides. `Th` needs a way to tint a column (plan comparison) without `!`.
3. `Avatar` / `AvatarStack` / `PersonChip` (initials, deterministic tone).
4. `Notice` banner (tone, title, action) in `src/ui` — the upload wizard and U5 each have a copy.
5. `FileDrop` compact drop zone; `Stepper` is used as is.
6. `Page` `meta` slot under the title (the client header line is placed with `-mt-2` today).
7. `QrCode` (always dark on white) — `settings/two-factor.tsx` exports it for the Telegram card.
8. `Button` `size="sm"` in card footers looks right; a `CardFooter` status slot (left-aligned
   "Saqlandi" next to the save) is handled inside the card for now.
Status when the owner asked to wrap up (23 Oct 2026):
- Done: every page listed above. `npm run typecheck` at the last commit (see the commit message);
  web tsc, eslint on all touched files and the unit tests of the touched folders (27) were green
  during the work.
- Not run: the e2e specs (settings-nav, review-assignment, review-flow, navigation, empty-states,
  dictionary-review, account-flows) and the root `npm test` / `npm run build` / full `npm run lint`.
  Run them before merging; account-flows was updated for the table rows.
- Screenshots are incomplete: 83 of 102. Missing: the dark set of yordam, yordam-article,
  maxfiylik and oferta (all of these but oferta-1280 and yordam-article-375 exist in light), plus
  admin-375-dark, settings-data-375-dark, api-docs-1280-dark (the dev server aborted those loads).
- Not done: a dialog-level screenshot of the two-factor wizard; the invite dialog's form is
  unchanged inside (only the team page around it changed).
