# Matching v2: reranker on, top results like a search product, benchmark against Krafta

Written 2026-10-28. Goal: for a row without a code, Tasnivo's first suggestion should be right as
often as tasnif.krafta.uz's AI-ordered search, while keeping what Krafta does not have (audit of
existing codes, units, restricted codes, TN VED, decisions, clients). Nothing here changes the
rule that a person confirms every code.

## 1. Where we stand (measured 2026-10-28)

Same 22 hand-labelled queries (golden, metal, construction rows), top-1 correct:

| | Krafta (AI-ordered site search) | Tasnivo (no reranker) |
|---|---|---|
| top-1 | 18/22 (20 counting two debatable labels) | 14/22 |
| top-5 | – | 19/22 |

Why Krafta wins where it wins: (1) an LLM orders the final list; our stage 6 (Claude reranker,
`packages/core/src/match/rerank*.ts`) has never run with a key; (2) when the name carries a brand
or a size it returns the identifying code ("Труба ВГП 15х2,5" → the 15 mm / 2,5 mm code,
"PANADOL 500mg N12" → the exact product) while our `baseCodePreferred` rule (+0.05) pushes the
base code up; (3) catering dishes and brand drinks resolve to exact codes. Where we win: Ротбанд,
Guruch bo'tqasi, Щебень (both sides miss some). Full table in the session transcript of 28 Oct.

Also open: the TN VED branch `claude/eager-bardeen-e698d3` (acb57ba) is unmerged and now
conflicts with main after the accounting and bug-fix programmes landed.

## 2. Tasks (each its own worktree and branch; no file overlap by design)

### T1 Gemini reranker (packages/core rerank files only)
- New `rerank-gemini.ts`: a `RerankClient` (same shape as `ClaudeRerankClient`) calling the
  Generative Language REST API with `fetch` (no new dependency), `responseMimeType:
  application/json` + `responseSchema` built from `OUTPUT_SCHEMA`, same `SYSTEM_PROMPT` and
  `buildBatchPrompt`, timeouts, retries on 429/5xx with backoff, usage from
  `usageMetadata`.
- `rerank-config.ts`: `RERANK_PROVIDER = gemini | anthropic | off` (default: gemini when
  `GEMINI_API_KEY` is set, else anthropic when `ANTHROPIC_API_KEY` is set, else off),
  `GEMINI_MODEL` (default `gemini-2.5-flash`), `GEMINI_PRICE_INPUT_PER_MTOK` /
  `_OUTPUT_PER_MTOK` for `rerank-usage.ts`, `MXIK_GEMINI_BASE_URL` for tests; `rerank.ts`
  picks the client. `.env.example`, DEPLOY.md, README env table.
- Tests with a fake fetch: schema, parse, retry, usage, provider selection; never a real call
  in `npm test`.
- Then, with the real key (in the main checkout's `.env`; copy `.env` into the worktree, never
  commit or print it): `npm run eval` labelled "T1 gemini-2.5-flash reranker on", all sets,
  and the gate (`RERANK_GATE_CONFIDENCE`, `RERANK_GATE_MARGIN`) tuned so high-band coverage
  rises with high-band precision staying 100%; record cost per 1,000 rows and latency per batch;
  try `gemini-2.5-pro` on the golden + metal sets once and record the difference.
- Done when: eval with the reranker on beats the "off" run on golden, real-metal and
  real-construction top-1 without any set losing top-5; numbers in `docs/eval-results.json` and
  summarised in `docs/scoring.md` ("reranker on" section).

### T2 Ranking rules for top-1 (pipeline, rules, score, fusion)
- `rules.ts`: `identifyingPreferred` — when the row name carries brand or attribute tokens that
  match an identifying code's brand/attribute names (brand token overlap, a size such as
  "15х2,5", a dosage "500mg", a pack "N12", a volume "1,5л") prefer that identifying code over
  the base code; when the name is generic, keep `baseCodePreferred`. Pure, tested, measured.
- Reranker pool: `pipeline.ts` builds the 20-candidate pool from RRF; add position diversity so
  the pool holds at most N (3) codes per subposition and at least 4 positions when available,
  so the reranker can choose between positions, not only sizes; keep the fused order otherwise.
- `score.ts`: a candidate chosen by the reranker with the top LLM score and the right rule set
  may reach ≥ 0.90 (bulk-accept band) only when the reranker and retrieval agree (existing
  behaviour kept; verify and test).
- Evidence: `identifyingMatchedTokens` in `evidence.ts`, uz/ru reason line.
- Done when: eval without reranker shows no regression on any set and the 22-query set
  (`eval/competitor-22.csv`, from T3, or a temporary copy) gains the ВГП, PANADOL, Кока-Кола and
  Ноутбук exact codes at top-1.

### T3 Benchmark and five test catalogues (eval/, tmp/found-catalogs/, scripts/)
- `eval/competitor-22.csv`: the 22 queries with labels (list in §4), source `real`.
- Five test catalogues as xlsx with an answer-key sheet, built from real classifier rows like
  `tmp/build-two.mjs` did, in `tmp/found-catalogs/`: (1) oziq-ovqat do'koni (uz, 1C, barcodes),
  (2) stroymarket (ru, MoySklad, restricted codes, TN VED column), (3) dorixona (pharma, brands
  and dosages, barcodes), (4) elektronika do'koni (brands and models), (5) umumiy ovqatlanish
  (catering dishes, portions, uz). 60–90 rows each, mixed errors as before.
- `scripts/bench-files.ts` (`npm run bench:files`): audits each file through the domain audit
  function against the local DB (no browser), compares with its answer key, prints per-file
  precision/recall per finding type and the top-1 rate for rows without a code; appends to
  `docs/bench-results.json`.
- `docs/BENCHMARK_KRAFTA.md`: method, the 22-query table (Krafta numbers from 28 Oct), how to
  re-run.
- Done when: the script runs on all five files on current main and prints a summary; the owner
  can upload the same five files in the app.

### T4 TN VED branch rebased onto main
- Rebase or merge `claude/eager-bardeen-e698d3` onto current main, resolve the conflicts
  (likely `packages/db/prisma/schema.prisma`, the finding-type enum and serializers, i18n parts,
  `apps/api` modules), re-run its tests and the TN VED eval set, keep the migration
  `20261028100000_tnved` additive and tested on a scratch DB only.
