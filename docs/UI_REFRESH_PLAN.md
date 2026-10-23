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
