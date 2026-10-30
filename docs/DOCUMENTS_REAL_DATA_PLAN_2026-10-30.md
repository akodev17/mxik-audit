# Documents modules: make them work for real (plan, 30 Oct 2026)

Owner's ask (30 Oct): the four "documents" modules on the landing page — bank statements, Didox
invoices, products catalogue, 1C import & history — each still say "sinov rejimida" (trial mode,
unverified against real data). Research the real formats deeply, open Opus tasks, fix the gaps, and
run **50+ tests built from real-world material found on the internet**.

Coordinator: this session (`main` at 1afccd1, fresh build, 59 migrations). Four Opus sessions, one per
module, each in its own worktree and branch. **Sessions never push or merge**: they report, the
coordinator merges after the owner's approval.

## 1. What the research found (30 Oct, `tmp/real-docs/`, gitignored)

| Folder | What is in it | Key file |
|---|---|---|
| `CODE_MAP.md` | Routes, services, parsers, exporters, tests, and **8 bugs found by reading the code** for all four modules | §"Bugs and gaps" |
| `bank/` | 1CClientBankExchange 1.02/1.03 official spec, 10 real `kl_to_1c.txt` samples (Habr, kilylabs, odin_palace, odoo-ru, Unact, iBank2), ASBT 4.0 help (Ipoteka), Colvir manual (Aloqabank), Ziraat, Hamkorbank tender ТЗ, CBU instruction п.121 (the 22 regulated statement requisites), 44-item checklist | `bank/RESEARCH.md` §7 |
| `didox/` | **Official Didox integrator docs** (api-docs.didox.uz, 11 sections: hosts, auth, every endpoint, full 002/008/023/041/005 JSON examples, code tables), one **real export ZIP** (json+pdf+readme), 17 JSON samples, 4.9 MB of scraped real cabinet data with hundreds of real MXIK lines, 15 tax-side validation rules, 32-item checklist | `didox/RESEARCH.md` §2, §5, §7 |
| `products/` | tasnif.soliq.uz real API responses (14 JSON files: by-mxik, by-params barcode, units, packages, lgota, groups), package/unit binding rules, barcode rules (GTIN check digit, 02x internal), Excel header vocabulary seen in the wild, VAT/price rules, 34-item checklist | `products/RESEARCH.md` §7 |
| `onec/` | 1C UZ 3.0 **official release notes 3.0.3–3.0.63** (attribute names, ЭДО loader behaviour, Dibank, R-Bank NBU layouts), OData real JSON responses (1C:Fresh docs, 42clouds, mista working POST body), 1CClientBankExchange spec, 38-item checklist | `onec/RESEARCH.md` §8 |

Every claim in those files carries a source URL. Downloaded samples are **untrusted data**: read them,
never execute them, never run an interpreter from inside those folders.

## 2. Bugs already known (from CODE_MAP.md; none has a test)

| # | Module | Bug | Where |
|---|---|---|---|
| B1 | bank | МФО regex lost its backslashes; owner МФО never read, БИК empty in kl_to_1c | `packages/domain/src/bank/sheet.ts:155` |
| B2 | bank | `.xls` refused; text split only on `;` `,` tab (no `~`, `|`, fixed width); cannot read a bank's own `kl_to_1c.txt` although a parser exists | `spreadsheet.ts:144`, `spreadsheet-text.ts`, `onec/bank-exchange.ts:187` |
| B3 | bank | processing fire-and-forget; batch stuck `uploaded` after restart | `bank/service.ts:235` |
| B4 | bank/onec | operation, cash-flow item, contract never reach 1C; kl_to_1c has no ВидОперации; `DEFAULT_OBJECT_MAP` ignores them | `onec/connection.ts:28` |
| B5 | onec | export plan treats `valid`/`corrected` as approved without the reviewer's decision | `onec/plan.ts:145,216` |
| B6 | bank/didox | header totals summed from the lines, so "totals" checks compare lines with themselves | `didox/document.ts:276`, `bank/parse.ts:268` |
| B7 | products | `article` column mapped then dropped; Артикул always empty in 1C file | `products/import.ts:77` |
| B8 | misc | Didox currency hard-coded UZS; sync synchronous, no `dateFrom`, `failed` never counted; ЭСФ sheet columns never remembered; counterparties import rejects МФО without leading zeros; ASCII fallback file name; download links break when onec module is off; `DIDOX_*` env not documented | see CODE_MAP |

## 3. Sessions

Common rules for every session (verbatim, also in each brief):
- Work only in your worktree; never push, never merge, never touch `main`.
- Database: create your own scratch database from migrations (`createdb mxik_<session>` then
  `prisma migrate deploy`), never `createdb -T` on the busy dev DB, never migrate the shared `mxik`.
  Use `127.0.0.1`, not `localhost`.
- Never weaken or delete an existing test. New tests go next to the code they test (`*.test.ts`,
  node:test) or in `apps/api/test/e2e`. Fixtures built from real samples go in the module's
  `fixtures/` folder with a `SOURCES.md` naming the origin of each one (URL and what was changed).
  Copy only what a test needs; strip real names/ИНН of private persons; company data from public docs
  may stay.
- Each real-world test case must cite the checklist item it covers (`// bank §7.26`, `// didox §7.21`).
- Keep the "sinov rejimida" / "unverified" notes in the UI and landing; the owner removes them
  after a real 1C / Didox / bank run. You may sharpen their wording to what is still unverified.
- Report: append `## Sx results` to this file with: bugs fixed (file:line), tests added (count,
  file list, which checklist items), what is still unverified and exactly what the owner must do to
  verify it (one screen or one request each). Commit on your branch; tell the coordinator the branch.
- Secrets: never print or commit `.env`; `DIDOX_*`, `GEMINI_API_KEY` stay out of logs.

### S1 — Bank statements (`feat/docs-s1-bank`)

Goal: a statement from any Uzbek internet bank (ASBT, iABS/КИБ, Colvir, bank-own apps) reads
correctly, the reconcile uses the bank's printed totals, and `kl_to_1c.txt` is both read and written
to the letter of the 1C standard.

Tasks:
1. Fix B1, B2, B3, B6 (bank side). Add `~` / `|` / fixed-width text statements (ASBT configurable
   export, bank §2.3/§7.39), zip-wrapped downloads, UTF-8 BOM, cp866 detection by content.
2. Read a bank's own `kl_to_1c.txt` as an input statement (bank §7.1–25): reuse `onec/bank-exchange.ts`
   parser, harden it on the 10 real samples (duplicate keys, missing КонецДокумента, repeated
   СекцияРасчСчет, composite `ИНН 7765434566\775001001 ОАО …` names, empty budget fields).
3. Excel statements: implement the regulated п.121 layout as the base profile (bank §2.4) and the
   documented vendor shapes (ASBT "Выписка лицевых счетов", Colvir, iABS); two-row merged headers,
   repeated page headers, totals/`Обороты за период` rows, continuation rows, posting date vs document
   date, numeric document numbers and МФО losing zeros, purpose code column or 5-digit prefix.
4. Reconcile with the **printed** opening/closing balances and totals (not line sums); report
   mismatch, do not block.
5. Output `kl_to_1c.txt`: bank §7.44 — cp1251 without BOM, CRLF, one СекцияРасчСчет per account, unique
   (РасчСчет, type, Дата, Номер), ДатаСписано/ДатаПоступило by direction; round-trip test: write → parse
   with our own reader → identical documents.
6. Dedup fingerprint per bank §7.42 (account, date, number, amount, counterparty account, purpose hash)
   so a re-import of an overlapping period yields zero new lines.

Tests to add: **≥ 15**. At least: the 10 real `kl_to_1c` samples parsed with asserted document counts,
balances and encodings; 4 Excel/CSV/TXT fixtures you build strictly from documented layouts (ASBT
delimited + fixed width, п.121 Excel with two-row header and totals, iBank2-style CSV one-file-all-accounts),
1 round-trip. Bench: `scripts/bench-bank.ts` on the new fixtures.

