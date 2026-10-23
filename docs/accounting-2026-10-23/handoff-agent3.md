# Agent 3 (Didox) → Agents 1, 4, 5 and the coordinator: proposals and integration notes

Branch `feat/didox-invoice-automation`. Written against the base commit `36ef476`; the notes from
Agent 1 (`agent1-onec-interface.md`) and Agent 4 (`agent4-products-interface.md`) in the shared notes
folder were read at the end of the session and are answered below. Nothing here blocks the merge:
every point has a local fallback on this branch.

## To Agent 4 (products)

1. **A read of matched products.** `MatchCandidate` carries only `id`, `label`, `confidence`, `basis`,
   `reason`. To flag `mxik_conflict` (invoice code ≠ catalogue code), `package_mismatch` and
   `unit_mismatch`, the Didox check needs the matched product's `mxik`, `packageName` and `unit`.
   Proposal: export `getProducts(orgId, ids): Promise<ProductRecord[]>` from
   `packages/domain/src/products/index.ts` (or put an optional `product?: ProductRecord` on the
   candidate). Local shim: `CheckDeps.productRecords` in `packages/domain/src/didox/check.ts`
   answers `[]` today, so those three checks are skipped until it is wired (tests inject it).
2. **Classifier issues.** Your `classifyProducts` answers `issues` per line (`mxik_malformed`,
   `mxik_not_found`, `mxik_inactive_api`, `package_not_of_code`, `marking_required`, …). The Didox
   check currently maps only `mxikStatus` (invalid / inactive / restricted) to its own codes. At
   integration: append your issues to the line (they are already labelled under `productsX.issues`),
   and drop my duplicates for the same field. The web grid looks up `didoxX.issues[code]` first; it
   should fall back to `productsX.issues[code]` (one-line change in `review.tsx` `d.issues[i.code] ?? …`).
3. `matchProducts` no longer answers `unknown` once merged; my `product_unchecked` info issue then
   disappears by itself. `upsertProducts` is called only from `exportInvoice` for lines decided
   "create new" (resolved.productId null); I pass no `confirmed` set — a reviewer's "use this
   existing product" decision could be passed as `confirmed` to learn the mapping (your call).
4. The name folding I apply before calling you (`packages/domain/src/didox/fold.ts`: case, ё/е,
   Latin/Cyrillic look-alikes, punctuation, "50 кг" = "50кг", trailing count units) groups lines of one
   invoice; your matcher still receives the original name of the group's first line.

## To Agent 1 (1C)

1. **Batch-level issues.** `seller_unknown` and `seller_tin_invalid` belong to the document, not a
   line. They are stored in `import_batch.meta.didox.issues` (an extra key the contract parse drops).
   Proposal: an optional `issues: ValidationIssue[]` on `IncomingInvoiceMeta` (or on `ImportBatchRow`).
2. **Fingerprints.** Records use `${externalRef ?? documentFingerprint}#${lineNo}` today. Your note
   asks for `invoiceLineFingerprint(meta, line)`; switch at integration (one line in
   `storeInvoice`, `packages/domain/src/didox/service.ts`).
3. **Decisions.** Didox has its own `PUT /api/didox/records/{recordId}/decision` because a
   correction also resolves the product (`resolved` ProductRecord) and may re-check a new MXIK with
   the classifier. Statuses follow your export rule: approve → `valid`, correct → `corrected`,
   skip → `skipped`; an error keeps the line `unresolved`. Batch counts are kept by my
   `refreshBatch(batchId)`; it can call your `refreshCounts` after the merge.
4. **What the export receives.** `prepareExport` / `buildExport` are called with
   `format: 'receipt_xlsx'` and `recordIds` = the lines the reviewer approved or corrected (an
   undecided `valid` line is held back as `not_approved`, your reason key); `nomenclature_xlsx` with
   the subset whose `payload.resolved.productId` is null (new products). The meta parses as
   `IncomingInvoiceMeta`. While your stub answers `not_implemented`, the UI says so (no file).
5. **Review grid.** This branch has a local grid in `apps/web/src/app/(app)/didox/[batchId]/review.tsx`
   (marked for replacement). Replace its `<Table>` with your `review-grid.tsx` and keep the picker
   dialog, the bulk buttons and the prepare panel around it.
6. `matchCounterparties(orgId, refs)` is called without the new `{ clientId }` option; pass the
   batch's client at integration.

## To the coordinator / Agent 5 (platform)

1. **PDF print form not embeddable.** The web CSP allows `frame-src https://oauth.telegram.org` only
   and the API sends `X-Frame-Options: DENY` / `frame-ancestors 'none'`, so the invoice page links
   the PDF ("open in a new tab") instead of embedding it. If an inline preview is wanted:
   `frame-src 'self'` on the web and `X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'` on
   `GET /api/didox/invoices/{batchId}/pdf` only.
2. Shared-file one-liners on this branch: `apps/api/src/app.module.ts` (DidoxModule),
   `.claude/launch.json` (`tasnivo-api-4023`, `tasnivo-web-3023`, `didox-fake-4923`; the API config
   points `DIDOX_API_URL` at the local fake server), `packages/db/prisma/schema.prisma`
   (`Organization.didoxConnection`, `Organization.didoxDocuments`), `packages/contracts/README.md`
   (checklist regenerated).
3. **Pre-existing test failure on the base commit:** `apps/web/src/app/robots.test.ts` "B16: every
   section of the signed-in app is disallowed" fails with `/bank`: the test scans `app/(app)/` and
   the base commit added `/bank`, `/didox`, `/products`, `/onec` without adding them to
   `PRIVATE_PATHS` in `apps/web/src/app/robots.ts`. Not touched here (not this workstream's file);
   the fix is four entries there.
4. New environment variables (none required): `DIDOX_API_URL` (default `https://api.didox.uz`,
   test `https://testapi2.didox.uz`), `DIDOX_PASSWORD_LOGIN=1` (shows the unverified ИНН + password
   login), `DIDOX_PARTNER_TOKEN` (or the name saved in the connection) for the partner auth model.
