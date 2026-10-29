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

## 11. Learned lexicon (branch `claude/epic-driscoll-478159`, 29 Oct 2026)

Every new catalogue type so far (cafe menus, pharmacy lists, procurement names) needed a
developer session to add synonyms, unit aliases and ranking rules (§7, §8). The learned lexicon is
the first version of letting the product learn from customers instead: what organisations confirm
becomes a candidate, a platform admin approves it, and the matcher reads the approved entries
beside the hand-written tables. Nothing changes for existing users until an admin approves
something; with an empty database lexicon the bench and the eval are byte-for-byte the runs
recorded before (verified: run 4 of `docs/bench-results.json` and run 72 of `docs/eval-results.json`
against `npm run lexicon:check` on a copy of `mxik`, see the branch report).

### Data flow

```
decision (accept / change a code, individual or group)          bulk accepts, dictionary auto-accept
        │  dictionary.ts learn(source)                                      │ (never counted)
        ▼                                                                   ✗
firm_mapping (per org, name+unit, confirmations)      learned_alias (per org, name key, code, confirmations)
                                                               │  GROUP BY key, code
                                                               │  HAVING count(DISTINCT org) >= 2  (ALIAS_MIN_ORGS)
                                                               ▼
                                                 global alias candidates  ──►  /admin/lexicon  (approve / reject)
                                                                                        │
lexicon_entry (kind: synonym | unit | alias; status: active | disabled | rejected) ◄──────┘  (+ synonyms and unit
        │  applyLexicon() at the start of an audit (cached 60 s), bench:files, eval              aliases typed by an admin)
        ▼
installLexicon(): synonyms.ts and units.ts extensions, merged after / over the file tables
aliases → PipelineOptions.aliases → one more RRF list ("alias") + pool slots, evidence aliasOrgs
```

- **Learning** (`packages/domain/src/lexicon.ts recordAliasConfirmations`, called from `learn()`):
  the same sources that count as dictionary confirmations (`manual`, `group`); the key is the
  name's folded, word-sorted key (`match/alias.ts aliasKey`), no unit, so "Stekloveta 50 mm, dona"
  and "СТЕКЛОВАТА 50мм, kg" are one name. A different code for the same name is a row of its own.
- **Candidates**: a (name, code) pair at least two distinct organisations confirmed. Listed with the
  organisation count, the confirmation sum and up to three example names; never auto-activated.
- **Matcher** (`match/pipeline.ts`): the approved alias codes (live, inside the row's TN VED heading
  when it has one) form one more ranked list in reciprocal rank fusion and keep up to three slots in
  the reranker pool after the fused window. The list exists only when an alias matched, so the RRF
  normalisation of every other row is unchanged. Evidence: `aliasOrgs`, `aliasConfirmations`; the
  row signal reads "N tashkilot tasdiqlagan". Stages 0-2 are untouched: a barcode identity, an
  exact name and the org's own dictionary still decide before retrieval runs.
- **Entries** (`/admin/lexicon`, `GET/POST /api/admin/lexicon`, `PATCH /api/admin/lexicon/{id}`,
  `POST /api/admin/lexicon/aliases`; platform admins only, everyone else 404): a synonym entry has
  the shape of a `synonyms.ts` row (forms, term, replace, unless, group, kind), a unit alias maps
  free text to an official unit. Every save runs `normalize/lexicon.ts checkLexicon()`: shape
  checks, then the active lexicon with the change installed for one synchronous pass over the
  normaliser's invariants (the cases `synonyms.test.ts` and `units.test.ts` pin: rebar, angle
  steel, mineral wool, PP, an unchanged "Лист г/к", the catering context, kg / dona / tsentner /
  "500 gramm" / "dona (paket) 500 gramm"), then the previous lexicon is restored. An entry that
  breaks one is answered `{ ok: false, problems }` and not stored.
- **Regression safety**: `npm run lexicon:check` runs the five-file bench and the eval sets with
  the database lexicon applied (reranker off) and compares every file's top-1 / fix / exact-row
  counts and per-type precision and recall, and every eval set's top-1 / top-5 / high-precision /
  pool %, with the last run recorded in `docs/bench-results.json` and `docs/eval-results.json`.
  Any drop fails it. `LEXICON=off` measures the file tables alone; `--baseline-bench` /
  `--baseline-eval` compare with a run record instead of the history (needed on a database copy: a
  pg_restore rebuilds the HNSW indexes and real-metal top-5 moved 166 → 117 between `mxik` and
  `mxik_lexicon` with identical code, top-1 unchanged). DEPLOY.md says when to run it.

### Deferred

- Undoing a decision does not subtract its alias confirmation (the dictionary's `restoreMappings`
  does for `firm_mapping`); a candidate can therefore count an undone decision until the next one.
- No score boost for an alias hit beyond the RRF list and the pool slot: a code only the alias
  found lands in the pool with low confidence and needs the reranker (or the dictionary) to win.
  A `globalAlias` rule key (+0.05 or so) is the natural next step once a few aliases are approved
  and the bench shows where they land.
- The admin page edits synonym entries one at a time; no import of a whole group (as the catering
  group was added) and no per-group context words (`GROUP_CONTEXT`) from the database yet.
- Alias approval checks that the code is live but not that the name still retrieves it; the check
  script is the guard for that.