- Done when: branch `claude/tnved-rebased` (or the same branch updated) merges cleanly into
  main with typecheck, lint and tests green.

## 3. Integration and merge (coordinator, after all four report)
1. Integration worktree from main: merge T4, then T2, then T1, then T3 (T3 last: it only adds
   data and scripts). Resolve anything that overlaps; run typecheck, lint, full tests
   (`delete from auth_attempt` first if sign-in suites fail on rate limit).
2. `npm run eval` with the Gemini key on all sets, and `npm run bench:files` on the five
   catalogues; compare with §1 and the T-reports.
3. Re-run the 22 Krafta queries through `tmp/probe-match.mts` with the reranker on.
4. Present the numbers to the owner; merge to main and push only after approval; then
   `prisma migrate deploy` on the local DB (TN VED migration) and `dropdb mxik_tnved`.

## 4. The 22-query set and labels

Труба ВГП 15х2,5 → 07306001*; Трубы эл/св 57х3,0/3,5 → 07306001*; Труба профильная г/к
40х20х1,5 → 07306001*; Лист г/к 5,00х1500х6000 → 07208*; Арматура 12 мм → 07214*|07213*;
Песок кварцевый фр. 0-0.63 мешок 50кг → 02505001002*; Щебень гранитный 5-20 → 02517001004*;
Штукатурка гипсовая Knauf Ротбанд 30 кг → 02520002003*; Известь гашеная пушонка 25кг →
02522003002*; Эмаль ПФ-115 белая 2.7 кг → 03208006002*; Кирпич керамический одинарный М150 →
06904*|06901*; Цемент М400 50 кг → 02523002*; Kartoshka → 00701001001000000; Shakar-rafinad
qadoqlangan 1 kg → 01701001002000000|01701001007000000|01701001006000000; Sement M400 50 kg qop →
02523002*; G'isht keramik M150 → 06901001002*|06904001003*|06904001001*; Palov 1 porsiya →
10202001006000001|10202001002000000; Guruch bo'tqasi → 01901001003000000; PANADOL 500mg tabletka
N12 → 03004452001001004; Gilam sintetik 200x300 sm → 05703001005*|05705003001*|05702003001*|
05703001003*; Кока-Кола 1,5л пэт → 02202002001*; Ноутбук Lenovo IdeaPad 15 → 08471001001*.

## 5. Environment and safety
- `GEMINI_API_KEY` lives only in `.env` (gitignored). It was pasted in a chat on 28 Oct, so it
  should be rotated after the pilot. Never commit, log or print it; tests use a fake fetch.
- Gemini free tier limits (requests per minute and per day) apply; the batched reranker must
  back off on 429 and the audit must finish without AI rather than fail (existing
  `llmRowsFailed` accounting).
- No writes to the shared DB from task sessions other than reads and evals; migrations on
  scratch DBs only.

## 6. Integration result (branch `claude/integration-v2`, 28 Oct 2026)

Merged in the planned order onto main `ddbe0e2`: T4 (`5beb5f0`), T2 (`f5cc423`), T1
(`877d425`), T3 (`47a752c`). Conflicts were only where the plan expected them (pipeline
retrieval block, evidence fields, the eval history, one comment in `eval/run.ts`); every
resolution keeps both sides. Typecheck and lint pass. Tests: see the note at the end.

### Eval, no reranker (`npm run eval --no-ablate`, run 69 of `docs/eval-results.json`)

Top-1 per set. "main" is run 48 (before TN VED); the task columns are each branch alone.

| set (n) | main | T4 alone | T2 alone | integration |
|---|---|---|---|---|
| golden (12) | 8 | 8 | 9 | **9** |
| real-construction (102) | 84 | 84 | 85 | **85** |
| real-metal (168) | 78 | 78 | 90 | **90** |
| real-tnved (49) | 32 | 48 | – | **49** |
| competitor-22 (22) | – | – | – | **16** (Krafta 18) |
| synthetic (191) | 178 | 177 | 178 | **178** |
| all real (331) | 202 (61.0%) | 218 (65.9%) | – | **233 (70.4%)** |

No set lost a case against any single task branch; real-tnved gained one over T4 alone
(the identifying query reaches the exact size inside the heading).

Still missed on the 22 without the reranker (6): Труба профильная г/к 40х20х1,5 (rank 2),
Лист г/к 5,00х1500х6000 (rank 5), Щебень гранитный 5-20 (rank 2), Эмаль ПФ-115 белая 2.7 кг
(rank 2), Цемент М400 50 кг (rank 3), Palov 1 porsiya (the dish code is not in the pool).

### Five test catalogues (`npm run bench:files`, run 2 of `docs/bench-results.json`)

| file | top-1 (no code) main → integration | fix (wrong/unknown code) main → integration |
|---|---|---|
| test-oziq-ovqat-2 | 14/15 → 14/15 | 13/13 → 13/13 |
| test-stroymarket-2 | 11/12 → 12/12 | 9/11 → 10/11 |
| test-dorixona | 12/16 → 12/16 | 2/10 → 7/10 |
| test-elektronika | 12/17 → 13/17 | 6/10 → 6/10 |
| test-umumiy-ovqatlanish | 5/16 → 5/16 | 2/10 → 3/10 |
| **total** | **54/76 (71.1%) → 56/76 (73.7%)** | **32/54 (59.3%) → 39/54 (72.2%)** |

### With the Gemini reranker (`gemini-3.1-flash-lite`, free tier, batch 25; bench run 3, eval run 71)

| file | top-1 off → on | fix off → on |
|---|---|---|
| test-oziq-ovqat-2 | 14/15 → **15/15** | 13/13 → 13/13 |
| test-stroymarket-2 | 12/12 → 12/12 | 10/11 → **11/11** |
| test-dorixona | 12/16 → **13/16** | 7/10 → 6/10 |
| test-elektronika | 13/17 → **15/17** | 6/10 → **9/10** |
| test-umumiy-ovqatlanish | 5/16 → 6/16 | 3/10 → 2/10 |
| **total** | **56/76 (73.7%) → 61/76 (80.3%)** | **39/54 (72.2%) → 41/54 (75.9%)** |

