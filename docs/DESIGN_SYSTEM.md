# Tasnivo design system

The signed-in product (everything under `.app`) is a dense, precise working tool for chief
accountants: one accent colour, hairline structure, status said in colour **and** icon **and**
text, numbers in tabular figures, MXIK codes in mono. The public landing (`.landing`, `lp-` tokens)
is a separate system and is not covered here.

Target: WCAG 2.2 AA in both themes. `src/styles/tokens.test.ts` checks the contrast pairs listed
below on every `npm test`.

## Where things live

| What | File |
| --- | --- |
| Tokens (light in `@theme`, dark on `.app[data-theme]`) | `src/styles/app-tokens.css` |
| Fonts, global base rules, print | `src/app/globals.css`, `src/app/layout.tsx`, `src/ui/onest.ts` |
| Theme type, cookie name, parser | `src/ui/theme.ts` |
| Primitives | `src/ui/*.tsx` (shell in `src/ui/shell/**`) |
| Contrast maths | `src/styles/contrast.ts` |
| Visual QA page (dev only, 404 in production) | `/dev/ui` (`src/app/(app)/dev/ui`) |
| Strings used by primitives | `packages/i18n/src/i18n-parts/shell.ts` → `ta.shellX.ui`; those added in the UI refresh in `i18n-parts/auth.ts` → `ta.uiX` |

All base rules sit in `@layer base`, component classes (`.dense`, `.skeleton`) in
`@layer components`, so any Tailwind utility on an element wins over them.

## Theming

- `.app` without `data-theme`, or with `data-theme="light"`: light.
- `data-theme="dark"`: dark tokens, `color-scheme: dark`.
- `data-theme="system"`: follows `prefers-color-scheme`.
- Print always uses the light values (dark blocks are inside `@media screen`).

`src/ui/theme.ts` exports `type Theme = 'light' | 'dark' | 'system'`, `THEMES`,
`THEME_COOKIE = 'mxik_theme'`, `DEFAULT_THEME = 'light'` and `parseTheme(value)` (unknown → light).
The shell owns the switch UI and the cookie; it sets `data-theme={parseTheme(cookie)}` on `.app`.

Overlays (Dialog) are portalled **into** `.app`, not `document.body`, so they inherit the theme.
Never hard-code a colour (`#fff`, `text-white`, `bg-black/50`) inside `.app`: it will not follow
the theme. Use the tokens below.

## Colour tokens

Utilities follow the token name: `--color-danger-ink` → `text-danger-ink`, `bg-danger-ink`,
`border-danger-ink`.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `base` | `#ffffff` | `#0f151b` | Page background |
| `surface` | `#f3f6f9` | `#151c23` | Panels, table heads, hover rows, drawer footer |
| `raised` | `#ffffff` | `#1b232b` | Cards, inputs, buttons, popovers, dialogs, toasts |
| `sunken` | `#edf1f5` | `#0a0f14` | Wells, code chips, neutral badges, disabled fields, inside of the progress track |
| `overlay` | `rgb(16 24 32 / .45)` | `rgb(0 0 0 / .6)` | Modal and drawer scrim |
| `fg` | `#15202b` | `#e5eaef` | Primary text |
| `muted` | `#4f5c69` | `#a3afbb` | Secondary text, labels, header cells (≥ 4.5:1 on wells and every tint too) |
| `subtle` | `#5a6774` | `#8f9ca9` | Placeholders, separators, tertiary icons (still ≥ 4.5:1, also on tints) |
| `inverse` | `#ffffff` | `#0f151b` | Text on an `fg` fill (tooltip, selected segment) |
| `line` | `#dce3ea` | `#2c3742` | Dividers, card borders |
| `line-strong` | `#c5cfd9` | `#3a4651` | Table head rule, button borders |
| `line-input` | `#7a8896` | `#687686` | Borders of inputs, selects, textareas; the progress track edge (≥ 3:1) |
| `brand` | `#2457f5` | `#7aa0ff` | Primary buttons, links, progress, selection |
| `brand-hover` | `#1c47d6` | `#93b3ff` | Primary button hover |
| `brand-active` | `#173bb3` | `#adc4ff` | Primary button pressed |
| `brand-tint` | `#eaf0fe` | `#18264a` | Selected row, brand badge |
| `brand-ink` | `#1a44cc` | `#a9c1ff` | Text on `brand-tint`, quiet links |
| `on-fill` | `#ffffff` | `#0b1220` | Text and icons on solid brand, good, danger, info fills |
| `focus` | `#2457f5` | `#7aa0ff` | Focus ring |
| `focus-halo` | `rgb(36 87 245 / .16)` | `rgb(122 160 255 / .24)` | Soft 4px halo outside a focused field (decoration; the ring is the signal) |
| `good` / `good-tint` / `good-ink` | `#1a7f4c` / `#e7f4ec` / `#14653c` | `#4dc28a` / `#11291d` / `#83d9ab` | Verified, accepted, done |
| `warn` / `warn-tint` / `warn-ink` | `#e39b12` / `#fdf4e1` / `#8a5a00` | `#e2a63c` / `#2d2412` / `#f1c46e` | Doubtful, needs a look. The `warn` fill is never text |
| `danger` / `danger-tint` / `danger-ink` | `#cc3324` / `#fcefed` / `#a52a1d` | `#f27b6f` / `#341b19` / `#ff9f94` | Wrong or missing code, destructive actions, invalid fields |
| `info` / `info-tint` / `info-ink` | `#0b6bbf` / `#e8f1fb` / `#0a5596` | `#62b1f0` / `#10253a` / `#94caf6` | In progress, neutral notices |

