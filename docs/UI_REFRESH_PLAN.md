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
