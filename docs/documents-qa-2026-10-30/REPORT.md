# Documents modules: browser QA pass (30 Oct 2026)

Scope: the four "documents" modules after the S1–S4 merge into `main` (65bbe01), as described in
`docs/DOCUMENTS_REAL_DATA_PLAN_2026-10-30.md` (sections "S1 results" … "S4 results", "Integration results").
Everything below was done in the built-in browser on http://localhost:3002 (web) against the API on
http://localhost:4010, dev DB `mxik` (all three new migrations are applied there: checked read-only in
`_prisma_migrations`). No source file was changed.

## How the pass was run (read this before the verdicts)

- **Account.** The browser was already signed in as `ai-match@test.localhost` (the entry in
  `tmp/found-catalogs/test-account.txt` that is in `ADMIN_EMAILS`, so the platform admin). No new sign-in was needed.
- **Uploads.** The browser tool has no file picker, so each fixture was put into the page as a `File`
  (exact bytes, SHA-256 checked against the repo file) and set on the page's own `<input type=file>` with a
  `change` event. This is what choosing a file does, but it bypasses the OS picker's `accept` filter (see bug 7).
- **Derived files.** The cp866, BOM, `~` and HTML "xls" bank files and the PDF were made from
  `ibank2-all-accounts.csv` and the HTML/PDF snippets in `bank/real-layouts.test.ts`, exactly as that test builds
  them. The ЭСФ template xlsx was built with exceljs from the captions in `didox/real-docs.test.ts` (no file
  fixture exists). The «Вывести список» counterparty file was a `;` CSV (the form accepts `.xlsx,.csv`) laid out
  like `onec/counterparties.test.ts`.
- **Product files.** `onec-nomenclature.xlsx` and `magicstore-ikpu.csv` were uploaded as the real files. To keep
  the transfer small, `moysklad-uz`, `click-fiscal`, `uz-cyrillic`, `uzum-seller` and `buline-uz-latin` were
  uploaded as `;` CSV transcriptions of their xlsx (same header row, same cell text, read with exceljs). Four of
  them have only text cells, so nothing changes. For `buline` the xlsx number cells (`mxik_number_cell`, the
  Excel percent cell `0.12`) were **not** exercised.
- **API logs.** Not available. The API on 4010 and the web on 3002 were started outside this session, so
  `preview_logs` cannot read them. An attempt to attach with `preview_start tasnivo-api-4010-ai` started a second
  API process, which failed with `EADDRINUSE :4010` and was stopped at once. Server-side behaviour was read from
  the network responses instead.
- **Console.** No application error in the browser console during the whole pass. Every error entry there came
  from the QA probes themselves: a CSP-blocked `fetch` of a blob URL, a CSP-blocked iframe, and deliberate
  409/403/404 API calls.
- **Not testable from the browser:** S1 B3 restart-resume (needs an API restart mid-upload). Skipped, not counted.
- **Screenshots:** JPG/PNG in this folder, 0.85 scale of a 1280×860 viewport. The file name is given in each step.

## Summary

| Module | Steps | OK | BUG | UNCLEAR |
|---|---:|---:|---:|---:|
| Bank (`/bank`, batch, reconcile, settings) | 27 | 16 | 9 | 2 |
| Didox (`/didox`, upload, batch, settings) | 15 | 10 | 3 | 2 |
| Products (`/products`, `/products/import`) | 20 | 10 | 7 | 3 |
| 1C (`/onec`, batch, settings, module switch) | 13 | 9 | 2 | 2 |
| Landing and module-page wording sweep | 5 | 2 | 2 | 1 |
| **Total** | **80** | **47** | **23** | **10** |

The 23 BUG steps come down to 17 distinct bugs, listed under "Bugs found". One of them (the layout overflow)
shows on two modules.

## Step log

Verdicts: OK, BUG (with the bug number from the list below), UNCLEAR (could not be settled here).

### Bank