Status families: **fill** for dots, bars and solid marks; **tint** for chip and row backgrounds;
**ink** for text on the tint (≥ 4.5:1 on its tint and on base). The audited danger chip
(`#d23a2a` on `#fcefed`, 4.27:1) is now `danger-ink` on `danger-tint`, 6.3:1.

`--color-ink` (`#14161c`) remains only because the privacy page uses `text-ink` on the landing.

## Type scale

Onest for all text (weights 400, 500, 600, 700), IBM Plex Mono for codes. `.app` sets
`text-body` and tabular figures by default. The scale is the one in `docs/UI_REFRESH_PLAN.md` §2
(`tokens.test.ts` checks it); use these utilities and nothing else (no `text-sm`, `text-lg`,
`text-[1.75rem]`).

| Utility | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `text-display` | 32 / 40 | 600 | Hero lines only: the auth brand panel, a first-run empty state |
| `text-h1` = `text-title` | 24 / 32 | 600 | Page `h1` (Page), auth form titles |
| `text-h2` = `text-section` | 18 / 28 | 600 | Section `h2`, card, dialog and drawer titles |
| `text-body` | 14 / 20 | 400 | Running text, page hints (the `.app` default), `lg` controls |
| `text-data` | 13 / 18 | 400 | Tables, grids (`.dense`), `md` controls, buttons, field labels |
| `text-small` | 12 / 16 | 400–500 | Hints and errors under fields, header cells, breadcrumbs |
| `text-micro` | 12 / 16 | 500 (add `font-medium`) | Badges, counts, tooltips |
| `text-mono` + `font-mono` | 13 / 18 | 400 | MXIK codes (CodeChip), keys, tokens |