Rows with exactly the expected findings: 325/358 off → 327/358 on. Every finding type keeps
100/100 precision/recall outside the cafe menu; on the grocery file two right codes were
re-ranked away (MISMATCH precision 82%), the price of the reranker's override.

**22-query set with the reranker: 20/22 top-1, 21/22 top-5** (off 16/22; main before this
programme 14/22; Krafta 18/22). 18 rows were sent in 3 calls, none failed, est. $1.14 per
1,000 catalogue rows. The two misses: Труба профильная г/к 40х20х1,5 (the reranker keeps a
7216 profile code at rank 1; the 7306 code is rank 2) and Palov 1 porsiya (§7, not in the
pool).

Summary for the owner: main 54/76 → 61/76 on the five files, 14/22 → 20/22 on the Krafta
set, with a reranker costing about $0.001 per row that needs a paid key for pilots.

Finding precision/recall is 100/100 for MISSING, NOT_FOUND, RESTRICTED and TNVED_MISMATCH on
every file. MISMATCH precision is 51% only because of the cafe menu: 33 dish rows with a right
10202 code are flagged because a prepared dish never reaches the candidate pool (T3's finding,
§7 below). Outside that file MISMATCH precision is 100%.

## 7. Open after integration (not in this branch)

- **Catering dishes never reach the pool.** The 10202001 dish codes are named "Asosiy taomlar,
  umumiy ovqatlanish shaxobchalarida tayyorlangan …", which shares no word with "Palov",
  "Shashlik" or "Norin". On the cafe menu every correctly coded dish is reported as MISMATCH (33
  false findings) and no dish without a code gets the right suggestion; "Palov 1 porsiya" is the
  one 22-query miss the reranker cannot fix because the code is not among the candidates. Fix
  candidates: a dish → 10202 synonym table (normalize/synonyms.ts) or a dish lexicon
  (`docs/BENCHMARK_KRAFTA.md` §3).
- **Unit "porsiya".** Rows written in "porsiya" get UNIT_CONFLICT under codes whose binding is
  {dona} although the classifier's own unit text says "dona (portsiya)"; an alias would fix it
  (listed as debatable in `docs/BENCHMARK_KRAFTA.md`).
- **Paid Gemini key.** The free tier allows 20 requests a day per model and only
  `gemini-3.1-flash-lite` answers reliably (`docs/scoring.md`, "What a free-tier key can and
  cannot do"); a pilot needs Tier 1. Rotate the key that was pasted into chat on 28 Oct.
- **Scratch databases.** `mxik_tnved` and `mxik_scratch` are stale (older than main) and
  `mxik_v2` is the copy used for the integration test run; all three can be dropped once the
  migration is on the local DB.

## 8. Catering blind spot closed (branch `claude/stoic-bhabha-5b8b93`, 28 Oct 2026)

§7's first item. On the cafe menu every correctly coded dish was reported as MISMATCH and no
dish without a code got the right suggestion, because a prepared dish never reached the
candidate pool: the menu codes of position 10202001 are named by family ("Asosiy taomlar, umumiy
ovqatlanish shaxobchalarida tayyorlangan go'shtli"), never by dish, so "Palov", "Lag'mon" or
"Somsa" share no word with them.

### Diagnosis (no reranker, the cafe file alone, bench run "catering baseline")

Per retrieval stage, where the first code of group 10202 appeared for five failing rows:

| row | lexical query | trigram | full-text | identifying | vector (uz) | pool of 20 | top-1 |
|---|---|---|---|---|---|---|---|
| Palov 1 porsiya | `palov` | none (50 hits, all "palov uchun" seasonings) | none | none | none | none | 02103002006002022 seasoning |
| Sho'rva 1 kosa | `shorva kosa` | none (1 hit) | none ("shorva" ≠ "sho'rvalar", no stemming) | none | none | none | 06911001012000000 porcelain bowl |
| Mol go'shtli shashlik 1 six | `mol goshtli shashlik six` | none | none (50 sausage codes on "mol go'shtli") | none | none | none | 08215001020000000 skewer |
| Manti 5 dona | `manti` | none (frozen dumplings 01905999) | none | none | none | none | 01905999001171009 |
| Tovuq kabob 1 porsiya | `tovuq kabob` | none | none (raw chicken 00207) | none | none | none | 00207001001000000 |

Two rows that do share a word reached the pool and still lost: "Makaron sabzavotli 1 porsiya"
(10202001006000004 at trigram rank 6, pool rank 20, final rank > 5) and "Olivye salati 1 porsiya"
(10202001003000000 at full-text rank 5, pool rank 6, final rank 3 at 0.46). Two reasons: the
raw-food codes carry the same words with trigram and vector support, and the old prepared-dish
rule gave +0.08 to *base* codes and −0.10 to every other code, which in the menu position (whose
family codes are not base codes) pushed the right code *down* and lifted a seasoning base code.

### Fix (retrieval, ranking, unit)

1. **Catering lexicon** in `packages/core/src/normalize/synonyms.ts`, 43 entries in the same
   table as the construction synonyms, group `catering`. A dish word adds its family's official
   wording to the lexical query (Uzbek Latin words of the code name plus the one Russian word only
   that family has, "с мясом" against "с птицей"): trigram then scores the near-complete name,
   full-text selects the position on its rare words and ranks the family on the distinguishing
   ones. The seller's word stays (vector stage, relevance guard, evidence). Three kinds of entry:
   - **anchor**, fires alone: dish names (palov/osh/plov, lag'mon, dimlama, norin, manti, somsa,
     chuchvara, pelmeni, omlet/quymoq, sho'rva/shurpa/mastava/moshxo'rda, vinegret/olivye/sezar/
     achchiq-chuchuk, gamburger/shaurma/pitsa, gazak, garnir/fri, tuzlama, kapuchino/latte/
     espresso, mojito, biznes-lanch, xizmat haqi, olib ketish, banket, keytering, chilim), the
     protein-neutral mains (shashlik, kabob, steyk, grill, nuggets) and "taom";
   - **contextual**, fires only in a cafe's context: words a shop sells too (choy, kofe/qahva,
     kompot/limonad, non/lavash, makaron, salat, tort/chak-chak/pechenye, muzqaymoq, meva,
     assorti, desert, kokteyl, nonushta, servis, ijara, qovurilgan). The context is a serving
     word in the name as written (porsiya, kosa, six, bo'lak, stakan, choynak, krujka, grafin,
     "uy usulida", zal, stol, restoran, kafe…), a portion unit on the row, another catering entry
     firing, or the row's own code lying in group 10202 (the uploader says it is a cafe row; the
     name still has to win inside the group);
   - **qualifier**, fires only after the group fired, to pick the main-course family: mol/qo'y/
     go'shtli/qazi → go'shtli с мясом; tovuq/parranda → с птицей; baliq/losos/sazan → с рыбой;
     tuxum → из яиц; sabzavot → из овощей. Raw chicken or eggs in a grocery list fire nothing.
   Every anchor is blocked by a grocery word beside it (muzlatilgan, yarim tayyor, qadoq, konserv,
   "uchun"/"для", ziravor, sous, quruq, konsentrat…): "Palov uchun ziravor" and "Chuchvara
   muzlatilgan 1 kg" are products, not dishes. Entries and the codes they aim at: meat mains
   10202001006000001, poultry …002, fish …003, vegetables/grain/pasta …004, flour …005, eggs …006;
   soups 10202001004000000; salads 10202001003000000; fast food 10202001002000000; snacks
   10202001001…; garnish 10202001007000001; bread 10202001005000001; desserts 10202001008001–003;
   tea 10202001010000001, coffee …002, compote/lemonade …003; cocktails 10202001011000001; set
   meals 10202001009001–003; service charge 10202002003000001, takeaway containers 10202002005,
   rental 10202002002, hookah 10202002003000005; banquets 10202003002, catering 10202003001.
