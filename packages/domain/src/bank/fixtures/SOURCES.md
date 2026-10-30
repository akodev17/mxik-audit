# Bank statement fixtures: where each one comes from

No Uzbek bank publishes a statement file (bank research, `tmp/real-docs/bank/RESEARCH.md` §2, §5
"Not obtained": every Uzbek internet bank keeps its exports behind a login). So there are two kinds
of fixture here, and the kl_to_1c inputs live in `../../onec/fixtures/bank-input/` (own SOURCES.md).

## Synthetic, from the pilot vocabulary (23 Oct 2026)

`ru-debit-credit.xlsx`, `uz-debit-credit.xlsx`, `amount-direction.xlsx`, `signed-1251.csv` —
`make-fixtures.ts`; layouts from `docs/accounting-2026-10-23/integration-research.md` §2; invented
bank "Namuna Bank". Unchanged by the 30 Oct work.

## Built strictly from documented layouts (30 Oct 2026) — `make-real-layouts.ts`

The **layout** (header words, title block, row kinds, delimiter, packaging) follows the source; the
data rows besides those the source prints are invented (companies, accounts, amounts), and the
generator computes balances and totals so each file reconciles to the tiyin. Tests:
`real-layouts.test.ts`, `real-data-db.test.ts`; bench: `scripts/bench-bank.ts --fixtures`.

| File | Source (URL) | What the source documents | What is ours |
|---|---|---|---|
| `p121-two-row-header.xlsx` | CBU Instruction on bank accounting, reg. № 1834, п.121 — https://lex.uz/ru/docs/1370900 (CBU listing https://cbu.uz/ru/documents/3315/2135479/); research §2.4 | the 22 requisites of a лицевой счёт: bank code (МФО) and name, account number and name, processing date, last-movement date, opening/closing balance, posting number, document kind and number, correspondent bank code, correspondent account and name, debit and credit turnovers and their totals, payment purpose | the Russian column captions (no bank publishes its header), the two-row merged header ("Корреспондент" over МФО/Счет/Наименование/ИНН, "Обороты" over Дебет/Кредит), the column-number row, a page break with "Итого по странице" + "Страница 1 из 2" + the header again, a wrapped purpose, Excel number cells that dropped leading zeros (doc № 12, МФО 444, code 668) — the pitfalls of research §4 #10/#12 and §7.31–36. Bank: Ipak Yuli, МФО 00444 (public, research §1.5) |
| `colvir-statement.xls` | Aloqabank «Интернет-банк для юридических лиц» (Colvir Banking System) manual §5.2.2, Рис. 26 — https://aloqabank.uz/upload/medialibrary/31d/91viprk6s6pofg5l5kej6fmdwbogy55f/Internet_bank_dlya_yuridicheskikh_lits_RP_aloqa.pdf | the statement screen: "Выписка по счёту 20208000700000568005", balance labels over values ("Входящий остаток Эквивалент" / "6 423.00 UZS", "Исходящий остаток" 4 689.00), "Дата валютирования: 16.06.2021 - 16.07.2021", columns Дата создания / Дата валютирования / Номер документа / Корреспондент / Счет / БИК / Банк / Создан в ИБ / Расход / Приход, the purpose on its own row under each payment, "Обороты по расходу (приходу) на странице:" and "Обороты по расходу (приходу):" with the amount in the last column, amounts "1 234.00 UZS"; the two payments 548108 (1 234.00) and 128 (500.00) | saved as a legacy **.xls** (BIFF8 in an OLE file, written by our minimal writer) because the manual's export format is not enumerated (§5.2.3) and ASBT/Ziraat list .xls reports; the counterparty accounts the screen truncates ("19997000900…") padded to 20 digits; the two "Дата создания/валютирования" stacked in one cell on screen are two columns; 70 invented payments so the shared strings span CONTINUE records; balances recomputed |
| `asbt-documents-pipe.zip` | ASBT 4.0 Интернет-банк help «Сервис. Экспорт документов» / «Файлы отчетов» — https://ibank1.ipotekabank.uz/bkey/asbt_help/asbt31_help.htm (Ipoteka; Ziraat runs the same reports) | a text file of payment documents, fields in a user-chosen order, any delimiter, optional header row («Включать заголовки»), date appended to the file name (`yyy.txt` → `yyy230309.txt`), handed out as a zip | windows-1251 has no қ ғ ў ҳ: they are folded (к г у х) as a 1251 export must; the field list (the payment-order requisites of the Положение о безналичных расчётах п.11, https://bank.uz/news/text49473_polojenie_o_beznalichnyh_raschetah_v_respublike_uzbekistan): number, date, payer account/ИНН/name/МФО, payee account/ИНН/name/МФО, amount, purpose code, purpose; `|` as the delimiter; windows-1251; `vypiska301026.txt` inside |
| `asbt-documents-fixed.txt` | same help page («Если разделитель полей отсутствует … длина каждого поля в строке в точности будет равна значению») | fixed width, no delimiter, every field exactly its length | the same four documents; field widths ours; header captions padded to the widths; the 20-digit accounts fill their field, so they touch the next field (the case the help warns about) |
| `ibank2-all-accounts.csv` | BIFIT iBank2 Format Guide p.132 «Экспорт документов в формате CSV — Выписки» — https://ibank.ccb.ru/doc/Corporate_iBank2-Format_Guide.pdf; «Экспортировать в один файл» p.5 | the statement CSV's 18 fields in order (Счет;Дата операции;Код операции;Бик банка;…;ID докум.), `;` with decimal comma, the two example rows | the two example rows kept as printed (a Russian account, the `"КЕМЕРОВСКИЙ" ФИЛИАЛ …` cell); three rows of a second, Uzbek account in the same file (iBank2 is not confirmed at any Uzbek bank: research §2.3); windows-1251, CRLF |

Small variants (a cp866 CSV, a UTF-8 BOM CSV, a `~` file, an HTML table and an Excel-2003-XML file
saved as .xls, a PDF, zips with two files or none) are built in memory by the tests from these
fixtures' rows; they need no file of their own.
