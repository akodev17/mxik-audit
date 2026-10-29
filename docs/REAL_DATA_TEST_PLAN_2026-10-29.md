# Real-data test plan (2026-10-29)

Goal: measure the matcher (main `0f5914e`, Matching v2 + catering fix) on catalogues written by real
Uzbek companies, not on files we generated ourselves. Every number we have today comes from synthetic
sets, two real lists from 2026-10-21 (metal 168, restricted construction 423) and five catalogues
that were built by an Opus session. A pilot customer's file will look like the real sources below.

## 1. Sources found (29 Oct)

Public catalogues with codes attached are rare: companies do not publish their nomenclature, and the
government e-shop's offer API refuses non-browser clients. What was obtainable:

| id | file (all under `tmp/real-catalogs/`, gitignored, main checkout) | rows | what it is | ground truth |
|---|---|---|---|---|
| P1 | `pharm/ref-prices-2026-10-01.xlsx` (sheet Лист2) | 2,070 | Pharmacy agency reference-price register, prescription drugs: brand, INN, manufacturer, **package string** ("ЭДАРБИ Таблетки 80 мг блистеры №28(2x14)"), registration number, price | the classifier's pharma identifying codes carry brand + manufacturer + form + dose + pack (e.g. `03004187009001001` "ЭДАРБИ® (Takeda Pharma), Таблетки 40 мг …"); key is derivable by brand+manufacturer+form+dose+pack and must be verified |
| P2 | `pharm/ref-prices-2026-03-01.xlsx` (sheet Лист1) | 1,894 | same register, March edition, with wholesale/retail prices | same |
| X1 | `xarid/eshop-names.txt` | ~190 unique | goods names from the government e-shop listing (xarid.uzex.uz), Russian, generic ("Радиатор алюминиевый", "Кабель UTP", "Подгузники детские") | none; a 100-row key to be built against the classifier |
| M1 | `found-catalogs/uzmetallsavdo-168.xlsx` → `eval/real-metal.csv` | 168 | Uzmetallsavdo metal price list (2023) | keyed on 2026-10-21 |
| C1 | `found-catalogs/stroy-materials-423.xlsx` → `eval/real-construction.csv` | 423 | EHF-restricted construction codes list | keyed |
| T1 | `found-catalogs/test-*.xlsx` (five) | 5×~75 | our own segment catalogues with "Javob kaliti" | keyed |

Not obtainable without the owner: Telegram group files (no API access from here), customer 1C
nomenclature exports, Didox "Мои товары" exports. The owner can drop such files into
`tmp/real-catalogs/telegram/` (xlsx/csv, any columns) and a later session keys and runs them.

## 2. Sessions

Both run on Opus in their own worktree from main, read the shared dev DB (`127.0.0.1:54329/mxik`,
classifier snapshot 442,964 codes), and never push or merge. Benchmarks run with
`RERANK_PROVIDER=off` except where stated: the Gemini key is free tier (20 requests/day).

### S1 Pharmacy (P1, P2)

1. Build `tmp/real-catalogs/pharm/apteka-2026.xlsx` as a pharmacy would write it: columns
   `Nomi` = the package string, `Birlik` = dona (or упак), `Narx` = retail price, no code column.
   Take 400 rows of P1 stratified by dosage form (tablets, injections, syrups, drops, ointments,
   infusions) and by domestic/foreign manufacturer.
2. Build the answer key semi-automatically: for each row search the classifier for the brand
   (`brandNameRu`), then narrow by manufacturer, form, dose and pack. Where exactly one code remains,
   accept. Where several remain (same brand, different pack count or packaging word), keep the
   alternatives with `|` in the key. Where none matches, mark `NOT_FOUND` and record why
   (brand absent, manufacturer differs, dose absent). Hand-check 60 rows against the classifier text.
3. Run the five-file bench harness on the file (`npm run bench:files -- --file …`), then through
   the app API (sign-in, preview, commit, report) on a fresh test org, reranker off; one more app run
   on a 100-row sample with the reranker on and the free-tier batch settings
   (`RERANK_BATCH_SIZE=25 RERANK_BATCH_WAIT_MS=5000 RERANK_MAX_CONCURRENT=2 RERANK_TIMEOUT_MS=300000`).
4. Report: top-1 and top-5 for rows with a key, NOT_FOUND precision, and a classified miss list
   (dose mismatch, pack mismatch, manufacturer mismatch, transliteration, ® and ™ marks, "№28(2x14)"
   tokens, Latin brand vs Cyrillic brand). Propose fixes in `packages/core/src/normalize` or the
   identifying-token query; implement the ones that are a clear win on P1 without moving the other
   eval sets, with tests. Append the numbers to `docs/MATCHING_V2_PLAN.md` §9.

### S2 Procurement and Russian generic names (X1, M1, C1)

1. Key 100 rows of X1: generic Russian names, often matching a position name exactly or needing a
   base code. Record for each the expected base/position code (alternatives with `|`), and
   `NOT_FOUND` for names that are service-like or too broad.
2. Build `tmp/real-catalogs/xarid/xarid-100.xlsx` (Nomi, Birlik = dona/м/кг from the listing where
   known, no code) and run bench + app as in S1 step 3, reranker off only.
3. Re-run `eval/real-metal.csv` and `eval/real-construction.csv` through `npm run eval -- --set …`
   on this main to refresh their numbers after the catering merge (expected unchanged).
4. Report as S1, with the miss classes typical of Russian generic names: base vs identifying,
   singular/plural, "прочие" catch-all positions, adjectives order. Fix what is clearly general;
   append to `docs/MATCHING_V2_PLAN.md` §9.

### S3 (later, owner-supplied files)

When the owner drops Telegram or customer files into `tmp/real-catalogs/telegram/`, one session
keys and runs them the same way. Not started now.

## 3. Pass criteria

- P1 top-1 ≥ 80% on keyed rows (pharma identifying codes are strict; dose and pack must match).
- X1 top-1 ≥ 75%, top-5 ≥ 90%.
- No eval set or five-file number drops.
- Every miss class in the reports has either a fix on the branch or a one-line reason it is deferred.
