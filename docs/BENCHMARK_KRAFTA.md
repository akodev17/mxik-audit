# Benchmark: Tasnivo vs Krafta, and five test catalogues

Written 2026-10-28 (MATCHING_V2_PLAN T3). Two repeatable measurements:

1. **The 22-query competitor set** (`eval/competitor-22.csv`): first suggestion for a bare product
   name, Tasnivo's matcher against tasnif.krafta.uz's AI-ordered site search.
2. **Five test catalogues with answer keys** (`npm run bench:files`): the whole audit (matching plus
   every check) on 60–90-row shop files, scored per finding type.

All numbers below are for the matcher on main at 99706f2, **reranker off** (no key), local
`multilingual-e5-small` vectors. They are the "before" for T1 (Gemini reranker) and T2 (ranking rules).

## 1. The 22-query set

### Method
- The queries are rows of the existing eval sets: 12 from `real-metal.csv` / `real-construction.csv`
  (seller-style Russian names), 8 from `golden.csv` (hand-written Uzbek/brand names), plus two brand
  rows (Кока-Кола, Ноутбук Lenovo). Labels are those of MATCHING_V2_PLAN §4: a full code, several
  codes, or a prefix. `07306001*` accepts any code of that 8-digit position; `07208*` accepts a whole
  class (group + class = the HS heading), for names that say no more than the heading
  (`eval/cases.ts` accepts 5-digit class prefixes since this change).
- Krafta: each query typed into the site search on 28 Oct, AI-ordered results, top-1 = the first
  result's code. The code is recorded per row in the CSV `notes` ("Krafta top-1 = …").
- Tasnivo: `npm run eval -- --set competitor-22`, the full pipeline as the audit runs it, no reranker.
  The set is reported on its own ("real set competitor-22") and kept out of the "real" totals, because
  its rows repeat golden/metal/construction rows.

### Results

✓ = top-1 right under the label, top5 = right code in the first five, ✗ = not in the first five.

| # | Query | Label | Krafta top-1 (28 Oct) | Tasnivo 28 Oct | Tasnivo now |
|---|---|---|---|---|---|
| 1 | Труба ВГП 15х2,5 | 07306001* | ✓ 07306001005015629 (the exact 15 mm / 2,5 mm code) | ✓ position | ✓ position |
| 2 | Трубы эл/св 57х3,0/3,5 | 07306001* | ✓ 07306001005000015 | ✓ | ✓ |
| 3 | Труба профильная г/к 40х20х1,5 | 07306001* | ✓ 07306001005015616 | top5 | top5 (07216001015000000) |
| 4 | Лист г/к 5,00х1500х6000 | 07208* | ✗ 11402001001000000 (a service) | top5 | top5 (07314001006000000) |
| 5 | Арматура 12 мм | 07214*\|07213* | ✓ 07214001001000311 | ✓ | ✓ |
| 6 | Песок кварцевый фр. 0-0.63 мешок 50кг | 02505001002* | ✓ 02505001002000006 | ✓ | ✓ |
| 7 | Щебень гранитный 5-20 | 02517001004* | ✓ 02517001004000115 | ✗ foam-glass gravel | top5 (07016001003000000, foam glass) |
| 8 | Штукатурка гипсовая Knauf Ротбанд 30 кг | 02520002003* | ✗ 02520002001000000 (gypsum, not plaster) | ✓ | ✓ |
| 9 | Известь гашеная пушонка 25кг | 02522003002* | ✓ 02522003002000001 | ✓ | ✓ |
| 10 | Эмаль ПФ-115 белая 2.7 кг | 03208006002* | ✓ 03208006002000002 | top5 | top5 (03209004003000003) |
| 11 | Кирпич керамический одинарный М150 | 06904*\|06901* | ✓ 06901001002000017 | ✓ | ✓ |
| 12 | Цемент М400 50 кг | 02523002* | ✓ 02523002001240011 | ✗ dental cement | top5 (03006002006000000, dental cement) |
| 13 | Kartoshka | 00701001001000000 | ✓ | ✓ | ✓ |
| 14 | Shakar-rafinad qadoqlangan 1 kg | 01701001002000000 \| …007… \| …006… | ✓ 01701001002000000 | ✓ | ✓ |
| 15 | Sement M400 50 kg qop **(debatable)** | 02523002* | ✓ 02523002001240011 | same position | ✓ |
| 16 | G'isht keramik M150 | 06901001002* \| 06904001003* \| 06904001001* | ✓ 06901001002000004 | ✓ | ✓ |
| 17 | Palov 1 porsiya | 10202001006000001 \| 10202001002000000 | ✓ 10202001006000001 | ✗ plov spice | ✗ (02103002006002022, plov spice) |
| 18 | Guruch bo'tqasi **(debatable)** | 01901001003000000 | ✗ 10202001006000004 (a catering dish) | ✓ | ✓ |
| 19 | PANADOL 500mg tabletka N12 | 03004452001001004 | ✓ 03004452001001004 (the exact brand code) | ✗ another drug | ✗ (03004322008173002) |
| 20 | Gilam sintetik 200x300 sm | 05703001005* \| 05705003001* \| 05702003001* \| 05703001003* | ✓ 05705003001000000 | ✓ | ✓ |
| 21 | Кока-Кола 1,5л пэт | 02202002001* | ✓ 02202002001010009 (an exact Coca-Cola code) | ✓ | ✓ |
| 22 | Ноутбук Lenovo IdeaPad 15 | 08471001001* | ✓ 08471001001002060 (an exact IdeaPad code) | ✓ | ✓ |
| | **top-1** | | **19/22** | **14/22** | **15/22** |
| | **top-5** | | – | 19/22 | **20/22** |

