# Real 1CClientBankExchange (kl_to_1c.txt) files read as bank statements

Ten files downloaded on 30 Oct 2026 for the bank research (`tmp/real-docs/bank/RESEARCH.md` §1.6, §5;
the research folder is not in the repository). Copied by a one-off script; the only changes are the
ones listed. **Private persons** (person-like full names, e.g. the placeholder "Иванов Иван
Иванович") became `Физлицо А.`, `Физлицо Б.`, … and their **12-digit ИНН** became `9900000000NN`
(length kept, same person → same placeholder in every file). All-zero ИНН placeholders
(`000000000000`) were left as they are. Company names, company ИНН, banks and accounts from the
public sources are unchanged. Tests: `bank/exchange-input.test.ts`.

| File | Origin (URL) | What it is | Changed |
|---|---|---|---|
| `habr-245397.kl_to_1c.txt` | https://habr.com/ru/articles/245397/ (the `<pre>` sample) | v1.02, `Кодировка=Windows` but saved as UTF-8 (as extracted); 2 Банковский ордер + 2 Платежное поручение; duplicate `ПлательщикКорсчет`; `ПлательщикИНН= …` (space after `=`); `ИНН 7765434566\775001001 ОАО …` composite names; printed turnovers (68 770) do not match the 4 documents (the article trimmed the file) | person name and ИНН replaced |
| `ibank2-format-guide.cp1251.kl_to_1c.txt` | https://ibank.ccb.ru/doc/Corporate_iBank2-Format_Guide.pdf p.129 (BIFIT iBank2 Format Guide) | vendor example, v1.02, 1 outgoing + 1 incoming; `Плательщик=7719617469 ОАО "Крокус"` (ИНН + name, no "ИНН" word); balance chain exact | re-encoded to windows-1251 with CRLF (as iBank2 writes it: "iBank 2 использует кодировку Windows"); a 12-digit ИНН replaced |
| `unact-1.03-two-accounts.kl_to_1c.txt` | https://raw.githubusercontent.com/Unact/client_bank_exchange2/master/spec/data/test.txt | v1.03, every field populated, two `РасчСчет=` and two `Документ=` header lines, two accounts, transfers between them, `ПлательщикБИК=Payer bank BIC` (non-numeric), `НазначениеПлатежа1..6`, `КодНазПлатежа` | none |
| `kilylabs-one-day.cp1251.kl_to_1c.txt` | https://raw.githubusercontent.com/kilylabs/client-bank-exchange-php/master/tests/resources/one_day.txt | cp1251, CRLF, 13 documents, `Квитанция*` fields, trailing space in `КвитанцияСодержание` | 12-digit ИНН replaced |
| `kilylabs-one-day.utf8.kl_to_1c.txt` | same repository, `tests/resources/one_day_utf8.txt` | the same file in UTF-8 while it still says `Кодировка=Windows` | 12-digit ИНН replaced |
| `odin-palace-bench.cp1251.kl_to_1c.txt` | https://github.com/tochka-public/odin_palace (`benches/bench_statement.txt`) | Tochka bank's anonymised benchmark: 129 documents, 26 daily `СекцияРасчСчет` blocks for one account; the printed debit turnover is 690.00 above the documents' (the anonymised file lost a document) | person names and 12-digit ИНН replaced |
| `odin-palace-bom.kl_to_1c.txt` | same repository, `src/tests/suites/bom/input.txt` | UTF-8 with BOM (`EF BB BF 31 43 43 …`) | person names and ИНН replaced |
| `odin-palace-duplicate-interval.kl_to_1c.txt` | same repository, `src/tests/suites/duplicate_interval/input.txt` | three `СекцияРасчСчет` for one account, two identical (June), one May; no documents; no header period | none |
| `odoo-ru-1.01.cp1251.kl_to_1c.txt` | https://raw.githubusercontent.com/odoo-ru/client-bank-1c/master/tests/data/kl_to_1c.txt | v1.01, LF, blank line inside the header, account `00000000000000000001`, empty budget fields, `ВидПлатежа=электронно`, a comma amount inside the purpose | none |
| `odin-palace-readme.cp866.kl_to_1c.txt` | https://raw.githubusercontent.com/tochka-public/odin_palace/master/README.md («Пример входного файла») | Tinkoff-style example: a bank order to the own account carrying `ДатаСписано`; printed 67 770 against one 1 000 document | the example cut out of the README, **re-encoded to DOS cp866 with `Кодировка=DOS`** (no public DOS sample was found; this covers bank research §7.2), CRLF; person names and ИНН replaced |

The malformed variants of bank research §7.9 (odin_palace's `no_end_of_document`, `no_end_of_account`,
`no_end_of_file` suites, listed in that repository but not downloaded) are derived in the test from
`odin-palace-readme…` by deleting the end marker; the `Сумма` with a comma (§7.11) and the Uzbek
МФО / purpose-code variant (§7.18, §7.22) likewise.