`text-h1`/`text-h2` (the plan's names) and `text-title`/`text-section` (older) are the same sizes;
both stay. Phones: a field whose text is under 16px makes iOS zoom in on focus, so pages a phone
user types into first (auth) add `max-sm:text-[16px]` to their fields.

## Shape, depth, stacking, motion, sizing

| Token | Value | Use |
| --- | --- | --- |
| `rounded-sm` / `rounded-md` / `rounded-lg` | 6 / 8 / 12 px (inside `.app`) | Chips and menu items / controls and popovers / dialogs |
| `rounded-ctl` | 8 px | Legacy alias of `rounded-md`; keep using it in existing code |
| `shadow-sm` | `0 1px 2px` | Raised small elements |
| `shadow-pop` | `0 6px 20px`, `0 1px 3px` | Popovers, menus, tooltips |
| `shadow-overlay` | `0 18px 48px`, `0 2px 8px` | Dialogs, drawers, toasts |
| `z-sticky` / `z-dropdown` / `z-drawer` / `z-modal` / `z-toast` | 10 / 20 / 30 / 40 / 50 | Never use raw `z-*` numbers |
| `--duration-fast` / `--duration-base` | 120 / 180 ms | Colour changes / entrances (`duration-(--duration-fast)`) |
| `ease-standard` | `cubic-bezier(.2,0,0,1)` | All motion |
| `animate-fade-in` / `animate-pop-in` / `animate-slide-in` | base duration | Always behind `motion-safe:` |
| `h-control-compact` / `-md` / `-lg` | 32 / 36 / 40 px | Inputs, selects, buttons, segmented. **Forms use `lg`** (40, §2), toolbars and filters `md`, dense bars `compact`; Button, Input, Select and Segmented of the same size are the same height |
| `h-control-inline` | 28 px | Buttons inside dense table and grid rows |
| `max-w-page` / `max-w-page-wide` | 64 / 80 rem | Page containers (`pageContainerClass(wide)`) |

Shadow colours come from `--elevation-color(-strong)`, which the dark theme deepens.
`prefers-reduced-motion: reduce` cuts every animation and transition to a single frame.

## Components

All in `src/ui`. States listed are the ones the dev gallery renders.

| Component | Props (beyond native) | States |
| --- | --- | --- |
| `Button`, `ButtonLink`, `buttonClass()` | `variant`: primary · secondary · ghost · danger · danger-ghost; `size`: compact (28) · sm (32) · md (36, default) · lg (40, forms); `loading` (Button); `leadingIcon`, `trailingIcon` (decorative slots; the spinner takes the leading slot while loading); `BUTTON_ICON_SIZE[size]` is the matching icon size | rest, hover, pressed, focus, disabled, loading (`aria-busy`, spinner, clicks ignored, focus kept) |
| `IconButton` | `label` (required: aria-label and tooltip), `icon`, `variant` ghost · secondary · danger-ghost, `size`, `tooltipSide`, `tooltipAlign`, `loading` | as Button; tooltip on hover and keyboard focus |
| `Tooltip` | `content`, `side`, `align`, `describe` (adds aria-describedby) | hidden, shown on hover (300 ms) or focus-visible, hoverable, Escape hides |
| `Badge`, `StatusChip`, `StatusIcon` | `tone`: neutral · good · warn · danger · info · brand; `icon`, `title` | text always present; StatusIcon gives tick / triangle / cross / i; when space is tight only the label shortens with an ellipsis (`min-w-0` label, `shrink-0` icon, chip capped at `max-w-full`) and the full text stays in the DOM; StatusChip repeats a plain-text label as `title`, Badge only when given one (badges often sit in Tooltip triggers) |
| `Input` | `size` compact · md · lg, `invalid`, `leadingIcon`, `trailingIcon` (decorative), `trailing` (an interactive element at the end, with its own name), `wrapperClassName` | rest, hover, focus (2px ring over the border plus the `focus-halo`), invalid, disabled, read-only |
| `PasswordInput` (`password-input.tsx`) | as Input, without `type`/`trailing` | show/hide toggle: a real button named "Parolni koʻrsatish / yashirish" (`ta.uiX`), `aria-pressed`, `aria-controls` the field; never submits |
| `Field` | `label`, `hint`, `error`, `required`, `labelAside` (a link at the right of the label row, e.g. "Forgot password?") | links label, hint and error to its control by id (`aria-describedby`, `aria-invalid`); label `text-data` medium, hint and error `text-small` |
| `Select` | `size`, `invalid`, `label`, `hint`, `error`, `wrapperClassName`, `leadingIcon` | native select, chevron, same states as Input; a pointer-focused select shows the ring too |
| `Textarea` | `invalid` | as Input, vertical resize |
| `Checkbox` | `label`, `description`, `hideLabel`, `indeterminate` | unchecked, checked, mixed, disabled |
| `Segmented` | `label`, `options` ({ value, label, icon, lang }), `value`, `onChange`, `size` compact · md · lg, `name`, `disabled` | native radios: arrows move, Tab leaves, posts with forms; selected = `brand-tint` fill, `brand-ink` text and a 1px `brand` ring (>= 3:1 on the `surface` track, tested) |
| `CopyField` | `label`, `value`, `mono`, `size` | idle, copied (announced politely), failed (fallback to selection, message shown) |
| `Progress`, `progressPercent()` | `label`, `value`, `max`, `valueText`, `tone`, `hideLabel`, `size` | determinate (`aria-valuenow/min/max/text`), indeterminate; track = `sunken` well with a 1px `line-input` edge (≥ 3:1 on surface, raised and base in both themes; brand, good and danger fills ≥ 3:1 on the well; tested in `progress.test.ts`). The light `warn` fill is about 2:1 on the well, so a warn bar keeps its visible value text (no `hideLabel`) |
| `Stat` | `label`, `value` (pre-formatted), `hint`, `href`, `tone` | static tile, whole tile as link; the label wraps to two lines before an ellipsis and values line up across a row |
| `Table`, `Th`, `Td`, `Tr` | Table: `label` (region name), `stickyHeader`, `maxHeight`, `density` comfortable (40px rows, default) · compact (32px), `hoverRows`; Th/Td: `numeric`; Tr: `interactive`, `selected` | horizontal scroll inside a positioned frame with edge fades; hover on interactive rows, or on every row with `hoverRows`; cell padding comes from `--cell-py` |
| `Page`, `Section`, `pageContainerClass()` | Page: `title`, `hint`, `actions`, `wide`, `crumbs`; Section: `title`, `hint`, `actions` | breadcrumbs above the `h1` (`text-title`, 24/32); the hint is one sentence in `text-body` muted; container is `relative` |
| `Card`, `cardClass()` (`page.tsx`) | `title`, `description`, `actions`, `footer`, `padding` none · sm (16) · md (20, default), `as`, `headingAs` | raised surface, `line` border, 12px radius, `shadow-sm`; header row (title and description left, actions right), footer bar on `surface`; never nest cards |
| `Alert` | `tone` info · good · warn · danger, `title`, `action`, `icon` | tint fill, ink text, softened border of the fill colour; danger is `role=alert`, the rest `role=status` |
| `Skeleton`, `SkeletonLine`, `SkeletonText`, `SkeletonCard`, `PageSkeleton` | Line: `size` (a type-scale step), `width`; Text: `lines`, `size`; Card: `lines` | every line box has the real line height, so nothing shifts when content arrives |
| `Breadcrumbs` | `items` (last = current page), `label` | `nav` + `ol`, `aria-current="page"` |
| `EmptyState` | `title`, `hint`, `action` (slot), `tone` neutral · danger, `icon`, `size` default · compact, `as` h2 · h3 | empty, failed |
| `Dialog` | `open`, `onClose`, `title`, `description`, `footer`, `size` sm · md · lg, `initialFocus`, `dismissible`, `role`, `icon` (on the title line only; description and body use the full width), `placement` center · top (top keeps the panel still while results grow: the command palette) | portal into `.app`, scrim, focus trap, Escape, backdrop click, scroll lock, focus returns to opener, `aria-modal`, `aria-labelledby` |
| `ConfirmDialog` | `title`, `description`, `count`, `countLabel`, `scope`, `tone` default · danger, `confirmLabel`, `cancelLabel`, `onConfirm` (async, may return `{ ok: false, error }`) | idle, running (cannot be dismissed), failed (inline error, stays open), done (closes) |
| `Popover` | `label`, `title`, `children` (or `close => node`), `variant`, `size`, `align`, `side`, `open` / `onOpenChange` | `aria-expanded`/`aria-controls`, focus moves in, Escape / outside click / Tab away close; flips and shifts to stay in the viewport (see Panel placement) |
| `Menu` | `label`, `items` ({ label, description, onSelect, href, icon, tone, disabled }), `icon`, `iconOnly`, `variant`, `size`, `align` | arrows, Home, End, first letter, Escape returns focus, Tab closes; flips and shifts like Popover; `description` is a small muted second line |
| `Tabs` | `items` ({ href, label, active, count }) | links with `aria-current="page"` on the active one; a row wider than the screen scrolls sideways with edge fades and the active tab scrolled into view |
| `Drawer` | `open`, `title`, `onClose`, `footer`, `backdrop`, `width` (sets `--drawer-width`, default 460px) | non-modal; focus to heading on open and back to opener on close; Escape ignored in a filled text field or when already handled |
| `ToastProvider`, `useToast()` | `toast(message, { tone: 'ok' \| 'error', action })` | timer pauses on hover and focus; close button; errors are `role="alert"` with an "Error:" prefix; with an action at least 5 s |
| `Spinner` | `label`, `size` | decorative or `role="status"` |
| `Kbd` | — | — |
| `VisuallyHidden` | — | screen-reader text pinned to its containing block |
| `LanguageSwitch` | `className` | built on `Segmented`; each name carries its own `lang`; a change reloads the page |
| `Stepper` | `stages`, `current` | done (good fill, tick), current (brand fill with a tint halo), upcoming (outlined); the connector after a done step is green |
| `TelegramLogin` | `bot`, `authUrl`, `radius` (8 = the control radius), `className` | Telegram's own iframe button (it cannot be restyled); its 40px height is reserved, so nothing moves when it loads |
| `AuthLayout` (`auth-layout.tsx`) | `children`, `aside` (false: no brand panel) | auth pages: split on ≥ 1024px (form column ≤ 440px, brand panel), stacked on phones; logo to `/`, language switch, legal links |
| `CodeChip`, `Sparkline` | unchanged APIs, now token-only | — |

Escape handling is shared: every open overlay registers in a layer stack (`src/ui/layers.ts`) and
only the topmost one reacts, so Escape in a menu inside a dialog inside a drawer closes the menu.

### Panel placement (Popover, Menu)

`side` and `align` are preferences. When the panel opens, `usePlacement` (`src/ui/use-placement.ts`)
measures it against the viewport with the pure `placePanel()` (`src/ui/placement.ts`, unit-tested):

- **Flip:** the panel keeps its side (Menu: below) unless it does not fit there; it then opens on
  the other side if it fits there or has more room. Room is the viewport height minus the 4 px gap
  and an 8 px margin.
- **Shift:** the left edge is clamped so the panel stays 8 px inside the viewport; a panel wider
  than the viewport allows is pinned to the left margin (panels are capped at `100vw - 2rem`).
- It re-measures on window resize, on scroll of any container and when the panel changes size.
  Measurement happens before paint, so there is no visible jump. Focus and keyboard behaviour are
  unchanged.

Panels are still `absolute` inside the trigger's wrapper, so an `overflow` container still clips
them (rule 9).

### Menu item descriptions

`MenuItem.description` adds a small muted second line under the label (`text-small text-muted`).
The label alone is the item's accessible name (`aria-labelledby`) and the description is its
accessible description (`aria-describedby`), so a screen reader says both once. Typeahead still
matches the label. A menu with descriptions is capped at 22 rem and the descriptions wrap; keep
each one short and factual (what the file or action is, not marketing).

### Tabs overflow

`Tabs` stays a row of links (`nav` > `a`, `aria-current="page"` on the active tab). When the row
is wider than its container it scrolls sideways: the scrollbar is hidden, fades on the edges show
there is more (as in `TableFrame`), and the active tab is centred in the row on load and on change
by setting the row's `scrollLeft`, never scrolling the page. Links are `shrink-0` and never wrap;
the focus ring is drawn inside the tab so the scroller does not clip it.

## Usage rules

1. **One primary action per view.** A page, dialog or drawer has at most one `primary` button;
   everything else is `secondary` or `ghost`. In a footer the primary action goes last.
2. **Buttons say exactly what happens**: "Katalogni oʻchirish", "12 ta taklifni qabul qilish",
   never "OK" or "Ha". Sentence case, Uzbek Latin first, Russian mirror.
3. **Destructive actions** use `danger` (a deliberate button) or `danger-ghost` (in rows and
   menus) and go through `ConfirmDialog` with `tone="danger"`, a `scope` and, when known, a
   `count`. Do not use `window.confirm`.
4. **Status = colour + icon + text.** Use `StatusChip` with `StatusIcon`, or a Badge with text.
   A tint or a red number on its own is never the only signal.
5. **Codes in mono.** MXIK codes go through `CodeChip` (or `font-mono`), never wrap, and are not
   letter-spaced.
6. **Numbers align right** with tabular figures: `Th numeric` / `Td numeric`; format with
   `fmtNumber`, `fmtPercent`, `fmtDate` from `src/lib/format.ts`. Both languages group thousands
   with a no-break space and use a decimal comma ("1 234,5"); the separators are fixed in code, not
   taken from the runtime ICU, so the server and every browser print the same text (a difference
   breaks hydration). Never call `toLocaleString` or `Intl.NumberFormat` in UI or dictionaries.
7. **Tokens only.** No hex values, `text-white`, `bg-black/…` or raw `z-50` inside `.app`.
8. **Screen-reader text needs a positioned ancestor.** `sr-only` is `position: absolute`;
   without a positioned ancestor it lands at its static position and can lengthen or widen the
   page. Page, Table and Drawer bodies are `relative`; elsewhere add `relative` or use
   `VisuallyHidden`.
9. **Tables** get a `label` when they can overflow, and `Tr interactive` only when the whole row
   opens something. Menus and popovers inside a table are clipped by its scroll frame; put row
   actions in the last cell or in a drawer.
10. **Focus** is one 2px `focus` ring. Do not add `ring-*` focus styles on top, and do not remove
    the outline without a visible replacement of at least 3:1.

11. **Same-route navigation loads a document.** In the production build an app-router
    navigation that stays on the same route (only the query changes, or one record to its
    sibling such as `/clients/A` to `/clients/B`) has no fresh loading fallback and can stay
    suspended for good on the heavier pages: the request succeeds, the address and page do not
    change. The shell (`src/ui/shell/same-route-links.ts`) turns such link clicks into document
    loads; the workspace (`/catalogs/<id>`) keeps its own query state in the router. Code that
    navigates itself uses `goTo(href, router.push)` from the same file, never a bare
    `router.push`/`router.replace` to the current route. `router.refresh()` has the same risk:
    after a change that alters the whole page (client switch, language) reload instead.
12. **The header client control** says what the page is about: the page's client (a client's
    pages, a list filtered by `client`), the active client (catalogue list, upload), "Barcha
    mijozlar / Все клиенты" (firm-wide pages and unfiltered lists), or a neutral "choose a
    client" on a catalogue, whose header names its client. Picking a client always shows it:
    the client's page, catalogues or the same list filtered to it (`switchTarget`).

