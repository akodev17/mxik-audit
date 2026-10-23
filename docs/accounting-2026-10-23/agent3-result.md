# Agent 3 result: Didox incoming invoice → 1C (23 Oct 2026)

Branch `feat/didox-invoice-automation` (worktree `didox-invoice-automation-041da9`), cut from the base
commit `36ef476`. Not pushed. Commits: see `git log 36ef476..feat/didox-invoice-automation`
(listed at the end of this note).

**Honesty line.** No Didox credentials exist on this machine. Everything that talks to Didox is
**implemented, not verified against Didox**, except `GET /v1/measures/all`, which was called live
(public, no auth) and answered. The Didox document shape is **third-party-documented, not verified
against Didox** (research note §1, sources A and B); the code, the API answers (`verified: false`)
and every page say so. The 1C file is not produced on this branch: Agent 1's `buildExport` is the
base-commit stub (`not_implemented`); Agent 4's matcher and classifier are stubs too. Tests assert on
the records this workstream writes.

## What was built

| Deliverable | Where | State |
|---|---|---|
| Document model and parser | `packages/domain/src/didox/document.ts`, `decimal.ts` | Done. Lower-case and upper-case (`FacturaDoc`, `ProductList.Products`) shapes, `{data}` / `{document}` / JSON-string wrappers; kind detection (invoice / act / contract / reconciliation / free-form), non-invoices refused with their kind; decimals read once into BigInt millionths (no float arithmetic; `decimal.js` is not in the lockfile), noisy floats folded (`892.8600000000000136` → `892.86`), `,` and spaces handled; line arithmetic checked (`totals_mismatch`, the document's own numbers kept); fingerprint = SHA-256 of the canonical (sorted, lower-cased) document. |
| Fixtures | `packages/domain/src/didox/fixtures/` | Standard ЭСФ (3 lines), 120 lines in the upper-case form with two spellings of one product, noisy floats + missing / broken codes in an API-style wrapper, VAT 0 with a 14-digit ПИНФЛ seller, and an act. Synthetic values. |
| Upload sources | `sources.ts` | Zip of zips (walked for `*.json` documents, nested one level, each archive through `zip-guard`; the PDF beside a JSON is kept), single JSON (also an array), ЭСФ XLSX with guessed columns (ru / uz Latin / uz Cyrillic headers) + typed header, confirmed by the user; layout `verified: false`. |
| API client | `client.ts` | Both auth models behind one interface (`token`: api-key + user-key; `partner`: Bearer + user-key), timeout, retries on 5xx / 429 (Retry-After) / network, per-org rate limit, log lines with method + path + status only (no token, no query). Endpoints: measures/all, documents list (paging), document, PDF print form, ИНН+password login. |
| Fake Didox | `fake-server.ts` | From the fixtures; both auth models, list shapes, paging, failure injection, delays, password login. Runs standalone (`didox-fake-4923` in launch.json). |
| Connection + sync | `connection.ts`, Prisma `DidoxConnection`, `DidoxDocument` (migration `20261103000100_didox`) | "Paste your token" (sealed AES-256-GCM, never answered back), test button, ИНН+password behind `DIDOX_PASSWORD_LOGIN=1`, E-IMZO documented as not implemented; "Fetch new incoming invoices" pages the list (owner 0, doctype 002), skips ids already imported or cached, caches JSON + PDF, records `lastSyncAt` / `lastError`. |
| Matching and checks | `check.ts`, `fold.ts` | Lines folded into candidate groups (case, ё/е, look-alikes, punctuation, "50 кг"="50кг", trailing count units), `matchProducts` once per group, `classifyProducts` once per (group, code); issues below; seller through `matchCounterparties`. |
| Workflow on the DB | `service.ts` | One `import_batch` (kind `didox_invoice`, `externalRef` = Didox id, `fingerprint` = document hash) per invoice, one `import_record` per line (`InvoiceLine` payload), duplicate invoice refused (same Didox id, same content, or same seller + number + date) with the earlier batch; decisions (approve / correct product or MXIK / skip / reopen), bulk approve (matched / clean), dry-run report, export through Agent 1 (`upsertProducts` only for lines decided "create new", at export). |
| HTTP | `packages/contracts/src/modules/didox.ts` (16 operations), `apps/api/src/didox/` | List, upload, sheet commit, detail, PDF, delete, decision, MXIK suggestion, bulk approve, prepare, export file, sync, connection get / save / delete / test / password login. |
| Web | `apps/web/src/app/(app)/didox/` | `/didox` (upload / sync, list), `/didox/[batchId]` (header, issues, print form link, review grid with filter, per-line picker: candidate / create new / other MXIK with the classifier's suggestion and reason, bulk approve, prepare report, export buttons), `/didox/settings` (admin only, demo cannot save). uz and ru; phone width checked. |

### Issue codes (labels in `i18n-parts/didox.ts`, uz and ru; listed in `DIDOX_ISSUES`)

`mxik_missing`, `mxik_invalid`, `mxik_inactive`, `mxik_restricted`, `mxik_conflict`, `product_new`,
`product_ambiguous`, `product_unchecked` (info: matcher not available), `package_mismatch`,
`unit_mismatch`, `totals_mismatch`, `quantity_invalid`, `duplicate_line_name` (info),
`seller_unknown`, `seller_tin_invalid`, `duplicate_invoice` (refusal of the whole document).
Severity: an error leaves the line `unresolved`, a warning `suspicious`.

## What was verified and how

- `npm run typecheck`, `npm run lint`, `npm test`: see "Checks" below.
- Domain tests (`packages/domain/src/didox/*.test.ts`): parser on every fixture (18), sources incl.
  zip of zips and ЭСФ XLSX (6), client against the fake server: both header models, paging with
  both list shapes, maxPages, retries on 500 and 429, give-up, timeout, network error, 404, PDF
  decode, password login, rate limiter, and that no token reaches a log line or error message (12);
  checks with stubbed interfaces: fold groups, conflicts, package / unit mismatch, new / ambiguous,
  classifier verdicts (6); service and sync on the dev database: zip upload → batches and records,
  duplicates (same id, re-issued file with another id), refusals (viewer, demo, foreign client,
  scoped accountant), list / detail / PDF, every decision path, dry-run report, export refusal,
  bulk approve, XLSX preview → commit, connection (sealed token, admin only), sync of 4 invoices with
  JSON + PDF cached, second sync skips all 4 without refetching, rejected token recorded (13).
- API e2e (`apps/api/test/e2e/didox.test.ts`): upload → detail → decisions → prepare → export 409
  → bulk approve → delete, roles and CSRF, contract shapes (`matches(...)`), token never answered.
- Web parity (`tests/web-parity/didox.test.ts`, `apps/web/src/app/(app)/didox/model.test.ts`):
  status rule = domain `statusFor`, sheet fields contract = domain, every emitted code labelled in
  uz and ru, money text from decimal strings without floats.
- **Live Didox:** `DIDOX_LIVE=1 … client.test.ts` → `GET https://api.didox.uz/v1/measures/all`
  through `DidoxClient` passed on 23 Oct 2026 (also probed with curl). Nothing else was called.
- **In the browser** (dev API 4023 + web 3023 + fake Didox 4923, seed account of the shared dev DB):
  screenshots in `docs/accounting-2026-10-23/agent3/`:
  `00-upload-result-ru.jpg` (one invoice added, a duplicate refused with a link to the earlier
  batch, an act refused), `01-list-after-sync.jpg` (four invoices fetched from the fake Didox),
  `02-invoice-review-problems.jpg`, `03-prepare-report-ru.jpg` (4 imported / 1 skipped / 0 rejected,
  the 1C builder pending), `04-settings-connection-test.jpg`, `05-duplicate-name-group-ru.jpg`
  ("Цемент М400 50кг" and "ЦЕМЕНТ  М-400, 50 кг" shown as one product, lines 1 and 4),
  `06-mobile-detail-ru.jpg` (375 px, no horizontal scroll).
- Benchmark: `docs/accounting-2026-10-23/benchmarks.md` § Didox — 100-line invoice 53 ms
  (parse 0.9, match-stub 0.2, validate 1.6, write 50), 1 000 lines in 10 invoices 543 ms, the same
  as one zip through the upload path 609 ms. The DB write dominates; the real matcher will add the
  most once merged.

## Implemented but not verified against Didox

- Every API endpoint but measures/all: the list query (`owner`, `doctype=002`, `dateFrom`, `page`,
  `limit`), the list entry shape (id as `_id` / `doc_id` / `id`), the document wrapper, the PDF
  answer `{file:{data}}`, the password login, both auth header models.
- The document JSON shape (the incoming field names are second-hand from source A; invoice number
  and date keys `facturano` / `facturadate` and seller `account` / `bankid` come from the Soliq
  e-invoice JSON, not from the research note), status numbering (only source A's `3` counts as signed).
- The zip export's internal naming (any `*.json` that parses as a document is taken).
- The ЭСФ Excel template's column layout (guessed, user-confirmed).

## Not done / limits

- 1C files are not generated on this branch (Agent 1 stub); the export button answers "1C builder
  not merged" (409). The dry-run report is computed from the records.
- MXIK conflict / package / unit comparison needs a product read from Agent 4 (proposal in
  `handoff-agent3.md`); skipped until wired.
- The PDF print form opens in a new tab; embedding is blocked by the app's CSP (proposal in the
  handoff note).
- E-IMZO key login (needs the user's key in the browser) is not implemented.
- One connection per org (a firm syncing several client companies would need one per client).
- The review grid is local; Agent 1's shared grid replaces it at integration.

## What the owner must provide

1. Didox partner access (or confirmation that a client's own token may be used by a SaaS acting for
   them), a test company on `testapi2.didox.uz`, and a token for it.
2. One real Didox zip export (a few incoming invoices) and one ЭСФ Excel file filled in, to replace
   the guesses about naming and columns.

### Request text to send to Didox (RU)

> Здравствуйте! Мы — сервис Tasnivo (tasnivo.uz), помогаем бухгалтерам загружать входящие
> счета-фактуры в 1С:Бухгалтерию для Узбекистана и проверять ИКПУ и коды упаковки. Просим:
> 1) партнёрский доступ к API Didox и документацию (методы списка и получения документов, печатной
> формы, авторизации); 2) тестовый контур (testapi2.didox.uz или другой) и тестовую компанию с
> несколькими входящими ЭСФ; 3) условия, на которых сервис может работать от имени компании-клиента
> (согласие клиента, токен компании или партнёрский токен). Мы читаем только входящие документы
> (owner=0) и не подписываем и не отправляем документы. Ответьте, пожалуйста, также на вопросы ниже.