| # | URL | What I did | Expected | Actual | Screenshot | Verdict |
|---|---|---|---|---|---|---|
| B1 | `/bank` (ru) | Looked at the upload card and the drop zone; read the file input's `accept` | Hint and picker allow .xls, .txt, .zip | The card says ".xlsx, .xls, CSV/TXT…, kl_to_1c.txt, ZIP", but the drop zone says «Excel (.xlsx) или CSV… Старый файл .xls сначала сохраните как .xlsx», and `accept=".xlsx,.xls,.csv,…"` hides .txt and .zip in the file dialog | 10-bank-list-ru.jpg, 11-bank-dropzone-xls-hint-ru.png | BUG 7 |
| B2 | `/bank/upload` | Opened the URL named in the brief and in the plan's owner steps | The upload wizard | 404 "Страница не найдена". The wizard is on `/bank` | 12-bank-upload-route-404.jpg | BUG 17 |
| B3 | `/bank` | Uploaded `p121-two-row-header.xlsx` | Layout recognised, bank, МФО, account, period, balances, lines, skipped rows with reasons | «Формат распознан: …п.121…», bank «АИКБ «Ипак Йули»… (МФО 00444)», account, 01.10–31.10.2026, 50 000 000,00 → 61 605 000,00, 6 operation rows, 9 skipped rows each with its reason (column numbers, continuation joined, page subtotal, footer, repeated header ×2, totals, closing balance) | 13-bank-p121-check-step.jpg, 14-bank-p121-skipped-rows.jpg | OK |
| B4 | `/bank` check step | Looked for the printed totals | Check step shows the bank's printed totals | Only the balances are shown. The printed totals appear only as a skipped row («Итого обороты · 4 645 000,00 · 16 250 000,00») and later on the reconcile page | 13 | UNCLEAR |
| B5 | `/bank/<id>` | «Прочитать выписку» | Batch with review grid, balance check | Batch opened, «Остаток сходится», 6 lines with operation, rule, status «Корректно», «Новый контрагент» | 15-bank-p121-review-grid-frame-scrolled.jpg | OK |
| B6 | `/bank/<id>` | Looked at the page at 1280 px | Page fits; the grid scrolls inside its own box | The review table (1506 px) makes the app frame `div.group/frame` scroll sideways (scrollWidth 1413 > 1280). A click into the grid scrolls the whole frame, so the sidebar is cut off | 15 | BUG 8 |
| B7 | `/bank/<id>` | «Подтвердить корректные» | 6 approved | Status «Подтверждено», «Готово к передаче в 1С: 6 подтверждённых строк» | 16-bank-p121-approved.jpg | OK |
| B8 | `/bank/<id>/reconcile` | Opened the reconcile page | Balanced; both totals shown and compared | 16 250 000,00 / 4 645 000,00, difference 0,00, «Остаток сходится», «Итоговая строка банка: Расход … (совпадает) · Приход … (совпадает)» | 17-bank-p121-reconcile.jpg | OK |
| B9 | `/bank/<id>` | «Подготовить для 1С» | Checks, and 1C warnings that say which line | 5 checks ✓, then «Проверка модуля 1С» with «Контрагент не проверен по справочнику» six times, with no counterparty name or line number | 18-bank-p121-prepare-1c.jpg | BUG 11 |
| B10 | `/bank/<id>` | «Файл для 1С», then fetched the file from «История передач» | kl_to_1c, cp1251, no BOM, CRLF, МФО padded | `kl_to_1c.txt` 4 517 B, `text/plain; charset=windows-1251`, no BOM, CRLF only, `ПлательщикБИК=00444` (written «444» in the file), `НазначениеПлатежа=00664 Договор…`, balances and totals in `СекцияРасчСчет` | — | OK |
| B11 | `/bank` | Uploaded the same p121 file again | Refused, with a link to the old statement | «Этот файл уже загружен (30.10.2026). Повторно прочитать нельзя» + «Открыть прежнюю выписку» | 19-bank-p121-reupload-same-file-refused.jpg | OK |
| B12 | `/bank`, reconcile | `colvir-statement.xls` (BIFF8) | Colvir layout, balanced, totals match | Recognised as Colvir, 72 lines, 50 skipped, 6 423,00 → 286 184,55, «Остаток сходится», both totals «совпадает» | 20-bank-colvir-xls-check-step.jpg | OK |
| B13 | `/bank` | `asbt-documents-pipe.zip` | ASBT document export from the zip, direction by own account | Recognised as ASBT, 4 lines, debit/credit right, «Остатки в файле не указаны» (none in this export). Approved and exported 4 lines | 21-bank-asbt-zip-check-step.jpg | OK |
| B14 | `/bank` | `asbt-documents-fixed.txt` (fixed width) | Same layout from fixed-width text | Recognised as ASBT, the same 4 payments | 22 | OK |
| B15 | `/bank/<id>` | Read the fixed-width file after the zip's 4 lines were **exported**: same period, same 4 payments | Re-upload of the same period creates zero new lines (or the lines are clearly "already in 1C" and nothing can be approved) | A new batch with 4 lines, each «Корректно» + «Есть и в другой выписке на проверке» (stale: the other batch is exported). «Подтвердить корректные» approved all 4; prepare showed «Готово к передаче в 1С: 4», every check ✓ including «Ранее переданные платежи не повторяются», and also «Уже передано в 1С» ×4. «Файл для 1С» → `409 {"code":"nothing_to_export","message":"Не удалось сохранить"}` | 22-bank-asbt-fixed-duplicates-flagged.jpg, 23-bank-reimport-ready-4-but-already-exported.jpg | BUG 2 |
| B16 | `/bank`, batch, reconcile | `ibank2-all-accounts.csv` (two own accounts) | One summary per account; reconcile per account | Recognised as iBank2. The check step and the batch header show only `40702810300180001774`. The reconcile adds both accounts' lines into one total (credit 12 502 516,13 = 2 516,13 from 2014 + 12 500 000 from 2026). No per-account block anywhere. Only the dry-run check «По каждому счёту остатки и обороты банка совпадают со строками» refers to accounts | 24-bank-ibank2-two-accounts-check.jpg | BUG 3 |
| B17 | `/bank` | iBank2 file re-encoded cp866 | Read by content, Cyrillic intact | Recognised as iBank2; «ОАО "Прогресс Парк"», «КЕМЕРОВСКИЙ ФИЛИАЛ…» readable | — | OK |
| B18 | `/bank` | Same file, UTF-8 with BOM | BOM not in the first header | First header «Счёт организации/Счет», text intact | — | OK |
| B19 | `/bank` | Same file with `~` as delimiter | `~` detected | Recognised, same columns | — | OK |
| B20 | `/bank` | HTML table saved as `.xls` | Read as a sheet | «Выписка (RU): дебет и кредит…», 1 line «ООО «Альфа»», «Оплата за товар» (the `<br>` joined) | — | OK |
| B21 | `/bank` | `statement.pdf` | Refused with a clear message | «PDF-выписку прочитать нельзя. Выгрузите её из интернет-банка в Excel, CSV/TXT или 1С (kl_to_1c.txt).» | 25-bank-pdf-refused.jpg | OK |
| B22 | `/bank` | `habr-245397.kl_to_1c.txt` (real kl_to_1c) | 1CClientBankExchange layout; bank name or empty | Recognised, 4 lines. The field «Банк» shows «1CClientBankExchange 1.02», which is the file's format line, not a bank. The same happens with Unact («…1.03») | 26-bank-habr-kl_to_1c-check.jpg | BUG 9 |
| B23 | `/bank/<id>/reconcile` | Read habr | The file's printed turnovers (68 770) do not match its 4 documents (SOURCES.md says so): reported, not hidden | Difference 250,00 in red; «Расход: 68 770,00 (не совпадает) · Приход: 68 770,00 (не совпадает)» | 27-bank-habr-reconcile-mismatch.jpg | OK |
| B24 | `/bank/<id>` | `unact-1.03-two-accounts.kl_to_1c.txt` (second real kl_to_1c) | Each account's section reconciles; balances shown | 12 lines (all «Сомнительно: Неверный МФО», expected for the Russian БИК). Header: «Остатки в файле не указаны» / «Faylda qoldiq koʻrsatilmagan», although both `СекцияРасчСчет` print `НачальныйОстаток=0.00 … КонечныйОстаток=0.00`. Only the first account is shown. The dry-run per-account check passes | — | BUG 3 |
| B25 | `/bank/<id>` (iBank2) | «Подтвердить все строки без ошибок» | All error-free lines approved, or a confirm dialog | Nothing changed («Ещё не подтверждено: 5»), no dialog, no message. Possibly by design, because 2 lines are «Сомнительно» | — | UNCLEAR |
| B26 | `/bank`, `/bank/<id>` (uz) | Switched to uz and scanned the page text | No raw keys, everything in uz | No raw keys, no `undefined`. The 8 built-in layout names stay Russian in the uz UI («Выписка (RU)…», «1CClientBankExchange (kl_to_1c.txt) банка», «Экспорт платёжных документов…»), also in the «Shakl aniqlandi: …» notice | 28-bank-uz-check-step-colvir.jpg | BUG 10 |
| B27 | `/bank` (settings part) | Looked at «Сохранённые форматы», «Встроенные форматы», «Правила операций» | New layouts listed, marked unverified | 8 built-in layouts, each «Не подтверждён»; none saved; no rules | 10 | OK |
| — | — | B3 restart-resume (S1) | — | Cannot be done from the browser (needs an API restart mid-processing) | — | skipped |

