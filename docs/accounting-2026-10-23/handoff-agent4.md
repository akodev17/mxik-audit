# Agent 4 → coordinator and Agent 1: proposals and notes (2026-10-23)

Branch `feat/mxik-product-intelligence`. Nothing here is applied to Agent 1's files; each item says
what Agent 4 does meanwhile.

## Proposals for `packages/contracts/src/accounting.ts` (owner: Agent 1)

1. **`MATCH_BASES`: add `'name_similar'`.** `matchProducts` and `classifyProducts` produce candidates
   from name *similarity* (pg_trgm for products, the lexical/vector cascade for MXIK suggestions).
   The enum has only `name_exact` / `name_normalized`, so they are reported as `name_normalized`
   with a reason that says "similarity N%". With `name_similar` the review grid could tell an exact
   normalised-name hit from a fuzzy one without parsing the reason. Meanwhile: `name_normalized`.
2. **`ProductRecord`: optional `match: MatchResult.optional()` and `alternatives: MatchCandidate[].optional()`.**
   A catalogue import record carries its match against the org's existing products and the runner-up
   codes. Meanwhile both ride on `import_record.payload` as extra keys (`packages/domain/src/products/import.ts`
   `StoredPayload`); `ProductRecord.parse` strips them for every reader that uses the shared schema.
3. **`ProductRecord.article: string | null` (optional).** 1C «Номенклатура» has an `Артикул`; the
   import recognises the column (so it is never taken for the name) but has nowhere to keep it.
4. **`ProductCatalogMeta`: optional `progress: { done, total }`, `locale`, `dropped`.** The import
   checks a batch in chunks and keeps its progress in `import_batch.meta`; stored today as extra keys.
5. **`InvoiceLine` / `ProductRecord` classification issues.** `classifyProducts` answers the §4.4 Pick
   **plus `issues: ValidationIssue[]`** (codes listed in `agent4-result.md`, labels in
   `ta.productsX.issues`). Agent 3 can copy them into its record's `issues`.

## `nomenclature_xlsx` (Agent 1's builder) — what the product batches contain

- Product imports: `import_batch.kind = 'product_catalog'`, `source = 'upload'`, records with a
  `ProductRecord` payload; `status` valid / suspicious / unresolved / corrected / skipped;
  `decision.action = 'correct'` when a reviewer chose the code. After "save", `payload.productId` is set.
- Catalogue export (`POST /api/products/export`): a batch with `source = 'products'`, status `approved`,
  one `valid` record per product (`decision.action = 'approve'`, `fingerprint` = product id).
  While `prepareExport` answers `not_implemented` the batch is deleted again and the UI says
  "available after integration".
- `barcode` in records is EAN-13 when the stored GTIN-14 has a leading 0, otherwise as stored.
- The builder should write `packageCode` (Tasnif package id, e.g. `1074787`) and `mxik` as **text**
  (17 digits, leading zeros).

## Shared files touched (one-line or additive)

- `packages/db/prisma/schema.prisma`: `products Product[]` on `Organization` and on `Client` (relation
  lists; union at merge), the Agent 4 section, migrations `20261104000100_products_packaging`,
  `20261104000200_product_alternatives` (applied to the shared dev DB).
- `apps/api/src/app.module.ts`: `ProductsModule` import (one line + one entry).
- `.claude/launch.json`: `tasnivo-api-4024`, `tasnivo-web-3024`.
- `packages/domain/src/audit-runner.ts`: `checkItem()` also returns `suggestions` and `existing`
  (additive fields of `ItemCheck`; no caller changes).
- `apps/web/src/app/(app)/catalogs/[id]/workspace-header.tsx`: one line renders
  `products/add-from-audit.tsx` next to the report link on a finished audit.
- `packages/contracts/README.md`: regenerated checklist (generated section; regenerate at merge).

## Platform notes (for Agent 5)

- A page that calls `history.replaceState` with a new query is remounted by the shell's page
  boundary (`apps/web/src/ui/shell/navigation.ts`); `/products` therefore keeps the open drawer in
  state only (`?product=` still opens one on arrival). No change requested; documenting the trap.

## At merge with Agent 1's `feat/onec-integration-core` (from its note of 2026-10-23)

- Agent 1 exports only records with status `valid` or `corrected`. A product import record left
  `suspicious` or `unresolved` is therefore not in the 1C file until a reviewer accepts a code (→
  `corrected`); "save to catalogue" does not change record statuses. Intended, but the import page
  should then say how many records the 1C file will leave out (Agent 1's `prepareExport` reports it).
- Switch the import's record fingerprint (`productNameKey|unitKey`, `products/import.ts`) to Agent 1's
  `productFingerprint(p)` so duplicate checks across batches agree, and call its `refreshCounts(batchId)`
  instead of the local `batchCounts` after writing records.
- Replace the import's own review table with Agent 1's `onec/review/review-grid.tsx` when it lands
  (the decisions API here maps 1:1: accept suggestion = correct with `{ mxik }`, skip, reopen).
