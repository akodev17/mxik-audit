# MXIK Audit design system

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
| Strings used by primitives | `src/lib/i18n-parts/shell.ts` → `ta.shellX.ui` |

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
| `sunken` | `#edf1f5` | `#0a0f14` | Wells, code chips, neutral badges, disabled fields, progress track |
| `overlay` | `rgb(16 24 32 / .45)` | `rgb(0 0 0 / .6)` | Modal and drawer scrim |
| `fg` | `#15202b` | `#e5eaef` | Primary text |
| `muted` | `#5b6875` | `#9ba7b3` | Secondary text, labels, header cells |
| `subtle` | `#63707d` | `#8794a1` | Placeholders, separators, tertiary icons (still ≥ 4.5:1) |
| `inverse` | `#ffffff` | `#0f151b` | Text on an `fg` fill (tooltip, selected segment) |
| `line` | `#e2e8ee` | `#263039` | Dividers, card borders |
| `line-strong` | `#cbd5df` | `#34404b` | Table head rule, button borders |
| `line-input` | `#7a8896` | `#687686` | Borders of inputs, selects, textareas (≥ 3:1) |
| `brand` | `#2457f5` | `#7aa0ff` | Primary buttons, links, progress, selection |
| `brand-hover` | `#1c47d6` | `#93b3ff` | Primary button hover |
| `brand-active` | `#173bb3` | `#adc4ff` | Primary button pressed |
| `brand-tint` | `#eaf0fe` | `#18264a` | Selected row, brand badge |
| `brand-ink` | `#1a44cc` | `#a9c1ff` | Text on `brand-tint`, quiet links |
| `on-fill` | `#ffffff` | `#0b1220` | Text and icons on solid brand, good, danger, info fills |
| `focus` | `#2457f5` | `#7aa0ff` | Focus ring |
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
`text-body` and tabular figures by default.

| Utility | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `text-title` | 22 / 28 | 600 | Page `h1` (Page) |
| `text-section` | 16 / 24 | 600 | Section `h2`, dialog and drawer titles |
| `text-body` | 15 / 22 | 400 | Running text (the `.app` default) |
| `text-data` | 14 / 20 | 400 | Tables, grids (`.dense`), controls, buttons |
| `text-small` | 13 / 18 | 400–500 | Labels, hints, header cells, breadcrumbs |
| `text-micro` | 12 / 16 | 500 | Badges, field hints and errors, tooltips |
| `text-mono` + `font-mono` | 13 / 18 | 400 | MXIK codes (CodeChip), keys, tokens |

## Shape, depth, stacking, motion, sizing

| Token | Value | Use |
| --- | --- | --- |
| `rounded-sm` / `rounded-md` / `rounded-lg` | 6 / 8 / 12 px (inside `.app`) | Chips and menu items / controls and popovers / dialogs |
| `rounded-ctl` | 8 px | Legacy alias of `rounded-md`; keep using it in existing code |
| `shadow-sm` | `0 1px 2px` | Selected segment |
| `shadow-pop` | `0 6px 20px`, `0 1px 3px` | Popovers, menus, tooltips |
| `shadow-overlay` | `0 18px 48px`, `0 2px 8px` | Dialogs, drawers, toasts |
| `z-sticky` / `z-dropdown` / `z-drawer` / `z-modal` / `z-toast` | 10 / 20 / 30 / 40 / 50 | Never use raw `z-*` numbers |
| `--duration-fast` / `--duration-base` | 120 / 180 ms | Colour changes / entrances (`duration-(--duration-fast)`) |
| `ease-standard` | `cubic-bezier(.2,0,0,1)` | All motion |
| `animate-fade-in` / `animate-pop-in` / `animate-slide-in` | base duration | Always behind `motion-safe:` |
| `h-control-compact` / `-md` / `-lg` | 32 / 36 / 40 px | Inputs, selects, buttons |
| `h-control-inline` | 28 px | Buttons inside dense table and grid rows |
| `max-w-page` / `max-w-page-wide` | 64 / 80 rem | Page containers (`pageContainerClass(wide)`) |

Shadow colours come from `--elevation-color(-strong)`, which the dark theme deepens.
`prefers-reduced-motion: reduce` cuts every animation and transition to a single frame.

## Components

All in `src/ui`. States listed are the ones the dev gallery renders.

