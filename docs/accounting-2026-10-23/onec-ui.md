# 1C pages and the shared review grid (Agent 1)

## Pages

| Route | What | Who |
|---|---|---|
| `/onec` | Import history: every batch of every kind with state, record counts ("N need review"), exports, date. Filters: kind and state chips; client through the header's client control (`?client=`, `/onec` is in `CLIENT_LISTS`). 25 per page. | everyone signed in; a scoped accountant sees their clients' batches only |
| `/onec/[batchId]` | Header (kind, client, source, uploaded), counts (records, ready, need review, sent to 1C), the review grid, «Подготовить для 1С» (format, dry run with checks and grouped issues, build + download), direct transfer (only when the org has an OData connection; labelled unverified), export history with outcome per reason and a download per stored file. | reads: everyone; decisions and exports: admin/accountant, not in a demo |
| `/onec/settings` | Bank-file МФО keys, direct connection with its test (admins), counterparties: list, search, 1C «Контрагенты» import for a chosen client. | connection: admins; counterparties: everyone, import: writers |

Screenshots: `docs/accounting-2026-10-23/agent1/` (01–13, uz and ru, desktop and 375 px).

## The review grid (for the bank, Didox and product pages)

```tsx
import { ReviewGrid } from '@/app/(app)/onec/review/review-grid';          // or a relative path
import { DEFAULT_COLUMNS, type ReviewColumn } from '@/app/(app)/onec/review/columns';

<ReviewGrid batchId={batch.id} kind="bank_statement" />                   // default columns
<ReviewGrid batchId={batch.id} kind="didox_invoice" columns={myColumns} readOnly={!writer} />
```

Props (stable):

| Prop | Type | Meaning |
|---|---|---|
| `batchId` | `string` | the `import_batch.id` |
| `kind` | `'bank_statement' \| 'didox_invoice' \| 'product_catalog'` | picks `DEFAULT_COLUMNS[kind]` |
| `columns?` | `ReviewColumn[]` | your own columns (below); default `DEFAULT_COLUMNS[kind]` |
| `readOnly?` | `boolean` | hides selection and decisions (pass `!canWrite(user) \|\| user.demo`) |

`ReviewColumn = { key, label?, kind?, editable?, wide?, formOnly? }`:
- `key`: dot path into the record's payload (`amount`, `counterparty.inn`, `resolved.mxik`).
- `label`: defaults to `ta.onecX.columns[key]`, then `ta.onecX.columns[<last segment>]`.
- `kind`: `text` | `money` (decimal string, locale grouping) | `signed` (money with `+`/`−` from
  `payload.direction`) | `date` (`YYYY-MM-DD` → `DD.MM.YYYY`) | `code` (monospace) | `direction` |
  `long` (two-line clamp).
- `editable`: offered in the row's correction form; sent as `corrections[key]` (blank = `null`).
  The server re-validates the corrected payload with the kind's zod schema, removes the issues on
  the corrected fields (an issue's `field` equal to, inside, or containing the corrected path),
  and sets `corrected` (or `unresolved` when another error stands).
- `wide`: hidden below 1280 px (from the fourth column on). `formOnly`: only in the correction form.

What the grid does by itself: loads `GET /api/onec/batches/{id}?status&page` (React Query key
`onec.batch`), status chips with counts, 100 records per page, row checkboxes and a bulk bar
(approve / skip / reopen through `POST …/decisions`), per row: approve and skip icons, a details
row with every issue (label from `accountingX.issues[code]`, then `bankX.issues`, `didoxX.issues`,
`productsX.issues`, `onecX.issues`; params and `suggestion` shown), the decision and its note, the
1C outcome and its reason/message, and the correction form. After any decision it invalidates
`onec.batch`, so the page's counts and the export panel refresh too. Loading, empty and failure
states are built in; it fits a 375 px screen (the table scrolls inside its card).

Decision rules (server, `packages/domain/src/onec/review.ts`): `approve` is refused while an
`error` issue stands (`has_errors`), else the record becomes `valid` (`corrected` stays
`corrected`); `skip` → `skipped`; `reopen` → the status its issues give; an `exported` record
cannot be changed (`already_exported`). The batch moves to `review` while anything is suspicious or
unresolved, `approved` when something is ready, `exported` when everything left is exported.

Issue codes: emit your own (`mxik_missing`, `bank_format_unknown`, …) with a label in your i18n
part under `<area>X.issues.<code>` (uz and ru) and the grid shows it.

## New primitives

None. Local helpers: `onec/review/columns.ts` (pure: columns, value formatting, tones, issue
labels) used by the grid and the pages; the chip style is the one `/activity` uses.