## Glossary

One word per idea, in both languages. Labels, PDF, Excel and Telegram use the same ones.

| Idea | Uzbek | Russian | Not |
| --- | --- | --- | --- |
| A row with at least one high or medium finding | xavfli qator | рискованная строка | riskli, eʼtibor talab qiladigan |
| What the audit found on a row | muammo (UI), topilma only in admin metrics | проблема | — |
| An uploaded file and its rows | katalog (list column: Fayl = the file name) | каталог | — |
| How well a suggestion matched (never a probability) | Yuqori / Oʻrtacha / Past moslik | Высокое / Среднее / Низкое совпадение | ishonch, Tekshirish kerak, уверенность |
| Decision states | Tasdiqlandi · Rad etildi · Koʻrib chiqilmagan | Принято · Отклонено · Не рассмотрено | Qabul qilindi, Подтверждено, Ожидает |
| Decision verbs | Tasdiqlash · Rad etish | Принять · Отклонить | Подтвердить (for a suggestion) |
| The classifier code | MXIK kodi | код ИКПУ | код MXIK (the product name no longer carries MXIK) |
| A catalogue not yet audited | Tahlil qilinmagan | Не проанализирован | Yuklangan, Загружен |

The low match band uses the neutral tone (a dot), never the danger tone of problem chips: lower
certainty is not an error.

