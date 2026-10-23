# Landing 2026-10: feature inventory and section plan (T2.1)

Subtask T2.1 of `docs/ONBOARDING_LANDING_PLAN_2026-10-23.md`. Branch `feat/landing-2026-10`, cut from
`main` = `2908238`. Only this document changed; no product code changed.

T2.2–T2.4 write the landing from this document. Its rule: **the page says only what the code on
`main` does, and anything that has never met the real outside system (a real bank file, a real Didox
export or API, a real 1C base) is never called live.**

Sources read: the plan §1.2–1.4, §2 (Q2, Q3, Q5), §3, §4 (COMMON RULES, T2.1–T2.4);
`docs/accounting-2026-10-23/FINAL_REPORT.md` §1 and §3; `agent1-result.md` … `agent4-result.md`;
`onec-formats.md`; `docs/CONTINUE_2026-10-23.md` "Not verified"; the i18n parts `bank.ts`, `didox.ts`,
`products.ts`, `onec.ts`, `accounting.ts`, `pricing.ts`, `shell.ts`; every file in
`apps/web/src/components/landing/` that carries copy, plus `app/page.tsx` and `app/opengraph-image.tsx`;
`help/api-va-integratsiyalar.mdx`; `packages/domain/src/billing/plans.ts`; and the external calls
in `packages/domain/src/{bank,didox,onec,products}`.

---

## 0. Where the plan differs from the code

The plan's §1.2 table is mostly right. These rows needed correcting, and the rest of this document
follows the code:

| # | Plan says | Code / reports say | Effect on the landing |
|---|---|---|---|
| P1 | Q3: the **file** paths (Didox archive upload, 1C file exports, bank Excel) "are fully exercised", so they count as live. | They have only been tested on our own synthetic fixtures and our own golden files. **No file of any kind has been loaded into a real 1C** (`onec-formats.md` status column: every format "unverified"; the Uzbek edition's МФО key is unknown). **No real bank statement has been read**: every layout is `verified: false` (agent2 §Formats), and the app tells the user so (`bankX.upload.unverified`: "Haqiqiy bank fayli bilan hali tasdiqlanmagan — natijani tekshiring."). **The Didox document shape comes from third-party documentation**, not from a real Didox export (agent3 "Honesty line"). The app's `didoxX.unverified` banner covers the whole Didox module, not just sync. | The T2.1 CONSTRAINTS rule wins over Q3: bank intake and Didox intake get the "sinov rejimida" badge on their "Qanday ulanadi" line, and the section says once, plainly, that the 1C files have not yet been loaded into a real 1C. Only the products card and the catalogue audit are unbadged. See open question O1. |
| P2 | 1C row: connection settings `none` / `odata` / `http`. | `http` is **connection test only**. A transfer answers `http_transfer_unsupported` (`onec-formats.md` table, agent1 "Implemented but not tested"). | Never mention HTTP transfer. Only OData appears, and it carries the badge. |
| P3 | OData is "tested only against a fake server". | It is also **incomplete by design**: the default object map fills no references (`Контрагент_Key`, `Номенклатура_Key`, …). `onec-formats.md` §5 says "Expect 1C to refuse such documents". | The badge, plus the app's own sentence "Fayl orqali yuklash asosiy yoʻl boʻlib qoladi". Never "send straight to 1C" as a benefit. |
| P4 | Catalogues: "Excel export in the original shape, 1C CSV". | The export menu has five files: original-shape Excel, **1C XLSX**, **1C CSV**, PDF report, **PDF for the client** (`catalogs/[id]/export-menu.tsx:14-29`). The Excel and 1C files are locked when the plan has no `export` (the trial) or `BILLING_REQUIRED_FOR_EXPORT` demands payment; the PDFs are not. | Name "1C uchun CSV/XLSX" where the catalogue's 1C file is mentioned. |
| P5 | Products: "live". | Import, checks and the drawer are live (browser-verified + 50 tests; Tasnif called live). Three parts are not: the **1C «Номенклатура» import preset is `verified: false`**, the **nomenclature xlsx has never been loaded into 1C**, and the retired-code path **has never met a real retired code** (agent4). | The card says "Excel fayldan" and not "1C eksportidan". It makes no "eskirgan kod" (retired code) promise. The 1C-load caveat is the section-wide sentence. |
| P6 | Findings list (T2.1 prompt): "restricted / privilege / purchase / marking". | The finding types are `MISSING, NOT_FOUND, MISMATCH, UNIT_CONFLICT, NOT_PURCHASED, PRIVILEGE_CODE, PRIVILEGE_OPPORTUNITY, RESTRICTED` (`packages/contracts/src/common.ts:12`). **Marking is a row flag and filter (`markingRequired`), not a finding.** | Wording: "markirovka belgisi" (the marking flag), not "markirovka xatosi" (a marking error). |
| P7 | §1.4: tagline uz = "…pozitsiyalarni toping". | `packages/i18n/src/i18n.ts:277`: "Katalogingizdagi xavfli pozitsiyalarni **aniqlang**". | T2.4 replaces it anyway. |
| P8 | T2.3: the closing line names «Buxgalteriya 8 Oʻzbekiston uchun». | `onec-formats.md` names «1С:Бухгалтерия для Узбекистана» (3.0) and never "8". | Use «1C:Buxgalteriya (Oʻzbekiston uchun)». |
| P9 | T2.3 req. 2: retitle the Capabilities H2 so it covers the catalogue only. | It already does: "Katalogni tekshirish uchun kerak boʻlgan hamma narsa". Only the eyebrow "Imkoniyatlar" claims the whole product. | T2.3 changes the eyebrow only (see §4 S7). |
| P10 | §1.4 / T2.3 / T2.4: the Trust section gets a line about documents. | `trust.tsx` is in **no** subtask's file list (§3). Its "Hech qachon chiqmaydi: … MXIK kodi" and "Tashqi AI … faqat tovar nomi va oʻlchov birligi" are true only for the catalogue audit (see §1 row 36). | T2.3 owns `trust.tsx` together with `data.ts`. |
| P11 | T2.4 req. 1: "qaysi ustunlar oʻqiladi" FAQ wording. | No FAQ question by that name exists. The column claim ("Tahlilda toʻrt ustun oʻqiladi") lives in `DATA_FLOW.stored`, used in the FAQ answer "Maʼlumotlarim qayerga ketadi?" and in Trust. It is still true **for the catalogue audit**. The product import reads seven fields (`PRODUCT_FIELDS`: name, onecRef, article, mxik, packageCode, unit, barcode). | Scope the sentence to the catalogue audit; don't extend it. |
| P12 | Pricing (Q2): modules not plan-gated. | Confirmed: no `planHas` or billing check anywhere in `packages/domain/src/{bank,didox,onec,products}` or `apps/api/src/{bank,didox,onec,products}`. So 1C files from statements, invoices and products download in the trial too, while the pricing lead says "Toʻgʻrilangan fayl … — obunada". | The Q2 sentence is needed and is true as worded. |

---

## 1. Inventory

Status vocabulary:
- **live**: works on `main` and has been exercised against the real thing.
- **live-unverified**: implemented and tested, but never run against the real outside system.
- **partial**: part of it is built.
- **not built**.

Landing decision vocabulary:
- **show**: present it as live.
- **badge**: show it with "sinov rejimida" on the specific line.
- **omit**: leave it off the landing.

"Evidence" points at code or at a report section.

### 1.1 MXIK catalogue audit (the existing product)

| # | Feature | Where | What the user gets (uz) | Status | Evidence | Landing decision |
|---|---|---|---|---|---|---|
| 1 | Four checks per row | `/catalogs/[id]`, `/upload` | Har bir qator toʻrt savoldan oʻtadi: kod bormi, tasniflagichda bormi, nomga mos keladimi, oʻlchov birligi mos keladimi. | live | `data.ts` `CHECKS`; finding types `MISSING`, `NOT_FOUND`, `MISMATCH`, `UNIT_CONFLICT` (`contracts/src/common.ts:12`) | **show** (already on the page; keep) |
| 2 | Other findings: restricted, privilege, not purchased; marking flag | workspace filters, `/clients/[id]/purchases` | Cheklangan kodlar, imtiyoz shartlari, xaridlarda yoʻq tovarlar va markirovka belgisi alohida koʻrsatiladi. | live (code + labels); not re-verified in this pass | `FINDING_TYPES`; labels `workspace.ts:47-50`; `workspace.ts:73` marking filter | **omit** in this wave: T2.3 is told to leave Capabilities alone, and the four-check story is the measured one. Owner question O4. |
| 3 | Suggestions with classifier path | workspace drawer | Taklif yonida kodning tasniflagichdagi oʻrni (guruh, sinf, pozitsiya, subpozitsiya) va moslik darajasi turadi. | live | `capabilities.tsx` "Nega bu kod?"; `mxik-code.ts` | **show** (keep) |
| 4 | Decisions, undo, history | workspace, `/activity` | Har bir tasdiq va rad etish kim va qachon qilgani bilan yoziladi; bekor qilish ham tarixda qoladi. | live | `/activity`; Trust lanes | **show** (keep) |
| 5 | Excel export in the original shape | export menu | Tuzatilgan Excel asl ustunlar va tartibda qaytadi. | live; locked without `export` (trial) or when billing is required | `export-menu.tsx:89`; `plans.ts` `PLAN_FEATURES.trial.export=false` | **show** (keep) |
| 6 | 1C CSV / 1C XLSX of a catalogue | export menu | Katalogni 1C uchun CSV yoki XLSX koʻrinishida yuklab olasiz. | live-unverified (built by the shared 1C module; never loaded into a real 1C) | `export-menu.tsx:26-27`; FINAL_REPORT §3 "its 1C CSV/XLSX now built by the shared module" | **show** as "1C uchun fayl"; covered by the section-wide 1C sentence (§3.3) |
| 7 | PDF report, PDF for the client | export menu, `/catalogs/[id]/report` | Chop etishga moslangan risk hisoboti, mijoz uchun alohida varianti bilan. | live | `export-menu.tsx:28-29`; Outcomes row 1 | **show** (keep) |
| 8 | Share links | `/r/[token]`, `share-button.tsx` | Hisobotni havola orqali mijozga ulashasiz. | live; the `clientLinks` feature is gated to Buxgalter/Byuro | `app/r/[token]`; `PLAN_FEATURES` | **show** only where it is already shown (the pricing feature list); no new copy |
| 9 | Versions and diff | `/catalogs/[id]/diff` | Yangi versiya yuklansa, qarorlar oʻtadi va farq hisoblanadi. | live | route exists; Capabilities tile | **show** (keep) |
| 10 | Column recognition, remembered mapping | `/upload` | Ruscha yoki oʻzbekcha sarlavhadan ustunlar taniladi; bir xil shakl qayta soʻralmaydi. | live | Capabilities tile; Workflow step 1 | **show** (keep) |
| 11 | Firm dictionary | `/dictionary` | Tasdiqlangan "nom → kod" juftlari eslab qolinadi va keyingi safar birinchi taklif boʻladi. | live | route; `PLAN_FEATURES.dictionary` | **show** only in pricing (already there) |
| 12 | Live sample audit, demo | `#demo` (landing), `/demo` | Namuna katalogni sahifaning oʻzida koʻrasiz; `/demo` da shaxsiy namuna nusxasi ochiladi. | live | `demo-band.tsx`; `.env.example:283` `NEXT_PUBLIC_DEMO_URL=/demo`; `scripts/seed-demo.ts:81` | **show** (keep). Fix the stale comment (§4 S1). |

### 1.2 Firm workspace

| # | Feature | Where | What the user gets (uz) | Status | Evidence | Landing decision |
|---|---|---|---|---|---|---|
| 13 | Clients and client switcher | `/clients`, `/clients/[id]` (+ imports, purchases, schedules), header switcher | Har bir mijoz kompaniyasi alohida: kataloglari, xaridlari va jadvallari oʻz sahifasida; yuqoridan mijozni almashtirasiz. | live | `(app)/clients/[id]/*`; plan §1.2 | **show**: Outcomes "Mijozlar boʻyicha ajratish" row; remove the flag (Q5) |
| 14 | Team roles, invites, client assignments | `/team` | Administrator, buxgalter va kuzatuvchi rollari; e-pochta yoki havola orqali taklif; buxgalterga faqat tanlangan mijozlar. | live | `contracts/src/modules/team.ts:28-51` | **show** only in pricing ("team", already there) |
| 15 | Dashboard, review queue, activity, notifications | `/dashboard`, `/queue`, `/activity`, `/notifications` | Ish navbati, ochiq topilmalar va xabarnomalar bir joyda. | live (route check only; the tour subtasks cover them) | plan §1.2 | **omit** (app chrome, not a selling point) |

### 1.3 Accounting modules (new on `main` since 23 Oct)

| # | Feature | Where | What the user gets (uz, app words) | Status | Evidence | Landing decision |
|---|---|---|---|---|---|---|
| 16 | Bank statement intake: Excel/CSV, three generic layouts, one-time manual mapping saved per org | `/bank`, `/bank/upload` | Bankdan yuklab olingan Excel yoki CSV koʻchirmani yuklaysiz: qatorlar oʻqiladi; shakl tanilmasa, ustunlarni bir marta tanlaysiz va keyingi safar avtomatik oʻqiladi. | **live-unverified**: synthetic fixtures only; no real bank file; layouts `verified: false` | agent2 §Formats; `bankX.upload.unverified`, `bankX.hint` | **badge** on the card's "Qanday ulanadi" line; **never name a bank** (no layout is verified for any of them) |
| 17 | Bank normalisation, issues, balances, duplicates | `/bank/[batchId]` | Sana, summa, STIR, hisob raqami va MFO tekshiriladi; qoldiqlar solishtiriladi; takroriy toʻlov belgilanadi. | live-unverified (as row 16) | agent2 issue codes; `duplicate_row` (`source: exported|file`) | **show** inside the bank card, which already carries the badge |
| 18 | Operation rules (built-in + "remember for this counterparty/purpose") | `/bank/[batchId]`, `/bank` rules | Operatsiya turi qoidalar bilan aniqlanadi; tuzatishda "eslab qolish" yangi qoida yaratadi. | live-unverified (as row 16) | agent2 §Rules | **show** in the bank card ("muammo" / "nima uchun") without listing rules |
| 19 | AI operation suggestions | bank review | Qoida hal qilmagan qatorlarga AI taklifi (faqat kalit sozlangan boʻlsa), hech qachon avtomatik qoʻllanmaydi. | live-unverified: **the real Claude call was never exercised** | agent2 §Rules "AI"; `packages/domain/src/bank/ai.ts` | **omit** as a feature; mention it **only** in the data-flow line (row 36), because it is an outbound path |
| 20 | Reconciliation report + CSV | `/bank/[batchId]/reconcile` | Solishtirma hisobot va uning CSV fayli. | live-unverified (as row 16) | agent2; `bankX.reconcile.title` "Solishtirma hisobot" | **show** as one phrase in the bank card |
| 21 | `kl_to_1c.txt` (1CClientBankExchange 1.02) | `/bank/[batchId]` 1C panel, `/onec/[batchId]` | Tasdiqlangan qatorlardan 1C ning "Bank koʻchirmalarini yuklash" oynasi uchun `kl_to_1c.txt` fayli. | live-unverified: golden-file tested against the official Russian standard; **never loaded into a real 1C**; Uzbek edition's МФО key unknown (both variants shipped, per org) | `onec-formats.md` §1; FINAL_REPORT §3 | **show** the file name; covered by the section-wide 1C sentence |
| 22 | Didox upload: zip of zips / JSON / ЭСФ XLSX | `/didox` | Didox arxivi (.zip), bitta hujjat JSON yoki ESF Excel faylini yuklaysiz. | **live-unverified**: document shape is third-party-documented; zip naming and ЭСФ template columns guessed (the XLSX columns are user-confirmed) | agent3 "Honesty line", "Implemented but not verified"; `didoxX.unverified`, `didoxX.upload.hint` | **badge** on the Didox card's "Qanday ulanadi" line (covers rows 22 and 23) |
| 23 | Didox token connection and sync | `/didox/settings`, `/didox` | Didox tokeningizni kiritasiz va yangi kiruvchi hisob-fakturalarni olasiz. | **live-unverified**: only `GET /v1/measures/all` ever hit the real API; no credentials; fake Didox only. ИНН+password login behind `DIDOX_PASSWORD_LOGIN=1`; E-IMZO not built | agent3; FINAL_REPORT §3 | **badge** (same line as row 22) |
| 24 | Invoice line folding, product matching, MXIK checks | `/didox/[batchId]` | Bir mahsulotning turli yozilishi bitta guruhga yigʻiladi; mahsulot va MXIK, qadoq va birlik tekshiriladi. | live-unverified: on the integrated run every synthetic line was `unresolved` (their codes are not in the local classifier) and **nothing was exported** | FINAL_REPORT §3 row 2; agent3 issue codes | **show** inside the badged Didox card |
| 25 | `receipt_xlsx` + `nomenclature_xlsx` from invoices | `/didox/[batchId]` export | Tovar kirimi va nomenklatura Excel fayllari. | live-unverified: builders golden-file tested; **no end-to-end export from an invoice on the integrated code**; no documented Uzbek loader for «Поступление» | FINAL_REPORT §3; `onec-formats.md` §2-3 | **show** the file kinds; covered by the section-wide 1C sentence and the Didox badge |
| 26 | Product catalogue import (Excel; 1C «Номенклатура» preset), checks, suggestions | `/products`, `/products/import` | Firmangiz va mijozlaringiz mahsulotlari bitta joyda: MXIK, qadoq kodi, oʻlchov birligi va shtrix kod tekshiriladi. | **live** for the Excel import and the checks (browser + 50 tests; Tasnif live); the 1C «Номенклатура» preset is **unverified** | agent4 table; `productsX.hint` | **show**; say "Excel fayldan", not "1C eksportidan" |
| 27 | Packaging codes and unit checks | `/products` drawer, import | Qadoq kodi MXIK kodiga va oʻlchov birligiga mos kelishi tekshiriladi. | live (ran live against Tasnif) | agent4 "Packaging lazily" | **show** in the products card |
| 28 | "Mahsulotlar katalogiga qoʻshish" from a finished audit | `/catalogs/[id]` | Tugagan auditdagi tasdiqlangan qatorlar bir bosishda mahsulotlar katalogiga oʻtadi. | live (browser-verified) | agent4 screenshot 08; `productsX.fromAudit` | **show** in the products card (links the audit to the new section) |
| 29 | Nomenclature xlsx of the catalogue | `/products` → 1C | Tasdiqlangan mahsulotlar 1C nomenklatura fayli sifatida. | live-unverified (as row 25) | agent4 "Export to 1C"; FINAL_REPORT §3 row 3 | **show**; covered by the section-wide 1C sentence |
| 30 | 1C import history, review grid, prepare (dry run) | `/onec`, `/onec/[batchId]`, `/onec/review` | Bank, Didox va katalog paketlari bitta tarixda: nima tayyorlangan, nima yuklab olingan, nima oʻtkazib yuborilgan va nima uchun. | live (in-app; browser-verified by agent1) | agent1 "Verified, and how"; `onecX.hint` | **show** (1C card) |
| 31 | Duplicate protection across exports | prepare/build | Oldin 1C ga chiqarilgan yozuv yangi paketda qayta kelsa, belgilanadi. | live (tests on the dev DB) | agent1 `duplicate_export`; agent2 "duplicate of an exported line flagged" | **show** (1C card, "muammo") |
| 32 | Counterparties: matching, 1C «Контрагенты» import, `counterparties_xlsx` | `/onec/settings` | Kontragentlar STIR, hisob raqami va nomi boʻyicha topiladi; 1C dagi kontragentlar roʻyxatini yuklash mumkin. | live in-app; the xlsx and the 1C list's header words are unverified against a real 1C | agent1 §3; `onec-formats.md` §4 | **show** as one phrase ("kontragentlar") in the 1C card; no promise of an exact 1C match |
| 33 | Direct transfer to 1C: OData | `/onec/settings`, batch "1C ga toʻgʻridan-toʻgʻri yuborish" | Tasdiqlangan yozuvlarni OData orqali 1C bazangizga yuborish. | **live-unverified and incomplete**: fake server only; no reference fields filled, so a real 1C is expected to refuse | `onec-formats.md` §5; `onecX…transferNote`, `onecX.settings.notVerified` | **badge** on its own line in the 1C card, with the app's sentence |
| 34 | Direct transfer to 1C: HTTP | `/onec/settings` | — | **not built** (connection test only) | `onec-formats.md` table | **omit** |
| 35 | Plan gating of the modules | — | Bank, Didox, mahsulotlar va 1C modullari hamma tariflarda, Koʻrikda ham. | live (not gated) | §0 P12 | **show** the Q2 sentence in pricing |

### 1.4 Data handling, integrations, account

| # | Feature | Where | What the user gets (uz) | Status | Evidence | Landing decision |
|---|---|---|---|---|---|---|
| 36 | What leaves the server (documents) | — | See the precise wording in §3.6. | code-checked in this pass | `bank/ai.ts:1-6`, `:27` (masking of digit runs ≥ 9); `products/tasnif-client.ts:8,175,179` (code-only lookups); `didox/client.ts:20` + agent3 (token sealed, logs without token); `onec-formats.md` §5 (OData to the user's own base); products/Didox names go through the audit cascade (`products/classify.ts:3`) | **show** one Trust line (T2.3) and one FAQ answer (T2.4) |
| 37 | Telegram bot: notifications, send a file to audit, sign-in | `/settings` integrations, `apps/api/src/telegram` | Natijalar Telegram chatga keladi; botga fayl yuborib tahlil boshlash mumkin. | partial: implemented; sign-in parked (the widget works only on the bot's domain); notifications and file-to-audit **not verified** against Telegram in any report read here | CONTINUE "Sign-in providers"; help `api-va-integratsiyalar.mdx` | **omit** (the landing only links the support chat; unchanged) |
| 38 | Google sign-in | `/sign-in`, `/sign-up` | Google hisobi bilan kirish. | live on localhost only; production redirect not registered; consent screen in Testing | CONTINUE "Sign-in providers" | **omit** |
| 39 | Public API v1 | `/api-docs`, `POST /api/v1/check`, catalogues | Mahsulot nomini API orqali tekshirish, katalog yuklash va hisobot olish. | live | `contracts/src/modules/public-api.ts:149-197` | **show** only in pricing ("api", already there) |
| 40 | Google Sheets add-on | `integrations/google-sheets` | — | partial: source code only, not published | plan §1.2; help article ("manba kodi") | **omit** |
| 41 | Pricing and plans | `#narxlar` | Koʻrik bepul, uch tarif, bir martalik toʻgʻrilangan katalog. | live; online payment behind `NEXT_PUBLIC_ONLINE_PAYMENT` | `config.ts PRICING` + parity test | **show** (keep) + Q2 sentence |
| 42 | Security: 2FA, sessions, data export, close account | `/settings` security / data tabs | Ikki bosqichli kirish, faol seanslar, maʼlumotlarni yuklab olish va hisobni yopish. | live | `settings/{two-factor,session-list,data-panel,close-account}.tsx` | **omit** as new copy (out of scope for this wave); could become an FAQ later |
| 43 | Lead-file retention | `#audit` form | Bepul audit fayli N kundan keyin oʻchiriladi. | live where the daily purge runs | `config.ts LEAD_FILE_RETENTION_DAYS`; `domain/src/retention.ts` | **show** (keep) |
| 44 | Legal pages | `/maxfiylik`, `/oferta` | — | placeholders (owner text, Q7 of the accounting bug list) | FINAL_REPORT §5.5 | unchanged; not an inventory claim |

---

## 2. Final landing section list

Order in `app/page.tsx`. "Rows" refers to §1.

| # | Section | id / anchor | Purpose | Rows | Component and owner |
|---|---|---|---|---|---|
| 1 | Header | — | Section links, sign-in, sign-up. Add "Buxgalteriya" → `/#buxgalteriya` between "Qanday ishlaydi" and "Narxlar" (uz "Buxgalteriya", ru "Бухгалтерия" in `shell-copy.ts`). | — | `site-header.tsx`, `shell-copy.ts`: **T2.2** |
| 2 | Hero (broadened) | `hero-title`, `#hero-actions` | Two jobs in one line: MXIK audit + documents into 1C files. The keyed preview stays as the catalogue workspace, because it is real. | 1, 5, 16, 22, 26 | `hero.tsx`: **T2.2** (headline from §3.1) |
| 3 | Problem (keep + one row) | `why-title` | Keep the code decoder and the portal examples; add the document row (§3.2). | 1, 16, 21, 22 | `problem.tsx`: **T2.2** |
| 4 | Consequences | — | Unchanged. | — | — |
| 5 | Capabilities = MXIK audit | `cap-title` | Unchanged tiles. Eyebrow "Imkoniyatlar" → "MXIK auditi" so it no longer claims to be the whole product (P9). | 1, 3, 4, 5, 9, 10 | `capabilities.tsx`: **T2.3** |
| 6 | **NEW Buxgalteriya** | `buxgalteriya` | Eyebrow, H2, flow strip, four cards (2 × 2), the section-wide 1C sentence and the formats line (§3.3–3.4). | 16–33 | new `accounting.tsx`, copy as data in `data.ts`: **T2.3** |
| 7 | DemoBand | `demo` | Unchanged (it is the real audit UI). | 12 | — |
| 8 | Workflow | `qanday-ishlaydi` | Keep the four steps. One sentence under the heading: bank statements and invoices go through the same review → approve → file loop (§3.5). Optional: name the 1C CSV/XLSX in the "Eksport" detail (P4). | 1, 4, 5, 6, 30 | `workflow.tsx`: **T2.3** |
| 9 | Outcomes | `accountants-title` | Show the clients row (Q5) and add the row "1C uchun fayl" (§3.5). | 7, 13, 21, 25, 29 | `outcomes.tsx`: **T2.2** |
| 10 | Trust | `trust-title` | Keep the lanes; scope the four data cards to "katalog auditi"; add one line for documents (§3.6). | 36 | `trust.tsx` + `data.ts` `DATA_FLOW`: **T2.3** (P10: unassigned in the plan) |
| 11 | Pricing | `narxlar` | Keep everything; add the Q2 sentence under the plan cards (§3.7). | 35, 41 | `pricing.tsx`, `i18n-parts/pricing.ts`: **T2.4** |
| 12 | FAQ | `savollar` | Keep the five; scope the data answer to the catalogue audit; add four document questions (§3.8). | 16, 21–23, 33, 36 | `faq.tsx`: **T2.4** |
| 13 | FinalCta (lead form) | `audit` | Unchanged: the free audit is a catalogue service. | 43 | — |
| 14 | StickyCta | — | Unchanged. | 12 | — |
| — | Meta, OG image, tagline | — | Catalogue-only today (§4 S4–S6). | — | `page.tsx`, `opengraph-image.tsx`, `i18n.ts`/`i18n-ru.ts`: **T2.4** |

---

## 3. Draft copy (Uzbek, U+02BB)

Shared rules for these drafts:
- No figures anywhere in the new section.
- No bank names.
- No "avtomatik 1C ga" or "1C ga tayyor": the file is produced, but whether 1C accepts it is unverified.
- Card titles are the app's nav labels (`accountingX.nav`).
- Icons are the app's own: `IconBuilding` and `IconSend` from `@/ui/icons`; `IconBox` and `IconSwitch` from `@/ui/shell/icons` (`ui/shell/nav-items.tsx:23-26`).

### 3.1 Hero headline: two options (H1 ≤ 14 words, `<em>` on the last beat)

- **A (three beats, same rhythm as today; default):**
  "MXIK katalogini tekshiring. Hujjatlarni 1C ga tayyorlang. *Qarorni oʻzingiz qabul qiling.*" (11 words)
- **B (benefit first, two beats):**
  "Katalogdagi MXIK xatolarini toping. Bank koʻchirmasi va hisob-fakturalardan *1C uchun fayl* oling." (12 words)

Lead paragraph for either option (≤ 2 sentences, names the three jobs):
"Katalogdagi MXIK kodlari va oʻlchov birliklarini tekshiring, bank koʻchirmalari va Didox
hisob-fakturalaridan 1C uchun fayl tayyorlang. Har bir taklif va qaror kim va qachon qilgani bilan
tarixda qoladi."

### 3.2 Problem: the new row ("Shu ish qoʻlda va Tasnivo bilan")

`{ what: 'Hujjatlar', before: 'Bank koʻchirmasi va hisob-faktura qatorlarini 1C ga qoʻlda qayta yozasiz.', after: 'Faylni yuklaysiz, faqat shubhali qatorlarni koʻrib chiqasiz va 1C uchun faylni olasiz.' }`

### 3.3 Buxgalteriya section: head, strip, closing

- Eyebrow: "Buxgalteriya"
- H2: "Hujjat kiradi, *1C uchun fayl* chiqadi"
- Sub (one sentence): "Bank koʻchirmasi, Didox hisob-fakturasi yoki mahsulotlar roʻyxatini yuklaysiz. Tasnivo qatorlarni oʻqiydi va tekshiradi, siz faqat shubhali joylarni koʻrib tasdiqlaysiz."
- Flow strip (`ACCOUNTING_FLOW`): manba → oʻqish → solishtirish → tekshiruv → tasdiqlash → 1C fayli
- Formats line under the grid: "Fayllar «1C:Buxgalteriya (Oʻzbekiston uchun)» ning oʻz yuklash oynalari uchun tuziladi: bank koʻchirmasi uchun `kl_to_1c.txt`, nomenklatura, tovar kirimi va kontragentlar Excel fayllari, katalog uchun 1C CSV/XLSX."
- **Section-wide honesty sentence** (directly under the formats line, same size; required by P1):
  "Fayllar 1C almashuv standarti boʻyicha tuzilgan, lekin haqiqiy 1C bazasiga hali yuklab sinab koʻrilmagan: birinchi faylni sinov bazasida tekshiring."

### 3.4 The four cards

Each card has: the icon, the title, and the three labelled lines. A badge sits **on the line, never on the card**: the text "sinov rejimida", followed by its one-sentence note.

**Bank koʻchirmalari** (`IconBuilding`)
- Nima uchun: Koʻchirmani 1C ga qoʻlda qayta yozmaysiz: qatorlar, kontragentlar va operatsiya turlari oʻqiladi, qoldiqlar solishtiriladi.
- Muammo: Har oy yuzlab toʻlovni qoʻlda kiritish, kontragentni adashtirish, bir toʻlovni ikki marta yozish.
- Qanday ulanadi: Bankdan yuklab olingan Excel yoki CSV koʻchirmani yuklaysiz; shakl tanilmasa, ustunlarni bir marta tanlaysiz va keyingi safar eslab qolinadi. Tasdiqlangandan keyin `kl_to_1c.txt` va solishtirma hisobotni olasiz.
  - **sinov rejimida**: "Haqiqiy bank fayllari bilan hali tasdiqlanmagan: natijani koʻrib chiqing." (mirrors `bankX.upload.unverified`)

**Didox hisob-fakturalar** (`IconSend`)
- Nima uchun: Kiruvchi hisob-faktura qatorlari mahsulotlaringiz bilan solishtiriladi, MXIK, qadoq kodi va oʻlchov birligi tekshiriladi.
- Muammo: Qatorlarni 1C ga qoʻlda koʻchirish, bitta mahsulotning turlicha yozilishi, notoʻgʻri yoki cheklangan MXIK kodi.
- Qanday ulanadi: Didox arxivi (.zip), JSON yoki ESF Excel faylini yuklaysiz yoki Didox tokeningiz bilan yangi hisob-fakturalarni olasiz. Natija: tovar kirimi va nomenklatura Excel fayllari.
  - **sinov rejimida**: "Didox hujjat tuzilishi va ulanish haqiqiy Didox bilan hali tekshirilmagan: har bir hisob-fakturani koʻrib chiqing." (mirrors `didoxX.unverified`)

**Mahsulotlar katalogi** (`IconBox`): no badge
- Nima uchun: Firmangiz va mijozlaringiz mahsulotlari bitta roʻyxatda: MXIK, qadoq kodi, oʻlchov birligi va shtrix kod bir joyda tekshiriladi.
- Muammo: Bitta mahsulot har hujjatda boshqacha yoziladi, qadoq kodi yoki oʻlchov birligi MXIK kodiga mos kelmaydi.
- Qanday ulanadi: Excel fayldan yuklaysiz yoki tugagan auditdan «Mahsulotlar katalogiga qoʻshish» bilan oʻtkazasiz; tasdiqlangan roʻyxat 1C nomenklatura fayli sifatida yuklab olinadi.

**1C import va tarix** (`IconSwitch`)
- Nima uchun: Bank, Didox va katalog paketlari bitta tarixda: nima tayyorlangan, nima yuklab olingan va nima nima uchun oʻtkazib yuborilgan.
- Muammo: Qaysi hujjat 1C ga allaqachon kiritilgani nomaʼlum boʻlib qoladi va bir yozuv ikki marta kiradi.
- Qanday ulanadi: Tasdiqlangan yozuvlardan fayl yuklab olinadi va 1C ning oʻz yuklash oynasi orqali kiritiladi; oldin chiqarilgan yozuv qayta kelsa, belgilanadi. Kontragentlar roʻyxatini 1C dan yuklash mumkin.
  - Second line, **sinov rejimida**: "1C ga toʻgʻridan-toʻgʻri yuborish (OData) haqiqiy 1C bazasida hali sinovdan oʻtmagan. Fayl orqali yuklash asosiy yoʻl boʻlib qoladi." (mirrors `onecX…transferNote` + `onecX.settings.notVerified`)

### 3.5 Workflow note, Outcomes row

- Workflow, under the heading: "Bank koʻchirmalari va hisob-fakturalar ham shu yoʻldan oʻtadi: yuklash, tekshiruv, sizning tasdiqingiz, keyin 1C uchun fayl."
- Outcomes, new row: title "1C uchun fayl"; body "Tasdiqlangan bank, Didox va mahsulot yozuvlaridan 1C yuklash oynasi uchun fayl. Nima chiqarilgani va nima oʻtkazib yuborilgani tarixda qoladi."
- Outcomes, clients row: keep the existing text ("Kataloglarni mijoz nomi bilan guruhlash va har bir mijozga alohida kirish"). It is true: clients plus scoped accountants (row 14).

### 3.6 Trust: what leaves the server (checked in code)

Facts, for T2.3 (`data.ts` comment + copy) and for the T2.4 FAQ:

- **Stored:** uploaded statements, invoices (with Didox JSON and PDF when synced) and product files stay on our server as batches and lines.
- **Bank AI**, only with `ANTHROPIC_API_KEY` set and `MXIK_LLM_ENABLED` not `false`, at most 200 lines per statement. It sends only the payment purpose (digit runs of 9 or more masked), the counterparty name and the direction. **Never** the account, ИНН (STIR) or amount (`bank/ai.ts:1-6`).
- **Product and invoice line names** take the same path as the catalogue audit: to the embedding provider, and to the reranker for uncertain rows, only when those keys are configured.
- **MXIK codes**, and nothing else, go to the official public classifier API `tasnif.soliq.uz` to read packaging and activity. That covers the products module and Didox checks only; `TASNIF_LIVE=false` turns it off. The catalogue audit does not call it.
- **Didox token**: used only to read your incoming invoices from `api.didox.uz`; stored sealed (AES-256-GCM); never shown back or logged.
- **OData**: approved records go to your own 1C base, only if you configure it.

Draft line (uz), placed under the four data cards. The cards get the label "Katalog auditida" (for the catalogue audit):

"Hujjatlar ham shu qoidaga boʻysunadi: koʻchirma va hisob-faktura serverimizda saqlanadi. Tashqi AI
yoqilgan boʻlsa, bank qatoridan faqat toʻlov maqsadi (uzun raqamlar yashirilgan), kontragent nomi va
yoʻnalishi yuboriladi: hisob raqami, STIR va summa chiqmaydi. Mahsulot va hisob-faktura qatorlarida
MXIK kodi qadoq va holatini bilish uchun rasmiy tasnif.soliq.uz dan soʻraladi."

### 3.7 Pricing (Q2)

"1C, bank va Didox modullari hozircha barcha tariflarga kiradi." This is true, including the trial (P12).

### 3.8 FAQ: the four new answers (short drafts for T2.4)

- **1C ga qanday yuklanadi?** Tasdiqlangan yozuvlardan fayl olasiz: bank uchun `kl_to_1c.txt`, mahsulot va hisob-faktura uchun Excel fayllari. Ularni 1C ning oʻz yuklash oynasi orqali kiritasiz. Fayllar haqiqiy 1C bazasida hali sinab koʻrilmagan; toʻgʻridan-toʻgʻri ulanish (OData) sinov rejimida.
- **Didox bilan qanday ishlaydi?** Didox dan yuklab olingan arxiv, JSON yoki ESF Excel faylini yuklaysiz yoki tokeningiz bilan yangi kiruvchi hisob-fakturalarni olasiz. Ikkala yoʻl ham sinov rejimida: haqiqiy Didox bilan hali tekshirilmagan, shuning uchun har bir hisob-fakturani koʻrib chiqasiz.
- **Bank koʻchirmasi qaysi formatda boʻlishi kerak?** Bankdan olingan Excel (.xlsx) yoki CSV. Eski .xls faylni .xlsx qilib saqlang. Shakl tanilmasa, ustunlarni bir marta tanlaysiz va shu bankning keyingi fayli avtomatik oʻqiladi.
- **Hujjatlardagi maʼlumotlar qayerga ketadi?** The §3.6 line verbatim.

---

## 4. Stale or wrong claims on the current page and around it

| # | Where | Claim today | Why it is wrong now | Fix owner |
|---|---|---|---|---|
| S1 | `landing/config.ts` `DEMO_URL` comment | "No public demo mode exists in the app yet" | `/demo` exists; `.env.example:283` sets `NEXT_PUBLIC_DEMO_URL=/demo`; `seed-demo.ts:81` | T2.2 |
| S2 | `config.ts` `SHOW_MULTI_CLIENT` ("NOT BUILT: every screen reads the organisation's newest catalogue"); `outcomes.tsx` filter and comment "the unbuilt one waits behind its flag"; `.env.example:288` `NEXT_PUBLIC_FEATURE_MULTI_CLIENT=false` | Clients "not built" | Clients are built (row 13). `DEPLOY.md` does not mention the flag (checked). | T2.2 |
| S3 | `hero.tsx` H1 + lead | Catalogue audit only | Product now also covers documents → 1C | T2.2 |
| S4 | `app/page.tsx` `TITLE`, `DESCRIPTION`, OG, twitter | "MXIK katalogingizni tekshiring, xatolarni aniqlang" | Same | T2.4 |
| S5 | `app/opengraph-image.tsx` `alt` (line 9), headline (line 53), row (line 56) | Catalogue only | Same; Latin-only font | T2.4 |
| S6 | `packages/i18n/src/i18n.ts:277` `tagline` (+ ru) | "Katalogingizdagi xavfli pozitsiyalarni aniqlang" | Same; default `<title>` of every page | T2.4 |
| S7 | `capabilities.tsx` eyebrow "Imkoniyatlar" | Reads as the whole product's capabilities | The section covers the catalogue audit only | T2.3 |
| S8 | `trust.tsx` `DATA` cards; `data.ts` `DATA_FLOW.stored/external` | "Tashqi AI … faqat tovar nomi va oʻlchov birligi"; "Hech qachon chiqmaydi: … MXIK kodi …"; "Tahlilda toʻrt ustun oʻqiladi" | True for the catalogue audit only. For bank lines, purpose, counterparty and direction can go to the AI. For products and Didox, MXIK codes go to tasnif.soliq.uz. The product import reads seven fields (§3.6, P11). | T2.3 (scope + documents line); T2.4 reuses it in the FAQ |
| S9 | `data.ts` `DATA_FLOW` comment | Cites `src/core/match/pipeline.ts`, `src/lib/audit-runner.ts`, `src/lib/retention.ts`, `src/lib/catalogs.ts` | Monolith-era paths: the code is now in `packages/core/src/match/*` and `packages/domain/src/*` (`apps/web/src/core` and `src/` do not exist) | T2.3 (owns `data.ts`; comment only) |
| S10 | `i18n-parts/pricing.ts` `prX.lead` | "Toʻgʻrilangan fayl va har oylik tekshiruv — obunada" | Still true for the catalogue. But 1C files from documents are in every plan; without the Q2 sentence the page implies they are paid. | T2.4 (Q2 sentence; lead unchanged) |
| S11 | `faq.tsx` "Maʼlumotlarim qayerga ketadi?" | Uses `DATA_FLOW` as if it covered every upload | Must say "katalog" or be followed by the documents answer | T2.4 |
| S12 | `workflow.tsx` step "Eksport" | Mentions only the original-shape Excel | Incomplete rather than wrong: 1C CSV/XLSX and two PDFs exist (P4) | T2.3 (optional) |
| S13 | `problem.tsx` table | No row about documents | Gap rather than wrong | T2.2 |
| S14 | Help `api-va-integratsiyalar.mdx` (uz + ru), first sentence | "Tasnivo boshqa dasturlar bilan uch yoʻl bilan bogʻlanadi" | Didox and 1C connections now exist | T2.6 (optional); otherwise a follow-up |
| S15 | App string `didoxX.connection.hint` (`i18n-parts/didox.ts:127`, + ru) | "Hozir ishlaydigan yoʻl: Didox tokeningizni shu yerga kiriting" | Calls the token path "working" although it never met the real Didox. Not landing copy. | **Out of T2.x scope**: follow-up for the app |

Not stale (checked): the footer classifier figures (generated); the sticky CTA; the portal examples (dated); the Consequences sources; `robots.ts` (already disallows `/bank`, `/didox`, `/products`, `/onec`); the sitemap (the new section is an anchor).

---

## 5. Open questions for the owner (with the default used above)

| # | Question | Default in this brief |
|---|---|---|
| O1 | Q3 assumed the file paths are proven. They are proven only on synthetic data (P1). Badge the bank and Didox intake lines, and add the one section-wide sentence that the 1C files have not yet been loaded into a real 1C? | **Yes**, as drafted in §3.3–3.4: three line badges (bank intake, Didox intake/sync, 1C OData) plus one section sentence. The badges and the sentence go once a real bank file, a real Didox export and one load into a 1C test base are done (FINAL_REPORT §5 items 1–3). |
| O2 | Hero headline A or B (§3.1)? | **A**: keeps today's three-beat rhythm and promises "tayyorlang" (prepare), not "ready". |
| O3 | Should the hero visual stay the catalogue workspace only? | **Yes** (T2.2 says keep it; it is real). There are no document screenshots on the landing (T2.3 constraint). |
| O4 | Mention the restricted / privilege / not-purchased findings and the marking flag on the landing (row 2)? | **No** in this wave. Capabilities stays as the measured four-check story; candidate for a later Capabilities tile. |
| O5 | The pricing Q2 sentence says "hozircha" (for now). Is a separate paid tier for the modules planned? | Sentence as in Q2; prices and `PLAN_FEATURES` untouched. |
| O6 | Two eyebrows start with "Buxgalteriya": the new section and Outcomes ("Buxgalteriya firmalari uchun"). | Keep both. They read differently, and the header link targets only `#buxgalteriya`. |
| O7 | Fix the app string S15 ("Hozir ishlaydigan yoʻl") in its own small change? | Yes, as a follow-up outside the landing branch. |

---

## 6. Report

- **Files changed:** this file only (`docs/landing-2026-10-23/feature-inventory.md`). No product code.
- **How it was checked:**
  - Read the reports listed at the top.
  - Every §1.2 row was checked against routes, components, contracts, i18n strings, `plans.ts` and the domain modules' outbound calls (`bank/ai.ts`, `didox/client.ts`, `products/tasnif-client.ts`, `onec` per `onec-formats.md`).
  - Gating was checked with grep: no plan or billing check in the four modules.
  - `.env.example`, `DEPLOY.md` and the scripts were grepped for the flags.
  - `npm ci` ran in the worktree.
  - `typecheck` / `lint` / `test` were not run: the change is a markdown file.
- **Unverified here:**
  - Telegram notifications and file-to-audit (no report covers them).
  - The restricted / privilege findings' data sources (row 2: code present, not re-checked).
  - The dashboard checklist (tour scope).
- **Open questions:** §5.