2. **Ranking rule** (`rules.ts`): `preparedDishBase`/`preparedDishSpecific` became
   `cateringPreferred` (+0.08 for a code of group 10202 when the row reads as a food-service item,
   with the base-code and marking shape rules silent inside the group) and `cateringOutside`
   (−0.10 for every other code). The row reads as a food-service item when a catering entry fired;
   `rules.ts isPreparedDish` and its separate word list are gone. Labels in `packages/i18n`,
   tones in `row-signals.ts`, table in `docs/scoring.md`.
3. **Unit alias** (`normalize/units.ts`): "porsiya", "portsiya", "порция", "порц." resolve to
   `dona`, as the classifier itself canonicalises "dona (portsiya)" (no live code binds the
   official unit 50); an alias now wins over the reading derived from a parenthesised qualifier.
   The full form "dona (porsiya)" still resolves to 50. UNIT_CONFLICT no longer fires on the three
   portion rows.

### Five test catalogues (`npm run bench:files`, run 2 → run 4 of `docs/bench-results.json`, no reranker)

| file | rows exactly right | top-1 (no code) | fix (wrong/unknown code) | MISMATCH precision |
|---|---|---|---|---|
| test-oziq-ovqat-2 | 75/75 → 75/75 | 14/15 → 14/15 | 13/13 → 13/13 | 100 → 100 |
| test-stroymarket-2 | 72/72 → 72/72 | 12/12 → 12/12 | 10/11 → 10/11 | 100 → 100 |
| test-dorixona | 72/72 → 72/72 | 12/16 → 12/16 | 7/10 → 7/10 | 100 → 100 |
| test-elektronika | 71/71 → 71/71 | 13/17 → 13/17 | 6/10 → 6/10 | 100 → 100 |
| test-umumiy-ovqatlanish | 35/68 → **66/68** | 5/16 → **15/16** | 3/10 → **10/10** | 15 → **100** |
| **total** | **325/358 → 356/358** | **56/76 (73.7%) → 66/76 (86.8%)** | **39/54 (72.2%) → 46/54 (85.2%)** | 51 → 100 |

The other four files are identical row for row. UNIT_CONFLICT precision on the cafe file 67 → 100.
The three cafe rows still off the key: "Kompot 1 stakan" and "Qo'y go'shtli shashlik (1 six)",
wrong codes inside position 10202001 (the first suggestion is now the right code in both, but
MISMATCH is by design position-level and cannot see a swap inside one position, `POSITION_DIGITS`);
"Chak-chak 200 g" with no code and no serving word in the name, which stays a confectionery product
(10202001008000002 would need a cafe context the row does not give).

### Eval (`RERANK_PROVIDER=off npm run eval -- --no-ablate`, run 70 → run 72 of `docs/eval-results.json`)

| set (n) | top-1 before → after | top-5 before → after |
|---|---|---|
| golden (12) | 9 → **10** | 9 → **10** |
| real-construction (102) | 85 → 85 | 94 → 94 |
| real-metal (168) | 90 → 90 | 166 → 166 |
| real-tnved (49) | 49 → 49 | 49 → 49 |
| competitor-22 (22) | 16 → **17** | 21 → **22** |
| synthetic (191) | 178 → 178 | 187 → 187 |
| all real (331) | 233 (70.4%) → **234 (70.7%)** | 318 → **319** |

No set lost a case. The gain is "Palov 1 porsiya" in golden and in the 22-query set (§6 listed it
as the one miss the reranker could not fix because the code was not in the pool; it is now
top-1 at 0.86 without a reranker). "Guruch bo'tqasi" stays on the porridge code (no dish word).

Tests: `npm test` 2,123 tests, 2,121 pass, 0 fail, 2 skipped (both Redis-only); typecheck clean;
lint 0 errors, 1 pre-existing warning (`scripts/lib/xlsx.ts`). New unit tests: the lexicon
(every entry, context, qualifiers, grocery guards, phrases), the unit alias, the catering rule,
the pipeline note.

**Quota note.** The first eval run of this branch was started without `RERANK_PROVIDER=off` and
picked up the free-tier Gemini key from `.env`: 285 calls, 433 of 456 rows failed on quota, the
run was not appended (removed before commit) and repeated with the reranker off. Run benchmarks
on this key with `RERANK_PROVIDER=off` unless the reranker is the point; the key's day quota is
likely spent until 07:00 UTC.

Still open from §7: the paid Gemini key and the scratch databases.

## 9. Real data: pharmacy (session S1 of `docs/REAL_DATA_TEST_PLAN_2026-10-29.md`, 29 Oct 2026)