### Didox

| # | URL | What I did | Expected | Actual | Screenshot | Verdict |
|---|---|---|---|---|---|---|
| D1 | `/didox` (uz) | Opened without a Didox token | Clear "not connected" state, date field, no error page | «Didox ulanmagan. Ulanish sozlamalarida tokenni kiriting.», a date field «Shu sanadan keyin oʻzgarganlar», the fetch button disabled | 30-didox-list-uz-not-connected.jpg | OK |
| D2 | `/didox` | Uploaded `real-export-1428.zip` | One invoice added | «1 ta hisob-faktura qoʻshildi … Ochish» after about 10 s | 31 | OK |
| D3 | `/didox/<id>` | Opened it | Header, totals, lines, checks | Seller/buyer/contract, 892,86 + 107,14 = 1 000 UZS, 1 line with its code and checks, document-level «Sotuvchi kontragentlar roʻyxatida yoʻq» | 31-didox-real-zip-invoice-uz.jpg | OK |
| D4 | `/api/didox/invoices/<id>/pdf` | Fetched the print form behind «Yangi oynada ochish» | The PDF from the archive | 200, `application/pdf`, `inline; filename="didox-1428.pdf"`, 638 B (= the zip's `.pdf`), starts with `%PDF-` | — | OK |
| D5 | `/didox` | Uploaded the same ZIP again | Duplicate refused, link to the old one | «Bu hisob-faktura avval yuklangan. Avvalgisini ochish» | 32 | OK |
| D6 | `/didox` | `02-factura-full.json`, `05-get-document.json`, `07-hybrid-023.json` | Each added | 3 × «1 ta hisob-faktura qoʻshildi» | 32 | OK |
| D7 | `/didox` | `08-act-005.json` | Refused with its kind | «Bu hujjat hisob-faktura emas (dalolatnoma). Faqat hisob-fakturalar qabul qilinadi.» | 32-didox-act-refused-and-list.jpg | OK |
| D8 | `/didox/<id>` (02) uz and ru | Checks column | New S2 rule texts in uz and ru | «Imtiyoz bu MXIK uchun roʻyxatda yoʻq» / «Льготы нет в списке для этого ИКПУ», «Hujjat belgisi qatorlarga mos emas» / «Признак документа не совпадает со строками»; «Bosma shakl yoʻq (fayl yoki Excel orqali yuklangan)» | 33 | OK |
| D9 | `/didox/<id>` | Scrolled to a line | No sideways page scroll | Same frame overflow as B6 (frame scrollWidth 1360 at 1280 px; the «Muammolilar / Hammasi» toggle sticks out) | 33-didox-json02-new-rule-texts-frame-scrolled.jpg | BUG 8 |
| D10 | `/didox` | Uploaded the ЭСФ template xlsx (73 columns, 2 invoices) | Sheet step names the template preset | «ESF Excel: ustunlar va sarlavha — Didox ESF shabloni aniqlandi… haqiqiy xlsx bilan hali tekshirilmagan.», «Faylda 2 ta hisob-faktura · 3 ta qator» | 34-didox-esf-template-preset.jpg | OK |
| D11 | `/didox` | «Hisob-fakturani yaratish» | Invoices created and the result said | 2 invoices created (QA-EXL-1 2 352, QA-EXL-2 500). The sheet card just closes: no «Yuklash natijasi», no count. The button says "invoice" (singular) for 2 | 35-didox-template-two-invoices.jpg | BUG 14 |
| D12 | `/didox` | Background sync progress state | Progress while a sync runs | Needs a Didox token; the button is disabled without one | — | UNCLEAR |
| D13 | `/didox/settings` (uz) | Opened | Hosts, modes, token TTL explained; unverified note | All present; no raw keys | 36-didox-settings-uz.jpg | OK |
| D14 | `/didox/settings` | Didox's error text area | Didox's own words after a failed test | Appears only after a real call to Didox; not made (external service, no token) | — | UNCLEAR |
| D15 | `/didox*` (ru) | Read the unverified note in ru | Same wording family as the other modules | Didox says «Пробный режим. …», bank says «Тестовый режим: …», uz says «Sinov rejimida» for both | — | BUG 16 |

### Products

| # | URL | What I did | Expected | Actual | Screenshot | Verdict |
|---|---|---|---|---|---|---|
| P1 | `/products/import` | Read the page | Formats said once | Page header «Excel (.xlsx, .xls) или CSV», drop zone «…Старый файл .xls сначала сохраните как .xlsx» (the same shared drop zone as B1) | 40 | BUG 7 |
| P2 | `/products/import` | `onec-nomenclature.xlsx` | 1C preset maps the documented captions | «Шаблон 1C «Номенклатура»» (unverified notice). Код→Код 1C, Артикул, Код из классификатора→ИКПУ, Упаковка (ЭДО)→Код упаковки, Единица, Штрихкод, Ставка НДС | 40-products-onec-mapping.jpg | OK |
| P3 | same | Looked for «Полное наименование» | Kept or mapped | No field to map it to. The 1C file then writes the short name into «Полное наименование» («Масло Lactel 200 г», not «Масло сливочное Lactel 200 г») | 40 | BUG 12 |
| P4 | same, result | «Загрузить и проверить» | Checks done, readable texts | 3 «Корректно», 1 «Сомнительно» (the transport service) with an AI suggestion. In the ru UI the AI rationale is in Uzbek («Выбор AI: Ushbu kod…»); «Сохранить 4 товаров» (wrong plural, also «4 товаров» on `/products`) | 41-products-onec-result.jpg | BUG 13 |
| P5 | same | Before saving, read «В файл 1C войдёт…»; then «Сохранить … в каталог»; accepted the suggestion for row 3 | B5 gate: undecided rows stay out; saved clean rows go in | Before: «войдёт 0; не войдёт 4». After saving: 3. After accepting the suggestion: 4 | 41 | OK |
| P6 | same | «Подготовить для 1C», fetched the file | Sheets «Номенклатура» + «Услуги», Артикул, codes with leading zeros as text | `onec-nomenclature-nomenklatura.xlsx` (UTF-8 name in `filename*`), sheets «Номенклатура» (3 goods) and «Услуги» (transport), 10 columns A–J, Артикул LAC-200/LAC-400/BUT-KG, «00405001001106002» as text, «12%»/«Без НДС», «Товар»/«Услуга» | — | OK |
| P7 | same | Looked at «Код упаковки» for the rows without one (LAC-400, BUT-KG кг) | Package derived from the unit when empty (S3 §7.8) | Both empty in the 1C file and in the catalogue. Cannot tell whether no package qualified or derivation did not run | — | UNCLEAR |
| P8 | `/products` | Opened the drawer of «Масло Lactel 200 г» | Артикул and price in the drawer | Drawer shows ИКПУ, Код упаковки, Ед. изм., Штрихкод, Код 1C, Клиент, packages. No Артикул, price or VAT, though `GET /api/products` returns `"article":"LAC-200"` | 42-products-drawer-no-article-price.jpg | BUG 5 |
| P9 | `/products/import` | `magicstore-ikpu.csv` | Scientific code and lost leading zero detected | «ИКПУ сохранён в Excel как число и стал «4,05001E+14»…», «У ИКПУ потерян ведущий ноль: «405001001000000» (возможно, 00405001001000000)…», «2.30900100100000E+15» likewise; ID column → Артикул; duplicate with the catalogue named | 43-products-magicstore-leading-zero-scientific.jpg | OK |
| P10 | same | Read the proposed code for «Масло весовое» (lost leading zero) | The restored code `00405001001000000` offered | Proposed `02710999001000000` «Базовое масло» (petroleum base oil), 67 %, while the check text itself names the right code | 43 | BUG 6 |
| P11 | same | `moysklad-uz` (headers «ИКПУ (MXIK)», «Код упаковки ТАСНИФ», «Единицы измерения», «НДС», «Цена продажи») uploaded right after the 1C file | Vocabulary maps them (S3 task 1) | «Применено сопоставление прошлой загрузки.»: only Наименование and Штрихкод mapped; ИКПУ, package, unit, VAT, price «— не учитывать —». All 5 rows «Не решено · Нет ИКПУ». `POST /api/products/import/preview` answers `mappingSource:"remembered"`. Reproduced again later with a file whose headers are plain «ИКПУ», «Код упаковки», «Артикул»: all unmapped too | 47-products-moysklad-remembered-mapping-no-ikpu.jpg | BUG 1 |
| P12 | same | MoySklad again (one extra newline so it is a new file), columns chosen by hand | New checks run | 4 «Корректно», «Масло … (коробка)»: «Код упаковки 1498196 не относится к этому ИКПУ»; catalogue duplicates named | 44-products-moysklad-manual-mapping-package-check.jpg | OK |
| P13 | same | Uploaded the byte-identical MoySklad file with a corrected mapping | New check with the new mapping, or a message | Silently re-opened the old batch (`?duplicate=1`); the corrected mapping was dropped | — | UNCLEAR |
| P14 | same | `click-fiscal` | Click names mapped; unit and service checks | SPIC, PackageCode, Units, GoodPrice, VATPercent mapped. Transport in «кг»: «Единица «кг», код требует «xizmat»» (an uz unit word in the ru text), «…не привязана к этому коду», «Код услуги, но единица «кг»…» (three messages for one problem) | — | OK |
| P15 | same | `uz-cyrillic` | UZ Cyrillic headers; price decimals; duplicate row | Номи, МХИК коди, Қадоқ коди, Ўлчов бирлиги, Штрих коди, Нарх (ҚҚС билан), ҚҚС mapped. «В цене больше 2 знаков после запятой: «41 250,555» → 41250.56», «Повтор строки 1…», package not of code | — | OK |
| P16 | same | `uzum-seller` | SKU → Артикул; GTIN checks; two barcodes in a cell | Mapped. «Штрихкод не проходит контрольную цифру GTIN», «Штрихкод 4780042470127 есть и в строке 1», «…базовый код (11 цифр) другой — штраф за неверный ИКПУ», «Для штрихкода … есть свой идентификационный код». Row 5's suggestion shows the code where its name should be | 45-products-uzum-gtin-checks.jpg | OK |
| P17 | same | Row with internal barcode `2912347001566` | `barcode_internal` noted (S3 §7.16) | Row «Корректно», nothing said. It may be info-level and hidden | 45 | UNCLEAR |
| P18 | same | `buline-uz-latin` (as CSV) | uz Latin headers; leading zeros; EAN-8 | Ichki kod→Артикул, Nom, GTIN dona, MXIK, O'lchov birligi, Narx, QQS mapped. Leading zero lost ×3 detected. EAN-8 `47801271` → 02402001001001025 «…принадлежит именно этому коду» | — | OK |
| P19 | same, then `/api/products` | Second import of «Масло Lactel 200 г» with empty «Код упаковки» and «Артикул», box unticked; saved | Saved values kept | package `1497381` and article `LAC-200` kept. The product now carries a `package_missing` info issue although its package is kept | — | OK |
| P20 | `/products/import?batch=…` (uz) | Switched to uz | All text uz | The catalogue-duplicate reason was stored in Russian and shows in uz: «Katalogda bor: Масло Lactel 200 г — Совпадают ИКПУ и единица, наименование похоже (100%)» | 46-products-uz-empty-cells-ru-reason-text.jpg | BUG 13 |

### 1C

| # | URL | What I did | Expected | Actual | Screenshot | Verdict |
|---|---|---|---|---|---|---|
| O1 | `/onec` (uz) | Opened the list | All batches with status and "to 1C" count | 22 batches, filters by kind and status, «1C ga» counts | — | OK |
| O2 | `/onec/<uz-cyrillic batch>` | «Tekshirish», then «Faylni yaratish va yuklab olish» with no decision on the one valid record | Undecided record not exportable | «Faylga 0 ta yozuv kiradi»; the download answered «Yuboriladigan tasdiqlangan yozuv yoʻq» | 50-onec-gate-zero-records-raw-placeholders.jpg | OK |
| O3 | same | Read the notes column and «Ogohlantirishlar» | Filled-in texts | Notes: «Narxda 2 tadan ortiq kasr raqami: «{value}» → {rounded}» (ru: «В цене больше 2 знаков после запятой: «{value}» → {rounded}»). Warning: «Qoidalar hal qila olmadi: tekshiring × 1 count: 4», for records that are simply not approved | 50 | BUG 4 |
| O4 | same | «Tasdiqlash» on record 1, check, export | 1 record exported, the rest named | «Faylga 1 ta yozuv kiradi»; history: «Yuborildi: 1 · Oʻtkazildi: 3 · Tasdiqlanmagan: 3», `uz-cyrillic-nomenklatura.xlsx` | — | OK |
| O5 | same | Read the format description | Lists the 1C columns written | «nom, IKPU (Код из классификатора), qadoq kodi, birlik, shtrix-kod»: the 5 new columns (Артикул, Полное наименование, Ставка НДС, Цена, Вид номенклатуры) are not mentioned | 50 | BUG 15 |
| O6 | `/onec/settings` | Counterparties: «Вывести список»-style file with title rows, branches, an individual, a non-resident, 2 bad rows, МФО `1176` | Rows taken, bad rows listed by number, 4-digit МФО padded | 6 taken; «6-qator: STIR yoki JShShIR yoʻq (faqat norezidentga ruxsat)», «7-qator: STIR 9 raqam emas»; МФО shown `01176`; `00444` kept | 51-onec-settings-counterparties-mfo-padded.jpg | OK |
| O7 | same | Row numbers in the rejection list | The file's row number | "6-qator"/"7-qator" are the data-row ordinals; in the file (3 title rows + header) they are rows 10 and 11. The two branch rows of one ИНН look identical in the list (no branch code shown) | 51 | UNCLEAR |
| O8 | same | OData, base `http://10.255.255.1:8080/qa-base` | Plain-http warning | «Manzil http: login va parol tarmoqda shifrlanmasdan boradi. Imkon boʻlsa https manzilni kiriting.» | 52 | OK |
| O9 | same | «Ulanishni tekshirish» on the unreachable URL | A clear failure | «⊗ 10 soniyada javob yoʻq · Oxirgi tekshiruv: …» (`lastError: timeout`) | 52-onec-settings-unreachable-timeout-http-warning.jpg | OK |
| O10 | same | Base `http://localhost:4010` (not OData), test | A clear failure | «Manzil topilmadi (404)» | 53-onec-settings-localhost-404.jpg | OK |
| O11 | same | Composition-gaps text | Gaps listed with the 1C path | Needs a server that answers `$metadata`; the test fake server is not running and was not started | — | UNCLEAR |
| O12 | `/admin/features` → 1C «Yashirin»; then the files | Downloaded the bank kl_to_1c and the products xlsx through `/api/onec/exports/<id>/file` with 1C HIDDEN (after the 30 s cache) | Downloads still work; the rest of 1C closed | Both 200 (4 517 B, 8 190 B); `/api/onec/connection` 404, `/onec` 404; the bank page's 1C panel and its history link still work | — | OK |
| O13 | `/admin/features` | Set 1C back to «Yoqilgan» | ENABLED | All five modules ENABLED | — | OK |

### Landing and module pages

| # | URL | What I did | Expected | Actual | Screenshot | Verdict |
|---|---|---|---|---|---|---|
| L1 | `/` logged out (uz) | Fetched the page without cookies and scanned it; screenshots | Wording reads well; no raw keys or `undefined` | No raw keys, no `undefined`. The four module notes read correctly and say exactly what is unverified | 00-landing-uz-hero.jpg, 01-landing-uz-modules.jpg | OK |
| L2 | `/` | Looked at the module cards | One "sinov rejimida" per card | Bank card: badge «sinov rejimida» then text «Sinov rejimida: shakl…», Didox: badge then «Sinov rejimida. Hujjat…», the same words twice in a row | 01 | BUG 16 |
| L3 | `/` (ru) | Set `mxik_locale=ru` | A ru landing, if offered | The landing is Uzbek only (`components/landing/data.ts` imports the uz texts); ru cookie ignored. No ru landing to check | — | UNCLEAR |
| L4 | `/` FAQ | Read the bank answer | Matches the new formats | «Bankdan yuklab olingan Excel (.xlsx) yoki CSV. Eski .xls faylni Excelda .xlsx qilib saqlang.»: no .xls, TXT, kl_to_1c or ZIP | — | BUG 16 |
| L5 | 13 pages × uz and ru (`/`, `/bank`, batch, reconcile, `/didox`, invoice, settings, `/products`, import, import batch, `/onec`, batch, settings) | Scanned the server-rendered text for `xxxX.key` patterns, `undefined`, `NaN`, `{placeholder}` | None | None on any page. Placeholders appear only after client actions (O3). Unverified notes present on bank batch, Didox pages and 1C settings in both languages | — | OK |

## Bugs found (most severe first)

**1. High: Products import applies the previous import's column mapping to any file that shares its name column, which silently drops ИКПУ, package, unit, VAT and price.**
Reproduction: on `/products/import` import `products/fixtures/onec-nomenclature.xlsx` (columns «Наименование… Код из
классификатора, Упаковка (ЭДО)…»). Then upload `moysklad-uz.xlsx` (headers «Наименование, ИКПУ (MXIK), Код упаковки
ТАСНИФ, …»). The mapping step says «Применено сопоставление прошлой загрузки». Only Наименование and Штрихкод are
mapped, everything else is «— не учитывать —», and after «Загрузить и проверить» every row is «Нет ИКПУ». The same
happens with plain «ИКПУ / Код упаковки / Артикул» headers. `POST /api/products/import/preview` returns
`mappingSource: "remembered"`. Likely file: `packages/domain/src/products/import.ts:230-258` (`rememberedMapping`
takes the latest batch whose remembered *name* header is present, and `remembered ?? suggested.mapping` throws the
vocabulary guess away), with `import-map.ts:209` `resolveNamed`. A remembered mapping should only win for the same
header signature, or be merged with the guess for the fields it leaves at -1.

**2. Medium: Bank re-import of an already exported period lets the duplicates be approved, says "ready", then fails with a generic "save failed".**
Reproduction: upload `bank/fixtures/asbt-documents-pipe.zip`, «Подтвердить корректные», «Файл для 1С». Then
upload `asbt-documents-fixed.txt` (same 4 payments) and read it. The lines show «Есть и в другой выписке на
проверке» although the other statement is exported. «Подтвердить корректные» approves them. «Подготовить для 1С»
says «Готово к передаче в 1С: 4» with every check ✓ (including «Ранее переданные платежи не повторяются») and
«Уже передано в 1С» ×4. «Файл для 1С» → `409 nothing_to_export`, shown as «Не удалось сохранить». No double
export happens, so the data is safe; the screens contradict each other and the message is wrong. Likely
files: `packages/domain/src/bank/service.ts:~713-728` (every build error but `not_implemented` becomes
`e.saveFailed`), the `ready`/`approvedWhere` count (does not exclude lines already exported elsewhere), the
duplicate flag text in `bank/duplicates.ts` / `bank/store.ts:157`.

**3. Medium: Statements with two own accounts show one account, mix the totals, and say "balances not stated".**
Reproduction: upload `bank/fixtures/ibank2-all-accounts.csv`. Header and check step show only
`40702810300180001774`, and the reconcile sums both accounts. Upload
`onec/fixtures/bank-input/unact-1.03-two-accounts.kl_to_1c.txt`: «Остатки в файле не указаны», though each
`СекцияРасчСчет` prints its balances and turnovers. The per-account summaries (`extra.accounts`) are computed
(`bank/parse.ts:309,378` `accountSummaries`) and only reach the dry-run check `accounts_reconcile`. No UI shows
them: `apps/web/src/app/(app)/bank/[batchId]/page.tsx` and `…/reconcile/` need a per-account block.

**4. Medium: The 1C batch page shows unfilled message templates and raw parameters.**
Reproduction: import `uz-cyrillic` products (a price with 3 decimals), open `/onec/<batch>`. The notes column
shows «…«{value}» → {rounded}» (uz and ru). «Tekshirish» lists «Qoidalar hal qila olmadi: tekshiring × 1 count: 4»,
and the reason given (rules undecided) is wrong for records that are simply not approved. Likely files:
`apps/web/src/app/(app)/onec/review/columns.ts:123-136` (`issueLabel` returns the template without filling it;
`issueDetail` prints `key: value`), `review-grid.tsx:117,280`, `onec/[batchId]/export-panel.tsx:37-39`.

**5. Medium: The product drawer shows no Артикул, price or VAT.**
Reproduction: import `onec-nomenclature.xlsx`, save, open «Масло Lactel 200 г» on `/products`. There is no
Артикул (the API returns `article: "LAC-200"`) and no price or VAT rate. Likely files:
`apps/web/src/app/(app)/products/product-drawer.tsx` and the list contract (`packages/contracts/src/modules/products.ts`
has `article`; price/VAT are not in the list row).

**6. Medium: For a code that lost its leading zero, the proposed code ignores the restored code.**
Reproduction: import `products/fixtures/magicstore-ikpu.csv`. Row «Масло весовое» says «возможно,
00405001001000000», but «Предложенный код» is `02710999001000000` «Базовое масло» (67 %), which is petroleum base oil.
«Принять предложение» would write it. Likely: `products/classify.ts` / `products/checks.ts` (`mxik_leading_zero`).
When the padded code exists, it should be the suggestion (or at least a candidate) and not go to the matcher.

**7. Medium (bank) / low (products): The shared drop zone uses the catalogue's file filter and hint.**
Reproduction: `/bank`, press «Выбрать файл». The dialog filters to `.xlsx,.xls,.csv`, so `kl_to_1c.txt`, `.txt`
fixed-width files and `.zip` are hidden unless the user switches to "All files". The zone's text says .xls must
be saved as .xlsx, while the card above says .xls, TXT and ZIP are read. Likely:
`apps/web/src/app/(app)/_manage/file-drop.tsx` (uses `UPLOAD_ACCEPT` from `@/lib/catalogs/upload` and
`importX.select.formats`, `packages/i18n/src/i18n-parts/imports.ts:523`). It needs per-module `accept` and hint
props (bank: add `.txt,.zip`).

**8. Low: Wide review tables make the whole app frame scroll sideways.**
Reproduction: at 1280 px open `/bank/<batch>` or `/didox/<invoice>` and click a control inside the table. The frame
`div.group/frame` (scrollWidth 1413 / 1360 > 1280) scrolls left and the sidebar is cut off (screenshots 15, 22,
33). Likely: a missing `min-w-0` / `overflow-x-auto` on the content column of the app layout or on the review card.

**9. Low: For a bank's kl_to_1c, the "Bank" field shows the format line.**
Reproduction: upload `habr-245397.kl_to_1c.txt`. «Банк: 1CClientBankExchange 1.02» on the check step and the
batch header (Unact: «…1.03»). Likely: the title/meta reading for kl_to_1c inputs (`bank/documents.ts`,
`onec/bank-exchange.ts:239,275` read path). For this layout the bank should be empty or the `…Банк1` of the own account.

**10. Low: Built-in bank layout names are Russian-only in the uz UI.**
Reproduction: uz locale, `/bank`. «Ichki shakllar» lists «Выписка (RU)…», «iBank2: выписка в CSV…»,
«Экспорт платёжных документов…», also in «Shakl aniqlandi: …». Likely: `packages/domain/src/bank/formats/builtin.ts:102-183`
(names have no uz variant).

**11. Low: The 1C dry-run warnings repeat without saying which line.**
Reproduction: p121 statement → «Подготовить для 1С»: «Контрагент не проверен по справочнику» ×6, without names or
line numbers. Likely: `apps/web/src/app/(app)/bank/[batchId]/export-panel.tsx` (the `prepared.onec` issues list).

**12. Low: «Полное наименование» from a 1C file is lost.**
Reproduction: import `onec-nomenclature.xlsx`. The mapping has no field for «Полное наименование». The 1C file
then writes the short name into column G. Likely: `PRODUCT_FIELDS` in `packages/contracts/src/modules/products.ts:13`
and `onec/sheets.ts` (nomenclature).

**13. Low: Language and grammar slips in products.**
(a) «Сохранить 4 товаров», «4 товаров» (ru plural) on `/products` and the import result. (b) AI rationale in Uzbek
on the ru UI («Выбор AI: Ushbu kod…»). (c) «Единица «кг», код требует «xizmat»» (uz unit word in the ru text).
(d) The catalogue-duplicate reason is stored in the import's language and shown in Russian on the uz UI
(«Katalogda bor: … — Совпадают ИКПУ и единица…»). Files: `packages/i18n/src/i18n-parts/products.ts` (plural forms),
the duplicate reason built in `products/import.ts` (store a code + params, not text).

**14. Low: Creating invoices from the ЭСФ template gives no feedback.**
Reproduction: upload the template xlsx on `/didox`, press «Hisob-fakturani yaratish». The card closes and the
invoices appear in the list, but there is no «Yuklash natijasi» with the count. The button label is singular for a
file with 2 invoices. Likely: `apps/web/src/app/(app)/didox/intake.tsx`.

**15. Low: The 1C nomenclature format description is out of date.**
`/onec/<products batch>` → «1C ga tayyorlash» lists five columns. The file now has ten (Артикул, Полное
наименование, Ставка НДС, Цена, Вид номенклатуры). File: the onec i18n part for the nomenclature format hint
(`packages/i18n/src/i18n-parts/onec.ts`).

**16. Low: The "unverified" wording repeats itself and is uneven across modules.**
(a) Landing bank and Didox cards: the badge «sinov rejimida» is followed by text starting «Sinov rejimida…».
(b) Landing FAQ, bank answer: «Excel (.xlsx) yoki CSV. Eski .xls faylni Excelda .xlsx qilib saqlang.», stale after
B2 (`apps/web/src/components/landing/faq.tsx:102`). (c) ru: Didox «Пробный режим.» vs bank «Тестовый режим:» for
the same uz «Sinov rejimida» (`i18n-parts/didox.ts:281`, `i18n-parts/bank.ts:400`).

**17. Low (docs): `/bank/upload` does not exist.**
The plan's owner steps ("upload … on `/bank/upload`", S1 results and Integration results step 1) point to a 404;
the wizard is on `/bank`. Fix the doc or add a redirect.

## Still open (UNCLEAR) and the one step that settles each

- B4 printed totals on the check step: decide whether the check step should show them. Today they show only on reconcile.
- B25 «Подтвердить все строки без ошибок» did nothing on a batch with 2 doubtful lines: read its intended rule.
- D12, D14 Didox sync progress and Didox's error text: need a sandbox token (plan, owner step 5).
- P7 package derivation: open a product whose package was empty and whose code has a plain-unit package, check the stored `packageCode`.
- P13 identical file re-upload re-opens the old batch and drops a changed mapping: confirm this is intended and say so on screen.
- P17 internal barcode `2…` not reported: check whether `barcode_internal` is info-level by design.
- O7 counterparty rejection row numbers: say "row N of the file" or count from the header.
- O11 OData composition gaps: run `onec/fixtures/odata/fake-server.ts` or a real base and press "Test".
- L3 ru landing: confirm the landing is meant to be Uzbek only.

## State left behind

Created on the dev DB `mxik` in org "AI Match Test (test)" (no other org touched):
- 7 bank statements (p121, colvir, asbt zip, asbt fixed, ibank2, habr, unact; the refused re-uploads created nothing). Two kl_to_1c exports (p121, asbt zip).
- 6 Didox invoices (real zip, 02, 05, 07, template ×2).
- 9 product catalogue imports (onec-nomenclature, magicstore, moysklad ×2, click, uz-cyrillic, uzum, buline, empty-cells); 2 nomenclature exports (onec-nomenclature, uz-cyrillic); the catalogue products saved from them.
- 6 counterparties «QA …» for client "AI Match Test (test)".
- 1C connection: kind set back to «Только файлы». The test base URL `http://localhost:4010`, the username `qa-user` and
  a dummy password remain stored on the connection record; they are unused while the kind is "files only".
- `/admin/features`: 1C was HIDDEN for about 2 minutes, then set back to ENABLED. All five modules are ENABLED.
- The account's language is back to ru; the QA helper data in the browser's localStorage was removed.
