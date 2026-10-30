# Product fixtures: where each file comes from

Research behind them: `tmp/real-docs/products/RESEARCH.md` (30 Oct 2026, gitignored; every claim with
its URL) and the plan `docs/DOCUMENTS_REAL_DATA_PLAN_2026-10-30.md` (S3). Tests:
`real-data.test.ts` (no database) and `import-real.test.ts` (database).

## `tasnif/` — real answers of tasnif.soliq.uz (GET, no auth, captured 2026-10-30)

Base `https://tasnif.soliq.uz/api/cls-api`. Copied byte for byte from `tmp/real-docs/products/samples/`
except where "changed" says otherwise. `tasnifFixtureFetch()` (`test-fixtures.ts`) serves them; an
unrecorded code answers 403 with an empty body, as the live API did for `02520001006000000`,
`03304001011000000`, `99999999999999999` and a 16-digit code.

| File | Request | Changed |
|---|---|---|
| `by_mxik_00405001001106002.json` | `/mxik/get/by-mxik?mxikCode=00405001001106002&lang=ru` (Lactel butter 200 g, 2 packages) | `createdBy` of the operator-created package: a staff member's name replaced by `OPERATOR` |
| `by_mxik_00405001001000000.json` | `/mxik/get/by-mxik?mxikCode=00405001001000000&lang=ru` (butter base code, 72 packages) | — |
| `by_mxik_02309001001000000.json` | `/mxik/get/by-mxik?mxikCode=02309001001000000&lang=ru` (pet food base code) | **trimmed**: of 476 packages, the 13 plain-unit packages and the first 12 others are kept (261 KB → 14 KB) |
| `by_params_gtin_4780042470127.json` | `/mxik/search/by-params?gtin=4780042470127` (hit: 00405001001106002) | — |
| `by_params_gtin_4780083550024.json` | `/mxik/search/by-params?gtin=4780083550024` (hit: 03304020001027003) | — |
| `by_params_gtin_unknown.json` | `/mxik/search/by-params?gtin=<unknown>` → `success:false, code:-1, "not data found"` | — |
| `by_params_mxik_00405001001106002.json` | `/mxik/search/by-params?mxikCode=00405001001106002` | — |
| `by_params_mxik_02520001006000000.json` | `/mxik/search/by-params?mxikCode=02520001006000000` (a code gone since 2022: empty page) | — |
| `by_params_barcode_4780042470127.json` | `/mxik/search/by-params?barcode=4780042470127` (parameter ignored: the default page) | — |
| `by_params_text_sigaret.json` | `/mxik/search/by-params?text=sigaret` (EAN-8 GTINs `47801271`, `47802322`, `label:1`) | — |
| `units_all.json` | `/integration-mxik/references/get/units/all` (10 rows, `recordTotal: 90`) | — |
| `units_all_pageSize.json` | `/integration-mxik/references/get/units/all?pageSize=100&limit=100` (all 90) | — |
| `units_all_lang_ru.json` | `/integration-mxik/references/get/units/all?lang=ru` (10 rows, Russian names) | — |
| `brand_short_info_attribute_00405001001106.json` | `/brand/short-info-attribute?brandCode=00405001001106` (200 g and 400 g leaf codes with GTINs) | — |

`card-03004413004009066.json` and `history-03004413004009066.json` are the 2026-10-23 recordings
(docs/accounting-2026-10-23/tasnif-catalog.md).

## Product files — documented header rows, built cell values (`make-fixtures.ts`)

No real product Excel could be downloaded (Telegram attachments, cabinet-only templates; research §6).
Each file's **header row** is copied from one documented source; the **cell values** are built: the
real codes, packages and GTINs of the tasnif answers above, generic product names, invented prices and
article codes, and the damage the checklist asks for. No person or company data. Regenerate with
`npx tsx packages/domain/src/products/fixtures/make-fixtures.ts`.

| File | Header row from | Damage / cases inside |
|---|---|---|
| `moysklad-uz.xlsx` | MoySklad Uzbek card https://support.moysklad.ru/hc/ru/articles/19770742552978 (`ИКПУ (MXIK)`, `Код упаковки ТАСНИФ`, `Штрихкод ТАСНИФ`, `Фасовка`, `Тип учета`) and import https://support.moysklad.ru/hc/ru/articles/115006434208 (`Наименование`, `Штрихкод`, `Единицы измерения`, `НДС` as a number); `Цена продажи` is MoySklad's default price type name | `без НДС`; empty package (derive from kg); the brand code's box package on the base code |
| `onec-nomenclature.xlsx` | 1C captions, onec RESEARCH §1.2 / §8.7 (`Код`, `Наименование`, `Полное наименование`, `Артикул`, `Единица измерения`, `Ставка НДС`, `Штрихкод`, `Код из классификатора`, `Упаковка (ЭДО)`) | two caption rows and a blank row above the header (onec §8.17); a service code (`10112008001000001`) with unit `услуга` and `Без НДС` |
| `buline-uz-latin.xlsx` | buline.uz https://buline.uz/blog/avtomatlashtirish/mahsulot-nomenklaturasi-va-kodlash (`Ichki kod`, `Nom`, `GTIN, dona`, `GTIN, quti`, `MXIK`, `O'lchov birligi`) plus `Narx`, `QQS` from the §4 common vocabulary | MXIK stored as **number cells** (leading zeros lost; `10112008001000001` becomes `10112008001000000` in a double); QQS as Excel percent values (`0.12`) |
| `uz-cyrillic.xlsx` | §4 common vocabulary (`Nomi`, `MXIK kodi`, `Qadoq kodi`, `Oʻlchov birligi`, `Shtrix kod`, `Narx`, `QQS`) written in Uzbek Cyrillic, plus `Т/р` | `ҚҚС 12%`, `ҚҚСсиз`; a package of another code; a price with three decimals; a repeated row |
| `uzum-seller.xlsx` | Uzum seller card https://seller.uzum.uz/manual/5.product-creation/ (18 fields in the documented order) | two barcodes in one cell; a weighed-goods `29…` label; a GTIN with a wrong check digit; the Lactel GTIN under the sugar code (base mismatch) and under the base butter code (brand code exists) |
| `click-fiscal.xlsx` | Click fiscal item https://docs.click.uz/en/fiscalization/ and https://github.com/shaxzodbek-uzb/pay-uz (`Name`, `SPIC`, `PackageCode`, `GoodPrice`, `Price`, `Amount`, `VAT`, `VATPercent`, `Units`); `Units` values are unit names here (the docs do not say what the field holds) | `GoodPrice` in tiyin; a service counted in kg |
| `magicstore-ikpu.csv` | magicstore.ai https://magicstore.ai/ru/docs/catalog/ikpu (`ID`, `Название`, `ИКПУ`, `Код упаковки`), saved as `;`-separated CSV the way Excel saves it | `4,05001E+14` and `2.30900100100000E+15` (scientific notation, comma and dot locales); `405001001000000` (leading zeros lost) |

The weighed-goods label `2912347001566` follows the layout research §3 quotes ("29 + item + weight +
check"); the quoted example `2912347001562` has a check digit that fails GS1 mod 10, so the check digit
is recomputed.