**The file.** `tmp/real-catalogs/pharm/apteka-2026.xlsx` (main checkout, gitignored): 400 rows of
the Pharmacy agency's 1 Oct 2026 reference-price register (`ref-prices-2026-10-01.xlsx`, 2,070
rows), stratified by dosage form and origin (tablets 85, capsules 32, injections 75, infusions
75, powders 44, and the small strata whole: drops 27, sprays 20, suppositories 18, suspensions
11, syrups 5, ointments 5, oral solutions 3; 168 Uzbek, 232 foreign). Columns as a pharmacy
writes them: `Nomi` (the register's "Упаковка ЛП" string verbatim, e.g. "ЭДАРБИ Таблетки 80 мг
блистеры №28(2x14)"), `Birlik` (упак for "№N" > 1, else dona), `Narx` (limit price in sum + 20%),
no code column. Built by `build-apteka.mjs` from the register and the classifier dump
(`dump-data.mjs`), deterministic.

**The key** ("Javob kaliti", the five test files' layout; every row expects MISSING). Per row,
among live non-base group-030 codes: (1) brand: the register's trade mark equals the classifier
brand without its "(maker)", folded (®/™/*, case, ё, hyphens, spaces, Latin look-alike letters in
Cyrillic words; else the first words of the pack string; else both transliterated to Latin,
"Неуропаин" = "Neuropain"); (2) coarse dosage form; (3) dose: the
multiset of strengths and volumes (g→mg, mcg→mg, ratios reduced, "40 мг/12,5 мг" = "40 мг + 12,5
мг"), with fall-back tiers for the same numbers written differently, a code that omits part of
the dose, or a row that does; (4) pack count "№N" (none = 1); (5) the maker label sharing a word
with the register's manufacturer; (6) packaging words (блистеры / упаковки контурные ячейковые,
флаконы / бутылки) and exact text; (7) a code of another registrant with the same brand, dose and
pack whose text fits the row as well stays as an alternative, since the row names no
manufacturer (8 rows; the maker-only "strict" key is kept too). Result: 371 rows with a key
(359 one code, 12 with `|` alternatives), 29 NOT_FOUND: brand absent 11, dose or fill volume
absent 15 (mostly a 100 ml bottle where the classifier has only 200 ml), pack absent 3. 167
rows were read by hand against the classifier names (two 1-in-7 samples, every alternative,
tier and NOT_FOUND row); 6 hand corrections, each with its reason in the script (`OVERRIDES`):
two register typos ("50 мг/1.25 мг", "50 флаконы"), one classifier typo (ЦЕФЗОСУЛ 2 written
"100 мг + 1000 мг"), a fill-volume mismatch, a brand field naming two brands ("ЛОРКАР®, ЛОРКАР®
ФОРТЕ") and a registrant the fold missed ("ГИДРОКСИЭТИЛКРАХМАЛ (ГЭК)").

### Diagnosis (no reranker, main `0ddcc4d`)

Top-1 61.2%, top-5 73.0% on the 371 keyed rows. 123 of the 144 misses were another brand's
code: the brand is the only rare word of a pharmacy name ("ЭНАМ" is in 8 codes, "таблетки" in
14,234) and full-text has no IDF, so codes that repeat "раствор для инфузий … флаконы" twice
(НИРМИКС™, Декарин, СМОФКАБИВЕН®) outranked the brand's own code, which for 96 rows never
reached the top five. The pack token made it worse: "№100(10x10)" left "100" in the query
(codes repeating 100 anywhere ranked up) and its "(10x10)" was read as a size, so 9 misses' top
codes "earned" identifying on 10x10. The rest were siblings of the right brand: another
strength (micrograms and per cents were not measures: "250 мкг" vs "125 мкг", "0,1%" vs "1%"),
the box of ten for a row naming one vial, or a sibling without the row's dose.

### Fix (retrieval and ranking, `packages/core`; rules in `docs/scoring.md`)

- **Anchored full-text** (`store.ts byFullText(…, { anchored: true })`): the identifying query
  plus the row's two-letter words ("RG"), selecting only on words in at most 50 codes, else in
  under 1,000; numbers never select. Term counts are now cached from 50 codes up.
- **Brand list**: the anchored hits whose brand the row names (`identifying.ts namesBrandOf`: the
  brand matches and the code's own part repeats an attribute or a row word) enter fusion as a
  fourth list.
- **`otherBrand` −0.10** once such a code exists, for codes of another brand or of a shorter
  brand inside the named one ("ИРБЕСАН" for "КО-ИРБЕСАН 300"), unless their names carry the
  named brand ("PEPSI, Pepsi Max"); a brand's one-letter suffix must be in the row ("Ситафор-M").
- **Pack and strength tokens**: "№28(2x14)" is a pack of 28 with a breakdown, never a size, and
  the same breakdown is one more attribute; "№N" leaves the lexical query and comes back in the
  identifying query as a number; "10шт." is a pack; a code's №N > 1 contradicts a row naming no
  pack; micrograms and per cents are measures (so another strength contradicts); measures in
  parentheses count only for a kind the name does not state ("1,5 г (1,0г+0,5г)"); a trade mark
  splits words in full-text as Postgres splits the classifier ("КАРЛОН®ПЛЮС").
- **`identifyingPreferred`** +0.01 per attribute beyond the first (at most +0.03), so the
  sibling with the row's dose and pack ranks first.
- UI: `otherBrand` labels (uz, ru) and a warn tone in the row signals.

### Pharmacy file (no reranker; bench run 7 → run 8 of `docs/bench-results.json`)

| | before | after |
|---|---|---|
| top-1, 371 keyed rows | 227 (61.2%) | **356 (96.0%)** |
| top-1, strict maker key | 224 (60.4%) | **351 (94.6%)** |
| top-5 | 271 (73.0%) | **364 (98.1%)** |
| right position (8 digits) | 272 | 367 |
| findings exactly as keyed (all MISSING) | 400/400 | 400/400 |
| first suggestion "likely" (≥ 0.75): right / wrong | 189 / 24 | 283 / 7 |
| NOT_FOUND rows (29): first suggestion "check" / "likely" | 26 / 3 | 26 / 3 |

By stratum after: infusions, sprays, suppositories, drops, syrups, ointments and foreign tablets
100%; injections 66/69, powders 34/39 (Uzbek powders 7/10), capsules 28/32, Uzbek tablets 28/30. NOT_FOUND: the
matcher has no "no code fits" answer without a reranker; 26 of the 29 rows where none fits get a
"check" (low) first suggestion, 3 a "likely" one; a "check" label is not a NOT_FOUND signal on
its own (73 right answers carry it too: precision 26/107, recall 26/29).

**Misses by class** (the plan's classes; one row, one class; "before" from the automatic
classifier `classify-misses.mjs` over the stored per-row results):

| class | before | after | after: what is left, fix or reason deferred |
|---|---|---|---|
| another brand ranked first (brand not retrieved, or outranked by look-alike codes) | 101 | 3 | ЗЕТАЛИН "250 мг/мл" vs the code's "500 мг/2мл" (concentration, below), ЛИФОТАМ 2 and АПРОТОКС ("10000АТрЕ" glued): one-offs, deferred |
| … the same, name with ® ™ * | 16 | 1 | "milgamma® N" loses to "МИЛЬГАММА®" (Latin vs Cyrillic sibling brand, text equal to the row); the mark-specific failure (glued "КАРЛОН®ПЛЮС") is fixed |
| Latin letters in a Cyrillic brand | 5 | 1 | "ФЛУКОНАЗОЛ-RG" not retrieved ("RG" is in 205 codes, the anchor needs under 50); deferred |
| transliteration: Cyrillic name, Latin brand in the classifier | 1 | 1 | "Юниронтин" is "Unirontin (Unimed)": the row has no Latin token to search with (Неуропаин = "Neuropain" is found by the vectors). Deferred: a transliterated brand query (ю = u) is its own change |
| dose or volume mismatch, same brand | 12 | 5 | 2 data errors (register "50 флаконы", classifier ЦЕФЗОСУЛ typo); АМБРОКСОЛ "15 мг/мл" vs "15 мг/2 мл": a concentration-aware measure (mg/ml) is its own change, deferred; ТЕКНАЗОЛ (a sibling without the dose wins a tie) and БЛОКФАЗОЛ (vial vs "№1"): ties a reranker decides |
| pack mismatch, same brand | 6 | 2 | Метронидазол №100 ×2: an INN used as brand by 30+ registrants, the key's code not retrieved; deferred (needs the manufacturer column) |
| pack tokens "№28(2x14)" read as a size (cross-cutting) | 9 | 0 | fixed |
| packaging words, same brand | 3 | 2 | СПАРЕКС (3x10) vs (2x15), ФОРСИЛ №50 vs №50(50x1): ties without a reranker |
| manufacturer / registrant | 8 key rows took alternatives | 0 | the name carries no manufacturer; reading a Производитель column is the real fix (deferred: `guessMapping` and the identifying rule would need it) |
| brand absent from the classifier | 11 rows, NOT_FOUND | 11 | not a matcher miss; see NOT_FOUND above |
| **total misses** | **144** | **15** | |

### Through the app (fresh test org, credentials in `tmp/found-catalogs/test-account.txt`)

Sign-in, preview, commit, report on an API (port 4031) started from this branch. Reranker off,
400 rows: the mapping read Nomi/Birlik/Narx unaided, 400 MISSING, top-1 356/371 (the same rows
as the harness), 211 s. Reranker on (`gemini-3.1-flash-lite`, free tier, batch 25, wait 5 s, 2
concurrent, timeout 300 s), 100-row sample `apteka-2026-100.xlsx` (91 keyed): top-1 88 →
**89**/91; 65 rows reach the high band (≥ 0.9, bulk-acceptable), all 65 right; of the 9 NOT_FOUND
rows none is in the high band, 3 are "likely"; 8 rows (one batch's tail) fell back to fusion, no
quota error; 160 s. (The run also caught a key error: "Неуропаин", first keyed as brand absent,
is the classifier's Latin "Neuropain"; the key now falls back to transliterated brands.)

### No regression elsewhere (no reranker)

Five test files (bench run 5 → run 6): top-1 66/76 → **70/76** (dorixona 12 → 13/16,
elektronika 13 → 16/17), fix 46/54 → **49/54** (elektronika 6 → 9/10); every finding type's
precision and recall and the 356/358 exact rows unchanged; no file lost a row.

Eval (`npm run eval -- --label "pharmacy fix" --no-ablate`, run 73 → run 74 of
`docs/eval-results.json`):

| set (n) | top-1 before → after | top-5 before → after |
|---|---|---|
| golden (12) | 10 → 10 | 10 → 10 |
| real-construction (102) | 85 → 85 | 94 → 94 |
| real-metal (168) | 90 → 90 | 166 → 166 |
| real-tnved (49) | 49 → 49 | 49 → 49 |
| competitor-22 (22) | 17 → 17 | 22 → 22 |
| synthetic (191) | 178 → 178 | 187 → 187 |

One case moved (synthetic row 2, rank 4 → 3). Two intermediate versions did move sets and were
changed before landing: the "longer brand" rule cost the cafe file "PEPSI Pepsi Max, 0,5 l"
(the PEPSI code names Pepsi Max in its attributes: now exempt), and brand matching through the
position's words ("barcha turdagi") sent two synthetic rows with an injected brand to a Nestle
juice (now the code's own part must repeat the row).

Tests: `npm test` 2,161 tests, 2,159 pass, 0 fail, 2 skipped (Redis-only); typecheck clean; lint 0
errors, 1 pre-existing warning (`scripts/lib/xlsx.ts`). New unit tests: pack breakdown, micrograms
and per cents, the query key, the identifying pack/strength/brand-suffix rules, `namesBrandOf`,
`otherBrand`, the per-attribute step, anchored selection, the brand list in the pipeline.

## 10. Real data: procurement names (session S2 of `docs/REAL_DATA_TEST_PLAN_2026-10-29.md`, 29 Oct 2026)

Branch `claude/peaceful-albattani-b7150e`, from main `0ddcc4d`. Not pushed, not merged. §9 is S1's
(pharmacy); both sections append to this file and to the two results histories, so a merge keeps both.

### Source and key

100 of the 183 unique goods names listed on the government e-shop (`tmp/real-catalogs/xarid/eshop-names.txt`,
main checkout, gitignored): Russian, generic, no codes, no units. Picked to cover electrics (22), medical and
lab (15), office and IT (11), household chemicals (11), food and farm (6), construction and plumbing (18),
vehicle parts (8), services (5) and broad names (4). Each name was keyed against the classifier in the shared
DB (subposition names and leaf names, `psql`), with the reasoning in the key's `Izoh` column:

- a generic name gets its subposition: the base code and the subposition prefix (`…000000|…*`), as
  `real-construction.csv` does; equally right subpositions are `|` alternatives (mineral, synthetic or
  semi-synthetic motor oil; a pump or the engine coolant pump; road, rail, water or air freight);
- a name that only a position can hold gets the position prefix (`Сумка` → `04202001*`, `Мясо индейки`
  → `00207004*`, `Канцелярская книга` → `04820001*`);
- 2 names are `NOT_FOUND` (too broad for any position): "Химические реактивы", "Средства реабилитации".
  Services that have a code are keyed like goods (the classifier has service positions).

Files: `tmp/real-catalogs/xarid/xarid-100.xlsx` (sheet "Xarid": Nomi, Birlik; sheet "Javob kaliti" in the
five-file layout), its sources `xarid-100-key.tsv` and `build-xarid.cjs` beside it, and the 98 keyed rows as
the new real eval set `eval/real-xarid.csv` (a NOT_FOUND row has no code to score). The listing has no units;
`Birlik` is шт unless the product is sold otherwise (кг, л, м, м2, т, пар, мл, услуга).

Key corrections after the first baseline, all from evidence in the classifier: "Фотометры медицинского
назначения (ИФА)" is an exact leaf of 9018 "прочие" medical apparatus (`09018001229000031`, added); metal
blinds have a 7314 leaf "Жалюзы из горячеоцинкованный…" (added); aluminium radiators are HS 7616 and the
classifier has "Радиатор алюминиевый секционный" leaves in 7616 (added). Four invented units contradicted the
keyed code's strict unit (antiseptic in л, rubber gloves in шт, glass cleaner in шт, eau de toilette in шт)
and were set to the code's unit. Five rows whose every keyed base code is EHF-restricted (asphalt, linoleum,
plastic pipes, aluminium doors, power-line poles) expect `MISSING,RESTRICTED`: the right suggestion is flagged.
All before/after numbers below use the final key.

### Step 3: metal and construction refreshed

`RERANK_PROVIDER=off npm run eval -- --no-ablate` on this main (run 73, with `--no-vector-fill --no-head-rule
--no-base-for-leaves`, which is main's ranking): real-construction 85/102 top-1, 94 top-5; real-metal 90/168,
166 top-5. Identical to §8 (run 72). An earlier run on the untouched main code gave the same.

### Diagnosis (per stage, `tmp/diag-xarid.ts` in the worktree, gitignored)

Baseline 62/98 top-1, 76/98 top-5. Three mechanisms explained most misses:

1. **Renormalised lexical-only leaves.** A code that only trigram found is scored over lexical and RRF
   alone (score.ts renormalises over present signals), so an identifying leaf whose long text shares one
   word with a generic name scored ~0.6-0.8 and beat the code the vector stage ranked first: a first-aid kit
   for "Бинт гипсовый", vaccines "для взрослых" for "Подгузники для взрослых", liver drugs for "Средства
   моющие", "Разбавитель антиграффити" for "Разбавитель", connector leaves named "Коммутатор 32 порта".
2. **Head noun ignored.** Russian procurement names put the product noun first or after adjectives; trigram
   rewards any shared word, so "Люцерна кормовая" beat "Морковь" for "Морковь кормовая", "Подшлемник рабочий"
   beat clutch parts for "Рабочий цилиндр …", "Контроллер электрический" beat "Сетевой фильтр (удлинитель)",
   "Тонер для принтера" beat "Принтеры всех видов".
3. **Base code never retrieved.** For "Кабель UTP", "Реле защитное", "Водяной насос" the right subposition
   arrived only as identifying leaves (each penalised as an unearned identifying code); its base code never
   made a list.

### Fixes (commit `ce6558c`; each can be switched off, eval flag in brackets)

1. **Vector score for pool codes** (pipeline `fillVectorScores`, store `cosinesFor`; `--no-vector-fill`): a
   pool code the vector stage did not return gets its cosine by primary key. Exempt: a code the row earns
   by brand or size (`identifyingPreferred`), whose long leaf is far from a short query whether or not it
   is right (without the exemption "МЕЛЬДОНИЙ 10% р-р N5" lost its fix in the dorixona file), and the row's
   own code (without it a correct cafe code got a false MISMATCH).
2. **`headNounMismatch` −0.05** (rules.ts, `normalize/russian.ts`; `--no-head-rule`): a Russian row's head
   noun, number-blind ("Принтер" = "Принтеры"), must be among the nouns the code's Russian name offers as
   what it is (each listed item's first non-adjective word before a preposition). Uzbek and Latin rows are
   never judged. −0.03 lost 2 xarid rows against −0.05; −0.08 gained no top-1.
3. **Base code for unearned leaves** (pipeline `basesForLeaves`, store `lexicalFor`; `--no-base-for-leaves`):
   when the pool holds identifying codes of a subposition and the row earns none, the subposition's base
   code joins the pool, scored on its own name (trigram and cosine by key) and ranked in fusion like its best
   leaf. Only for names without a digit and not for catering rows.

Tried and dropped (each measured with the full eval): Russian singular/plural variants in the full-text
query (real-metal top-5 166 → 164, and 115 without the head rule: "трубы" lifts 7304 "Трубы из черных
металлов" over 7306 "Стальная труба"); a trigram score by key for every pool code (xarid −1 top-1, −2
top-5) or for base codes only (same); a base code inheriting its leaves' signals (metal top-1 +33 but top-5
166 → 143, construction −5, synthetic −11), and the same for sized rows.

### Before / after (no reranker)

xarid-100 (`npm run bench:files`, bench runs 5 → 7; eval set real-xarid, eval runs 73 → 74):

| | before | after |
|---|---|---|
| top-1 (98 keyed rows) | 62 (63.3%) | **72 (73.5%)** |
| top-5 (eval) | 76 (77.6%) | **83 (84.7%)** |
| right position at top-1 | 66 | 76 |
| rows with exactly the expected findings | 93/100 | **96/100** |
| MISSING precision/recall | 100/100 | 100/100 |
| RESTRICTED (5 expected): true / raised | 1 / 4 | 2 / 3 |

No xarid row lost its top-1. Gained: Бинт гипсовый марлевый, Жалюзи оконные, Кабель UTP, Коммутатор,
Морковь кормовая, Подгузники для взрослых, Подшипники качения роликовые…, Рабочий цилиндр усилителя…,
Разбавитель, Удлинитель электрический.

Five test catalogues (bench runs 6 → 8): identical row for row except one gain.

| file | top-1 (no code) | fix (wrong/unknown code) | rows exactly right |
|---|---|---|---|
| test-oziq-ovqat-2 | 14/15 → 14/15 | 13/13 → 13/13 | 75/75 → 75/75 |
| test-stroymarket-2 | 12/12 → 12/12 | 10/11 → 10/11 | 72/72 → 72/72 |
| test-dorixona | 12/16 → 12/16 | 7/10 → 7/10 | 72/72 → 72/72 |
| test-elektronika | 13/17 → 13/17 | 6/10 → **7/10** | 71/71 → 71/71 |
| test-umumiy-ovqatlanish | 15/16 → 15/16 | 10/10 → 10/10 | 66/68 → 66/68 |
| **total** | **66/76 → 66/76** | **46/54 → 47/54** | **356/358 → 356/358** |

The baseline equals §8's run 4. Every finding type keeps its precision/recall.

Eval (`RERANK_PROVIDER=off npm run eval -- --no-ablate`, runs 73 → 74):

| set (n) | top-1 before → after | top-5 before → after |
|---|---|---|
| golden (12) | 10 → 10 | 10 → 10 |
| real-construction (102) | 85 → **86** | 94 → **96** |
| real-metal (168) | 90 → **93** | 166 → 166 |
| real-tnved (49) | 49 → 49 | 49 → 49 |
| real-xarid (98) | 62 → **72** | 76 → **83** |
| competitor-22 (22) | 17 → 17 | 22 → 22 |
| synthetic (191) | 178 → **179** | 187 → 187 |
| all real (429) | 296 (69.0%) → **310 (72.3%)** | 395 → **404** |

No set dropped. One case did: "Truba PPR 20 mm" (real-construction) went from top-1 to rank 2 (vector fill),
against three construction cases gained ("Лак для дерева ПФ-283 0.8л" and "Кирпич силикатный белый
одинарный" to top-1, "Проволока вязальная 1.2мм" into the top 5) and three metal sheet/profile rows gained.

App flow (API on 4011 from this worktree, local e5, reranker off, the 2026-10-28 test org): sign-in,
preview, commit, ready after 12 s; the report scored against the key gives the same 72/98 top-1, 96/100
rows with the expected findings, MISSING 100/100, RESTRICTED 2 of 5 (3 raised). Saved as
`tmp/real-catalogs/xarid/app-xarid-100.json`.

### Miss classes (98 keyed rows; before → after)

| class | before | after | rows left |
|---|---|---|---|
| vocabulary: the classifier names the product differently, right code not in the pool | 11 | 11 | Кардиомонитор, Клемма промежуточная, Рубильник, Сетевой кабель, Сетевой шкаф, Труба полиуретановая, Черенок для лопат, Наконечник стоматологический, Нити хирургические…, Готовая дверная конструкция из алюминия, Канцелярская книга |
| singular/plural, exact position name not ranked first | 7 | 6 | Принтер, Термостат автомобильный, Шкаф электрический, Водяной насос, Ручка канцелярская, Уличный светильник… |
| base vs identifying: unearned identifying leaves win | 6 | 1 | Антисептический раствор… (marked pharma leaves, +0.03) |
| adjective shared with another product (adjective order) | 5 | 1 | Реле защитное ("Защитное стекло") |
| "прочие" catch-all positions | 3 | 3 | Набор хирургических инструментов, Пистолет топливораздаточной колонки, Ремкомплект системы охлаждения… |
| service-like names | 2 | 2 | Услуга по ремонту жалюзи, Услуга монтажа и демонтажа турникетов |
| material named by the row contradicts the code | 1 | 1 | Потолок подвесной металлический (gypsum ceiling wins) |
| needs world knowledge | 1 | 1 | Рассада тыквы (vegetable vs flower seedlings) |
| **total** | **36** | **26** | |

The two NOT_FOUND names still get a suggestion: "Химические реактивы" → radioactive elements at 0.62
(medium band), "Средства реабилитации" → nasal hygiene at 0.57 (low). Nothing tells a too-broad name apart.

### Pass criteria (plan §3) and what is deferred

X1 top-1 73.5% against ≥ 75%, top-5 84.7% against ≥ 90%: **not met** without the reranker. No eval set or
five-file number dropped. Deferred, one line each:

- **Vocabulary (11) and "прочие" (3):** the right code shares no word or stem with the name; only a synonym
  table per product family or the reranker can bridge it, and a per-name synonym is the hack this task rules
  out. Measure the reranker on xarid-100 once a paid Gemini key exists (the free key is S1's today).
- **Singular/plural (6):** plural variants in full-text cost real-metal top-5 and a trigram score by key
  cost xarid rows (above); the right code is in the top 5 for 5 of the 6, which is what a reranker fixes.
- **Base vs identifying (1):** the antiseptic loses to marked pharma leaves (`identifyingMarked` +0.03);
  changing the marked-category rule touches every pharmacy row, which is S1's ground.
- **Adjective (1), services (2), material (1), world knowledge (1):** each is one or two rows; a services
  object-noun rule or a general material-conflict rule (extending `unrequestedMaterial`) would be fitted to
  one row each here. Left for a larger real set (S3).
- **NOT_FOUND for broad names (2):** needs a "too generic" signal; the head-noun stem could feed it later.

Tests: `npm test` 2,150 tests, 2,148 pass, 0 fail, 2 skipped (Redis-only suites, as before); new tests for
`normalize/russian.ts`, the rule, both pipeline behaviours and the two store lookups against the DB.
Typecheck clean; lint 0 errors, 1 pre-existing warning (`scripts/lib/xlsx.ts`).
