# Handoff from Agent 1 (1C core): requests outside my area, notes for the other workstreams

Branch `feat/onec-integration-core`. Everything below is either a one-line edit I made in a shared
file (so the coordinator knows to keep it at merge) or a request for another owner.

## One-line edits in shared files (keep at merge)

| File | Edit | Why |
|---|---|---|
| `apps/api/src/app.module.ts` | `import { OnecModule }` + `OnecModule` in `imports` | the onec routes |
| `packages/db/prisma/schema.prisma` | `onecConnection OneCConnection?` on `Organization` (outside my section) | relation of the Agent 1 model; the rest is inside the shared and "Agent 1" sections |
| `packages/domain/package.json` + `package-lock.json` | `"iconv-lite": "^0.7.3"` (already in the tree, hoisted; only declared) | windows-1251 / cp866 for the 1C bank file |
| `.claude/launch.json` | `tasnivo-api-4021`, `tasnivo-web-3021` | my servers |
| `packages/contracts/src/registry.test.ts` | the `onec` slot lists its 12 operations | the §3.4 test |
| `packages/contracts/README.md` | checklist regenerated (`npx tsx packages/contracts/src/checklist.ts --write`) | new operations; regenerate again after merging all modules |
| `packages/domain/src/export-1c.ts` | now only re-exports `build1cCsv`, `build1cXlsx`, `ONE_C_HEADERS_RU` from `onec/sheets.ts` | brief: one place for 1C builders. **Agent 4:** do not add builders here; the catalogue download is unchanged (tests green) |

## Requests

1. **Activity log (A5 / coordinator):** `packages/domain/src/activity.ts` `GROUPS.exports` should
   list `onec.exported` and `onec.transferred`, and `GROUPS.team` (org-level) `onec.connection_saved`;
   `packages/i18n/src/i18n-app.ts` / `i18n-app-ru.ts` `actions` need their words
   (uz: «1C fayli tayyorlandi», «1C ga yuborildi», «1C sozlamalari saqlandi»; ru: «Сформирован файл
   для 1С», «Передано в 1С», «Сохранены настройки 1С»). Until then these events fall in "other"
   and show their raw action name. Payload carries `batchId`, `clientId`, `format`, `exportId`,
   `imported`, `skipped` (`rejected` for transfers).
2. **Platform a11y (A5):** in the in-app browser's accessibility tree a `Checkbox` with `hideLabel`
   (`apps/web/src/ui/checkbox.tsx`) is named "on" rather than its label; seen on the review grid's
   row checkboxes. Likewise `Segmented` radios are named by value (`standard`, `uz_mfo`). Not fixed
   here (shared primitives).

## Notes for the producing workstreams (already in the shared notes folder too)

- Exported = records with status `valid` or `corrected`. Write issues with the right severity:
  `error` → `unresolved` (blocks export until corrected or skipped), `warning` → `suspicious` (needs
  an approve). Use `statusFromIssues(issues)` and call `refreshCounts(batchId)` after writing records
  (both exported from `@tasnivo/domain/onec/index`).
- Fingerprints: `bankFingerprint(t, meta.account)`, `invoiceLineFingerprint(meta, line)`,
  `productFingerprint(p)` from the same module, so cross-batch duplicate checks work.
- **Agent 2:** `BankStatementMeta` gained optional `ownerName`, `ownerInn`, `mfo` (the statement
  owner's side of each payment in the 1C file). Fill them when the bank file prints them. Balances
  (`openingBalance`, `closingBalance`, `totalDebit`, `totalCredit`) feed the reconciliation check.
- **Agent 3:** `receipt_xlsx` needs `IncomingInvoiceMeta` to parse (else `meta_invalid`); the
  line's `resolved` product wins over the printed name/MXIK/package. Your invoice batches already
  render in the grid (screenshot 13).
- **Agent 4:** `nomenclature_xlsx` reads `ProductRecord` (`name`, `mxik`, `packageCode`, `unit`,
  `barcode`); `Артикул` stays empty until a field exists. If you want one, propose an additive
  `article` field here.
- Embedding the grid: `docs/accounting-2026-10-23/onec-ui.md`.
- Demo data for everyone: `npx tsx scripts/seed-accounting-demo.ts [email]` (default
  `buxgalter@demo.uz`) creates a bank, an invoice and a product batch (source `seed`, replaced on
  re-run).

## Contract changes made today (all additive)

`packages/contracts/src/accounting.ts`: `BankStatementMeta.ownerName?/ownerInn?/mfo?`;
`ONEC_FORMATS_BY_KIND`, `PRIMARY_FORMAT`, `ONEC_CONNECTION_KINDS`, `ONEC_BANK_KEYS`,
`ONEC_ISSUE_CODES`. Prisma (migration `20261101000100_onec_connection`, applied to the shared dev
DB): table `onec_connection`; `onec_export.file / contentType / requestKey / recordSetHash`;
indexes on `import_record.fingerprint` and `onec_export.recordSetHash`. No proposals from other
workstreams had arrived by the time of this note.
