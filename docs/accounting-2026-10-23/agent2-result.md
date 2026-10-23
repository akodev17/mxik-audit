# Agent 2 result — bank statement Excel/CSV → 1C

Branch `feat/bank-statement-automation` (worktree `bank-statement-automation-1bfa69`), cut from the
base commit `36ef476`. Not pushed. Commits `2328cfb`…HEAD (`git log 36ef476..feat/bank-statement-automation`).
Ports 4022 (API) / 3022 (web). Migration `20261102000100_bank_formats_rules` (additive: tables
`bank_format`, `bank_rule`), applied to the shared dev DB with `migrate deploy`.

## What exists now

| Area | Where |
|---|---|
| Layout type, three built-in layouts, recognition, header signature, mapping guess | `packages/domain/src/bank/formats/` |
| Header vocabulary RU / UZ Latin / UZ Cyrillic, noise rows | `bank/vocabulary.ts` |
| Table location (header under a title block, two-row headers, repeated headers), title block (account, ИНН, owner, МФО, period, currency, bank) | `bank/sheet.ts` (+ new `readGrid()` export in `spreadsheet.ts`) |
| Normalisation: dates, exact decimals, ИНН/ПИНФЛ, accounts, МФО, debit/credit flags | `bank/dates.ts`, `decimal.ts`, `identifiers.ts` |
| Lines + issues + dropped rows + balances | `bank/parse.ts`, `bank/issues.ts` |
| Operation rules (org rules, built-ins), duplicates, AI suggestions, reconciliation + CSV | `bank/rules.ts`, `duplicates.ts`, `ai.ts`, `reconcile.ts` |
| DB: layouts, rules, processing in chunks of 500 with progress, recount | `bank/store.ts` |
| Service (access, refusals in uz/ru, preview, read, decisions, bulk approve, 1C dry run/export via Agent 1's interface, reconcile, remove) | `bank/service.ts` |
| Contract (16 endpoints) | `packages/contracts/src/modules/bank.ts` |
| Nest module | `apps/api/src/bank/` |
| Web: `/bank` (list + client filter, upload wizard, saved layouts, rules), `/bank/[id]` (summary, 1C panel, review grid, edit drawer), `/bank/[id]/reconcile` | `apps/web/src/app/(app)/bank/` |
| Copy uz + ru | `packages/i18n/src/i18n-parts/bank.ts` |
| Fixtures + generator | `packages/domain/src/bank/fixtures/` |

## Formats and their verified status

No real bank statement exists in the repository; `tmp/found-catalogs` holds only product catalogues
(checked: `perechen.xlsx`, `stroy-materials-423.xlsx`, `test-*.xlsx`, `uzmetallsavdo-168.xlsx` — all
catalogue/price layouts). So every layout is **generic and `verified: false`**, built from the header
words of the pilot companies' statements quoted in `integration-research.md` §2:

| id | Layout | Fixture (synthetic, invented "Namuna Bank") | Verified |
|---|---|---|---|
| `generic_ru_debit_credit` | RU, `Дебет` + `Кредит` columns (also two-row header «Корреспондент: Наименование/ИНН/Счет/МФО», «Сумма: Дебет/Кредит») | `ru-debit-credit.xlsx`: 8 title rows, column-number row, 10 lines, wrapped purpose, totals, closing balance, footer; reconciles exactly | **no** |
| `generic_uz_debit_credit` | UZ Latin `Sana / Hujjat raqami / Kontragent / STIR / Hisob raqami / MFO / Debet / Kredit / To'lov maqsadi` | `uz-debit-credit.xlsx`: Excel serial dates, number cells, opening/closing balance rows, a layout row, 5 broken rows (bad date, bad ИНН/account, both columns, garbled amount, no date) | **no** |
| `generic_amount_direction` | one `Сумма` + `Дебет/Кредит` flag (or a signed amount when no flag column), `Референс`, `Валюта` | `amount-direction.xlsx` (dates with time, page break with repeated header, unknown flag, repeated reference) and `signed-1251.csv` (windows-1251, `;`, signed amounts) | **no** |
| `org:<id>` | any layout a user maps once: saved per org by header signature, recognised on the next upload | made in the tests and in the browser | `verified: false` until confirmed |

## Issue codes emitted (all labelled uz + ru in `bankX.issues`; `rules.test.ts` checks)

Errors (line `unresolved`): `date_missing`, `date_invalid`, `amount_missing`, `amount_invalid`,
`amount_both_columns`, `amount_negative`, `direction_missing`.
Warnings (line `suspicious`): `amount_ambiguous`, `inn_invalid`, `account_invalid`, `mfo_invalid`,
`counterparty_missing` (info on bank-fee/acquiring lines), `purpose_missing`, `counterparty_unknown`,
`counterparty_ambiguous`, `operation_missing`, `duplicate_row` (params `source: exported|file`),
`currency_mismatch`. Info: `counterparty_new`, `operation_suggested`, `duplicate_pending`.

## Rules

Org rules first (`bank_rule`: `purpose_contains | inn_equals | counterparty_equals | amount_sign`,
priority, per client or org-wide, hit counter), then built-ins: own transfers (statement owner's
ИНН/name, «перевод собственных средств»), tax («налог», «уплата НДС», ЕНП, ЕСП, НДФЛ, ИНПС, soliq —
but not «в т.ч. НДС»/«без НДС»; debit only), salary, bank fee (strong words always; «комиссия»,
«xizmat haqi» only when the counterparty is the bank or none), acquiring (SmartVista, эквайринг,
терминал, POS, Uzcard, Humo; credit only), loans, then a named counterparty → payment in/out. A line
no rule decides stays `operation: null` + `operation_missing`. **No ИНН of the tax committee or the
treasury is built in** — not in any source we have; an org adds an `inn_equals` rule.
"Remember for this counterparty / purpose" in the correction drawer creates the rule and applies it
to the statement's other undecided lines at once (verified in the browser: row 20 followed row 12).

AI: only with `ANTHROPIC_API_KEY` (and `MXIK_LLM_ENABLED` not `false`); purpose (digit runs of 9+
masked), counterparty name and direction only; ≤ 200 lines per statement in batches of 50; stored
as `operationSuggestion` (basis `ai`) + info issue, never applied; the reviewer accepts with one
click. Tested with a fake suggester; **the real Claude call was not exercised** (all browser test
lines were decided by rules, so nothing was sent).

## Verified, and how

- `npm run typecheck`: green. `npm run lint`: see "Checks" below. Tests: see "Checks".
- Domain tests (`packages/domain/src/bank/*.test.ts`, 73 + 12 DB): every fixture end to end (layout,
  header row, two-row header, title block, dropped rows with reasons, values, issues, balance to the
  tiyin, bank totals), normalisation edge cases, layout recognition and the mapping guess, header
  signatures, rules (org before built-in, client scoping, priority, VAT mentions, supplier fees),
  duplicate keys, AI boundaries (what leaves the server, reply validation, no key → none), labels for
  every code in both locales, CSV; against the DB: preview, read, duplicate file refused with the
  earlier id, manual mapping saved and recognised next time (usedCount), decisions with a remembered
  rule, unresolved → corrected → approved, skip/reopen, bulk approval (suspicious → valid), dry run
  checks, export through the stub (501), exported is final (retry sends only the rest, decisions
  and deletion refused), duplicate of an exported line flagged in a later statement, in-file
  duplicate, reconciliation + CSV, AI suggestions attached but never applied, access (other org,
  viewer, scoped lists).
- API e2e `apps/api/test/e2e/bank.test.ts` (6): preview → read → progress → records (contract shapes
  checked with `matches`), search, duplicate refusal, decision + remembered rule, bulk approve,
  prepare/export (501), reconcile + CSV headers, formats, 401/403/404 refusals, removal.
- Web parity `tests/web-parity/bank.test.ts`.
- In the browser (in-app browser, web 3022 + API 4022, the signed-in demo org): the full flow on the
  RU fixture (recognised → check with dropped rows → read → review → correct + remember → approve all
  → prepare → download refused honestly → reconciliation, CSV through the proxy), the manual mapping
  of an unknown CSV in Uzbek (layout saved as "Hamkor bank (namuna)"), the UZ fixture's unresolved
  lines, and the statement page at 375 px (no horizontal page overflow). Screenshots
  `docs/accounting-2026-10-23/agent2/01…12`. Bugs found that way and fixed: sample rows included the
  column-number row; an unrecognised file's sample came out empty; a server page imported a constant
  from a client module; CSV amounts used `.`; "xizmat haqi" from a supplier read as a bank fee.
  (Screenshot 06 shows the "remember" control before it became a select.)
- Benchmark: `docs/accounting-2026-10-23/benchmarks.md` § Bank — 1 000 lines end to end 389 ms median
  (write 250 ms), 10 000 lines 2.5–4.6 s; matching is the stub, so re-measure after integration.

## Not done / limits

- **No 1C file has been produced from a bank statement**: Agent 1's `buildExport` is the stub on this
  branch (`not_implemented` → 501 with an explanation). The bank module passes the right record ids
  and never builds a file itself. Verify on the integration branch.
- Counterparty matching is the stub (`unknown` → `counterparty_unknown` warning on every named line);
  pass `{ clientId }` at the merge (handoff-agent2.md §B).
- The review grid is local; Agent 1's shared grid lacks the bank actions (handoff §C).
- A 20-digit account stored as an Excel **number** cell loses digits in Excel itself (beyond 2^53);
  such a cell reads as `account_invalid` or a wrong account and cannot be repaired from the file.
- Legacy `.xls` is refused with a "save as .xlsx" message (the shared reader's rule).
- Processing runs inline in the API process (no queue); a restart mid-file leaves the batch in
  `uploaded` — deleting and re-uploading it is the remedy (no automatic resume).
- Test data left in the shared dev DB's demo org from the browser run: three statements
  (`vypiska-namuna-oktyabr.xlsx`, `hamkor-oktyabr.csv`, `kochirma-namuna-oktyabr.xlsx`), the layout
  "Hamkor bank (namuna)" and one rule (ИНН 302345678 → loan); removable from `/bank`.

## What the owner must provide

1. **Real statement exports (xlsx/csv) from the pilot companies' banks** — at least one per bank
   (Kapitalbank, Hamkorbank, Uzum Business, NBU, Asaka, Ipoteka… whichever the clients use), ideally
   a month with a fee, an acquiring credit, a tax payment and salary. Each one becomes a named layout
   with a fixture and is flipped to `verified: true` once its balance reconciles.
2. The ИНН of the tax committee / treasury accounts the clients pay taxes to (for an `inn_equals`
   tax rule), and the org's 1C operation list / ДДС items if they differ from the ten operations here.
3. One bank-statement import file exported **from** the clients' 1C (for Agent 1's
   `bank_exchange_1_02` field set) — needed before any file goes into a real 1C.
