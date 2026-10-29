# Confidence scoring

How a 0–1 confidence is produced, and why it is built the way it is.
The implementation is [`src/core/match/score.ts`](../src/core/match/score.ts) and the gate is [`rerank-gate.ts`](../src/core/match/rerank-gate.ts); this
document and that file must stay in step.

## The problem

There is no normative document defining a single correct MXIK code for a given
product. Two codes can both be defensible. So "confidence" here does not mean
"probability this is *the* answer" — it means **how safe it is to accept this
suggestion without a human looking at it**. That is what the UI does with it, and
it is what the bands below are calibrated against.

## Bands

| Band | Range | Meaning | UI behaviour |
|---|---|---|---|
| High | ≥ 0.90 | Safe to bulk-accept | Pre-checked |
| Medium | 0.60 – 0.89 | Needs a human eye | Unchecked, shown first |
| Low | < 0.60 | Likely no good match | Flagged for manual entry / application |

### What the user reads (changed 2026-10-19)

The number is a match score that ranks candidates. It is **not a probability**,
so no label may read as certainty. `labelKey()` in
[`confidence-labels.ts`](../src/core/match/confidence-labels.ts) is the single
place a label is decided; `src/ui/labels.ts` only translates it.

| Key | Uzbek | Russian | When |
|---|---|---|---|
| `barcode` | Shtrix-kod boʻyicha | По штрихкоду | evidence stage `barcode` |
| `dictionary` | Firma lugʻatidan | Из словаря фирмы | evidence stage `dictionary` |
| `sure` | Yuqori moslik | Высокое совпадение | score ≥ 0.90 |
| `likely` | Oʻrtacha moslik | Среднее совпадение | 0.75 – 0.89 |
| `check` | Past moslik | Низкое совпадение | < 0.75 |

The old words were "Aniq / Ehtimoliy" ("certain / probable"). Text the
reranker wrote is shown under "AI tahlili / Анализ ИИ" with a note that a
machine wrote it and it must be checked; the rule adjustments below are stored
as keys in the evidence (`rules`) and shown as translated signals.

## Short-circuits

Two stages produce an identity, not a guess, and bypass the formula:

| Stage | Confidence | Why |
|---|---|---|
| Barcode exact | **1.00** | A GTIN is an identifier, not a similarity. Gate 0 verified 5/5 exact hits via `by-params`, and 191,636 codes carry one. Only awarded when the barcode maps to exactly **one** live code; ambiguous barcodes fall through. |
| Folded name exact | **0.95** | Equality after normalization. Not 1.00 because normalization is deliberately lossy — it folds all seven apostrophe variants, both readings of ц, and both scripts, so two genuinely different names can collide. |

Rule adjustments do not lower these two. A unit conflict on an exact barcode
match means the *row's unit* is wrong, not that the code is wrong, so it is
reported as a note and becomes a `UNIT_CONFLICT` finding rather than eroding the
match confidence.

### Which barcodes count as an identity (changed 2026-10-19)

A row's barcode is used — for stage 1, as a firm-dictionary key and for
pairing catalogue versions — only when `barcodeIdentity()`
([`barcode.ts`](../src/core/normalize/barcode.ts)) says it identifies a product:

- a GTIN length (8, 12, 13 or 14 digits), as before;
- a valid GS1 mod-10 **check digit** — a mistyped barcode used to be able to
  hit another product's code at 1.00;
- **not a restricted-circulation number**: EAN-13 prefixes 02, 04 and 20–29
  (and the same numbers as UPC-A or padded GTIN-14). Shops and producers assign
  these internally, often with a weight or price inside, so one number means
  different goods in different places. Such rows fall through to name matching.

EAN-8 restricted numbers are not filtered: an 8-digit code starting with 0 can
also be a UPC-E product code, and telling them apart needs more than the digits.

### Firm dictionary against the barcode

A dictionary entry found by **name** never outranks the row's own barcode
identity. When the barcode decides a different code, the barcode code stays
first, the dictionary code is offered second, and the disagreement is stored in
the evidence (`dictionaryConflict`) and shown to the reviewer. An entry keyed on
the barcode itself (the firm decided for this very barcode) still comes first.

## The formula

For everything else:

```
retrieval = Σ(wᵢ · sᵢ) / Σ(wᵢ)          over the signals actually present
blended   = (1 − L) · retrieval + L · llm     when a reranker verdict exists
adjusted  = clamp01( min(blended + ruleAdjustment, ceiling) )   every candidate; the pool is ranked by it
margin    = (adjusted_top1 − adjusted_top2) / adjusted_top1     for the leader only; 0 for every other candidate
shaped    = blended · (0.85 + 0.15 · margin)
final     = clamp01( min(shaped + ruleAdjustment, ceiling) )
```

`calibratePool()` in `score.ts` is the implementation.

with

| Constant | Value | Meaning |
|---|---|---|
| `w.lexical` | 0.45 | trigram / full-text score (full-text mapped as r / (r + 0.1), see below) |
| `w.vector` | 0.25 | pgvector cosine, mapped to 0–1 |
| `w.rrf` | 0.30 | fusion score, normalized against rank-1-everywhere |
| `w.positionRrf` | 0.20 | position-level fusion score; present only when position fusion is switched on (opt-in, see "The 2026-10-21 ranking pass") |
| `L` | 0.40 | how far the reranker may move a retrieval score |
| margin weight | 0.15 | share of the score set by the top-1/top-2 gap |
| `ceiling` | 0.85 without a reranker, 1.0 with | see below |

### Why weights are renormalized over present signals

If a stage returns nothing, its weight is removed from the denominator rather
than contributing zero. Otherwise a candidate found only by trigram would be
capped at 0.45 for a reason that says nothing about its quality.

Since 2026-10-29 a pool code the vector stage did not return gets its cosine
looked up by key (`cosinesFor`), so renormalisation no longer lets a long
identifying leaf that shares one word with a generic name (a drug's
description for "Антисептический раствор", a first-aid kit for "Бинт")
outrank the code the model put first. Two kinds of code keep the old treatment:
one the row earns by brand or size (`identifyingPreferred`) and the row's own
code, because a long leaf is far from a short query whether or not it is
right. The same lookup for trigram lost procurement rows and is not done,
except for a base code that `basesForLeaves` (pipeline.ts) adds to the pool:
a subposition retrieved only through identifying codes the row does not earn,
for a name without a digit, gets its base code, scored on its own name and
ranked in fusion like its best leaf. Measured in MATCHING_V2_PLAN §10.

### Why the reranker cannot decide alone

The brief's requirement, and the right call: an LLM asked "how confident are
you" will answer confidently about a plausible-looking wrong row. `L = 0.40`
lets it reorder candidates and veto them, but a code that no retrieval stage
liked cannot be promoted to high confidence on the model's word alone. It also
can never invent a candidate: `ClaudeRerankProvider` drops any returned code
that was not in the list it was given.

### The ceiling is per candidate (changed 2026-10-15)

`ceiling` is 1.0 **only for a candidate the reranker actually scored**, and
0.85 for every other candidate — whether the reranker is off, was skipped by
the gate below, failed (timeout, refusal, unparseable answer), or simply did
not rank that candidate. Before this change the ceiling was lifted for every
candidate whenever a key was configured, so a failing call produced 0.985
("high", bulk-acceptable) with no LLM verdict at all. No weight or threshold
changed: with no key the eval reproduces the previous numbers exactly (see
`docs/eval-results.json`, runs 2 and 3).

### Which rows the reranker sees (the gate)

To bound cost, only uncertain fused rows are sent: those whose top-1 retrieval
confidence, computed **before** the ceiling, is below `RERANK_GATE_CONFIDENCE`
(default 0.95), or whose top-1 minus top-2 is below `RERANK_GATE_MARGIN`
(default 0.10). Barcode and exact-name hits never reach it. A skipped row keeps
the 0.85 ceiling, so skipping can only keep a row out of the bulk-accept band,
never put it in. Without a key the eval measures the gate in a dry run: it
would send 50% of the real cases and 57% of the synthetic ones. Since
2026-10-28 the default confidence is **1.01**, i.e. every fuzzy row is sent:
measured with Gemini (section "Reranker on (Gemini)" below), the old 0.95/0.10
skipped only 7 of 399 rows and cost 3.1 points of synthetic high-band coverage.