### Matn (UZ)

> Assalomu alaykum! Biz Tasnivo (tasnivo.uz) xizmatimiz: buxgalterlarga kiruvchi hisob-fakturalarni
> «1C:Buxgalteriya (Oʻzbekiston)» ga yuklash va MXIK hamda qadoq kodlarini tekshirishda yordam
> beramiz. Soʻraymiz: 1) Didox API ga hamkor sifatida kirish va hujjatlar (hujjatlar roʻyxati, hujjatni
> olish, bosma shakl, avtorizatsiya); 2) sinov muhiti (testapi2.didox.uz yoki boshqa) va bir nechta
> kiruvchi ESF bilan sinov kompaniyasi; 3) xizmat mijoz-kompaniya nomidan qanday shartlarda ishlashi
> mumkinligi (mijoz roziligi, kompaniya tokeni yoki hamkor tokeni). Biz faqat kiruvchi hujjatlarni
> (owner=0) oʻqiymiz, hujjatlarni imzolamaymiz va yubormaymiz. Quyidagi savollarga ham javob bering.

### The questions (research note §1, "Unknown")

1. How to obtain the partner token / partner API access and a test company (`testapi2.didox.uz`
   vs `stage.goodsign.biz` vs `api-partners.didox.uz`), and whether a third-party SaaS may act for a
   client company (consent terms).