### S2 — Didox invoices (`feat/docs-s2-didox`)

Goal: the parser accepts every real Didox shape, the checks apply the tax-side rules with evidence,
and the API client follows the official docs.

Tasks:
1. Parser per didox §7 P1–P16: PascalCase and lowercase keys, four envelopes (ZIP file JSON, GET
   `data.json`, create `pending_document`, 2020 `{"Factura":…}`), numbers-as-strings with float noise
   (compute in tiyin), `packagecode` string or number, `measureid` null/""/string/int, null buyer
   (one-sided), `facturatype` + `oldfacturadoc`, pharm 008 fields, acts 005, hybrid 023 shape detection,
   zip-of-zips and single-document zip (`<docid>.json` + pdf + readme + optional .p7s).
2. Header totals from the document (`total_delivery_sum` etc.), not from the lines (B6). Currency from
   the document (B8).
3. Checks per didox §5/§7 V17–V32: 17-digit code with leading zeros, active on `facturadate`;
   package bound to that ИКПУ (tasnif mirror); decimal places (count ≤ 6, money ≤ 2); arithmetic in
   tiyin with the documented tolerances; VAT rate set by date (12 / 15 from 2026 / 6 simplified);
   `withoutvat` semantics; flags agree with lines; lgota rules; restricted lists; parties (ИНН 9/14,
   VAT reg code 12, МФО 5, account 20); origin vs service codes; marking; corrected chains; document
   level. Every rule cites its evidence line in RESEARCH.md.
4. API client per didox §1: hosts (`api-partners.didox.uz` prod, `testapi3` sandbox), headers
   (`Partner-Authorization` + `user-key`; company mode `api-key`+`user-key`), `GET /v2/documents` with
   required `page`/`limit` and `next_page_url`, status semantics per doctype, `GET /v1/documents/{id}`
   envelope, `/archive` ZIP, error bodies (401/422/423/429) surfaced verbatim, token TTL 360 min.
   Sync asynchronous with `dateFromUpdated`, `failed` counted (B8). Document `DIDOX_*` in
   `.env.example` and DEPLOY.md.
5. ЭСФ Excel upload: the official 60-column template (reference doc in
   `docs/accounting-2026-10-23/reference/`) as a fixed preset; remember the mapping per org like the
   bank module does.

Tests to add: **≥ 15**. At least: the real export ZIP sample end-to-end (upload → lines → checks);
every official example 02–10 parsed; list/GET envelopes 05, 11, 12; 1C_integration fixtures (float
noise, withoutvat, type 8 + oldfacturadoc, PINFL seller); the didox-auditor real cabinet data as a
bulk parse (hundreds of real MXIK lines) with the package/unit check against the local tasnif mirror;
arithmetic tolerance cases; one fake-server test per new client behaviour.

### S3 — Products catalogue (`feat/docs-s3-products`)

Goal: the catalogue import reads the Excel files Uzbek firms actually keep, the checks apply the tasnif
rules, and the 1C nomenclature file maps without manual work.

Tasks:
1. Fix B7 (store Артикул / internal code; `Product` gets an `article` column via a migration on your
   scratch DB) and the ASCII file-name fallback (B8).
2. Header vocabulary per products §4 (RU, UZ Latin, UZ Cyrillic, 1C, Didox "Мои товары", my.soliq,
   Smartup, Billz, Uzum, Yandex, `Код упаковки ТАСНИФ`, `SPIC`, `CatalogCode`); header row not on row 1.
3. Checks per products §7: 17-digit ИКПУ with Excel float/leading-zero damage **detected and reported**
   (not silently padded); unknown vs transport error; base code (first 11 digits) vs brand code
   mismatch; GTIN check digit (EAN-8/12/13/14), internal 02x codes never sent to tasnif, several
   barcodes per cell; package must belong to that ИКПУ, derive candidates from the unit when empty;
   unit normalisation table (§1.4 ids); fixed-unit codes; duplicates (name, barcode, ИКПУ+package+name);
   price with/without VAT (12/112), VAT column values, tiyin rounding; service rows (origin 3, unit 25);
   30-day grace for changed codes; empty cells must not clear existing values on update.
4. 1C `nomenclature_xlsx`: headers equal the 1C captions (onec §8.7: Наименование, Полное наименование,
   Артикул, Штрихкод, Единица измерения, Ставка НДС, Цена, plus Код из классификатора, Код упаковки);
   leading zeros survive (text cells); services never in «Товары».
5. Tasnif client: `units/all` with `pageSize=100` and `recordTotal` check; 403 on `by-mxik` and
   `success:false` on gtin are both "not found"; 401 on `/integration-nomenclature` is "needs token",
   no retry.

Tests to add: **≥ 12**. At least: 6 Excel fixtures built from the documented header variants; the 14
real tasnif JSON responses as fake-server fixtures driving the package/unit/barcode checks; the
Excel-damage cases; the 1C file golden update with a documented diff.

### S4 — 1C import, history and OData (`feat/docs-s4-onec`)

Goal: the 1C side is correct by the official standard, the OData client behaves like a real 1C
expects, and nothing leaves Tasnivo that a reviewer did not approve.

Tasks:
1. Fix B5 (export only approved records; an export without record ids takes approved ones only) and
   B4 (ВидОперации / cash-flow item / contract into the OData document map; for kl_to_1c, document
   in `onec-formats.md` that the standard has no field and where the operation goes).
2. Counterparties: МФО zero-padding on import (B8); reader for a 1C «Вывести список» XLSX with
   arbitrary columns and header not on row 1 (onec §8.17); validators ИНН 9 / ПИНФЛ 14 / VAT code 12 /
   account 20 (27 budget) / МФО 5; branches (ИНН + код филиала); physical persons; non-residents.
3. OData per onec §8.25–34: entity names discovered from `$metadata` and cached by its hash (never
   hard-coded `Catalog_ЕдиницыИзмерения` vs `Catalog_КлассификаторЕдиницИзмерения`); required sets
   missing from the composition → actionable error (403 may mean an attribute, not the object); no
   redirects on write; one POST creates the document with its tabular part, no `Ref_Key` anywhere;
   documents created unposted, `Post()` separately with 500 surfaced as a business refusal; PATCH resends
   the whole tabular part with `If-Match: DataVersion`, 412 → refetch → retry; delete = `DeletionMark=true`
   via PATCH, never HTTP DELETE; paging `$top/$skip/$inlinecount`, `IsFolder eq false`, `allowedOnly`;
   composite refs with `cast(guid'…')`; dates `datetime'…'` no timezone.
4. Receipt from an ЭСФ in OData (onec §8.35–38): corrected invoice updates instead of duplicating;
   risk flag passed through; count 6 dp, sums 2 dp, totals from the document; marks per line.
5. Download links of bank and product exports must not depend on the onec module flag (B8).
6. `kl_to_1c.txt` conformance: cp1251 without BOM, CRLF, ВерсияФормата, both encodings
   (DOS/Windows) produced and re-parsed; МФО in `…БИК`; document identity unique per file.

Tests to add: **≥ 10**. At least: a fake OData server built from the **real** saved responses
(`onec/samples/odata/*`: list with `odata.metadata`, `$filter/$select`, `$expand`, POST 201 body,
error envelope codes 0–20) exercising discovery, create-with-rows, Post(), 412 retry, DeletionMark,
paging; counterparty reader fixtures; approval gate e2e; kl_to_1c conformance.

## 4. Totals and acceptance

| Session | Tests ≥ | Real sources used |
|---|---|---|
| S1 bank | 15 | 10 real kl_to_1c files, ASBT/Colvir/iBank2 documented layouts, CBU п.121 |
| S2 didox | 15 | official Didox docs examples, 1 real export ZIP, scraped real cabinet data, 1C_integration fixtures |
| S3 products | 12 | 14 real tasnif responses, documented Excel header variants |
| S4 onec | 10 | real OData responses, official 1C spec, UZ 3.0 release notes |
| **Total** | **≥ 52** | |

