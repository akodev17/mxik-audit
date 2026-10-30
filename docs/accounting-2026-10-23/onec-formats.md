# 1C formats Tasnivo writes (Agent 1, 23 Oct 2026)

Every 1C file and the direct transfer go through `packages/domain/src/onec/` (plan §4.3: one
place). Code: `bank-exchange.ts` (text format), `sheets.ts` (all spreadsheets), `files.ts` (a plan's
records → a file), `connection.ts` / `transfer.ts` (OData). Golden files: `packages/domain/src/onec/
fixtures/` (`UPDATE_GOLDEN=1 npx tsx --test packages/domain/src/onec/formats.test.ts` regenerates
them after a deliberate change; review the diff).

Status legend: **verified** = checked against the official specification and by our own tests;
**unverified** = no real 1C (or sample from one) has read it yet. Nothing below has been loaded
into a real «1С:Бухгалтерия для Узбекистана» yet: the owner must do that once per format (§6).

| Format (`ONEC_FORMATS`) | For which batches | 1C entry point | File | Status |
|---|---|---|---|---|
| `bank_exchange_1_02` | bank statements (primary) | «Банк и касса → Банковские выписки → Загрузить» | `kl_to_1c.txt`, windows-1251 | Russian 1C standard followed key by key; Uzbek key set unverified |
| `receipt_xlsx` | Didox invoices (primary) | «Поступление товаров и услуг» from a spreadsheet | `postuplenie-<номер>-<дата>.xlsx` | unverified (no documented UZ loader for it) |
| `nomenclature_xlsx` | product catalogues (primary); invoices (side file) | «Номенклатура → Загрузить из файла» / «Загрузка из табличного документа» | `<file>-nomenklatura.xlsx` | attribute names verified from 1c.uz letter №32589; loader mapping unverified |
| `counterparties_xlsx` | statements and invoices (side file) | «Контрагенты» from a spreadsheet | `<file>-kontragenty.xlsx` | unverified |
| `odata` | all (transfer) | OData standard interface | none | implemented, tested against a fake server only |
| `http` | — | an HTTP service of the client's base | — | connection test only; transfer answers `http_transfer_unsupported` |

A **primary** format (and `odata`) marks the records that went `exported`, writes `outcome`
`imported`/`skipped` on every considered record, and moves the batch to `exported`. A **side
file** only adds a row to the export history.

## 1. `bank_exchange_1_02`: 1CClientBankExchange 1.02

Source: «Стандарт обмена с системами Клиент банка», v8.1c.ru formats page (research note §2,
"Verified (official)"). Encoding `Кодировка=Windows` = windows-1251; lines end in CRLF; one
`key=value` per line; values never contain a line break (purposes are joined into one line).
Characters windows-1251 lacks are folded (`ғ→г`, `қ→к`, `ў→у`, `ҳ→х`, `ʻ ʼ ‘ ’ → '`), so Uzbek
Cyrillic names lose their special letters in this file (the 1C client-bank format cannot carry them).

```
1CClientBankExchange
ВерсияФормата=1.02
Кодировка=Windows
Отправитель=Tasnivo
Получатель=1С:Бухгалтерия для Узбекистана
ДатаСоздания=23.10.2026          (Tashkent time)
ВремяСоздания=16:59:27
ДатаНачала=01.10.2026            (statement period, else the first/last payment date)
ДатаКонца=07.10.2026
РасчСчет=20208000900100001001    (the statement's own account)
Документ=Платежное поручение
СекцияРасчСчет
ДатаНачала=… ДатаКонца=… РасчСчет=…
НачальныйОстаток=12500000.00     (only when the statement printed it AND every record is in the file)
ВсегоПоступило=30870000.00       (computed from the documents in the file)
ВсегоСписано=15425500.00
КонечныйОстаток=27944500.00      (printed one, else opening + in − out; same condition as above)
КонецРасчСчет
СекцияДокумент=Платежное поручение          (one per payment, by date then row)
Номер=101                        (docNumber, else the bank reference, else the row number)
Дата=01.10.2026
Сумма=15000000.00                (dot, two decimals)
ПлательщикСчет=…
ДатаСписано=…                    (outgoing payments only: value date, else the date)
Плательщик=…   ПлательщикИНН=…   Плательщик1=…   ПлательщикРасчСчет=…   ПлательщикБанк1=…
ПлательщикБИК=<МФО>
[ПлательщикМФО=<МФО>]            (bankKeys = uz_mfo only)
ПолучательСчет=…
ДатаПоступило=…                  (incoming payments only)
Получатель=…   ПолучательИНН=…   Получатель1=…   ПолучательРасчСчет=…   ПолучательБанк1=…
ПолучательБИК=<МФО>
[ПолучательМФО=<МФО>]
ВидОплаты=01
НазначениеПлатежа=…
КонецДокумента
КонецФайла
```