The reranker may only return codes it was given, or "none" (which scores every
candidate 0 and so pushes the row out of every trusted band). Codes outside the
row's candidates, or not live in the classifier, are discarded before scoring.

Since 2026-10-19 a "none" is a first-class outcome: the match result carries
`veto` and `rerank: 'none'`, no code is suggested, and the finding stores the
evidence `{ stage: 'rerank', rerankNone: true }` so the reviewer sees why. A
veto **alone never raises MISMATCH** on a row whose own code is valid: with
nothing better to offer, "none of the retrieved codes fits" says nothing
against the code the row already has. MISSING and NOT_FOUND still fire, with
the veto as their evidence.

**Changed 2026-10-28: "none" is a fallback, not a veto.** In the first real
runs it was wrong 43 times in 46 (real-metal pipe rows whose pool held only
other sizes), and emptying the row cost 14 points of real-metal top-5. A
"none" now scores no candidate (`rerank-step.ts`), so the row keeps retrieval
order under the 0.85 cap and can never reach the high band or bulk accept.
The outcome is still `none`, `veto` is still set, every candidate's evidence
carries `rerankNone: true` (the reviewer reads "AI found no fit; suggestions in
search order"), suggestions marked that way are never one-click accepted
(`acceptCode`), and `Catalog.pipelineMeta.llmRowsNone` counts these rows.

Also since 2026-10-28: after a ranked answer, candidates the reranker left out
of its top 5 score `llm = 0` when its own top confidence is at least
`OVERRIDE_CONFIDENCE` (0.5, `rerank-step.ts`). Before, they kept their full
retrieval score while its picks were pulled toward its confidence, so its
first choice often stayed below an unranked candidate. Below 0.5 an unsure
reranker leaves retrieval order alone. The cap is still lifted only for codes
it scored.

Cached verdicts are reused only for the exact set of candidate codes they
judged (`candidatePoolHash` in `rerank-cache.ts`). The storage key stays a hash
of model, prompt version, normalized name and unit, so deleting a catalogue can
still find and delete its rows' entries; the candidate fingerprint is stored
with the verdicts and a mismatch is a cache miss. Without it, a classifier
update that added the right code stayed hidden behind a cached "none". Entries
written before this change carry no fingerprint and are treated as misses.

Since 2026-10-21 the fingerprint (`candidatePoolHashOf`) covers what the prompt
showed of each candidate (code, name, hierarchy path, kind, marking, bound
unit, brand, attribute), not the code alone: an update that renames a code or
moves it to another position keeps the code set, and a verdict about the old
wording must not be reused. The classifier snapshot id is deliberately not in
the key, which would discard every cached verdict on each daily update. The
local `rerank_cache` was empty when this changed (no key has ever been set).

When the stored vectors are unusable, stage 4 is switched off for the run and
no query embedding is computed at all (it used to call the embedding provider
for every row and throw the result away).

### Why there is a ceiling without a reranker

`NO_RERANK_CEILING = 0.85` sits just below the high band, so **nothing is ever
pre-checked for bulk-accept on retrieval signals alone.** Retrieval can tell us
a row is lexically or geometrically close. It cannot tell us it is the right
*classification* — that needs the hierarchy path to be read and judged, which is
what stage 6 does. Shipping without a key is therefore safe: every suggestion
lands in "needs a human eye", which is honest.

### Why the margin matters

Two candidates at 0.80 and 0.79 are not the same situation as 0.80 and 0.10. The
first is a coin flip that a human should see; the second is a clear winner. The
margin term is deliberately small (15%) — it adjusts, it does not dominate.

### Only the leader is shaped by its margin (fixed 2026-10-19)

Until this date the pool was sorted by `blended` without rule adjustments, the
leader of that order was shaped with its real (small) margin, and **every other
candidate was shaped as if it had no rival** (margin 1). In a close race the
runner-up therefore came out ahead of the leader, with full, un-penalised
confidence — with a reranker verdict on both, e.g. 0.81 for the leader and
0.92 (bulk-acceptable) for #2 (`pipeline.test.ts`, "margin shaping").

Now every candidate gets its adjusted score (rules and ceiling applied, no
margin), the pool is ranked by it, the leader is shaped with its gap to #2 and
every other candidate as a dead heat (margin 0). Weights, thresholds and the
margin weight are unchanged. Measured with `npm run eval` (no reranker key,
hashing vectors on this machine; runs 9 and 10 in `docs/eval-results.json`):

| | real top-1 | real top-5 | synth top-1 | synth top-5 | high band (both) | mean conf right / wrong, real | synth |
|---|---|---|---|---|---|---|---|
| before | 66.7% (8/12) | 83.3% | 77.0% (147/191) | 90.1% | unchanged, 100% precision | 0.876 / 0.779 | 0.863 / 0.799 |
| after the margin fix | 58.3% (7/12) | 83.3% | 90.6% (173/191) | 95.3% | unchanged, 100% precision | 0.904 / 0.669 | 0.837 / 0.674 |

The separation between right and wrong answers more than doubled on both sets.
On the 12 real cases, two rows whose right answer is a base code ("Sement
M400", "Gilam") had been winning only through the runner-up bonus and now rank
second, while "Yogʻoch taxta" moved from second to first. The demo catalogue
(re-audited in memory, no writes) moved from 33 to 34 MISMATCH flags
(precision 58% → 56%, recall 100%), clean rows flagged 13 → 14 of 76, right
suggestion 35 → 36 of 77.

### Full-text rank is mapped absolutely (changed 2026-10-19)

`ts_rank_cd` is unbounded, and it used to be divided by the best hit of the same
query, so the top full-text hit always scored 1.0 — even when it matched a
single common word. Now `fullTextToUnit(r) = r / (r + 0.1)`. The constant is
not tuned: `"searchVector"` has no weights, so every lexeme carries
`ts_rank_cd`'s default D weight of 0.1 and each matched word occurrence adds
0.1 to the rank (the eval queries' top hits sit at 0.2–1.1, median 0.6). The
score therefore reads n / (n + 1) for n matched occurrences: one → 0.50, three
→ 0.75, nine → 0.90.

Measured on top of the margin fix (runs 10 → 11; run 13 repeats 11 exactly):

| | real top-1 | real top-5 | synth top-1 | synth top-5 | high band | mean conf right / wrong, real | synth | gate share real / synth |
|---|---|---|---|---|---|---|---|---|
| relative (old) | 58.3% | 83.3% | 90.6% | 95.3% | unchanged | 0.904 / 0.669 | 0.837 / 0.674 | 50.0% / 55.0% |
| absolute k = 0.1 | 66.7% | 83.3% | 92.7% | 96.3% | unchanged | 0.855 / 0.636 | 0.818 / 0.661 | 58.3% / 61.3% |

Accuracy improved on both sets and the high band did not move, so it ships.
Two costs are recorded rather than hidden: the right/wrong separation narrowed
slightly (0.235 → 0.219 real, 0.163 → 0.157 synthetic), and because weak
queries no longer look strong, the gate would send about 6 points more rows to
the reranker once a key is set. Demo catalogue: right suggestion 36 → 38 of 77,
MISMATCH and clean-row flags unchanged.

### Run-to-run noise

With the hashing stand-in, many vector distances tie, and Postgres may return
tied rows in a different order between runs. One synthetic case
(`synthetic.csv:4`, two near-identical codes tied at the 0.85 ceiling) flips
between rank 1 and 2 across identical runs (runs 12 and 13), i.e. ±0.5 points
of synthetic top-1. Differences of one case are not signal.

## Rule adjustments

Additive, applied before clamping. Encoded as adjustments rather than hard
filters so a strong retrieval signal can outvote a heuristic.

| Rule | Adjustment | Source |
|---|---|---|
| Candidate is a base code (…000000) | **+0.05** | In practice accepted when no exact match exists. Only 6,985 codes (1.6%) are base codes, covering 68.4% of subpositions. |
| Identifying code, category digitally marked | **+0.03** | Correct shape for a marked category. |
| Identifying code, category not marked | **−0.10** | A base code is safer. Not applied when the name earns the code (`identifyingPreferred`). |
| Identifying code, marking unknown | **−0.05** | Applies to the 8.7% of codes where the portal leaves `label` null. Penalised, but less — we are punishing our own ignorance, so we punish it gently. Not applied when the name earns the code. |
| Identifying code the name earns: its brand, or its size, dosage, volume, pack or model (`identifyingPreferred`) | **+0.08**, +0.01 per further attribute (at most +0.11) | Added 2026-10-28 (plan T2). Outweighs the base code's +0.05; a marked code keeps its +0.03 on top. The per-attribute step (2026-10-29, plan §9) puts the brand's code with the row's dose and pack ahead of its siblings. Token rules in "Identifying codes" below. |
| The row names a brand some retrieved code carries, and this code carries another one, or a shorter brand inside the named one (`otherBrand`) | **−0.10** | Added 2026-10-29 (plan §9). "ЭНАМ® Таблетки 5мг №100" is no НИМИД® tablet, "КО-ИРБЕСАН 300" no ИРБЕСАН. Never fires on a code without a brand of its own, nor on one whose names carry the named brand's words ("PEPSI, Pepsi Max, …" for "Pepsi Max"). |
| Food-service row → a code of the catering group 10202 (`cateringPreferred`) | **+0.08** | Changed 2026-10-28 (plan §8). A row the catering lexicon in `normalize/synonyms.ts` reads as a dish, a drink the outlet makes or its service belongs in group 10202, whose menu codes are named by family ("Asosiy taomlar … go'shtli"), not by dish. Inside the group the base-code and marking rules are silent: the family codes are not base codes and the position has no base code for mains. Until this change the pair preferred base codes for a dish, which sent "Palov" to a seasoning base code. |
| Food-service row → a code outside the group (`cateringOutside`) | **−0.10** | A foodstuff, seasoning or utensil that shares the dish's words. |
| Row unit contradicts a **strict** binding | **−0.15** | 385,414 codes (87.8%) have a strict binding. |
| **Recommended** binding: row unit is a recommended unit | **+0.03** | Added 2026-10-21 (plan §3.5). |
| **Recommended** binding: row sold by a measure (mass, length, area, volume) and every recommended unit is of another kind | **−0.05** | Added 2026-10-21. kg against tonnes converts and is left alone; a row sold in pieces is never judged (a piece can hold metres). |
| Metal semi-product (groups 072, 074–076, tubes 7304–7306) whose name declares a metal the row never names (stainless, aluminium, copper, brass, bronze, titanium) | **−0.05** | Added 2026-10-22 (`unrequestedMaterial`). Unnamed means carbon steel in metal trade; finished articles are never judged. Run 45 vs 44: 40 rows better, none worse. |
| Russian row whose head noun ("Принтер", "Реле защитное", number ignored) is not among the nouns the code's Russian name offers as what it is (`headNounMismatch`) | **−0.05** | Added 2026-10-29 (MATCHING_V2_PLAN §10). "Тонер для принтера" and "Защитное стекло" name other products; "Принтеры всех видов" and "Щит (шкаф)" name the row's. Heads come from `normalize/russian.ts` (first non-adjective word before a preposition, every listed item of the code's name). Uzbek and Latin rows are never judged; neither is a code whose name offers no noun. −0.03 was worse and −0.08 no better on top-1. |

Recommended-only bindings (4,223 codes) **never** produce a conflict, and an
unresolvable unit on either side is never a conflict — `UNIT_CONFLICT` must not
fire on our own inability to parse. The two recommended-binding rules only
reorder candidates; they raise no finding. Kinds come from `quantityKind()` in
[`units.ts`](../src/core/normalize/units.ts); units of time, energy and
services have no kind and are never judged. Measured with `npm run eval`
(scratch copy, hashing vectors, no reranker; runs 26 → 28): no row worse,
construction top-1 with the vector stage off 75.5% → 76.5%.

The base-code and marking rules encode practice, not a legal requirement; the
UI words them that way. The keys of the rules that fired (`baseCodePreferred`,
`identifyingMarked`, `identifyingUnmarked`, `identifyingUnknownMarking`, `identifyingPreferred`,
`otherBrand`, `cateringPreferred`, `cateringOutside`, `strictUnitConflict`, `recommendedUnitMatch`,
`unitKindMismatch`) are stored in
the evidence and translated in `ta.matchX.rules`.

## Identifying codes (plan T2, 2026-10-28)

`baseCodePreferred` pushes the base code up, which is right for a generic name
and wrong when the name says which product it is: "PANADOL 500mg tabletka N12"
is 03004452001001004, not a paracetamol base code. `identifyingPreferred`
(`rules.ts`, token logic in `identifying.ts`) gives +0.08 to an identifying
code the row name earns. Everything is folded with `matchKeyOf` (Latin, no
case, no punctuation) before comparison.

**Row tokens** (`rowIdentity`, built once per row):

- *words*: the folded raw name plus the normalized (abbreviation-expanded)
  tokens, each through the brand fold below.
- *size*: the dimensions normalization strips ("15х2,5", "57х3,0/3,5",
  "5,00х1500х6000"), split on х/x/×/* into segments, each segment's slash
  alternatives as numbers; two segments or more.
- *measures*: every number with a volume, weight, length or per-cent unit
  (`noise.ts measuresIn`: "1,5л" = 1500 ml, "500mg" = 0.5 g, "250 мкг" =
  0.00025 g, "0,1%", "12 мм"). Measures in parentheses count only for a kind
  the rest of the name does not state ("1,5 г (1,0г+0,5г)" is 1.5 g).
- *pack*: `N12`, `№12`, `No 12` (not "N02BE01": a letter follows the digits),
  or "10шт." when no "№" says it; and its *breakdown*, the "2x14" of "№28(2x14)",
  which is never read as a size.
- *models*: folded tokens with two letters or more glued to digits that are
  neither a measure nor a pack ("15itl6"). A single letter makes a grade or a
  pack many codes share ("m400", "m150", "n12"), not a model.

**Code side**: the attribute field plus both names after the first colon,
where the portal puts brand and attributes. *Brand words* are the brand field
before its parenthesised maker ("ПАНАДОЛ (GlaxoSmithKline ... (UK))" →
panadol), folded, keeping words of two letters or more ("LG"), and dropping
digit-only values (the "1", "2", "3" the portal fills in for unbranded metal),
placeholders (no brand, brendsiz, ...) and words of the code's own hierarchy.
The **brand fold** makes the Latin and Cyrillic spellings of one brand agree:
ck→k, ph→f, q→k, w→v, x→ks, c→s before e/i/y and k elsewhere, y→i, doubled
letters collapse ("Кока-Кола" and "COCA-COLA" both fold to "koka kola").

**Matches**:

- *brand*: every brand word of the code is a row word.
- *size*: every segment has an alternative among the code's numbers.
- *measure*: same kind, same value. A different value of the same kind is a
  **conflict** for volume and weight; lengths never conflict (a code states a
  diameter, a wall and a length in millimetres alike).
- *pack*: same count; a different count is a conflict, and so is a code's
  pack of more than one when the row names none (a vial is not the box of ten).
  The same breakdown ("(3x10)") is one more attribute.
- *model*: the same folded token.

**The code is earned** when nothing conflicts and either

1. the brand matches *and* the code repeats an attribute or another row word
   of three letters or more ("Santa Bremor" cosmetics never earn Santa Bremor
   caviar), or
2. the code has no brand of its own, repeats at least one size, measure, pack
   or model, *and* shares the row's content words (two, or the one there is):
   a 12 mm sheet is no "Арматура 12 мм".

A code of another brand never earns it on a size alone: "1,5 л" is every
brand's bottle. A generic name ("Труба ВГП", "Парацетамол таблетка") earns
nothing, so the base code keeps its +0.05 lead. The UI shows the tokens that
earned the code (`MatchEvidence.identifyingMatchedTokens`, "Brend va oʻlcham" /
"Бренд и размер").

**Reaching the code.** Normalization strips sizes and numbers from the
retrieval query, so most identifying codes never reached the pool (the PANADOL
code was not among the 20 fused codes; the 15 × 2,5 mm pipes ranked below
thirty 100–133 mm ones). The pipeline therefore runs one more full-text query
when it would add something (`identifyingQuery`): the lexical words, the row's
numbers ("15", "2", "5"), tokens glued to them ("500mg", "mg"), and each word
with k written c ("koka" → "coca"). Full-text still selects on the rare words
only (`fullTextCommonDocs`), so numbers rank and never select. Its hits do not
enter fusion and re-score no other code: at most three hits that earn
`identifyingPreferred` join the pool after the fused codes, and a code that
earns it takes the better of its two full-text scores. A size alone does not
say which heading ("57х3,5" is also a 7305 "other tubes" code), so a code
earned without its brand is added or lifted only inside a subposition of the
three leading fused codes; a matched brand brings its code from anywhere.
Feeding the query to fusion as a fourth list instead cost construction 4 and
metal 1 top-1 rows and was dropped; without the heading guard metal lost 6.
`identifyingRule: false` and `identifyingRetrieval: false` switch the two off
for ablation.

**Brands among many look-alikes (2026-10-29, plan §9).** On a pharmacy price
list the brand is the only rare word ("ЭНАМ" is in 8 codes, "таблетки" in
14,234), and full-text has no IDF: codes that repeat "раствор для инфузий …
флаконы" twice outranked the brand's own code, which then never reached the
pool (60% top-1 on 369 keyed rows). Four changes, each measured on the five
test files and every eval set:

- *Anchored query* (`byFullText(…, { anchored: true })`): the identifying
  query's words plus the row's two-letter words ("RG"), selecting only on the
  words in at most 50 codes, else on those in fewer than 1,000; numbers never
  select. Term counts are cached from 50 codes up (`TERM_STATS_FLOOR`).
- *Brand list*: its hits whose brand the row names (`namesBrandOf`: the brand
  matches and the code's own part, not just its position's name, repeats an
  attribute or a row word) enter fusion as a fourth list. Unlike the
  identifying query above, this list holds only the row's own brand, which is
  why it cost no eval row; without the own-part test the synthetic "NESTLE
  ELEKTROSAMOKATLAR (barcha turdagi)" found a Nestle juice.
- *`otherBrand`* (−0.10, table above) once such a code exists; the most
  specific brand counts, and a brand's single-letter suffix must be in the row
  ("Ситафор®" names no "Ситафор-M").
- *Pack and strength tokens*: "№100" leaves the lexical query (its "100"
  ranked codes that repeat 100 anywhere), "(10x10)" is a breakdown, not a size,
  micrograms and per cents are measures, and a trade mark splits words in
  full-text as Postgres splits the classifier ("КАРЛОН®ПЛЮС" = karlon plyus).

Numbers in [MATCHING_V2_PLAN.md §9](MATCHING_V2_PLAN.md).

**Position-diverse pool** (`poolPerPosition`, `fusion.ts positionPool`,
opt-in): at most 3 codes per subposition (an over-full subposition keeps its
best by rules-adjusted score), topped up from further down the fused list
until the pool spans 4 subpositions; fused order kept. Without a reranker it
can only add or drop pool members, never re-rank them: on top of the rule it
cost one construction top-1 row ("Профиль оцинкованный CD-60 3м" lost to an
added fastener code) and one synthetic pool row (a sibling ARTEL variant
capped out), and raised metal top-5 from 98.8 to 100. It stays off until a run
with the reranker decides. Every row's notes carry the pool composition
("Rerank pool: 20 codes in 1 subpositions (07306001005 ×20).").

**Bands unchanged.** The new adjustment cannot reach the high band without a
reranker: the largest stack (`identifyingMarked` + `identifyingPreferred` +
`recommendedUnitMatch`, +0.14) on perfect retrieval still ends at the 0.85
ceiling (`score.test.ts`, `pipeline.test.ts`).

Measured 2026-10-28 on the local `mxik` database (snapshot #4), e5 natural-v2
on both columns, no reranker; runs labelled "T2 ..." in
`docs/eval-results.json`, the 22 queries with `tmp/probe-match.mts`:

| Run | golden top-1 / top-5 | construction | metal | synthetic | 22 queries top-1 / top-5 |
|---|---|---|---|---|---|
| before | 66.7 / 66.7 | 82.4 / 91.2 | 46.4 / 98.2 | 92.7 / 97.9 | 14 / 19 |
| rule only | 66.7 / 66.7 | 83.3 / 92.2 | 53.6 / 98.8 | 93.2 / 97.9 | 14 / 19 |
| rule + identifying query (shipped) | **75.0 / 75.0** | **83.3 / 92.2** | **53.6 / 98.8** | **93.2 / 97.9** | **15 / 20** |
| + position-diverse pool (opt-in, off) | 75.0 / 75.0 | 82.4 / 92.2 | 53.6 / 100.0 | 93.2 / 97.9 | 15 / 20 |

Of the four competitor cases, "PANADOL 500mg tabletka N12" now leads with
03004452001001004 and "Труба ВГП 15х2,5" with the 15 mm / 2,5 mm code
07306001005015618 (a 100 mm code before). The COCA-COLA code now reaches the
pool but scores 0.66 against Bagca Saray's "Кока кола 1,5 л" at 0.79, because
only one list finds it: the reranker's to pick. "Ноутбук Lenovo IdeaPad 15"
names no model, so any Lenovo IdeaPad 15 code is as good as Krafta's IdeaPad 5;
ours stays 08471001001002001.

## Firm dictionary confidence

A code the org decided before is suggested at 0.96 (stage 0). The entry keeps
two counts: `uses` (every time it was learned, one-click bulk accepts included)
and, since 2026-10-19, `confirmations` (only individual or group decisions).
The explanation says "your firm confirmed this N times" from `confirmations`,
says plainly when an entry was only ever bulk-accepted, and makes no count claim
for evidence stored before confirmations existed. The org's automatic
acceptance takes only entries with at least one confirmation, and is recorded
as the system (`finding.auto_accepted`, `decisionSource = dictionary_auto`, no
decider), not as the person who uploaded the file.

## Pipeline metadata

Each audit stores on `Catalog.pipelineMeta` how it ran: embedder, whether the
vectors were usable, the reranker (enabled, model, prompt version), stable
degraded-reason codes (`rerank_off`, `vector_off`, `vector_not_semantic`,
`rerank_failed`, `vector_failed`), rows matched without AI review, rows whose AI
call failed, and rows whose vector stage failed. `Catalog.snapshotId` records the
classifier snapshot the audit started against. `readPipelineMeta()` in
`src/lib/pipeline-meta.ts` reads it back; the admin pipeline status uses the
same vector-readiness check as the audit, so the hashing stand-in is reported
as degraded.

## What the numbers are calibrated against

`npm run eval` reports, alongside accuracy:

- **mean confidence when right vs when wrong** — the separation must be positive.
  A negative separation means confidence is anti-predictive and the weights are
  wrong, and the harness says so explicitly.
- **per-band top-1 precision** — does "high" actually mean safe? On the current
  12-case seed set, with the reranker disabled: high band n=5, precision 100%;
  medium band n=7, precision 43%. That is the intended shape — high is
  trustworthy, medium genuinely needs review. On the 191 synthetic cases the
  high band covers 31.9% of rows at 100% precision (all barcode or exact-name
  hits, since nothing else can reach it without a reranker).

The checks that consume these numbers are scored separately by
`npm run demo:quality` against the labelled demo catalogue.

MISMATCH ("code valid but scores < 0.6 against the name") had 33% precision
without a reranker: short shop names score low against their own generic base
code. Since 2026-10-15 (approved by the product owner) it also requires the
best suggestion to lie in a **different 8-digit position** than the row's code.
The 0.6 threshold is unchanged. Measured on the demo catalogue's 159 labelled
rows, without a reranker:

| | before | after |
|---|---|---|
| MISMATCH precision | 33% (19/58) | 58% (19/33) |
| MISMATCH recall | 100% | 100% |
| clean rows flagged | 45% | 16% |

Caveat: the fixture's planted wrong codes all come from another group, so it
cannot show what the rule now misses — a wrong code inside the same position
(for example another brand's identifying code under the same base code) is no
longer flagged. Re-measure on a real catalogue.

With the e5 vectors (P1.1, 2026-10-16) the same rule measures 45% (19/42):
recall is still 100%, but it raises 9 more false alarms (23 vs 14), and clean
rows flagged by any check rose 16% → 25%. Thresholds and weights were not
changed.

## The 2026-10-19 matching pass, before and after

Measured on the development machine: 438,925 live codes, the hashing stand-in
for vectors (the stored vectors here are hashing, so the configured provider was
substituted and the e5 runs 7–8 in the history are not comparable), no reranker
key (the gate measured in a dry run). `npm run eval`, all stages:

| | real top-1 | real top-5 | real high band | synth top-1 | synth top-5 | synth high band | gate share real / synth |
|---|---|---|---|---|---|---|---|
| before (run 9, `efd9e06`) | 66.7% | 83.3% | 41.7% at 100% | 77.0% | 90.1% | 31.9% at 100% | 50.0% / 55.0% |
| after (runs 12–13) | 66.7% | 83.3% | 41.7% at 100% | 92.1–92.7% | 96.3% | 31.9% at 100% | 58.3% / 61.3% |

Mean confidence right / wrong went from 0.876 / 0.779 to 0.855 / 0.636 on the
real cases and from 0.863 / 0.799 to 0.818 / 0.661 on the synthetic ones. The
barcode, veto and evidence changes did not move any eval case (every barcode in
the eval sets is a valid, identifying GTIN).

`npm run demo:quality` scores the stored demo audit, which this pass does not
rewrite (re-seeding would touch a shared database), so the same scoring was run
on an in-memory re-audit of the demo template with the code before and after:

| | MISMATCH flagged / correct | MISSING | NOT_FOUND | UNIT_CONFLICT | clean rows flagged | right suggestion |
|---|---|---|---|---|---|---|
| before | 33 / 19 (58%) | 45 / 45 | 14 / 13 | 10 / 6 | 13 / 76 | 35 / 77 |
| after | 34 / 19 (56%) | 45 / 45 | 14 / 13 | 10 / 6 | 14 / 76 | 38 / 77 |

Recall stayed 100% for every check. Unit tests for `src/core/match`,
`src/core/audit` and `src/core/normalize`: 240 / 240 before, 298 / 298 after.

## The 2026-10-21 ranking pass (plan §3.2, §3.6, §5)

Measured on a copy of the local database (`mxik_scratch`, the 2026-08-20
classifier, hashing vectors, no reranker key) with `npm run eval:fit`, which
fits on 80% of every eval set and reports the fixed 20% hold-out
(`eval/split.ts`); every fit is in `docs/weight-fit-results.json`. Objective:
mean over the four sets of (top-1 + top-5) / 2. Constraints, from the plan's
§7.3: no golden row that is top-1 today may lose it, synthetic top-1 may not
drop by more than 1 point.

| Fit | Grid | Baseline train / hold-out | Best feasible | Best overall (infeasible) |
|---|---|---|---|---|
| 1 | position fusion off/position/subposition × position weight × stand-in vector weight (signal, 1, 0.5, 0.25, 0) × lexical × rrf, 210 | 77.17 / 84.91 | lexical .45 rrf .20: 77.49 / 84.59 | subposition, stand-in in RRF only, rrf .20 pos .20: 84.44 / **75.00** (metal hold-out 100, golden 33, synthetic 79.5) |
| 2 | position fusion counting at most 1 or 3 codes per position per list, 16 | 77.17 / 84.91 | cap 1: 77.18 / 83.40 | cap 3: 79.27 / 86.86, synthetic −5.3 train |
| 3 | position fusion voted by lexical and full-text only, 12 | 77.09 / 84.91 | none | subposition pos .20: 82.04 / 74.63 |

What ships, therefore:

- **Signal weights are unchanged** (lexical 0.45, vector 0.25, rrf 0.30): the
  only feasible improvement on the training rows was worse on the hold-out.
- **Position fusion** (`fusion.ts groupFusion`, `Signals.positionRrf`) is
  implemented and **opt-in** (`positionFusion: 'subposition' | 'position'`,
  `npm run eval -- --position-fusion subposition`). It sums each position's
  reciprocal ranks over the lists, so a position whose many codes fill the
  lists beats a lone code of a wrong position, and carries weight 0.2 when on.
  It fixes the metal set (top-1 46 → 76–98) but costs synthetic 4–10 points
  and golden rows on the hold-out. A non-semantic stand-in never votes in it.
- **The non-semantic stand-in stays a full signal.** The plan proposed
  excluding hashing vectors from fusion; every variant that drops or
  down-weights them (`nonSemanticVectorWeight`, opt-in) loses golden rows: on
  golden the stand-in is worth +25 points of top-1 (run 29: 75.0 with it, 50.0
  without), on metal it costs 30. With e5 vectors (plan phase 0) the vector list
  stops pulling metal to the wrong positions; re-fit then.

## e5 vectors after phase 0 (2026-10-22)

The phase-0 data layer (snapshot #4, 442,964 codes, local
`multilingual-e5-small`) first made the real sets **worse** than no vector stage
(metal 36.9/86.9 vs 75.6/98.2). Three causes, fixed in order, each measured on
a copy of `mxik` (`mxik_scratch`) and confirmed on `mxik`:

1. **Text shape.** Vectors were made from the folded match key with e5's
   "query: " prefix on both sides; e5 similarities then sat at 0.85–0.91 for
   everything. `src/core/embed/text.ts` `embeddingText()` is now the one place
   that decides the text: rows embed their natural name (script, case and
   apostrophes kept, abbreviations expanded, pack noise stripped) with
   "query: ", classifier names embed as written with "passage: ". Both columns
   are filled (`embeddingUz` from nameUz, `embeddingRu` from nameRu) and a row
   searches the column of its script (both for mixed names);
   `embedding_state.columns` records which hold the provider's vectors. The
   natural variant has its own provider name (`…#natural-v2`), so it is never
   compared with folded vectors.
2. **Index recall.** With pgvector's default graph (`m = 16,
   ef_construction = 64`) the HNSW top 50 shared on average 47% of the exact
   top 50 on the metal rows: thousands of near-identical identifying codes sit
   almost on top of each other in e5 space. `m = 32, ef_construction = 200`
   with `hnsw.ef_search = 1000` gives 0.95 at 13 ms per query (exact scan:
   705 ms). `npm run eval:recall` measures this; `npm run vectors:reindex`
   rebuilds online (serial builds: a parallel build's shared-memory segment
   did not fit in the container's `/dev/shm`).
3. **Cosine band.** e5 cosine is mapped linearly from 0.80 to 0.95
   (`vectorToUnit`), not (1 + cos) / 2; the hashing stand-in keeps the old
   mapping. Two hold-out fits (`docs/weight-fit-results.json`, 390
   configurations over band, vector weight, per-position cap of the vector
   list and position fusion) found nothing better on the hold-out than 0.80 –
   0.95 with no cap and no position fusion.

Plus one rule (above, `unrequestedMaterial`) for the sheet rows the stainless
code took. Eval, all stages, top-1/top-5 (runs in `docs/eval-results.json`):

| | golden | construction | metal | synthetic |
|---|---|---|---|---|
| phase 0 as stored (run 36) | 75.0 / 83.3 | 69.6 / 88.2 | 36.9 / 86.9 | 90.6 / 96.9 |
| natural text, HNSW m=16/64 on mxik (run 38) | 66.7 / 66.7 | 81.4 / 89.2 | 46.4 / 48.2 | 90.6 / 95.3 |
| natural text, HNSW m=32/200, ef 1000 (run 44) | 66.7 / 75.0 | 81.4 / 92.2 | 45.8 / 77.4 | 93.7 / 99.0 |
| + unrequested-material rule (run 45) | 66.7 / 75.0 | 82.4 / 92.2 | 46.4 / 98.2 | 93.7 / 99.0 |
| no vector stage | 50.0 / 58.3 | 76.5 / 86.3 | 75.6 / 98.2 | 85.3 / 92.1 |

Still open: golden loses "PANADOL 500mg tabletka N12", which the folded
vectors got right; metal top-1 stays below the vector-off figure because 49 profile
pipes take the hot-rolled profile base code and 35 hot-rolled sheets the
"Лист просечно-вытяжной" base code (the right sheets now in the top 5), where
the base-code preference (+0.05) beats unmarked identifying codes (−0.10).
Subposition fusion fixes the pipes but fails the synthetic constraint. The weighted hierarchy full-text column (opt-in) moved nothing
with e5 either (run 46: 0 rows better, 1 worse) and stays off.

## Reranker on (Gemini) (2026-10-28)

The first runs of stage 6 with a real key: Google Gemini over the REST API
(`rerank-gemini.ts`, selected by `RERANK_PROVIDER` or by `GEMINI_API_KEY`
being set). All numbers are `npm run eval` on the local `mxik` database,
snapshot #4, e5 vectors, 473 cases, runs 48–55 of `docs/eval-results.json`.
"off" is run 48 on the same commit with `RERANK_PROVIDER=off`.

### What a free-tier key can and cannot do (read this before a pilot)

The owner's key is on the **free tier**, and that decided which model could be
measured:

- `gemini-2.5-flash`, `gemini-2.5-pro` and `gemini-2.5-flash-lite` answer
  **HTTP 404 "no longer available to new users"**, although `/v1beta/models`
  still lists them. The plan's default (`gemini-2.5-flash`) cannot be used.
- **20 `generateContent` requests per day per model** (quota
  `GenerateRequestsPerDayPerProjectPerModel-FreeTier`), reset at midnight
  Pacific. Aliases share a counter (`gemini-3.5-flash` with `gemini-3.6-flash`,
  `gemini-flash-latest` with `gemini-3.8-flash`). Retries after a 503 count.
- `gemini-3.1-pro-preview` and `gemini-4-argon` have no free quota, so the
  planned Pro comparison was **not run**.
- The 3.x Flash models (`3.8-flash`, `3.6-flash`, `3-flash-preview`) answered
  25-row batches in 82–234 s (p50) and often returned **503 "high demand"**;
  each run ran out of its day's quota with 50–80% of rows unanswered.
- Only `gemini-3.1-flash-lite` completed a full eval (16 requests of 25 rows,
  p50 8.9 s). **Every number below is with `gemini-3.1-flash-lite`**, the new
  default. A pilot needs a paid key (Tier 1): with 20 requests a day a free key
  covers about 500 rows a day, and only at batch size 25.

Free-tier settings that let a full eval finish: `RERANK_BATCH_SIZE=25`,
`RERANK_BATCH_WAIT_MS=5000`, `RERANK_MAX_CONCURRENT=2`,
`RERANK_TIMEOUT_MS=300000`. A daily-quota 429 fails the batch at once and its
rows keep the capped ranking (counted in `llmRowsFailed`).

### Before and after (defaults: prompt v4, gate off, override 0.5, "none" = fallback)

Top-1 / top-5 %, then high-band coverage / precision %:

| set (n) | off | Gemini on | high band off | high band on |
|---|---|---|---|---|
| golden (12) | 66.7 / 66.7 | 66.7 / 66.7 | 41.7 / 100 | 41.7 / 100 |
| real-construction (102) | 82.4 / 91.2 | **91.2 / 95.1** | 7.8 / 100 | 7.8 / 100 |
| real-metal (168) | 46.4 / 98.2 | **96.4 / 98.2** | 0.0 / – | 0.0 / – |
| synthetic (191) | 92.7 / 97.9 | **96.9 / 97.9** | 31.9 / 100 | **38.7 / 100** |

No set loses top-5 and high-band precision stays 100% everywhere. Golden does
not move: its pool ceiling is 66.7% (the four misses never reach the 20
candidates), so stage 6 has nothing to choose from. The real sets' high-band
coverage does not rise because a blended score (0.6 retrieval + 0.4 LLM) rarely
reaches 0.90 on a fuzzy row; that is a `score.ts` question, not the gate's.

What it fixed and broke, row by row against "off":

- real-metal: 84 rows from top-5 to top-1 (sheet thickness, pipe sizes,
  rebar grades now picked by size), none worse.
- real-construction: 8 rows top-5 → top-1 and 4 misses → top-1; 3 rows top-1 →
  top-5 (Битум дорожный БНД 60/90 → a 2713 code, Жидкие обои шелковые → a paper
  code, Опалубка щитовая → a steel 7308 formwork code).
- synthetic: 8 rows top-5 → top-1, none worse.

The 22 hand-labelled queries of `docs/MATCHING_V2_PLAN.md` §4
(`tmp/probe-match.mts`, reranker on): **19/22 top-1 with the probe's stricter
label for "Sement M400 50 kg qop", 20/22 against the §4 label `02523002*`**
(off: 14/22; Krafta 18/22). Still wrong: "Palov 1 porsiya" (a palov seasoning
wins; the dish code is not in the pool) and "PANADOL 500mg tabletka N12"
(the exact code is not in the pool).

### Veto vs fallback, and the override threshold

Same verdicts (replayed from the full run's cache, no new calls), real-metal
construction and synthetic top-1 / top-5 (golden is 66.7 / 66.7 in every row):

| "none" | override | construction | real-metal | synthetic |
|---|---|---|---|---|
| veto (old) | never (old) | 82.4 / 93.1 | 53.0 / 83.9 | 93.7 / 96.3 |
| veto | 0.5 | 91.2 / 95.1 | 82.1 / 83.9 | 95.8 / 96.3 |
| veto | 0.7 | 91.2 / 95.1 | 53.0 / 83.9 | 95.8 / 96.3 |
| **fallback** | **0.5** | **91.2 / 95.1** | **96.4 / 98.2** | **96.9 / 97.9** |
| fallback | 0.7 | 91.2 / 95.1 | 67.3 / 98.2 | 96.9 / 97.9 |

On the partial `gemini-3-flash-preview` run, an override at 0.5 let a confident
wrong pick (a 530 mm insulated 7305 pipe for "Труба ВГП") push the right
retrieval codes out of the top 5 on 16 real-metal rows, and 0.7 did not.
Re-check the threshold when the default model changes.

A prompt v5 that asked for the ranking before "none" made flash-lite answer
"none" more often (47 rows against 26) and was dropped. The parser now reads a
"none" that comes with a ranking as the ranking.

### Gate

Replayed from the same verdicts with the defaults above. Top-1 and top-5 do not move on any set; coverage and precision are the high band:

| gate (confidence / margin) | rows sent | synthetic high band cov / prec | real sets |
|---|---|---|---|
| off (1.01) | 399 | **38.7 / 100** | unchanged |
| 0.95 / 0.10 (old default) | 392 | 35.6 / 100 | unchanged |
| 0.90 / 0.05 | 376 | 32.5 / 100 | unchanged |
| 0.85 / 0.05 | 353 | 32.5 / 100 | unchanged |

Gate off is the new default: it costs 2% more rows than the old one.

### Cost and latency

From `rerank-usage.ts` on the full runs, at paid-tier list prices (dated in
`rerank-config.ts`; the free tier costs nothing):

| model | input / output tokens per row sent | p50 per 25-row call | USD per 1,000 catalogue rows | rows answered |
|---|---|---|---|---|
| gemini-3.1-flash-lite ($0.25 / $1.50) | 4,430 / 96 | 8.9 s | **0.93** | 398 of 399 |
| gemini-3.6-flash ($0.75 / $3.75) | 4,280 / 730 | 95 s | ≈ 5.0 | 174 of 399 |
| gemini-3.8-flash ($0.75 / $3.75) | 5,380 / 580 | 234 s | ≈ 5.2 | 75 of 399 |
| gemini-3-flash-preview ($0.50 / $3.00) | – | 82 s | ≈ 3.5 (half the rows) | 199 of 399 |

Input dominates: each row sends up to 20 candidates with long Uzbek names whose
attribute repeats the name. Shortening the candidate block is the cheapest
saving left. The 3.x Flash rows' output includes thinking tokens (default
level); `GEMINI_THINKING_LEVEL=low` was not measured.

## Known weaknesses

1. **The weights are reasoned, not fitted.** 30 cases is far too few to tune six
   constants without overfitting. They should be re-derived once a few thousand
   human accept/reject decisions have accumulated in `AuditEvent` — which is
   exactly what that table is for.
2. **The vector weight is reasoned, not re-fitted for e5.** Under the old
   placeholder embedder the vector stage was a second lexical channel. Since
   2026-10-16 it is multilingual-e5-small, and the gap between mean confidence
   on right and wrong answers widened on the real cases (0.10 → 0.22) with the
   0.25 weight unchanged. It has not been tuned to e5's similarity range.
3. **`ts_rank_cd` has no notion of term rarity** and grows with the number of
   query words matched, so a long query scores higher than a short exact one.
   Since 2026-10-19 it is mapped absolutely (above) instead of against the best
   hit of its own result set. Since 2026-10-16 terms found in more than 10,000
   live codes (`uchun`, `va`, `boshqa`…) still count in the rank but no longer
   select candidates. Eval: real unchanged, synthetic top-1 77.5 → 79.1, top-5
   and pool unchanged, full-text query 459 → ~49 ms median.


## Appendix A. Tax-privilege (imtiyoz) data


Checked 2026-10-16 against the local classifier (Aug export, 438,925 codes) and
the portal's public reference endpoint.

### What exists

| Source | Content |
|---|---|
| Export column O "IMTIYOZ ID" → `mxik_code.taxPrivilegeIds` | **37,530** codes carry at least one id; **67** distinct ids. Id `0` appears on 64 codes and means none. |
| `GET /api/cls-api/integration-mxik/references/lgota` (public, found in Gate 0) | **202** privileges: `id`, wording (`nameLatn`, `nameRu`, `nameUz`), legal document (`docNum`, `docDate`, `docNameLatn`). Loaded into `tax_privilege` by `npm run privileges:fetch` (also run by `classifier:update`). |

The wording names the legal basis, e.g. id `102870`: "(SK 243-m.) 13-band.
dori vositalarini, veterinariya dori vositalarini, tibbiyot va veterinariya
uchun moʻljallangan buyumlarni" — the VAT exemption for medicines, linked to
37,014 codes (98.6% of all linked codes; 36,696 of them in the pharmaceutical
group).

So the data does link codes to privileges, and feature K is implemented
(no disabled flag needed):

- `PRIVILEGE_CODE` — the row's code (an accepted correction, else the file's)
  is privilege-linked. Informational; **medium** when the same code is also a
  pending MISMATCH (the product name does not fit the code, so a privilege
  claimed through it is doubtful).
- `PRIVILEGE_OPPORTUNITY` — the suggested code is privilege-linked and the
  row's code is not. Always informational; it never changes a code by itself.

Both run after every audit (`src/lib/privileges.ts`), replace only pending
privilege findings, and never count as risk unless severity is medium.

### What is missing — do not infer it

1. **Validity period.** No field says whether a privilege is in force. At
   least 8 reference texts are time-bound in their wording (e.g. "2021 yil 10
   oktyabrdan 2022 yil 31 dekabrga qadar …"), and the classifier still links
   codes to them. The app shows the wording and tells the user to check the
   conditions and period; it never says a privilege applies.
2. **Conditions.** Many privileges depend on who sells, to whom, or under
   which programme (e.g. operators of a production-sharing agreement). None of
   that is in the data.
3. **Which tax.** The wording usually names the Tax Code article (243 = VAT
   exemptions, 483 = turnover tax, …) but there is no structured "tax type"
   field; nothing is computed from it.
4. **One id missing from the reference:** `103312` is used by codes but not
   returned by the endpoint; it is shown as "imtiyoz ID 103312".
5. **History.** The export is a snapshot; when a link is added or removed
   only a later import shows it (the classifier diff does not track privilege
   changes yet).

A tax adviser should confirm the wording shown to users before the privilege
findings are promoted in sales material.


## Appendix B. Construction materials: general vs detailed codes (why GENERIC_CODE is not implemented)


Checked 2026-10-16 against the local classifier (Aug export, 438,925 live
codes). Outcome: **GENERIC_CODE is not implemented**. The brief says to build
it only if general vs detailed construction-material codes are reliably
detectable; one half of that is (general vs detailed), the other is not
(which rows are construction materials), and the rule the check would
enforce is not verified.

### What the data does show

General and detailed codes are structurally distinguishable:

- A **base (general) code** ends in `000000` (`mxik_code.isBase`); it is the
  fallback for its subposition (first 11 digits).
- **Detailed (identifying) codes** share the subposition and carry a brand,
  manufacturer or specification in the name (`brandNameUz`, `attributeNameUz`).

In the groups that hold most construction goods:

| Group | Name (classifier) | Subpositions | With a base code | Base code **and** detailed codes | Detailed codes |
|---|---|---|---|---|---|
| 025 | Tuz, oltingugurt, gips materiallari, ohak va sement | 82 | 80 | 35 | 2,003 |
| 068 | Tosh, gips, sement, asbest … materiallar | 241 | 240 | 125 | 81,778 |
| 069 | Keramik mahsulotlar | 183 | 183 | 59 | 4,348 |
| 070 | Shisha va shisha mahsulotlar | 182 | 182 | 68 | 1,083 |
| 072 | Qora metallar | 64 | 63 | 32 | 4,859 |
| 073 | Qora metallardan mahsulotlar | 111 | 111 | 76 | 53,131 |

None of these codes carries the marking flag (`isMarked` is false for all of
025, 068, 069), so the marking rule that justifies identifying codes elsewhere
does not apply.

### Why that is not enough

1. **"Construction material" is not in the data.** There is no field or
   group for it. Construction goods sit in at least 025, 044 (wood), 039
   (plastic pipes), 032 (paints), 068, 069, 070, 072, 073, 076, 083, 084 —
   and every one of those groups also holds non-construction goods (ceramic
   tableware in 069, glassware in 070, kitchen hardware in 073 …). A scope
   list would be our invention. The official construction-resources
   classifier (NKSR) would be the right source; cross-referencing it is out of
   scope (declared out of scope in the retired SESSION_STATE doc).
2. **Some subpositions have no general code.** Portland cement
   (`02523002001`) has only manufacturer-specific codes
   (e.g. `02523002001001001` "Portlandsement: QIZILQUMSEMENT, II/A-I 42.5 N,
   polipropilen qop 50 kg"); there is nothing "general" to flag there.
3. **Others have an unworkable number of children.** "Yopuvchi plita"
   (`06810006002`) has one base code and 68,665 detailed ones (bridge slabs by
   drawing number and rebar consumption, e.g. "П800.124.20, расход арматуры
   213 кг/м3"). Picking "the best detailed child" needs the drawing/mark,
   which a catalogue name rarely contains; when it does, the matcher already
   ranks the identifying code first.
4. **The rule is unverified.** Gate 0 and the official guidance used so far
   treat a base code as an acceptable classification when no exact code
   applies (an "important decision" recorded in the retired SESSION_STATE doc). We found no verified source
   that requires detailed codes for construction materials on e-invoices.
   Flagging base codes as wrong would be a legal claim we cannot support.

### What would make it implementable

- A cited regulation (lex.uz) or Tax Committee statement that requires
  identifying codes for named construction-material categories, with dates.
- An authoritative scope: the NKSR codes or a list of MXIK positions it
  covers.
- Catalogue columns for the attributes that pick a child (manufacturer,
  grade/mark, standard, dimensions), mapped at upload.

With those, the check is small: for rows in scope whose code is a base code,
rank that subposition's identifying codes with the existing matcher (name +
attributes) and suggest the best one only when it clears the "Ehtimoliy"
threshold; otherwise say that a detailed code is required and list the
subposition for the user to choose from.

## Appendix C. TIF TN (TN VED) heading as a matching input (2026-10-23)

### The structural rule, measured on the local classifier

Snapshot #4 (442,964 live codes, `mxik` and the scratch copy `mxik_tnved`):

| Fact | Value |
|---|---|
| Live goods codes (first digit `0`) | 442,029 |
| Live service codes (first digit `1`, groups 100-117) | 935: no HS heading |
| Distinct HS4 headings (digits 2-5 of goods codes) | 1,178 (of ~1,228 in the HS) |
| Chapters (digits 2-3, `groupCode` = `0` + chapter) | 98 |
| `classCode` (5 digits) = `0` + digits 2-5 | every code (0 mismatches) |
| Codes per heading: min / p25 / median / p75 / p90 / p99 / max | 1 / 2 / 7 / 62 / 437 / 6,067 / 74,893 (6810, concrete articles) |
| Headings with one code / more than 5,000 codes | 231 / 17 |

**HS4.** A sample of 30 classes (ordered by md5 of the class code) was read
against the HS heading texts: all 30 are the heading's own wording (0707
cucumbers, 1511 palm oil, 2808 nitric acid, 5603 nonwovens, 7106 silver, 7605
aluminium wire, 8106 bismuth, 8421 centrifuges, 8510 shavers, 8705 special
purpose vehicles, 9022 X-ray apparatus, 9504 video game consoles, 9606
buttons, …). So TN VED `7306301900` → MXIK `07306…`, `2523290000` → `02523…`,
`8471300000` → `08471…`, as the competitor's rule says.

**HS6 does not survive.** Digits 6-8 are the position, and of 2,591 goods
positions 1,883 are numbered `001`-`009`, 123 `010`-`099` and 27 `999`
("other"); 82.8% of goods codes have `00` in digits 6-7. 8471's positions
`001` portable, `009` processing units, `011` storage, `012` input/output
are HS 8471.30 / .50 / .70 / .60 in another order; 7306 has one position
(`001`, 15,581 codes) for all of HS 7306.11-7306.90. Only a few classes copy
the subheading (3920: `03920200` propylene, `03920430` vinyl chloride,
`03920620` PET), and 3004 uses drug-group numbers that merely look like it
(`03004410` oxicams). **Decision: the filter is HS4 only.** No HS6 path
with an HS4 fallback, because digits 6-7 cannot be read as HS6.

### What the matcher does with it

- `core/match/tnved.ts` reads a cell: digits only, 4-10 of them, chapter
  01-97. An odd count means Excel dropped the leading zero (HS codes have even
  lengths), which is put back: `702000000` → `0702000000`. Anything else is
  ignored and reported by the import diagnostics.
- `PostgresCandidateStore.withinPrefix('0' + heading)` limits stages 2-4
  (exact, trigram, full-text, vector) to `code LIKE '0HHHH%'`, served by the
  existing `mxik_code_code_prefix_idx` (`bpchar_pattern_ops`). The barcode
  stage stays global: a barcode is an identity. Lookups of a known code
  (`byCode`, `liveCodes`, `baseCodeFor`) are not limited.
- If the heading retrieves nothing, or every retrieved code is hidden as
  unrelated, the row is matched over the whole classifier (`MatchResult.tnved
  = 'fallback'`, a note, `evidence.tnvedFallback`). A reranker veto inside the
  heading stands.
- Every candidate's evidence carries `tnvedHeading`, `tnvedOutside` (this code
  is outside, e.g. a barcode hit or a fallback) and `tnvedExistingOutside`
  (the row's own code is outside).
- `TNVED_MISMATCH` (medium): the row's valid goods code lies in another
  heading. It takes MISMATCH's place on that row (with retrieval limited to
  the heading the own code is never scored, and "does not fit the name" would
  be the wrong reason); its suggestion is the best code of the TN VED heading.

### Query plans (2026-10-23, pgvector 0.8.6, 443k rows)

| Query | Plan | Time |
|---|---|---|
| HNSW + `code LIKE '07306%'` (as is) | index scan, filter after the graph | 8 ms, **1 row of 50** |
| exact cosine over 07306 (15,581 codes), materialized CTE | bitmap on prefix index + sort | 140 ms |
| exact cosine over 06810 (74,893 codes) | same | 540 ms |
| HNSW + `hnsw.iterative_scan = relaxed_order`, 07306 / 06810 | index scan until the limit fills | 70 ms / 14 ms |
| recall@50 of the iterative scan vs exact, 20 queries over 6810, 3004, 7306, 8516 | | 0.98-1.0 |
| trigram, no threshold, 07306 / 07208 (618 codes) | prefix index scan, word_similarity per row | 685 ms / 23 ms |
| trigram `<%` at 0.75 + prefix, 07306 | BitmapAnd(prefix, trigram GIN) | 313 ms |
| full-text `truba | 57` + prefix, 07306 | BitmapAnd(prefix, tsvector GIN) | 81 ms |

So a heading of up to `SCOPED_SCAN_MAX` = 1,000 codes (92% of headings) is
scored exhaustively: every code with any trigram gets a word_similarity, and
vectors are compared exactly (a few ms to ~40 ms). A larger heading keeps the
global strategy plus the prefix: the trigram threshold cascade, and the HNSW
index with the iterative scan. The heading's size is counted once per process.

Full-text inside a heading first selects on the classifier-wide rare words,
as everywhere; only when they occur nowhere in the heading do the common words
select ("57" among the 7304 pipes → "truba"). Letting every word select from
the start was the first version: "Кабель АВВГ 2х16" in 8544 then ranked
fibre-optic cables first, "kabel" being repeated in their names, and fell out
of the top five.

### Evaluation (`npm run eval -- --no-ablate`, scratch copy `mxik_tnved`, e5 vectors, no reranker key)

`eval/real-tnved.csv`: 49 rows, 34 seller-style names after real classifier
names in 34 headings and 15 deliberately vague names ("Труба 57", "Лист 5 мм",
"Профиль 40х20", "Проволока 3 мм", "Арматура 12" / "Арматура 1/2", …), some
of them twice with different headings; two TN VED cells lost their leading
zero as Excel does. Labels are the position prefix inside the row's heading.

| Run | golden | real-construction | real-metal | real-tnved | synthetic |
|---|---|---|---|---|---|
| before (cd7f066) | 66.7 / 75.0 | 82.4 / 92.2 | 46.4 / 98.2 | 65.3 / 79.6 | 93.2 / 99.0 |
| after, column ignored (`--no-tnved`) | 66.7 / 75.0 | 82.4 / 92.2 | 46.4 / 98.2 | 65.3 / 79.6 | 93.2 / 99.0 |
| after, column used | 66.7 / 75.0 | 82.4 / 92.2 | 46.4 / 98.2 | **98.0 / 100.0** | 93.2 / 99.0 |

(top-1 % / top-5 %.) The other sets carry no TN VED, and their numbers are
identical: the change does nothing to a row without the column. With it, all
15 vague rows reach top-1 (before: 3 of 15 at top-1, 7 in the top five); the
one row left at rank 2 is "Керамогранит 300х300х8", where 6907's two positions
(tiles, finishing pieces) are both in the heading. The full run over 522 cases
took 30 s with the column against 39 s without: a heading is a smaller search.
