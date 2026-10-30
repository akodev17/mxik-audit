# Didox fixtures: where each file comes from

Collected for the documents real-data round (30 Oct 2026, docs/DOCUMENTS_REAL_DATA_PLAN_2026-10-30.md §S2)
from the research folder `tmp/real-docs/didox/samples/` (gitignored; every source URL is in its
`RESEARCH.md` §0 and §6). Downloaded material was read as data only. Private persons are removed
everywhere: director / accountant / driver / agent / signer names become `DIREKTOR F.I.O.`,
`BUXGALTER F.I.O.` or `F.I.O.`, every ПИНФЛ (14 digits) becomes a fake `300000000000NN`, signer IPs
become `0.0.0.0`. Company names, ИНН (9 digits), accounts, МФО and VAT codes of companies are kept, as
the plan allows for company data from official docs.

## Synthetic (earlier rounds)

| File | What |
|---|---|
| `invoice-standard-3.json`, `invoice-120-lines.json`, `invoice-noisy.json`, `invoice-vat0-pinfl.json`, `act.json` | Built by hand in the 23 Oct round (FINAL_REPORT §3); the companies and codes are invented |
| `placeholder.pdf` | `fakePdf()` of fake-server.ts; stands in for the real print form inside `real/real-export-1428.zip` |

## Real-world (`real/`)

| File | Origin | What was changed |
|---|---|---|
| `real-export-1428.zip` | The only real Didox export found: https://github.com/shavkatbegmatov/didox-parser, file `05_03_2026_200242936301467485_Хисоб_фактура_1428_от_30_06_2025_1772684278.zip` (ЭСФ 002 №1428 of 30.06.2025, Hamkorbank 200242936 → "RUXSHANA TEKS" XK 301467485) | Layout kept exactly: `05EDC0F656A811F0B9D2FA163E666D9A.json`, `…pdf`, `readme.txt` (Didox's own text, unchanged). The JSON is `01-real-export-1428.json` below; the PDF (it prints the directors' names) is replaced by `placeholder.pdf` |
| `01-real-export-1428.json` | The JSON inside that ZIP (lowercase keys, `packagecode` string, `measureid` null, `vatregstatus` "20") | 4 person names (seller/buyer director, accountant) replaced |
| `02-factura-full.json` | https://api-docs.didox.uz/ru/integrators-property-documents §1 (002, PascalCase, committent + lgota line) | `//` comments stripped; 4 names replaced |
| `03-onesided-blocks.json` | same page, the one-sided and optional blocks (a fragment, not a whole document) | comments stripped |
| `04-create-pending-document.json` | same page, "Response 200" of POST /v1/documents/002/create (`pending_document.document_json`) | 4 names replaced |
| `05-get-document.json` | https://api-docs.didox.uz/ru/integrators-documents §3, GET /v1/documents/{id} (`data.json` + `data.document`, `packagecode` as a number, signature as a JSON string) | 4 names replaced; inside the signature string first/last/full name replaced and the IP set to 0.0.0.0 |
| `06-pharm-008.json` | property-documents §2 (008 ФАРМ: `HasMedical`, `Serial`, `BaseSumma`, `ProfitRate`, `DispenseType`) | comments stripped; 4 names replaced |
| `07-hybrid-023.json` | property-documents §3 (023 hybrid: `HybridInvoiceDoc`, `Roadway.ProductGroups[].ProductInfo.Products[]`) | comments stripped; two stray ` *` after values removed (`"No": "тест", *`, `"BankMfo": "00974", *`) so it parses; names and the driver's ПИНФЛ replaced |
| `08-act-005.json` | property-documents §5 (005 act, lowercase on create, `measureid`, `extended_json`) | comments stripped |
| `09-empowerment-006.json` | property-documents §6 (006 доверенность) | comments stripped; the agent's name and ПИНФЛ replaced |
| `10-ttn-041.json` | property-documents §4 (041 ТТН) | comments stripped; the docs' typo `"FreightForwarder": : {` and trailing commas fixed so it parses; driver and trustee names / ПИНФЛ replaced |
| `11-list-v2.json`, `12-list-v2-status60.json` | integrators-documents §1 and §22, GET /v2/documents (`data`, `total`, `next_page_url`, `doc_id`, `roaming_id`, `total_delivery_sum` …) | `agent_tin` (an agent's ПИНФЛ) replaced |
| `15-create-minimal.json` | integrators-documents §5, the minimal create response | none |
| `17-factura-2020.json` | 2020 roaming format `{"Factura":{…}}`, https://pastebin.com/CeGFnJEc (via r.jina.ai) | 4 names replaced |
| `1c-integration-cases.json` | The line cases of https://github.com/odiljonjamoliddinov39-cloud/1C_integration `apps/desktop/src/main/didox/document.test.ts` (float noise, mismatching lines, half a tiyin per unit, 15 %, `withoutvat`, type "8" + `oldfacturadoc`, a PINFL seller), rewritten as data | The seller ПИНФЛ `316…15` of that test replaced by `30000000000099`; the document skeleton is the test's own `invoice()` helper |
| `didox-auditor-cabinet.json` | https://github.com/anvarolimjonov818-spec/didox-auditor `live_didox_data.json` (data scraped from a real Didox cabinet: `{id, docNo, date, type, partnerName, partnerInn, status, items[{name, mxik, tasnif, unit, qty, price, total}]}`) | 353 of 1 450 documents kept (every document that brings a code not seen before, then the next ones up to 1 505 lines; all 91 distinct real MXIK codes are in); 75 partners that are or may be private persons (YaTT, a 14-digit ПИНФЛ, a person's name in the company name, no company suffix) become `YaTT (F.I.O.)` with a fake ПИНФЛ; items unchanged |

The files were produced by a one-off script (not kept in the repo, it read the gitignored research
folder): strip `//` comments outside strings, apply the fixes named above, then walk the JSON and
replace the person fields listed in the first paragraph.
