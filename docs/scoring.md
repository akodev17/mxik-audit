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
| `L` | 0.40 | how far the reranker may move a retrieval score |
| margin weight | 0.15 | share of the score set by the top-1/top-2 gap |
| `ceiling` | 0.85 without a reranker, 1.0 with | see below |

### Why weights are renormalized over present signals

If a stage returns nothing, its weight is removed from the denominator rather
than contributing zero. Otherwise a candidate found only by trigram would be
capped at 0.45 for a reason that says nothing about its quality.

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
would send 50% of the real cases and 57% of the synthetic ones. The defaults
are not tuned; tune them with `npm run eval` once a key is set.

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

Cached verdicts are reused only for the exact set of candidate codes they
judged (`candidatePoolHash` in `rerank-cache.ts`). The storage key stays a hash
of model, prompt version, normalized name and unit, so deleting a catalogue can
still find and delete its rows' entries; the candidate fingerprint is stored
with the verdicts and a mismatch is a cache miss. Without it, a classifier
update that added the right code stayed hidden behind a cached "none". Entries
written before this change carry no fingerprint and are treated as misses.

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
| Identifying code, category not marked | **−0.10** | A base code is safer. |
| Identifying code, marking unknown | **−0.05** | Applies to the 8.7% of codes where the portal leaves `label` null. Penalised, but less — we are punishing our own ignorance, so we punish it gently. |
| Prepared dish → base code | **+0.08** | Dishes deliberately have no detailed MXIK. |
| Prepared dish → detailed code | **−0.10** | The classifier does not provide these. |
| Row unit contradicts a **strict** binding | **−0.15** | 385,414 codes (87.8%) have a strict binding. |
| **Recommended** binding: row unit is a recommended unit | **+0.03** | Added 2026-10-21 (plan §3.5). |
| **Recommended** binding: row sold by a measure (mass, length, area, volume) and every recommended unit is of another kind | **−0.05** | Added 2026-10-21. kg against tonnes converts and is left alone; a row sold in pieces is never judged (a piece can hold metres). |

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
`identifyingMarked`, `identifyingUnmarked`, `identifyingUnknownMarking`,
`preparedDishBase`, `preparedDishSpecific`, `strictUnitConflict`, `recommendedUnitMatch`,
`unitKindMismatch`) are stored in
the evidence and translated in `ta.matchX.rules`.

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
