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