**Encoding and identity (S4, 30 Oct 2026).** `ExchangeFile.encoding` writes `Кодировка=Windows`
(cp1251, the default) or `Кодировка=DOS` (cp866) and the bytes follow it, never with a BOM; our
reader picks the code page by that key, and `kl-to-1c-conformance.test.ts` builds and re-reads both.
1C knows a document by (РасчСчет, вид, Дата, Номер) and takes a repeat for the same one («Документ
уже загружен»), so a number the bank used twice on one day gets a suffix (`58`, `58-2`): no payment
is lost.

**Operation, ДДС item and contract (B4).** The 1CClientBankExchange standard has **no field** for
the operation (ВидОперации), the cash-flow item or the contract: the 1C loader decides the operation
itself from its exchange settings («Настроить обмен с банком»: the ДДС item and the group for new
counterparties; the «По ключевым словам» rules, 3.0.57), an incoming payment from a counterparty
typically becoming «Оплата от покупателя». So what the reviewer chose in Tasnivo does not travel in
`kl_to_1c.txt`; the contract number stays inside `НазначениеПлатежа` as the bank printed it. It
reaches 1C through the OData transfer (§5: `ВидОперации`, `СтатьяДвиженияДенежныхСредств_Key`,
`ДоговорКонтрагента_Key`), or the accountant sets it in 1C after the load. No non-standard key is
invented for it.