## Follow-ups for other areas

Places outside `src/ui` that hard-coded colours or bypassed primitives when this system was built.
All of the first list are now fixed (checked against the code: no `text-white`, hex colour
classes, `window.confirm` or raw `<select>` remain under `src/app/(app)` and `src/ui`):

- ~~`bg-fg text-white` (segmented toggles, onboarding hint): use `text-inverse`, or `Segmented`.~~
- ~~`bg-brand text-white` and `hover:bg-[#1c47d6]` (activity filter, `/r` PDF link): use
  `buttonClass('primary')`.~~
- ~~`bg-danger text-white` (notification count in the header): use `text-on-fill`.~~ The bell
  count uses `text-on-fill`.
- ~~`hover:bg-[#ebf0f5]` (group rows) and `hover:bg-[#dbe6fd]` (user menu): use `hover:bg-sunken`
  and `hover:bg-brand-tint`.~~
- ~~`window.confirm` in four delete flows (catalogue, imported document, dictionary entry, team
  member): use `ConfirmDialog`.~~ All four use `ConfirmDialog`.
- ~~Raw `<select className="h-9 …">` in several pages: use `Select`.~~ The only `<select>` left
  is inside `Select`.
- ~~The shell `<main>` is the scroll container; making it `relative` would contain any stray
  `sr-only` on pages that do not use `Page`.~~ `<main>` is `relative`.

Open:

- `ExportMenu` (`catalogs/[id]/export-menu.tsx`) builds the export items; give each one
  `description: x.hints[kind]` (the strings are in `ta.importX.exp.hints`, uz and ru).
- `CellChip` (`catalogs/[id]/cell-chip.tsx`) wraps the icon in `shrink-0` and the label in
  `min-w-0 truncate` itself; `StatusChip` now does both, so the wrappers can go.