The two debatable labels:
- **Sement M400 50 kg qop (row 15).** `golden.csv` wants 02523002009000000 | 02523002008000000 (the
  M400 codes); §4 relaxes it to the position 02523002*. Both sides return 02523002001240011, which
  is a hit under §4 and a miss under golden. On 28 Oct it was counted as a miss for both, which is
  why the plan says Krafta 18/22 and Tasnivo 14/22; under §4's label it is 19 and 15.
- **Guruch bo'tqasi (row 18).** The label is the packaged good (rice porridge, 01901001003000000);
  Krafta returns the catering main dish 10202001006000004, which a cafe selling it would use.
  Counting it for Krafta gives 20/22, the plan's "20 counting two debatable labels".

Where Krafta wins: rows 3, 7, 10, 12 (our right code is in the top five, the first one is wrong), and
17 and 19, which need a catering dish and an exact brand code that our retrieval does not reach.
Where we win: 8 (Ротбанд) and, by the label, 18. Rows 1, 21 and 22 are hits for both, but Krafta
returns the identifying code (size, brand) and we return a code of the right position; T2's
`identifyingPreferred` rule targets exactly that.

### Re-running
- **Tasnivo:** `npm run eval -- --set competitor-22 --no-ablate --label "..."` (drop `--set` for every
  set; the run is appended to `docs/eval-results.json`). With a reranker key in `.env` the same command
  measures stage 6.
- **Krafta (site):** for each query open `https://tasnif.krafta.uz/en?q=<query, URL-encoded>`, wait for
  the AI-ordered list (about 9 s), and take the first "Copy code" button's 17-digit code as top-1
  (later buttons with 7-digit numbers are package codes for the receipt; skip them). In the in-app
  browser: navigate, wait 9 s, `find "Copy code"`. Write the code into the row's notes
  ("competitor benchmark <date>, Krafta top-1 = <code or MISS (code)>"); `eval/competitor.test.ts`
  checks that every note agrees with its label and pins the hit count, so update the count there.
- **Krafta (API):** https://tasnif.krafta.uz/en/api offers a free API (1 000-row batches, barcode,
  TN VED and name inputs) behind a key; not used here.

## 2. Five test catalogues

In `tmp/found-catalogs/` (gitignored, like the earlier `test-oziq-ovqat-dokoni.xlsx` and
`test-stroymarket.xlsx`). Each has the shop's data sheet first (what the app reads) and a
**"Javob kaliti"** sheet; the owner can upload the same files in the app.

