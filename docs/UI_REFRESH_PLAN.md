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