Done means: typecheck clean, the module's existing tests still pass, the new tests pass on the
session's scratch DB, the results section is written, and the branch is reported to the coordinator.
The coordinator merges S1–S4 into `main` in order (S4 last, it touches shared `onec/` files), runs the
full suite and the three builds, and reports to the owner.

What stays for the owner after this round (cannot be done from the internet): one real bank Excel
from each of their clients' banks, one Didox sandbox token (testapi3, E-IMZO test key from
my3.soliq.uz), and one real «1С:Бухгалтерия для Узбекистана» base to load `kl_to_1c.txt`,
`nomenclature_xlsx` and an OData receipt once. Each session's results section lists the exact
one-step check for its module.

## S1 results — bank statements (branch `claude/docs-s1-bank-7e7406`, 30 Oct 2026)

Three commits on the branch, not pushed. Typecheck: every workspace clean (`contracts`, `domain`, `i18n`,
`core`, `db`, `api-client`, `web`, `worker`); `apps/api` reports 4 `cookie` type errors because the main
checkout's `apps/api/node_modules` (which worktrees link to) was emptied at 14:04 by an npm run outside
this session — it typechecked clean before that, nothing in `apps/api` was changed. Scratch DB `mxik_s1`
(59 migrations + a 2 000-row slice of `mxik_code`, so the DB suites run instead of skipping).

### Bugs fixed

| # | Fix | Where |
|---|---|---|
| B1 | The title МФО regex has its backslashes back and also reads "Код банка" / "Bank kodi": the owner's МФО reaches meta and the 1C file's `…БИК` | `packages/domain/src/bank/sheet.ts:169` |
| B2 | Read by content: legacy **.xls** (own BIFF8 + OLE reader, shared strings across CONTINUE, RK/MULRK/formula results; encrypted and Excel-95 files refused with their own message) | `bank/xls.ts:41,228` |
| B2 | HTML tables and Excel-2003 XML saved as .xls | `bank/markup.ts:9` |
| B2 | Text: UTF-8 (BOM or not), windows-1251 or **DOS cp866 by content**; `;` tab `,` **`|` `~`** delimiters; **fixed width** (data gaps + header words, touching fields split) | `spreadsheet-text.ts:41,62`, `bank/text.ts:57,90` |
| B2 | **Zip-wrapped** downloads (one statement inside; two or none refused); **PDF refused** with a clear message | `bank/read.ts:81,105-107` |
| B2 | A bank's own **kl_to_1c.txt** read as a statement through the hardened reader: encoding by content (UTF-8 wins over `Кодировка=Windows`), first value kept on a duplicate key + warning, missing `КонецДокумента`/`КонецРасчСчет`/`КонецФайла` recovered + warning, repeated `РасчСчет=`/`Документ=` header lines as lists, unknown version warned; then documents → statement table with direction by the own accounts (dates as fallback), composite `ИНН …\КПП Name` names, `НазначениеПлатежа1..6`, repeated/overlapping `СекцияРасчСчет` merged per account | `onec/bank-exchange.ts:239,275`, `bank/documents.ts:54,123,164` |
| B2 | ASBT's payer/payee **document export** turned into debit/credit by the own account | `bank/documents.ts:247` |
| B3 | Lines are **stored before processing** (the upload answers after that); processing runs in chunks whose records (one bulk `UPDATE … FROM unnest`) and progress commit together; a statement `uploaded` with no progress for 90 s is **resumed by the next read** (list or detail), from its progress | `bank/store.ts:242,272,346`, `bank/service.ts:181,190,251` |
| B6 | `meta.totalDebit/totalCredit` are the bank's **printed** totals (last "Итого/Обороты" row, one row per side as Colvir prints, page/day subtotals ignored; kl_to_1c `ВсегоСписано/ВсегоПоступило`), `null` when none; the lines' sums are `extra.lineTotals`; the reconcile and the 1C plan compare the two and only warn | `bank/parse.ts:333,361`, `bank/vocabulary.ts:133` |
| new | Real-data findings: a transfer between two own accounts becomes a debit **and** a credit (Unact sample); "Оплата по договору" no longer yields contract "у" (odin_palace samples) | `bank/documents.ts:54`, `bank/parse.ts:79` |
| new | Multi-account statements: one summary per own account (`extra.accounts`), a dry-run check `accounts_reconcile` | `bank/parse.ts` (accountSummaries), `bank/reconcile.ts:95`, `bank/service.ts:682` |
| §7.44 | kl_to_1c output: one `СекцияРасчСчет` + header `РасчСчет=` per own account, `(account, date, Номер)` unique per file (`1`, `1/2`), purpose code prefixed in `НазначениеПлатежа`; cp1251 without BOM, CRLF (unchanged single-account output, goldens identical) | `onec/bank-exchange.ts:111,151`, `onec/files.ts:32,66` |
| §7.42 | Duplicate key: own account, date, direction, amount, document number (leading zeros ignored) or, without a number, counterparty account + normalised purpose; plus a `sameLine` check (written counterparty accounts must agree, else purposes) so reused numbers do not merge different payments while a re-export without the counterparty account still matches | `bank/duplicates.ts:30,42`, `bank/store.ts:157` |

New column roles `ownAccount` / `valueDate` / `purposeCode` (contract, vocabulary, mapping UI, uz+ru labels);
`BankTransaction.purposeCode` optional. New layouts (all `verified: false`): `cbu_p121` (base profile),
`colvir_ib`, `ibank2_csv`, `onec_client_bank_exchange`, `payer_payee_documents` (`bank/formats/builtin.ts:102-183`).

### Tests added: 35 (all pass), plus 3 existing assertions updated

- `packages/domain/src/bank/exchange-input.test.ts` — **19**: the 10 real kl_to_1c samples with asserted
  encoding, document count, account, printed balances and turnovers vs the lines (§7.1, 7.2, 7.15, 7.25);
  Unact two accounts (§7.7, 7.13, 7.18, 7.22, 7.40); Habr duplicate key / spaces / composite names
  (§7.5, 7.8, 7.12, 7.16, 7.17); composite form fallback (§7.16); odoo-ru 1.01 (§7.6, 7.11, 7.19–21, 7.34);
  duplicate interval (§7.14); truncated files (§7.9); comma `Сумма`, Uzbek МФО in `…БИК`, 5-digit
  `КодНазПлатежа`, unknown version (§7.11, 7.18, 7.22, 7.25); `НазначениеПлатежа1..6` (§7.23); **write → read
  round trip** and the output rules (§7.44).
- `packages/domain/src/bank/real-layouts.test.ts` — **13**: п.121 two-row header, title and B1 МФО, page break,
  subtotals, totals, posting vs document date, numeric doc number and МФО, purpose code column or prefix
  (§7.26–28, 7.31–36, 7.38, B6); Colvir .xls (B2, §7.27–30, 7.32–33); ASBT zip `|` and fixed width
  (§7.39, 7.13, 7.24, 7.42); iBank2 one file of two accounts (§7.40, 7.30, 7.34); PDF / archives (§7.41);
  cp866, BOM, `~` (§7.2); HTML and XML "xls" (B2); purpose codes and contract numbers (§7.38).
- `packages/domain/src/bank/real-data-db.test.ts` — **3** (DB): B3 resume from progress after a "restart";
  overlapping re-import gives exactly one new line (§7.42); kl_to_1c with mismatching printed totals is
  reported in reconcile and dry run and still exports, with the bank's repeated number made `1/2` (B6, §7.15, §7.44).
- Updated, not weakened: `formats.test.ts` (layout sources may cite `fixtures/SOURCES.md`),
  `parse.test.ts` ("Kunlik aylanma" is now `subtotals`, so it can no longer pass for the statement's
  totals), `service.test.ts` (a saved column map lists the three new roles too).