| Component | Props (beyond native) | States |
| --- | --- | --- |
| `Button`, `ButtonLink`, `buttonClass()` | `variant`: primary · secondary · ghost · danger · danger-ghost; `size`: compact (28) · sm (32) · md (36, default); `loading` (Button) | rest, hover, pressed, focus, disabled, loading (`aria-busy`, spinner, clicks ignored, focus kept) |
| `IconButton` | `label` (required: aria-label and tooltip), `icon`, `variant` ghost · secondary · danger-ghost, `size`, `tooltipSide`, `tooltipAlign`, `loading` | as Button; tooltip on hover and keyboard focus |
| `Tooltip` | `content`, `side`, `align`, `describe` (adds aria-describedby) | hidden, shown on hover (300 ms) or focus-visible, hoverable, Escape hides |
| `Badge`, `StatusChip`, `StatusIcon` | `tone`: neutral · good · warn · danger · info · brand; `icon` | text always present; StatusIcon gives tick / triangle / cross / i |
| `Input` | `size` compact · md · lg, `invalid` | rest, hover, focus (one 2px ring over the border), invalid, disabled, read-only |
| `Field` | `label`, `hint`, `error`, `required` | links label, hint and error to its control by id (`aria-describedby`, `aria-invalid`) |
| `Select` | `size`, `invalid`, `label`, `hint`, `error`, `wrapperClassName` | native select, chevron, same states as Input |
| `Textarea` | `invalid` | as Input, vertical resize |
| `Checkbox` | `label`, `description`, `hideLabel`, `indeterminate` | unchecked, checked, mixed, disabled |
| `Segmented` | `label`, `options`, `value`, `onChange`, `size`, `name` | native radios: arrows move, Tab leaves, posts with forms |
| `CopyField` | `label`, `value`, `mono`, `size` | idle, copied (announced politely), failed (fallback to selection, message shown) |
| `Progress`, `progressPercent()` | `label`, `value`, `max`, `valueText`, `tone`, `hideLabel`, `size` | determinate (`aria-valuenow/min/max/text`), indeterminate |
| `Stat` | `label`, `value` (pre-formatted), `hint`, `href`, `tone` | static tile, whole tile as link |
| `Table`, `Th`, `Td`, `Tr` | Table: `label` (region name), `stickyHeader`, `maxHeight`; Th/Td: `numeric`; Tr: `interactive`, `selected` | horizontal scroll inside a positioned frame with edge fades; hover only on interactive rows |
| `Page`, `Section`, `pageContainerClass()` | Page: `title`, `hint`, `actions`, `wide`, `crumbs`; Section: `title`, `hint`, `actions` | breadcrumbs above the `h1`; container is `relative` |
| `Breadcrumbs` | `items` (last = current page), `label` | `nav` + `ol`, `aria-current="page"` |
| `EmptyState` | `title`, `hint`, `action` (slot), `tone` neutral · danger, `icon`, `size` default · compact, `as` h2 · h3 | empty, failed |
| `Dialog` | `open`, `onClose`, `title`, `description`, `footer`, `size` sm · md · lg, `initialFocus`, `dismissible`, `role`, `icon` | portal into `.app`, scrim, focus trap, Escape, backdrop click, scroll lock, focus returns to opener, `aria-modal`, `aria-labelledby` |
| `ConfirmDialog` | `title`, `description`, `count`, `countLabel`, `scope`, `tone` default · danger, `confirmLabel`, `cancelLabel`, `onConfirm` (async, may return `{ ok: false, error }`) | idle, running (cannot be dismissed), failed (inline error, stays open), done (closes) |
| `Popover` | `label`, `title`, `children` (or `close => node`), `variant`, `size`, `align`, `side`, `open` / `onOpenChange` | `aria-expanded`/`aria-controls`, focus moves in, Escape / outside click / Tab away close |
| `Menu` | `label`, `items` ({ label, onSelect, href, icon, tone, disabled }), `icon`, `iconOnly`, `variant`, `size`, `align` | arrows, Home, End, first letter, Escape returns focus, Tab closes |
| `Drawer` | `open`, `title`, `onClose`, `footer`, `backdrop`, `width` (sets `--drawer-width`, default 460px) | non-modal; focus to heading on open and back to opener on close; Escape ignored in a filled text field or when already handled |
| `ToastProvider`, `useToast()` | `toast(message, { tone: 'ok' \| 'error', action })` | timer pauses on hover and focus; close button; errors are `role="alert"` with an "Error:" prefix; with an action at least 10 s |
| `Spinner` | `label`, `size` | decorative or `role="status"` |
| `Kbd` | — | — |
| `VisuallyHidden` | — | screen-reader text pinned to its containing block |
| `CodeChip`, `Stepper`, `Skeleton`, `Sparkline`, `LanguageSwitch` | unchanged APIs, now token-only | — |

Escape handling is shared: every open overlay registers in a layer stack (`src/ui/layers.ts`) and
only the topmost one reacts, so Escape in a menu inside a dialog inside a drawer closes the menu.

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
   `fmtNumber`, `fmtPercent`, `fmtDate` from `src/lib/format.ts`.
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

## Follow-ups for other areas

Places outside `src/ui` that still hard-code colours and will look wrong in the dark theme
(found while building this; owners should switch to tokens):

- `bg-fg text-white` (segmented toggles, onboarding hint): use `text-inverse`, or `Segmented`.
- `bg-brand text-white` and `hover:bg-[#1c47d6]` (activity filter, `/r` PDF link): use
  `buttonClass('primary')`.
- `bg-danger text-white` (notification count in the header): use `text-on-fill`.
- `hover:bg-[#ebf0f5]` (group rows) and `hover:bg-[#dbe6fd]` (user menu): use `hover:bg-sunken`
  and `hover:bg-brand-tint`.
- `window.confirm` in four delete flows (catalogue, imported document, dictionary entry, team
  member): use `ConfirmDialog`.
- Raw `<select className="h-9 …">` in several pages: use `Select`.
- The shell `<main>` is the scroll container; making it `relative` would contain any stray
  `sr-only` on pages that do not use `Page`.