| File | Rows | Data sheet and headers | Domain specifics |
|---|---|---|---|
| test-oziq-ovqat-2.xlsx | 76 | "Nomenklatura": Kod, Nomenklatura, Shtrix-kod, MXIK, O'lchov birligi, Narxi (Uzbek 1C) | Uzbek names; 19 rows with barcodes: 10 correct, 7 barcode-only, 2 where the barcode and the code name different products |
| test-stroymarket-2.xlsx | 73 | "Товары": Наименование, Артикул, Штрихкод, Код ИКПУ, ТН ВЭД, Единица измерения, Цена продажи (MoySklad) | Russian; 8 restricted codes (restricted_code, 01.07.2026); a ТН ВЭД column with the row's real HS4 heading on half the rows, and 2 rows whose heading contradicts a right code (TNVED_MISMATCH, scored only on the TN VED branch) |
| test-dorixona.xlsx | 73 | "Прайс": Наименование, Производитель, Штрих-код, ИКПУ, Ед. изм., Цена | medicines (03002–03004) named the pharmacy way: brand + dosage + form + pack ("МЕГАСЕФ® 500мг табл. N10"); classifier barcodes on half the correct rows and 9 barcode-only rows |
| test-elektronika.xlsx | 72 | "Товары": Артикул, Наименование товара, Бренд, Штрихкод, ИКПУ, Ед.изм, Цена | brand + model names (Lenovo, Samsung, Artel, LG, Shivaki, Midea, Philips, …) with identifying codes; 8 barcode-only rows |
| test-umumiy-ovqatlanish.xlsx | 69 | "Menyu": Taom nomi, MXIK kodi, O'lchov birligi, Shtrix-kod, Narxi | a cafe menu in Uzbek with portions ("Palov 1 porsiya", "Manti 5 dona", "Kapuchino 0,3 l"), services (xizmat haqi, yetkazib berish), bought-in bottled drinks with barcodes; 3 correct rows carry the unit "porsiya" |

Error mix in every file (as in the earlier generators): correct rows with noisy names, missing code
(empty cell and one placeholder: "yo'q", "нет", "-"), wrong code (another product's code from
another class; pharmacy: another position), two codes the classifier does not have, two codes with
the leading zero lost (16 digits), unit conflicts (a strictly bound code with a unit it refuses),
barcode-only rows, two exact duplicates and one row without a name.

**Answer key** ("Javob kaliti"): Excel qatori, Nom, Kutilgan natija (human label: xatosiz, kod yoʻq,
notoʻgʻri kod, …), Izoh, **Topilmalar** (the finding types the audit should raise, comma separated,
"-" = none), **Kutilgan kod** (the code a right first suggestion may carry: the source row's code
plus every live code with the same classifier name, "|" separated; restricted rows carry their
position prefix) and **Import** (dublikat / nomsiz).

**Generator** (`tmp/build-five.mjs`, not committed; `npx tsx tmp/build-five.mjs [outDir]` from the
repo root, about 7 s, deterministic). It reads the local classifier read-only with `pg`: rows are
picked per domain by `md5(code || salt)` with at most N rows per class (so one dense class such as
06810 cannot fill a pool), restricted codes are kept out of every pool except the restricted rows,
and every unit written to a "correct" row is checked with the audit's own `unitsCompatible` (unit
conflicts with the opposite check). Domain pools: food groups 004–022 (generic names, branded rows
with barcodes), construction groups 025/032/039/044/068–073/076/083/094, medicines 03002–03004 with
barcodes, groups 084/085 rows whose brand is one of twenty appliance brands, group 022 bottled drinks;
the catering menu is written by hand with its 10202 codes. Wrong codes for the catering file come
from food groups, plus two swaps inside position 10202001.

## 3. `npm run bench:files`

`scripts/bench-files.ts` reads each file with the upload's reader (`parseUpload`), maps the columns
with `guessMapping`, and runs every named row through `checkItem` (the audit's per-row check:
matching plus all checks) against the local classifier, **in memory**: no catalogue, finding or
rerank-cache row is written, so no scratch DB is needed. The scoring (`eval/bench-score.ts`, unit
tested) compares with the answer key:

- per finding type: rows expected, rows reported, true positives, precision and recall
  (privilege and purchase findings are counted as "not scored");