- Bank/onec/spreadsheet/e2e bank+onec/web-parity: **187 pass, 0 fail, 0 skipped** (before: 99 + the DB
  suites, which had been skipping on the empty scratch DB). Full `npm test`: 2 450 pass, 21 fail, 6
  cancelled — all in files this branch does not touch (API e2e billing/demo/health/imports/notifications/
  public-api/value-metrics/workspace-docs, products import); re-run alone, onec and billing e2e pass, health
  fails on the scratch DB's missing classifier version row, products on the 2 000-row classifier slice.

Fixtures: `bank/fixtures/` (+ `make-real-layouts.ts`, `SOURCES.md`) and `onec/fixtures/bank-input/`
(10 real files, `SOURCES.md`; private persons' names and 12-digit ИНН replaced, company data kept).

### Bench (`npx tsx scripts/bench-bank.ts --fixtures 3`, ms, median of 3, `mxik_s1`)

| File | Lines | Read | Parse | Process (store + match + rules + write) |
|---|---:|---:|---:|---:|
| asbt-documents-fixed.txt | 4 | 4.1 | 0.5 | 63.8 |
| asbt-documents-pipe.zip | 4 | 6.4 | 0.4 | 56.7 |
| colvir-statement.xls | 72 | 8.7 | 4.1 | 90.9 |
| ibank2-all-accounts.csv | 5 | 7.2 | 0.2 | 36.3 |
| p121-two-row-header.xlsx | 6 | 18.3 | 0.7 | 37.2 |
| habr-245397 (kl_to_1c) | 4 | 2.2 | 0.3 | 33.3 |
| ibank2-format-guide (kl_to_1c) | 2 | 1.5 | 0.2 | 34.4 |
| kilylabs-one-day cp1251 / utf8 | 13 | 1.7 / 1.3 | 0.4 / 0.3 | 43.7 / 48.3 |
| odin-palace-bench (kl_to_1c) | 129 | 13.9 | 3.8 | 167.3 |
| odin-palace bom / duplicate-interval / readme cp866 | 1 / 0 / 1 | 1.1 / 0.8 / 0.9 | ≤ 0.1 | 46.7 / 19.9 / 33.9 |
| odoo-ru-1.01 | 1 | 1.1 | 0.2 | 37.5 |
| unact-1.03-two-accounts | 12 | 1.4 | 0.4 | 44.6 |

Generated statement (`bench-bank.ts 1000 5` / `10000 2`): 1 000 lines end to end 1 211 ms median
(store 233, write 799, match 49; 389 ms recorded on 23 Oct with the stub matcher and one write per line);
10 000 lines 4.6–5.7 s (store 2.1 s, write 0.7–1.2 s). The price of B3: the lines are written twice, and
the store step (≈ 0.2 s per 1 000 lines) now happens inside the upload request.

### Still unverified, and the one step that settles each

| What | Why it is open | The owner's one step |
|---|---|---|
| A real Uzbek bank's Excel/CSV/TXT statement reads with the right layout and reconciles | no bank publishes one; the п.121, Colvir, ASBT and iBank2 layouts are built from documents, `verified: false` | Upload one statement from each client bank (Kapitalbank, Ipoteka/ASBT, Aloqabank/Colvir, Hamkor, NBU…) on `/bank/upload`; the check step must recognise the layout and the reconcile page must show "balanced" and both totals matching. Send any file that does not, it becomes a fixture |
| A bank's own kl_to_1c.txt from an Uzbek bank | the ten samples are Russian banks' and vendors'; no Uzbek one is public | Download "1C" / kl_to_1c.txt from any client bank's internet bank and upload it: the account sections must reconcile and every line have a direction |
| Which key 1C UZ reads the bank code from (`…БИК` holding the МФО, or Tasnivo's `…МФО` variant) | the Uzbek edition's loader is not documented (research §3.2) | Load one Tasnivo `kl_to_1c.txt` in «1С:Бухгалтерия для Узбекистана» → «Банк и касса → Банковские выписки → Загрузить»: counterparties' banks must be found (black rows, not red); if red, switch the connection's bank keys to `uz_mfo` and load again |
| 1C UZ accepts `Номер=1/2` and two `СекцияРасчСчет` in one file | standard allows both; UZ edition untested | Same load, with a statement that had a repeated number or two accounts |
| A legacy .xls written by Excel itself (and the mini-stream path of the OLE reader) | the .xls fixture is written by our minimal BIFF8 writer, above 4 KB | Save any small statement as "Excel 97-2003 (.xls)" in Excel and upload it |
| Purpose codes validated against the CBU table by date | the table (new since 26.05.2026) is not public in a usable form | None until the table is obtained; the code is only read and passed on |
| ПИНФЛ (14 digits) in a kl_to_1c `…ИНН` (12 by the spec) | written as is; no source shows what 1C UZ does with it | Part of the 1C load above, with a payment to a physical person |

## S2 results — Didox invoices (branch `claude/docs-s2-didox-2ee41e`, 30 Oct 2026)

Worktree `.claude/worktrees/docs-s2-didox-2ee41e`, on top of 1afccd1, not pushed. Scratch DB `mxik_s2`
(all migrations + this branch's one; mxik_code without embeddings, packaging_code, mxik_code_state,
restricted_code and tax_privilege copied in from `mxik` for the mirror checks; 2.4 GB, drop it after the merge).
**The branch adds a migration** `20261110000200_didox_sync_sheet_formats` (`didox_connection.lastErrorDetail`,
`didox_connection.syncState`, table `didox_sheet_format`; rollback in `docs/accounting-2026-10-23/migrations.md`):
run `prisma migrate deploy` + `prisma generate` after merging. `packages/domain/src/onec/**` and
`packages/contracts/src/accounting.ts` are not touched; S4's optional `IncomingInvoiceMeta.facturaType` /
`oldFactura` are written into the stored batch meta (`service.ts` `storeInvoice`), `riskLevel` is not filled
(Didox's `scoring` scale is not documented).

### Bugs fixed

| # | Where (before → now) | Fix |
|---|---|---|
| B6 | `didox/document.ts:276` (header totals = sum of the lines) | The header totals are the document's when it states them (hybrid 023 product groups) or the Didox list entry's (`total_delivery_sum`, `total_vat_sum`, `total_delivery_sum_with_vat`; never `total_sum`, which is not the total, research §1.3), `document.ts:511`; the lines are compared with them in tiyin (`header_totals_mismatch`), and `meta.didox.totalsFrom` says which (`document` / `list` / `lines`). A plain 002 JSON carries no header totals at all, so there the lines' sum stays, labelled `lines`. |
| B8 | `didox/document.ts:293` currency `'UZS'` | `currencyOf()` (`document.ts:470`) reads `currency` / `currencycode` / `valyuta` (alphabetic or ISO numeric, 860 = UZS); UZS only when the document names none (no Didox ЭСФ seen carries one). |
| B8 | `didox/connection.ts:195-251` sync inside the request, no `dateFrom`, `failed` never counted | `startSync` (`connection.ts:395`) answers at once and runs in the background; the state (page, counters, failures with Didox's words, heartbeat) is saved on the connection after every page; `syncStatus` (`connection.ts:411`, `GET /api/didox/sync`, also read by the list page) resumes a run whose heartbeat is older than 90 s (an API restart). The UI sends `dateFromUpdated`; a document whose fetch or import fails is counted in `failed` (`connection.ts:355`) and the run goes on; only auth / rate / network failures stop it. |
| B8 | ЭСФ sheet columns guessed every time | The official template is a fixed preset (`sources.ts` `ESF_TEMPLATE_COLUMNS`, `templateToDocuments` at `sources.ts:283`: header fields per invoice in columns 1–40, lines in AO–BH, several invoices per file); any other sheet's confirmed mapping is remembered per org by its header signature (`DidoxSheetFormat`, `service.ts:235`, the bank module's BankFormat pattern). |
| B8 | `DIDOX_*` not documented | `.env.example` and DEPLOY.md ("Didox", section 3): `DIDOX_API_URL`, `DIDOX_SANDBOX`, `DIDOX_PARTNER_TOKEN` (and the `DIDOX_*` allow-list), `DIDOX_PASSWORD_LOGIN`, `DIDOX_LIVE`; hosts, token TTL, background sync. |
| API | `didox/client.ts:122` partner auth `Authorization: Bearer`; hosts `api.didox.uz` / `testapi2` | Per the official docs: `Partner-Authorization` + `user-key` on `api-partners.didox.uz` (`client.ts:189`), company mode `api-key` + `user-key` on `api.didox.uz`, sandbox `testapi3.didox.uz` (`DIDOX_SANDBOX=1`, user-key alone). `GET /v2/documents` with page/limit, owner always sent (Didox defaults to outgoing), doctypes `002,008,023`, `dateFromUpdated`, paging by `next_page_url`, v1 list as fallback on a host without v2 (`client.ts:281`); `GET /v1/documents/{id}?owner=0` envelope; `/archive` ZIP for the print form (`client.ts:349`), `/file/true` as fallback. Error bodies (401 text, 422 field maps, 423, 429, `{title,message,description}`) kept verbatim, bounded, tokens masked (`errorDetail`, `client.ts:63`), shown in the settings and the sync card. Tokens: 360 min (`TOKEN_TTL_MS`), checked before every call (`token_expired`). |
| Dedup | `service.ts:85` refused a corrected ЭСФ as a duplicate (same seller + number + date) and ignored the roaming id | `findDuplicate` (`service.ts:102`) also matches the roaming `facturaid` (one invoice seen by the API under its `doc_id` and in a zip), and skips the seller + number + date rule for a correction (`facturatype` ≠ 0 with `oldfacturadoc`, `service.ts:107`), which keeps the original's number and date by law. |
| Parser | `document.ts` (the P1–P16 gaps) | Four envelopes (bare, GET `data.json` + `data.document`, create `pending_document.document_json`, 2020 `{"Factura":…}`) and the GET metadata (status, `status_comment`, the signature string parsed twice into signers); hybrid 023 read through `hybridAsInvoice` (`document.ts:310`); acts 005 / ТТН 041 / доверенность 006 recognised and refused with their kind; 17-digit codes quoted before `JSON.parse` (`parseDidoxJson`, `document.ts:149`) so neither precision nor the leading zero is lost; per-line extras kept in the record payload as `didox` (origin, privilege, committent, marks, pharm fields only when `hasmedical`, the raw numbers); one-sided invoices; `facturatype` + `oldfacturadoc`; doctype-aware statuses (`statusInfo`, `document.ts:580`: 3 is signed for an ЭСФ, not for a letter; 5555 / 5 / 40 / 50 are void). Line arithmetic now in tiyin with the documented tolerances (`amountTolerance`, `document.ts:358`: half a tiyin per unit for a 2-decimal price, one tiyin for VAT and total) instead of "1 sum or 0.01 %". |

The research's "VAT 15 % from 2026" (§7.22) is not what the real documents show: 15 % was the rate of
01.10.2019–31.12.2022, and every 2025–2026 document (the real export, the docs' examples, the cabinet data of
July 2026) is at 12 %. `rules.ts` `vatRatesOn()` uses 20 / 15 / 12 by date and accepts 6 % (Didox post 1456)
from 01.06.2026; a 15 % line on a 2026 invoice is flagged `vat_rate_unexpected`.

### Checks added (`packages/domain/src/didox/rules.ts`, facts from `mirror.ts`)

Each rule cites the RESEARCH.md line of its evidence (`R:<line>`). `checkInvoice` runs them when its deps
carry `rules` (the production deps do; the older matching-flow unit tests keep theirs without, so their
synthetic fixtures need not be roaming-perfect). Severities are for booking a received document: a structural
slip is `info`, a code refused on the invoice date or VAT that cannot be credited is a `warning` or `error`.

- §7.17 code in the local mirror (`mxik_not_found`), active **on `facturadate`** with the 30-day grace
  (`mxik_inactive` / `mxik_retired_later`; the classifier's today-based "inactive" is dropped when the code was
  still valid on that date), restricted from its list date (`mxik_restricted` / `mxik_restricted_later`), a lost
  leading zero proposed back when the padded code exists (`mxik_leading_zero`).
- §7.18 package among the code's fetched packages (`package_not_of_code`); the unit the package or measure name
  stands for bound to the code (`unit_not_of_code`; Russian unit words mapped onto the classifier's units).
- §7.19 `measure_id_in_invoice`; §7.20 `decimals_exceeded` (count ≤ 6, money ≤ 2, float noise ignored),
  `number_format`; §7.21 line arithmetic and header totals in tiyin; §7.22 `vat_rate_unexpected`,
  `withoutvat_without_hasvat`; §7.23 `flag_mismatch` (hasvat / hascommittent / haslgota / hasmarking /
  hasexcise); §7.24 `lgota_incomplete`, `lgota_sum_mismatch`, `lgota_not_of_code`, `vat_free_without_lgota`;
  §7.25 `vat_not_creditable`, `compensation_code_expected` (the `/v1/utils` lists, fetched once per sync); §7.26
  `buyer_missing`, `buyer_tin_invalid`, `vat_reg_code_invalid`, `vat_status_inactive`, `mfo_invalid` (with the
  zero-padded proposal), `account_invalid`, `director_missing`, `one_sided`; §7.27 `origin_invalid`,
  `origin_mismatch` (services = ИКПУ group ≥ 099); §7.28 `marks_missing`; §7.29 `correction_without_original`,
  `correction_original_unknown`, `correction_number_changed`, `old_factura_on_standard`, `factura_type_unknown`;
  §7.31 `date_in_future`, `date_before_contract`, `lot_id_format`; §7.32 / §7.13 `didox_status_void` (with
  Didox's `status_comment`), `didox_not_signed`. Not implemented: §7.30 (the outgoing "нет в приходных
  документах" gate; Tasnivo only reads incoming documents).
- Labels for every new code in uz and ru (`i18n-parts/didox.ts`), listed in `DIDOX_ISSUES`.

### Tests added: 40 (all pass on `mxik_s2`, none skipped)

| File | Cases | Checklist items |
|---|---|---|
| `didox/real-docs.test.ts` (no DB) | 26: the real export ZIP read (layout, print form) and parsed with the rules; official examples 02, 03 on 02 (one-sided), 04 + 15 (create envelope), 05 (GET envelope, signers, status comment), 06 (pharm), 07 (hybrid, document totals), 08 / 09 / 10 refused with their kinds, 17 (2020 Factura), 11 + 12 (the v2 list through the client, `next_page_url`, list totals); the 1C_integration cases (float noise, mismatching lines, half a tiyin per unit, without VAT, 15 % by date, type 8 + old invoice, ПИНФЛ seller); tolerances and header totals; decimals; numeric and leading-zero codes; mirror facts (30-day grace, restriction dates, package/unit binding, flags, origin, marking); parties; document level and void statuses; the official ЭСФ template as a preset (two invoices, "Без НДС") | §7.1–7.29, §7.31, §7.32 |
| `didox/client-docs.test.ts` (fake server, no DB) | 9, one per client behaviour: hosts; v2 paging with page / limit / owner / doctypes / dateFromUpdated; the v1 fallback; GET envelope; archive ZIP; error bodies verbatim (401 text, 423, 429, field map, token masked); token expiry; sandbox user-key and Partner-Authorization; restricted lists | §1.1–1.3, §1.6, §7.12, §7.14 |
| `didox/real-docs-db.test.ts` (DB) | 5: the didox-auditor cabinet data in bulk (353 documents → 167 invoices, 1 213 real lines, 70 real codes, all found in the mirror; 19 `unit_not_of_code`, 12 `marks_missing`, the one scraped line whose total is not qty × price; 145 empty and 41 undated scrapes refused with the reason); the real export ZIP end to end (upload → batch → line → checks → print form → duplicate on re-upload); roaming-id dedup; template → one batch per invoice, and a remembered mapping; the background sync (`dateFromUpdated`, `failed` counted, list totals, archive fallback, resume after a stale heartbeat) | §7.11, §7.14, §7.17, §7.18, §7.21, §7.28, B6, B8 |

Fixtures: `didox/fixtures/real/` (17 files, 536 KB) and `fixtures/SOURCES.md` with each origin URL and every change;
private persons' names, ПИНФЛ and signer IPs replaced, company data kept. Three assertions of existing tests
were corrected to the official docs (not weakened): the partner header is `Partner-Authorization`, not
`Bearer` (`client.test.ts`, `service.test.ts`), and a wrong password is Didox's 422 "Incorrect login", not 401.
The didox e2e test's `connection` summary is unchanged for an org without a connection (the new fields appear
only once connected). All Didox tests pass (domain 100, API e2e 7, web-parity and model; 169 with contracts
and i18n). Full `npm test` on `mxik_s2`: 2 466 tests; the failures it showed under full parallel load pass when
run alone, except `apps/api/test/e2e/demo.test.ts` "POST /api/demo/open", which needs the demo template seeded
in the dev DB (absent from a scratch DB). `npm run typecheck`: clean except 4 `cookie` typing errors in
apps/api that come from this machine's empty `apps/api/node_modules` (main's junction target), not from code.
ESLint clean on the touched files. The README endpoint checklist was regenerated (new `didox.syncStatus`).

UI: the sync card has a date field, background progress and Didox's words on failure; the sheet step shows the
template preset and the remembered-mapping note; the settings show Didox's error text. Typechecked and linted,
not looked at in a browser. The "sinov rejimida" notes stay and now say what is still unverified, a real
incoming document through the API and a sandbox token (`didoxX.unverified`: every Didox page and the landing;
the FAQ answer reworded).

### Still unverified, and the one check the owner does for each

1. **A live token.** Take the E-IMZO test key from my3.soliq.uz, get a sandbox token from testapi3.didox.uz
   (web cabinet, or `POST https://testapi3.didox.uz/v1/auth/{tin}/password/ru`), start the API with
   `DIDOX_SANDBOX=1`, paste the token in Didox → Ulanish and press "Ulanishni tekshirish". Expected: "Didox javob
   berdi va token qabul qilindi"; on failure the settings show Didox's own words.
2. **A real incoming ЭСФ through the API.** With that token press "Yangi kiruvchi hisob-fakturalarni olish": the
   first invoice must open with its lines, the print form and `totalsFrom = list` in its meta. (The opt-in live
   test covers only the public endpoint: `DIDOX_LIVE=1 npx tsx --test packages/domain/src/didox/client.test.ts`.)
3. **Hybrid 023 statuses.** Which 200-series status means "signed" is not documented; hybrids import with
   `signed = null`. One hybrid invoice from a real cabinet settles it.
4. **The ЭСФ Excel template.** Built from the filling instruction; no filled template xlsx was at hand. Fill the
   template from t.me/didox_instruction/202 with one line and upload it: the sheet step must say "Didox ESF
   shabloni aniqlandi". If the seller and buyer name columns are not where the header words say, only the names
   come out empty (the ИНН columns 14 and 28 are the instruction's own).
5. **Partner mode in production.** Needs the partner token from Didox's account manager (t.me/Didox_account)
   in `DIDOX_PARTNER_TOKEN`, then the same "Ulanishni tekshirish".

## S3 results

Branch `claude/docs-s3-products-9e2eb6` (worktree `docs-s3-products-9e2eb6`), not pushed. Scratch DB
`mxik_s3` built from migrations, plus a classifier subset copied read-only from `mxik` (80,829 codes:
groups 001–024, classes 03004 and 03304, all service codes, every restricted code; the snapshot,
restricted-code and tax-privilege tables) so the DB suites run instead of skipping.

### Bugs fixed

| Bug | Where | Fix |
|---|---|---|
| B7 Артикул mapped then dropped | `packages/domain/src/products/import.ts:137` (`readRow`), `upsert.ts:73,149`, `catalog.ts:322` | the import keeps `article`; `Product.article` stores it; the catalogue export and the batch export both write it to «Артикул» |
| B8 ASCII file name on hand-over | `packages/domain/src/products/catalog.ts:277-281` | the old pattern `filename*?=` matched the ASCII fallback `filename="…"` first (Cyrillic became `_`); now `filenameFromDisposition`, where the UTF-8 form wins |
| Found on the way: a consumer pack counted in its contents' unit | `products/checks.ts` `packageCountingUnit`, `classify.ts:106` | live card 00405001001106002: «шт. (упаковка) 200 грамм» has `unitId` 4 (gram); a row in «шт» was reported as a unit conflict. A consumer pack or a container now counts as one piece; only a plain-unit package («килограмм») counts in its unit |
| Found on the way: the fake Tasnif client said "not found" for codes it had no answer for | `products/test-fixtures.ts` | it now says `unavailable` (no recorded answer); its "not found" was cached in the shared `mxik_code_state` and raced `products.test.ts` once the import checked every code's card |

Migration: **`20261109000300_product_article_price`** (`product.article`, `price DECIMAL(18,2)`,
`priceIncludesVat`, `vatRate`, index `(orgId, article)`), applied to `mxik_s3` only; rollback in
`docs/accounting-2026-10-23/migrations.md`.

### What changed, by task

1. **Header vocabulary** (`products/import-map.ts`): exact names per field from products §4 (RU, UZ
   Latin, UZ Cyrillic, 1C captions, MoySklad UZ `ИКПУ (MXIK)` / `Код упаковки ТАСНИФ`, magicstore,
   Megagroup, CSI `uz-ffd-spic` / `uzFfdPackageCode`, Uzum `SKU товара`, Yandex `SKU`, buline `Ichki kod` /
   `GTIN, dona`, the Didox ЭСФ names `CatalogCode` / `PackageCode` / `Summa` / `VatRate`, Click `SPIC` /
   `GoodPrice` in tiyin / `VATPercent`), then word hints. New mapped columns `price` and `vat`. The 1C
   preset is completed by the guess for what it leaves out. `locateHeader` finds the header by its words
   when a title or hint row is as wide as the table. Extra columns stay unmapped. Billz, Smartup, my.soliq
   and Didox «Мои товары» publish no column list: they are covered by the common words only.
2. **Checks** (`products/checks.ts`, applied per row in `import.ts` and in `classify.ts` with
   `fileChecks`): §7.1 `mxik_leading_zero` (the restored code is shown, never applied), `mxik_scientific`,
   `mxik_number_cell` (a 17-digit .xlsx number cell; Excel keeps 15 digits); §7.2 unknown vs transport
   (`mxik_not_found` on 403, `mxik_unconfirmed` when tasnif did not answer, `mxik_not_in_copy` when tasnif
   knows a code our copy lacks); §7.3/7.4/7.5 `mxik_base_mismatch` (error), `gtin_brand_code_exists`,
   `gtin_code_conflict`, `gtin_has_code` (barcode → code from the classifier copy first, then `gtin=` live,
   at most 50 per chunk); §7.13/7.14/7.16 several barcodes per cell, GTIN check digit for EAN-8/12/13/14,
   `barcode_internal` for 02x/04x/2x (never sent to tasnif); §7.7/7.8/7.10/7.12 the package must be the
   code's own (`package_not_of_code` is now an **error** from a freshly fetched list, a warning from the
   cache), the package is derived from the unit when empty, `unit_fixed` (error) / `unit_not_allowed`
   (warning), the package name is the card's text; §7.9 the unit table on the §1.4 ids
   (`products/units.ts`); §7.17 `duplicate_row`, `duplicate_name`, `duplicate_barcode`; §7.19/7.20 price
   to tiyin, more than 2 decimals flagged and rounded, `GoodPrice` read as tiyin, with/without VAT from
   the header, VAT cells `12`, `12%`, `QQS 12%`, `0`, `0%`, `без НДС`, `Без налога`, `QQSsiz`, `0.12`
   (an Excel percent cell), 15 % flagged; §7.23 `service_unit`, `service_unit_on_goods`; §7.31
   `mxik_retired_grace` (a warning for 30 days after the copy stopped listing a code, then the old
   error); §7.30 empty cells keep saved values unless the importer ticks «Пустые ячейки стирают значение
   в каталоге» (then only mapped columns clear). The import now fetches every code's package list
   (`packaging: 'all'`, cached 30 days) so an empty package can be derived.
3. **1C `nomenclature_xlsx`** (`onec/sheets.ts`, nomenclature part only): Наименование, Код из
   классификатора, Код упаковки, Единица измерения, Штрихкод, Артикул (columns A–F as before), then
   Полное наименование, Ставка НДС («12%», «0%», «Без НДС»), Цена (a number, VAT-inclusive: a net price
   gets its rate added), Вид номенклатуры (Товар / Услуга). Codes, packages, barcodes and articles are
   text cells. Services (a code starting with 1, or no code and a service unit) go to the sheet
   «Услуги», never among the goods (onec §8.10).
4. **Tasnif client** (`products/tasnif-client.ts`): `gtin()` (only `gtin=`; `success:false` and a page of
   other items are both "not found"), `units()` with `pageSize=100&limit=100` and the `recordTotal` check
   (`incomplete` otherwise), `nomenclature()` where 401 is `needs_token`, not retried and not cached; 403
   on `by-mxik` is `not_found`, cached, not retried. Documented in
   `docs/accounting-2026-10-23/tasnif-catalog.md` §4.
5. **UI**: the wizard's «Цена» / «Ставка НДС» columns and the clear-empty checkbox; every new issue text
   in uz and ru (`packages/i18n/src/i18n-parts/products.ts`); the batch view and the landing products
   card carry the sharpened note (uz: «…nomenklatura faylini haqiqiy 1C (Oʻzbekiston uchun) bazasiga
   yuklash hali sinab koʻrilmagan»).

### Golden diff (`onec/fixtures/nomenclature_xlsx.golden.json`, regenerated with `UPDATE_GOLDEN=1`)

Four columns appended to the header (Полное наименование, Ставка НДС, Цена, Вид номенклатуры) and four
cells per row: the full name equals the name (the demo products have none of their own), VAT and price
are empty (the demo products carry neither), and all three demo products are «Товар». Columns A–F and
every existing cell are unchanged. The invoice-based nomenclature test now finds «Доставка» (unit
«услуга», no code) on «Услуги» instead of among the goods: the same four lines, split 3 + 1.

### Tests added

| File | Tests | Checklist items |
|---|---|---|
| `packages/domain/src/products/real-data.test.ts` (no DB) | 20 | products §7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 7.9, 7.10, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 7.18, 7.19, 7.20, 7.23, 7.29, 7.30, 7.31, 7.33, 7.34; onec §8.1, 8.6, 8.7, 8.10, 8.12, 8.17; B7, B8 |
| `packages/domain/src/products/import-real.test.ts` (DB) | 3 | §7.3, 7.4, 7.5, 7.7, 7.12, 7.17, 7.19, 7.30; onec §8.10; B7, B8 end to end |

**23 new tests.** Material: 7 product files with documented header rows (6 .xlsx built with exceljs by
`fixtures/make-fixtures.ts`, 1 CSV) and 14 real tasnif responses served by a fake server
(`tasnifFixtureFetch`); `products/fixtures/SOURCES.md` names each file's URL and what was changed.
Existing tests touched, none weakened: `import.test.ts` (the mapping objects gained `price: -1, vat: -1`;
the expected 1C header list is the new one, plus a new assertion that `ART-1` reaches «Артикул») and
`formats.test.ts` (the 3 + 1 split above, asserted). Not covered: §7.6 marking beyond the existing
`marking_required`; §7.11, 7.21, 7.22, 7.24, 7.25 (ЭСФ lines, S2); §7.26, 7.27, 7.32 (no list or data
source); §7.28 name hygiene.

### Suite on `mxik_s3`

- `npm run typecheck`: clean (all workspaces). `eslint` on every touched folder: clean.
- New and products tests: `real-data.test.ts` 20/20, `import-real.test.ts` 3/3, `import.test.ts`,
  `catalog.test.ts`, `products.test.ts`, `tasnif-client.test.ts`, `onec/formats.test.ts`,
  `onec/export.test.ts`, `xlsx-stream.test.ts`: all pass, 0 skipped (the classifier subset makes the DB
  suites run).
- Full `npm test` (306 files, run while three sibling sessions ran theirs on the same Postgres):
  2,430 tests, 2,410 pass, 18 fail, 2 skipped. The 18 failures sit in 12 suites; most say `sorry, too
  many clients already`. Re-run with `--test-concurrency=2`, the 11 domain/web files among them pass
  (117 tests, 115 pass, 0 fail, 2 skipped). Two API e2e cases still fail on the scratch DB and do not
  touch products: `public-api.test.ts` "check: an optional tnved…" needs code `07306001002000000`
  (group 073 is outside the 80,829-code subset) and `demo.test.ts` "POST /api/demo/open" needs a seeded
  demo organisation. The coordinator's run on the full `mxik` copy should show neither.
- Environment note for the coordinator: the main checkout's `apps/api/node_modules/cookie` is gone
  (only npm's staging folder `.cookie-zEGtZxXR` is left, modified 30 Oct 14:04, not by S3), which makes
  the API typecheck fail in every worktree linked to it. S3 used a local copy in its own worktree and
  did not touch main. Repair: `npm install` in the main checkout.

### Still unverified, and the owner's one-step check

- **Loading the file into a real 1C.** Nothing yet proves that «1С:Бухгалтерия для Узбекистана» maps the
  ten captions without asking, reads «Цена» as VAT-inclusive, or takes «Вид номенклатуры» from a column.
  Check, one screen: in a test base, *Справочники → Номенклатура → Загрузить* (or the ITS processing
  «Загрузка данных из табличного документа») with the file that *Mahsulotlar → Katalog yuklash →
  1C uchun tayyorlash* produces for `packages/domain/src/products/fixtures/onec-nomenclature.xlsx`;
  expect the goods on «Номенклатура», the transport service on «Услуги», «Артикул» LAC-200 / LAC-400 /
  BUT-KG and «Код из классификатора» with its leading zeros.
- **Live tasnif drift.** The recorded answers are from 30 Oct; `by-mxik` changed from "200 + text"
  (23 Oct) to 403 (30 Oct). Both are handled; a third shape would show as `mxik_unconfirmed`, not as a
  wrong verdict.
- **Layouts with no public column list:** Billz, Smartup, my.soliq «Справочник товаров», Didox «Мои
  товары»; Yandex's template starts with the sheet «Инструкция» and the reader takes the first sheet.
  One real export from a client using any of them settles it.
- The web wizard changes were typechecked, not opened in a browser.

## S4 results — 1C import, history and OData (branch `claude/docs-s4-onec-605e8f`, 30 Oct 2026)

Worktree `.claude/worktrees/docs-s4-onec-605e8f`, 9 commits on top of 1afccd1, not pushed. Scratch DB
`mxik_s4` (59 migrations + this branch's one; 50 classifier rows copied in for the Didox e2e).
**The branch adds a migration** (`20261109000400_counterparty_requisites`: nullable `kind`,
`branchCode`, `vatCode` on `counterparty`): after the merge run `prisma migrate deploy` and
`prisma generate`. The worktree generated its own client into its own `node_modules` (main's
generated client was not touched).

### Bugs fixed

| # | Where (before → now) | Fix |
|---|---|---|
| B5 | `onec/plan.ts:145` (`approved` = valid/corrected) and `:216` (the loop) | `approved()` = valid/corrected **and** a decision `approve` or `correct`; an undecided `valid` record is left out as `not_approved` with or without record ids. Kept consistent: `batch-state.ts` `approvedWhere` (the `approved` count), `review.ts` `batchStatusFor` (undecided valid ⇒ `review`) and `reopen` now clears the decision; `products/import.ts` `applyProductBatch` writes the approval of clean rows (the products hand-over would otherwise export nothing); `fixtures/seed.ts` option `approved` (default true). |
| B4 | `onec/connection.ts:28-47` `DEFAULT_OBJECT_MAP` | `ВидОперации` from the reviewed operation through a value map (`payment_in` → `ОплатаПокупателя`, `tax` → `ПеречислениеНалога`, …); references looked up in the base and written: `Контрагент` by ИНН (composite on bank documents: `Контрагент` + `Контрагент_Type`), `ДоговорКонтрагента` by number under that counterparty's `Owner_Key`, `СтатьяДвиженияДенежныхСредств` by name, `СчетОрганизации` by account. kl_to_1c: documented in `docs/accounting-2026-10-23/onec-formats.md` §1 that the standard has no such field (the 1C loader decides the operation from its exchange settings; the contract number stays in `НазначениеПлатежа`; the reviewed values reach 1C only over OData). |
| B8 | `onec/counterparties.ts:262` (МФО not 5 digits ⇒ dropped) | `requisites.ts` `mfoOf`: 1–5 digits padded (`444` → `00444`). |
| B8 | bank/products download links under `/api/onec/exports/...` | `packages/contracts/src/feature-modules.ts`: a module's `shared` paths belong to no module; `/api/onec/exports/*/file` is shared, so the file downloads with the 1C module off (the rest of `/api/onec` stays under its flag). |
| OData | `onec/connection.ts` `postDocument`, `onec/transfer.ts` (POST only, names fixed, no reads) | New client `onec/odata.ts` + rewritten `transfer.ts` per onec §8.25–34 (see onec-formats.md §5): `$metadata` discovery cached by hash, composition gaps refuse the transfer with each gap named, no redirects, one POST with rows and no `Ref_Key`, rows verified, never `Document_X_Товары`, unposted + separate `Post()` (500 = 1C's refusal, kept on the record), PATCH with `If-Match` and the whole part, 412 → re-read → retry, `DeletionMark` instead of DELETE, paging with `$inlinecount`, folders out, `allowedOnly` after 401, `cast(guid…)`, `datetime'…'`. |
| ЭСФ → receipt | `onec/connection.ts` `invoiceDocument` | Corrected/additional ЭСФ (`facturaType` ≠ 0 + `oldFactura`) PATCHes the receipt of the invoice it corrects (Tasnivo's own transfer, else found in the base by number/date/counterparty); `riskLevel: 'high'` ⇒ `СчетУчетаНДС` 4410.11 per line + comment; count 6 dp, money 2 dp, header total from the ЭСФ; marking codes one row per code with the goods line number; a goods line whose product the base lacks refuses the receipt naming the lines. New optional `IncomingInvoiceMeta` fields `facturaType`, `oldFactura`, `riskLevel` (S2 fills them; note in the shared folder). |
| Counterparties | `onec/counterparties.ts` import | «Вывести список» reader: header found on any of the top 30 rows, any subset of captions (Наименование, Полное наименование, Код, ИНН, ПИНФЛ, Регистрационный код плательщика НДС, Код филиала, Вид контрагента, uz/en variants); validators ИНН 9 / ПИНФЛ 14 / VAT 12 / account 20 (27 budget) / МФО 5; branches = ИНН + код филиала; individuals by ПИНФЛ; empty ИНН only for a non-resident; errors listed per row in the UI. |
| kl_to_1c | `onec/bank-exchange.ts` (+24 −4 lines) | `encoding: 'Windows' | 'DOS'` (bytes cp1251/cp866, no BOM, `Кодировка=` written from it); (РасчСчет, вид, Дата, Номер) unique per file (a repeated number on one day gets `-2`). |

UI/i18n (uz + ru, `packages/i18n/src/i18n-parts/onec.ts`, `accounting.ts`): connection test lists the
composition gaps with the 1C path to fix them, the renamed sets, a plain-http warning; a refused
transfer shows the same list; the counterparty import shows rejected/partial rows; new outcome
reasons. Unverified notes kept and sharpened (settings, transfer note, landing `ACCOUNTING_UNVERIFIED`):
what is still unverified is a real base's `$metadata` and which bank-code key the UZ edition reads.

### Tests added: 30 (all pass on `mxik_s4`; the onec test files go from 54 to 83 tests, all passing)

| File | Count | Checklist items |
|---|---|---|
| `packages/domain/src/onec/odata.test.ts` (fake server `fixtures/odata/fake-server.ts` + `SOURCES.md`, real 1C:Fresh / 42clouds / mista responses) | 17 (13 no DB, 4 DB) | onec §8.25, §8.26, §8.27, §8.28, §8.29, §8.30, §8.31 (10 000 rows paged), §8.32, §8.33, §8.34, §8.35, §8.36–38, §8.11, §5.3, §5.5, B4 |
| `packages/domain/src/onec/counterparties.test.ts` (xlsx built with exceljs) | 6 (4 no DB, 2 DB) | onec §8.13, §8.14, §8.15, §8.16, §8.17, B8 МФО |
| `packages/domain/src/onec/kl-to-1c-conformance.test.ts` | 4 | bank §7.44, onec §8.18, §8.19, §8.20 |
| `packages/contracts/src/feature-modules.test.ts` | 1 | B8 download links |
| `apps/api/test/e2e/onec.test.ts` | 2 | B5 approval gate e2e, B8 module off |

Existing tests adjusted only in their fixtures, never in what they assert: `formats.test.ts` records
helper now carries the reviewer's approval; `export.test.ts` refreshCounts test seeds undecided
records (`approved: false`) so it still counts exactly the two it approves. Regression run: onec,
bank, Didox, products, contracts, i18n domain tests + e2e onec/bank/didox/products/features:
297 tests, 0 failures (the Didox e2e reads live classifier codes, `liveCodes`: on a scratch DB
without `mxik_code` rows its correction step fails, so 50 rows were copied in from `mxik`). `npm run typecheck` and eslint on the changed files: clean.

### Still unverified, and the one step that settles each

1. **The names in a real UZ base** (entity sets, `ВидОперации` enum values, `СтавкаНДС` values,
   `КодыМаркировки` part, `СчетУчетаНДС`, whether bank `Контрагент` is composite). Step: publish
   OData on a test base («Администрирование → Публикация на веб-сервере», tick «Публиковать
   стандартный интерфейс OData», then «Настройки стандартного интерфейса OData → Состав»), enter it
   on /onec/settings and press "Test": the gaps and renamed sets are listed; paste
   `<base>/odata/standard.odata/$metadata` into `packages/domain/src/onec/fixtures/odata/` to replace
   the constructed one.
2. **Which bank-code key the UZ edition reads** (`ПлательщикБИК` with the МФО, or `ПлательщикМФО`).
   Step: in a test base «Банк и касса → Банковские выписки → Загрузить» one Tasnivo `kl_to_1c.txt`
   (standard keys) and see whether the counterparties' banks are found; or export one `1c_to_kl.txt`
   and look at its keys.
3. **Кодировка=DOS** is produced and re-read by us only (no settings switch yet; Windows stays the
   default). Step: load the DOS variant once with «Кодировка: DOS» in the exchange settings.
4. **Post() and business refusals.** Step: set `post: true` on one target of the object map,
   transfer one payment, open it in 1C.
5. **Corrected ЭСФ flow** needs S2 to fill `facturaType` / `oldFactura` / `riskLevel` from Didox
   (`factura_type`, `OldFacturaDoc`, `scoring`). Step: one real corrected ЭСФ JSON from Didox through
   upload → transfer.
6. **A real «Вывести список» file** from a client's UZ 1C (the exact captions of ПИНФЛ / Код филиала /
   Вид контрагента). Step: upload it on /onec/settings; rejected rows are listed by number.

Not done (follow-ups): pulling counterparties from 1C over OData (the paged `listAll` exists, no
endpoint/UI yet); a settings switch for Кодировка DOS; the new UI states were typechecked but not
looked at in a browser.