The statement owner's side of each payment comes from `BankStatementMeta.ownerName / ownerInn /
mfo / bankName` (added to the contract by Agent 1; the bank workstream fills them when the bank
file prints them), else the client's name (or the org's). A payment without a counterparty (a
bank fee) is written with empty payee keys and the warning is left to 1C («Создать ненайденное»);
no counterparty is invented.

### The Uzbek-edition question (unknown)

The research note (§2 "Unknown" 1) found no public description of which keys the Uzbek edition's
«Обмен с банком» reads. Two variants are therefore produced, per org (`OneCConnection.bankKeys`,
on `/onec/settings`):

- `standard` (default): exactly the Russian keys. The 5-digit МФО is written where the standard
  has the bank code (`ПлательщикБИК` / `ПолучательБИК`). This is what a client-bank program would
  emit if it reused the Russian format.
- `uz_mfo`: the same plus `ПлательщикМФО` / `ПолучательМФО`. 1C ignores keys it does not know, so
  this variant is safe if the Uzbek edition reads `БИК`, and right if it reads `МФО`.

**How to settle it (owner):** in a client's 1C, «Банк и касса → Банковские выписки → Ещё →
Обмен с банком → Отправка в банк» exports a `1c_to_kl.txt`; or take any `kl_to_1c.txt` a bank
produced for that client. Put it in `packages/domain/src/onec/fixtures/real-<bank>.txt` and run
`parseBankExchange` on it (decoding by its own `Кодировка`, DOS/cp866 too): the key list shows
which MFO key the edition uses, and the round-trip test can then compare our file with theirs.
Then load one of our files with «Загрузить» in a test base and record the result here.

## 2. `nomenclature_xlsx`

Sheet «Номенклатура», one row per distinct product (same name, code, package and barcode once):

| Наименование | Код из классификатора | Код упаковки | Единица измерения | Штрихкод | Артикул |
|---|---|---|---|---|---|

«Код из классификатора» (the ИКПУ / MXIK, 17 digits) and «Код упаковки» are the attribute names
the Uzbek family verifiably uses (1c.uz info letter №32589, research note §2). Codes, packaging
codes and barcodes are text cells (leading zeros and all 17 digits survive). `Артикул` is empty:
no workstream carries an article number yet. For an invoice the line's decided product
(`InvoiceLine.resolved`) wins over what the invoice printed.

## 3. `receipt_xlsx`

One sheet per invoice (named `<номер> <дата>`): a header block (Поставщик, ИНН поставщика,
Покупатель, ИНН покупателя, Номер счета-фактуры, Дата, Договор `<№> от <дата>`, Валюта), a blank
row, then the lines `№ | Наименование | ИКПУ | Код упаковки | Ед. | Количество | Цена | Сумма |
Ставка НДС | Сумма НДС | Всего` (numbers as number cells, codes as text), and an «Итого» row
computed from the lines in the file. A typical 1C «Загрузка из табличного документа» into the
document's «Товары» table maps these columns by hand; whether the Uzbek edition has a ready
loader for «Поступление» from a file is unknown (research note §2 "Unknown" 3).

## 4. `counterparties_xlsx` (and the import of the same columns)

Sheet «Контрагенты»: `Наименование | ИНН | Расчетный счет | МФО | Банк`. The import
(`POST /api/onec/counterparties/import`, `/onec/settings`) reads a 1C «Контрагенты» list saved
to Excel with «Ещё → Вывести список» (any subset of the list's columns, the header on any of the
top 30 rows under a title or filter line) or this file. Captions, ru / uz / en: Наименование /
Полное наименование / Nomi; Код; ИНН / ИНН/ПИНФЛ / STIR; ПИНФЛ / JShShIR; Регистрационный код
плательщика НДС; Код филиала; Вид контрагента; Расчетный счет / Hisob raqami; МФО / Код банка / БИК;
Банк. Requisites (`onec/requisites.ts`, S4): ИНН 9 digits, ПИНФЛ 14 (an individual, stored in the
same column), VAT code 12, account 20 (27 for a budget «Бюджетный ЛС»), МФО 5 — an МФО Excel stored
as a number (`444`) gets its zeros back (`00444`, B8). A bad ИНН / ПИНФЛ, or a legal entity or an
individual without one, keeps the row out (`inn_invalid`, `pinfl_invalid`, `inn_required`); only a
non-resident may have none. A bad account, МФО or VAT code drops that field and is listed. Two rows
with one ИНН and different «Код филиала» are two counterparties (1C UZ 3.0.62); the 1C «Код» is kept
as `onecRef`. Columns `kind`, `branchCode`, `vatCode` on `counterparty`: migration
`20261109000400_counterparty_requisites`.

## 5. Direct connection (`odata`)

Settings per org (`onec_connection`): kind (`none` / `odata` / `http`), base URL, user, password
(sealed with AES-256-GCM under a key derived from `SESSION_SECRET`, like the 2FA secrets; never
answered or logged), object map, last test. In production a host resolving to a private address
is refused unless `ONEC_ALLOW_PRIVATE_HOSTS=1` (a self-hosted install next to the client's 1C).

- **Test** (`POST /api/onec/connection/test`): `GET <base>/odata/standard.odata/$metadata`
  (1C:Fresh documents this path, research note §2), Basic auth, 10 s timeout, no redirects. Answers
  `ok`, `auth_failed`, `not_found`, `redirected`, `http_<status>`, `timeout`, `unreachable[:code]`,
  `not_odata`, the number of entity sets, the configured entity sets the base lacks, and (S4) every
  gap of the composition for the object map (`problems`: `set_missing`, `attribute_missing`,
  `part_missing`, `ref_missing`, each `required` or not), the names this base uses where an
  alternative was found (`resolved`), and `insecure` for a plain-http base. The settings page lists
  them with the 1C path to fix them («Настройки стандартного интерфейса OData → Состав»,
  «Загрузить метаданные» after a 1C update).
- **Client** (`onec/odata.ts`, S4, research note onec §5 and checklist §8.25–34):
  - names are read from `$metadata` (kept 10 minutes per base and user, parsed once per SHA-256 of
    the document), never assumed: `Catalog_КлассификаторЕдиницИзмерения` or `Catalog_ЕдиницыИзмерения`;
  - a required set, attribute or tabular part the composition lacks refuses the transfer before
    anything is written (`composition_incomplete` with the list): 1C ignores unknown properties, so
    writing anyway would lose data silently; a 403 is reported as "object or new attribute not
    published, or no rights", not as a wrong password;
  - nothing is followed on a redirect (an http→https hop turns a POST into a GET); http works, with
    the warning;
  - a document is created with its tabular part in ONE POST, `Ref_Key` stripped from the document
    and every row (a row's own key leaves the table empty, mista 828664), the answer's rows are
    counted, and a tabular part's own set (`Document_X_Товары`, error 13) is never written;
  - documents are created unposted; `Post()` is a separate call when the target's `post` is on,
    and its 500 is kept as 1C's own refusal on the record (the document stays, unposted);
  - an update re-reads `DataVersion`, PATCHes with `If-Match` and the whole tabular part; a 412
    reads again and retries (3 times);
  - "delete" is `DeletionMark: true` by PATCH; the client has no DELETE;
  - lists page with `$top/$skip/$inlinecount=allpages` ordered by `Ref_Key`, folders and deleted
    items out, and ask again with `allowedOnly=true` after a 401;
  - references are looked up (`<key> eq '…'`, contracts under their counterparty's `Owner_Key`) and
    written as `X_Key` or, for a composite attribute, `X` + `X_Type`; a composite one is filtered
    with `cast(guid'…', 'Catalog_X')`; dates are `datetime'YYYY-MM-DDTHH:MM:SS'` without a zone,
    `LineNumber` a string, numbers numbers.
- **Transfer** (`POST /api/onec/batches/{id}/transfer`): only records a reviewer approved (B5). One
  document per payment or product (an invoice is one receipt with its lines), 4 at a time. 2xx →
  `imported` with `Ref_Key` as `onecRef` and, in `message`, what was left out (a reference not
  found, a refused posting); otherwise `rejected` with the reason (`onec_refused`, `onec_<code>` for
  1C's internal codes 0–20, `forbidden_or_not_published`, `redirected`, `rows_lost`,
  `nomenclature_missing` with the line numbers, `timeout`, …) and 1C's message. A refused record
  keeps its status and goes again on retry; one that timed out is first looked up in the base
  (number, date, counterparty) so it is not written twice. A corrected or additional ЭСФ
  (`facturaType` ≠ 0 with `oldFactura`) PATCHes the receipt made for the one it corrects (found in
  Tasnivo's own transfers, else in the base) instead of creating a second; a high-risk one
  (`riskLevel: 'high'`) gets the VAT account 4410.11 on every line and says so in `Комментарий`;
  quantities keep 6 decimals, money 2, the header total is the ЭСФ's own; marking codes go one row
  per code with the goods line's number.
- **Default object map** (`DEFAULT_OBJECT_MAP`, editable per org; typical BP 3.0 names, unverified
  against a UZ base): bank credit → `Document_ПоступлениеНаРасчетныйСчет`, bank debit →
  `Document_СписаниеСРасчетногоСчета` (`Date`, `НомерВходящегоДокумента`, `ДатаВходящегоДокумента`,
  `СуммаДокумента`, `НазначениеПлатежа`, `ВидОперации` by value name from the reviewed operation —
  `payment_in` → `ОплатаПокупателя`, `tax` → `ПеречислениеНалога`, … —, `Комментарий`; references
  `Контрагент` by ИНН, `ДоговорКонтрагента` by number under that counterparty,
  `СтатьяДвиженияДенежныхСредств` by name, `СчетОрганизации` by account number); invoice →
  `Document_ПоступлениеТоваровУслуг` (+ `Товары`: `Количество`, `Цена`, `Сумма`, `СтавкаНДС`
  (`НДС12`/`НДС15`/`НДС0`/`БезНДС`), `СуммаНДС`, `Номенклатура` by name, `СчетУчетаНДС` for a
  high-risk ЭСФ; `КодыМаркировки` when published); product → `Catalog_Номенклатура` (`Description`,
  `НаименованиеПолное`, `Артикул`, `ЕдиницаИзмерения` by name). Tested against a fake server built
  from real saved responses (`onec/fixtures/odata/SOURCES.md`); the `$metadata` there is constructed.
  That is why the UI still says "not verified against a real 1C".

## 6. What the owner must provide to verify

1. One bank statement exported from a client's 1C (or a bank's `kl_to_1c.txt` for that client):
   settles the МФО keys and becomes a second golden file.
2. A test base of «1С:Бухгалтерия для Узбекистана 3.0» (local or clobus.uz) where our
   `kl_to_1c.txt`, `nomenclature_xlsx` and `receipt_xlsx` can be loaded once, with a screenshot of
   the result.
3. For the direct route: an OData-published base (URL), a user with «УдаленныйДоступOData» or full
   rights, and permission to create test documents. First step: run the connection test on
   /onec/settings and save the base's `$metadata` (`<base>/odata/standard.odata/$metadata`) into
   `packages/domain/src/onec/fixtures/odata/` in place of the constructed one; the listed gaps and
   renamed sets show at once which names of the default map are wrong for that base.