- **top-1** for rows without a code (MISSING expected): first suggestion within "Kutilgan kod",
  and how often it is at least in the right 8-digit position;
- **fix** for rows with a wrong or unknown code (MISMATCH / NOT_FOUND): the same for the suggestion;
- import diagnostics (duplicates, nameless rows) from `importDiagnostics`;
- the rows off the key, one line each.

```
npm run bench:files
npm run bench:files -- --file test-dorixona.xlsx
npm run bench:files -- --dir path/to/files --label "T1 reranker on" --rerank
```

`--rerank` turns on the reranker the environment configures (verdicts cached in memory only);
`--no-append` skips the record. Each run is appended to `docs/bench-results.json`
(`{ runs: [...] }`, append-only like `eval-results.json`). On a TN VED build (a `tnved` field in the
column map) the ТН ВЭД column is passed to the check as well.

### Current scores (main 99706f2 matcher, no reranker, 28 Oct)

precision / recall % per type; top-1 and fix as hits / rows.

| File | Rows | MISSING | NOT_FOUND | MISMATCH | UNIT_CONFLICT | RESTRICTED | top-1 (no code) | of which by name | fix (wrong code) | rows exactly right |
|---|---|---|---|---|---|---|---|---|---|---|
| test-oziq-ovqat-2 | 76 | 100/100 | 100/100 | 100/100 | 100/100 | – | 14/15 | 7/8 | 13/13 | 75/75 |
| test-stroymarket-2 | 73 | 100/100 | 100/100 | 100/100 | 100/100 | 100/100 | 11/12 | 8/9 | 9/11 | 70/72 |
| test-dorixona | 73 | 100/100 | 100/100 | 100/100 | 100/100 | – | 12/16 | 3/7 | 2/10 | 72/72 |
| test-elektronika | 72 | 100/100 | 100/100 | 100/100 | 100/100 | – | 12/17 | 4/9 | 6/10 | 71/71 |
| test-umumiy-ovqatlanish | 69 | 100/100 | 100/100 | **15**/100 | 67/100 | – | **5/16** | **0/11** | 2/10 | **35/68** |
| **Total** | 363 | 100/100 | 100/100 | 51/100 | 90/100 | 100/100 | 54/76 (71%) | 22/44 (50%) | 32/54 (59%) | 323/358 |

"By name" = top-1 on the rows without a code and without a barcode: all 32 barcode-only rows are
right at stage 1. Duplicates (10/10) and nameless rows (5/5) are all reported. The 2 TNVED_MISMATCH
rows of the stroymarket file are the two misses there (main has no TN VED check).

What the numbers say:
- **Catering is the gap.** Retrieval never reaches the 10202001 dish codes ("Asosiy taomlar, umumiy
  ovqatlanish shaxobchalarida tayyorlangan go'shtli" shares no word with "Palov" or "Shashlik"), so
  every correctly coded dish looks like a mismatch (33 false MISMATCH findings) and no dish without a
  code gets a right suggestion. This is §1's "catering dishes … resolve to exact codes" for Krafta.
  The two wrong codes swapped inside position 10202001 are reported only because the best suggestion
  lies elsewhere; by design (`POSITION_DIGITS`) the check cannot see a swap within one position.
- **Unit "porsiya".** The three correct rows written in "porsiya" get UNIT_CONFLICT: the code's
  binding is {dona}, although the classifier's own unit text is "dona (taom), dona (set), dona
  (portsiya)". Kept as "no finding expected" in the key; an alias for porsiya under these codes
  would fix it (debatable, so it is listed here rather than changed).
- **Identifying codes.** In pharmacy and electronics the first suggestion is usually in the right
  position (pharmacy fix 7/10, electronics 10/10) but a sibling code of the same brand (another pack,
  model or dosage): pharmacy fix 2/10, electronics 6/10 exact. This is T2's `identifyingPreferred`
  and the reranker's ground.
- Food and construction are near the ceiling because their names are classifier names with noise
  (the earlier generators' method); they guard against regressions more than they measure recall.
  Pharmacy, electronics and catering use shop-style names and are the harder half.
