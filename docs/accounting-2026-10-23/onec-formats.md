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
to Excel by its header words (ru, uz and en variants: Наименование / Полное наименование /
Контрагент / Nomi; ИНН / ПИНФЛ / STIR; Расчетный счет / Р/с / Hisob raqami; МФО / Код банка / БИК;
Банк). ИНН must be 9 or 14 digits (else the row is listed as `inn_invalid`), accounts 20, МФО 5.

## 5. Direct connection (`odata`)

Settings per org (`onec_connection`): kind (`none` / `odata` / `http`), base URL, user, password
(sealed with AES-256-GCM under a key derived from `SESSION_SECRET`, like the 2FA secrets; never
answered or logged), object map, last test. In production a host resolving to a private address
is refused unless `ONEC_ALLOW_PRIVATE_HOSTS=1` (a self-hosted install next to the client's 1C).

- **Test** (`POST /api/onec/connection/test`): `GET <base>/odata/standard.odata/$metadata`
  (1C:Fresh documents this path, research note §2), Basic auth, 10 s timeout, no redirects. Answers
  `ok`, `auth_failed`, `not_found`, `http_<status>`, `timeout`, `unreachable[:code]`, `not_odata`,
  the number of entity sets, and which configured entity sets the base lacks.
- **Transfer** (`POST /api/onec/batches/{id}/transfer`): one `POST <base>/odata/standard.odata/
  <EntitySet>?$format=json` per payment or product (an invoice is one document with its lines in
  the `linesPart` table), 4 at a time, 10 s each. 2xx → `imported` with `Ref_Key` as `onecRef`;
  otherwise `rejected` with `onec_refused` / `auth_failed` / `timeout` and 1C's
  `odata.error.message.value`. A refused record keeps its status, so the next transfer sends it
  again ("retry"); the batch becomes `exported` when nothing was refused.
- **Default object map** (editable per org; typical names of БП для Узбекистана 3.0, third-party
  source, unverified): bank credit → `Document_ПоступлениеНаРасчетныйСчет`, bank debit →
  `Document_СписаниеСРасчетногоСчета` (fields `Date`, `НомерВходящегоДокумента`,
  `ДатаВходящегоДокумента`, `СуммаДокумента`, `НазначениеПлатежа`), invoice →
  `Document_ПоступлениеТоваровУслуг` (+ table `Товары`: `Количество`, `Цена`, `Сумма`, `СуммаНДС`),
  product → `Catalog_Номенклатура` (`Description`, `НаименованиеПолное`). References
  (`Контрагент_Key`, `Номенклатура_Key`, `БанковскийСчет_Key`, `ВидОперации`) are **not** filled:
  resolving them needs reads against the client's base that no real 1C has been available for.
  Expect 1C to refuse such documents until the map and the reference lookups are completed against
  a real base. That is why the UI says "not verified against a real 1C".

## 6. What the owner must provide to verify

1. One bank statement exported from a client's 1C (or a bank's `kl_to_1c.txt` for that client):
   settles the МФО keys and becomes a second golden file.
2. A test base of «1С:Бухгалтерия для Узбекистана 3.0» (local or clobus.uz) where our
   `kl_to_1c.txt`, `nomenclature_xlsx` and `receipt_xlsx` can be loaded once, with a screenshot of
   the result.
3. For the direct route: an OData-published base (URL), a user with «УдаленныйДоступOData» or full
   rights, and permission to create test documents.