2. Standard ЭСФ document type `001` or `002`; the status numbering (0…60 per the 1C library vs
   DRAFT/SENT/SIGNED/REJECTED = 0…3 per the npm SDK); which header model is current: token in
   `api-key` + `user-key`, or `Authorization: Bearer <partner>` + `user-key`.
3. The exact JSON of a list entry (id field, date fields, whether it carries the document JSON),
   whether `dateFrom` filters by update or document date, rate limits, and whether webhooks exist.
4. Whether company-token login by ИНН + password is still offered (`/v1/auth/{taxId}/password/{locale}`
   vs `waltz/goodsign/0.0.1/user/{inn}/token`), and the token lifetime.
5. The internal naming of the user zip export, and whether incoming invoice lines carry a package
   code and the Didox `measureId` alongside `packagename`.

## Checks (final runs on `b5a71a1` + docs)

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0 (one warning, pre-existing, `scripts/lib/xlsx.ts:131`).
- `npm test`: **1 794 tests, 1 791 pass, 1 fail, 2 skipped.** The failure is pre-existing on the
  base commit and not in this workstream's files: `apps/web/src/app/robots.test.ts` "B16: every
  section of the signed-in app is disallowed" fails on `/bank` (the base commit added the
  accounting sections without listing them in `robots.ts` `PRIVATE_PATHS`; see the handoff note).
  An earlier full run also failed `billing` (an org cleanup hook) and `notifications` (one list
  test); both passed when re-run alone (12/12) and in the final run. They come from other sessions
  using the shared dev database at the same time.
- The Didox tests alone (domain, API e2e, web, parity, contracts): 106 / 106.

## Commits

```
b5a71a1 benchmark, handoff and result notes; lint fixes; reason key not_approved as in the 1C layer
4e7d72e review grid fits 1366px in both languages, info tone for the pending 1C builder, empty-filter row, upload source by zip signature; screenshots
6d08bfb web /didox list + intake, invoice review, settings; web parity tests; launch configs
a709343 contracts module (16 operations), Nest controller, API e2e test
71c7e82 service and sync tests on the database with the fake Didox; invalid-code suggestion fix
1ce82b1 service, connection + sync, i18n, domain tests
5616427 document parser, decimal and name-fold helpers, sources, API client, fake server, checks, Prisma section + migration
```

Shared dev database: migration `20261103000100_didox` applied (`migrate deploy`). The browser run's
batches, cached documents and fake-server connection in the seed org were deleted afterwards.
