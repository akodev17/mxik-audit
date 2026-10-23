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
