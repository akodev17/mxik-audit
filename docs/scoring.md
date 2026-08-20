# Confidence scoring

How a 0–1 confidence is produced, and why it is built the way it is.
The implementation is [`src/core/score.ts`](../src/core/match/score.ts); this
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

## The formula

For everything else:

```
retrieval = Σ(wᵢ · sᵢ) / Σ(wᵢ)          over the signals actually present
blended   = (1 − L) · retrieval + L · llm     when a reranker verdict exists
margin    = (blended_top1 − blended_top2) / blended_top1
shaped    = blended · (0.85 + 0.15 · margin)
final     = clamp01( min(shaped + ruleAdjustment, ceiling) )
```

with

| Constant | Value | Meaning |
|---|---|---|
| `w.lexical` | 0.45 | trigram / full-text score |
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

## Rule adjustments

Additive, applied before clamping. Encoded as adjustments rather than hard
filters so a strong retrieval signal can outvote a heuristic.

| Rule | Adjustment | Source |
|---|---|---|
| Candidate is a base code (…000000) | **+0.05** | Officially "not an error" when no exact match exists. Only 6,985 codes (1.6%) are base codes, covering 68.4% of subpositions. |
| Identifying code, category digitally marked | **+0.03** | Correct shape for a marked category. |
| Identifying code, category not marked | **−0.10** | A base code is safer. |
| Identifying code, marking unknown | **−0.05** | Applies to the 8.7% of codes where the portal leaves `label` null. Penalised, but less — we are punishing our own ignorance, so we punish it gently. |
| Prepared dish → base code | **+0.08** | Dishes deliberately have no detailed MXIK. |
| Prepared dish → detailed code | **−0.10** | The classifier does not provide these. |
| Row unit contradicts a **strict** binding | **−0.15** | 385,414 codes (87.8%) have a strict binding. |

Recommended-only bindings (4,223 codes) **never** produce a conflict, and an
unresolvable unit on either side is never a conflict — `UNIT_CONFLICT` must not
fire on our own inability to parse.

## What the numbers are calibrated against

`npm run eval` reports, alongside accuracy:

- **mean confidence when right vs when wrong** — the separation must be positive.
  A negative separation means confidence is anti-predictive and the weights are
  wrong, and the harness says so explicitly.
- **per-band top-1 precision** — does "high" actually mean safe? On the current
  12-case seed set, with the reranker disabled: high band n=5, precision 100%;
  medium band n=7, precision 43%. That is the intended shape — high is
  trustworthy, medium genuinely needs review.

## Known weaknesses

1. **The weights are reasoned, not fitted.** 30 cases is far too few to tune six
   constants without overfitting. They should be re-derived once a few thousand
   human accept/reject decisions have accumulated in `AuditEvent` — which is
   exactly what that table is for.
2. **The vector weight is currently unearned.** With the local placeholder
   embedder the vector stage is a second lexical channel, not a semantic one, so
   0.25 is being spent on a signal correlated with the 0.45 already allocated to
   lexical. Revisit once a real multilingual model is wired in.
3. **`ts_rank_cd` is unbounded**, so the full-text score is normalized against
   the best hit *in its own result set*. That makes it a relative signal: it says
   "best of what full-text found", not "good in absolute terms".
