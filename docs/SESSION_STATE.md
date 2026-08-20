# MXIK Audit — Persistent Project State

## Last Updated

2026-08-20

This file is the project's memory across Claude Code context resets. It is
reconstructed from the actual repository, not from prior conversation. Where a
fact could not be confirmed from the repo it is marked `UNVERIFIED` or
`NEEDS VALIDATION`.

---

## Project Summary

MXIK Audit audits a company's product catalogue against Uzbekistan's national
goods and services classifier (MXIK, also called IKPU or SPIC).

Every product on an Uzbek electronic invoice (EHF) must carry a 17-digit MXIK
code. A wrong or missing code means the invoice cannot be issued at all, the
buyer's input VAT credit is refused, razriv mismatches trigger a desk audit, and
Tax Code penalties apply for invoice defects. The official portal
`tasnif.soliq.uz` looks codes up **one at a time** against **438,925** codes, so
a business with 3,000 SKUs has no practical way to check its own catalogue.

The product uploads a catalogue, flags risky rows, proposes codes with a
confidence band and the classifier hierarchy path, lets a human confirm or
reject each one, and exports the corrected file with an append-only decision log.

## Product Goal

Turn an unanswerable question ("are any of my 3,000 MXIK codes wrong?") into a
reviewable list, and make the correction defensible to a tax inspector.

## Target Users

- Chief accountants
- Accountants
- Accounting outsourcing firm owners

Risk-averse, sceptical of software, previously burned by tools that promised
automation. This audience punishes overclaiming, so the product and its copy are
deliberately conservative.

## Core Product Flow

```
Excel / CSV upload
  → column mapping (auto-detected, remembered per org)
  → catalogue analysis (matching engine + five checks)
  → risk report ("how many of mine are dangerous")
  → human review (accept / reject / pick other)
  → corrected Excel export + append-only audit log
```

## Product Positioning

MXIK Audit is a **catalogue risk-audit tool**, not an MXIK search engine.

The user's mental model must be *"how many of my items are dangerous"*, never
*"help me find a code"*. Every screen reinforces this: the report screen opens
with a count of risky positions, not a search box.

---

## Completed Gates

### Gate 0 — Data acquisition and inspection — COMPLETE

Located the portal's undocumented bulk Excel export and ingested the whole
classifier in three languages. Established what the data actually contains
rather than trusting the specification. Full write-up in
[`docs/gate0-report.md`](gate0-report.md); machine-readable outputs in
`docs/gate0-*.json`.

Built: `scripts/fetch-catalog.ts`, `scripts/ingest-catalog.ts`,
`scripts/lib/xlsx.ts` (streaming reader for the 205 MB sheet),
`scripts/probe-api.ts`, `scripts/inspect-xlsx.ts`,
`scripts/inspect-columns.ts`, `scripts/compare-langs.ts`,
`scripts/enumerate-group.ts`, `scripts/bench-enrich.ts`,
`scripts/check-marking-coverage.ts`, `scripts/check-services.ts`,
`scripts/generate-units.ts`.

### Gate 1 — Matching engine and eval harness — COMPLETE

Six-stage matching cascade, pure/testable normalization layer, calibrated
confidence, and an evaluation harness written before the algorithm was tuned.
Scoring rationale in [`docs/scoring.md`](scoring.md).

Built: `src/core/normalize/*`, `src/core/match/*`, `src/core/embed/*`,
`eval/run.ts`, `eval/translit.ts`, `eval/golden.json`,
`scripts/load-db.ts`, `scripts/embed-catalog.ts`.

### Gate 2 — Application — COMPLETE

Next.js 15 / React 19 app with four screens, session auth, Prisma schema,
export, and a seeded demo. Runs locally against the live classifier.

Built: `src/app/*` (upload, report, review, export, sign-in),
`src/app/actions/*`, `src/lib/*`, `prisma/schema.prisma`, `prisma/seed.ts`,
`scripts/audit-catalog.ts`.

### Gate 3 — Landing page — EXISTS, REVISED, NOT VISUALLY REVIEWED

A landing page is implemented at `/` (`src/app/page.tsx`, **863 lines**) with
real screenshots, a verified legal citation, open pricing and a two-field lead
form. It passes typecheck, lint, tests and a clean production build, and `/` is
statically prerendered.

It has **not been visually reviewed at any viewport** since the most recent
revision. See `Landing Page` and `Known Problems` #1.

---

## Verified Data Facts

All measured from the official export and API on 2026-08-20 and reproducible via
the named scripts.

### Classifier size and shape

| Fact | Value | Source |
|---|---|---|
| Codes ingested | **438,925** | `npm run inspect:xlsx` |
| Code length | 17 chars, all rows | same |
| In-file duplicate codes | 0 | same |
| Groups in `/group` API | 117 | `npm run probe:api` |
| Groups containing codes | 115 | code prefixes |
| Subpositions | 10,215 | `npm run inspect:columns` |
| Base codes (last 6 digits `000000`) | **6,985 (1.6%)**, covering **68.4%** of subpositions | same |
| Codes with tax privilege id | 37,530 | `npm run inspect:xlsx` |

### Units

| Fact | Value |
|---|---|
| Strictly bound unit (column J) | **385,414 (87.8%)** |
| Recommended-only | 4,223 (1.0%) |
| Neither | 49,288 (11.2%) |
| Distinct raw unit strings | 11,054 |
| Distinct canonical units after parsing | **168** |
| Official unit reference (API) | **90** units, Cyrillic, with stable numeric ids |

### Barcodes

| Fact | Value |
|---|---|
| Rows with a barcode in the export | 191,675 (43.7%) |
| Loaded into Postgres | 191,636 |
| Dropped as invalid GTIN length | **39** (10–11 digits) |
| Length breakdown | 13ch: 190,679 · 8ch: 662 · 12ch: 288 · 11ch: 38 · 14ch: 7 · 10ch: 1 |

### Digital marking flag (`label`)

Three-state, harvested per code from the API because the bulk export omits it.

| State | Count |
|---|---|
| Marked (`label=1`) | **124,169** |
| Not marked (`label=0`) | 276,464 |
| Null / unknown | **38,292 (8.7%)** |

The nulls are systematic, not transient: 40 retried sequentially, 0 resolved.
Scattered across 89 groups; no group is entirely null.

### Languages

| Fact | Value |
|---|---|
| `lang=uz` → `category_0_lat.xlsx` | Uzbek **Latin**, 30,748,917 bytes |
| `lang=ru` → `category_0_ru.xlsx` | Russian, 31,189,897 bytes |
| `lang=uz_cyrl` → `category_0_uz.xlsx` | Uzbek **Cyrillic**, 31,353,616 bytes |
| `lang=en` | identical to `uz`; no English exists |
| Codes present in all three variants | **438,925 — zero gaps** |
| All three names genuinely distinct | 433,564 |
| Untranslated (Latin == Cyrillic) | 2 |

### API behaviour

| Fact | Value |
|---|---|
| Auth | none observed; public |
| Rate limiting | **none observed at any level tested** |
| Sustained throughput | **~2,025 req/s** at concurrency 25; 438,925 codes enriched in **3.6 min**, zero failures |
| `lang` on `/elasticsearch/search` | **ignored** — `uz`, `ru`, `uz_cyrl`, `en`, `kaa`, empty and the literal string `garbage` all return identical Cyrillic |
| Exhaustive walk via search | **impossible** — deep pagination fails (~10k window); `search=`, `search=*`, `search=%20` all return 0 |
| `label` type | JSON **number** from `by-params`, **string** from `/elasticsearch/search` |
| History endpoint `id` | **not stable** — three consecutive calls returned three different ids with identical content. Key on `mxikCode`, never `id` |
| Units reference pagination | param is **`pageSize`**, not `size`/`limit`; with `size` it silently returns 10 of 90 |

Endpoints in use (all public, discovered from the portal JS bundle):
`/excel/get/category`, `/elasticsearch/search`, `/mxik/search/by-params`,
`/mxik/get/by-mxik`, `/integration-mxik/get/history/{code}`, `/group`,
`/class/short-info`, `/position/short-info`, `/subposition/short-info`,
`/brand/short-info`, `/attribute/by-brand`, `/category/get/all`,
`/integration-mxik/references/get/units/all`, `/integration-mxik/references/lgota`.
`/advanced-search` and `/search-deep` require auth (401).

### Official portal search quality — measured, reproducible

This is the project's strongest commercial evidence.

| Query | Portal result |
|---|---|
| `цемент портланд` (two valid Russian words) | **0 results** |
| `tibbiy xizmat` (valid Uzbek Latin) | **0 results** |
| `тиббий хизмат` (Cyrillic) | 297 results, topped by **electric kettles and nappies** |
| `Coca-Cola 1.5L` | top hit **Paracetamol** |
| `Coca Cola` (pack size removed) | 68 results, correct beverage first |
| `no'xat` (ASCII apostrophe) | 1 result — **acrylic polymer dispersion** |
| `noʻxat` (U+02BB) | 105 results |

Both failure modes return a *confident wrong answer*, not an error.

### Normalization discoveries

| Fact | Value |
|---|---|
| Apostrophe variants in the Latin export's name column | **seven** |
| U+2019 `’` | 137,432 |
| ASCII `'` | 73,645 |
| U+0060 `` ` `` | 157 |
| U+2018 `‘` | 129 |
| U+00B4 `´` | 89 |
| **U+02BB `ʻ` (orthographically correct)** | **74** |
| U+02BC `ʼ` | 10 |
| Rows carrying any apostrophe mark | 211,077 (48%) |
| Mixed-script rows in the **Latin** export | **101,617 (23%)** — Cyrillic brand names inside Latin text |
| ц transliteration | portal uses **both**: `Portlandsement` but `tsentner` |
| Group names: raw distinct / lowercased / actual groups | 173 / 118 / 115 (difference is capitalisation, e.g. `GO'ShT` vs `GO'SHT`) |

### Transliterator accuracy

Validated against the classifier's own 438,925 parallel Cyrillic/Latin name
pairs — free ground truth. `npm run eval:translit`.

| Measure | Value |
|---|---|
| Exact character match | 131,469 (29.95%) |
| After the match fold | 400,693 (91.29%) |
| **Plus ц/е alternates (what the index achieves)** | **97.88%** |
| Residual | 9,296 (2.1%) |

---

## Important Discoveries That Changed the Plan

1. **Deprecation status does not exist in any accessible source.** No column in
   the export; the history endpoint's 27 fields contain nothing matching
   `replac|archiv|revok|substit|prev|next`; `isActive` is `1` for everything
   reachable; 10 search queries × 50 results produced **0** codes absent from the
   export. Two groups were enumerated exhaustively through the portal's own
   hierarchy: group 001 → API tree 45, Excel 45, zero diff; group 015 → 1,971 and
   1,971, zero diff. The 2,682 delta between `/group` counts and the export is
   **stale counters**, not hidden codes.
2. **Strict unit binding is 87.8%, not the 99% originally assumed.** Column K
   (the strict block's "unit" sub-column) is effectively dead — 74 of 438,925
   rows, containing junk. The real strict unit is column J, which fuses packaging
   detail and sometimes holds a comma-separated *list* of acceptable units.
3. **The marking flag is three-state** and absent from the bulk export.
4. **Seven apostrophe variants**, with the correct one nearly absent.
5. **The "Latin" export is 23% Cyrillic-contaminated**, so transliteration must
   run *within* strings, not per document.
6. **Base codes are rare** (1.6%) and cover only 68.4% of subpositions, so
   "prefer base codes" cannot always be satisfied.
7. **Prepared dishes have no detailed code.** Searching `palov` returns only
   seasonings *for* palov; the answer is a catering "main dishes" code which is
   itself **not** a base code.
8. **Sparse vectors defeat HNSW.** With the local placeholder embedder,
   distances plateau near 0.80 while true neighbours sit at ~0.04, so greedy
   descent misses even an exact self-match at any `ef_search`. Real dense
   embeddings do not have this problem.

---

## Matching Engine

Ordered cascade; first strong hit wins, top five always returned.
Implementation: `src/core/match/pipeline.ts`.

| # | Stage | Confidence | Status |
|---|---|---|---|
| 1 | Barcode exact (GTIN → `internationalCode`) | 1.00 | **active** |
| 2 | Folded name exact (`matchKeys`) | 0.95 | **active** |
| 3 | Lexical: pg_trgm `word_similarity` + full-text | scored | **active** |
| 4 | Vector: pgvector cosine, per-language embeddings | scored | **active but non-semantic** — see below |
| 5 | Reciprocal rank fusion of 3 + 4 | scored | **active** |
| 6 | LLM rerank with full hierarchy path | scored | **DISABLED** — no `ANTHROPIC_API_KEY` |

### Currently disabled / degraded

- **Stage 6 is off.** No Anthropic key has ever been present in `.env`.
  Consequence: confidence is capped at `NO_RERANK_CEILING = 0.85`, so **nothing
  reaches the high / bulk-accept band** on retrieval signals alone. This is
  deliberate and safe.
- **Stage 4 is non-semantic.** `embedding_state` records the stored vectors as
  `hashing (local, non-semantic)`. All 438,925 rows are embedded with the local
  placeholder, which behaves as a second lexical channel, not a semantic one.
- An **OpenAI key was supplied once and had no billing quota** (HTTP 429
  `insufficient_quota`). Configuring it made accuracy *worse* (top-1 50%,
  top-5 58.3%) because it disabled the working placeholder without replacing it.
  This produced the `vector-readiness` guard described under Decisions.

### Supporting pieces

- `src/core/normalize/` — apostrophe folding, bidirectional transliteration,
  noise stripping (pack sizes / volumes / counts / vendor codes), unit
  resolution against the 90 official ids, diacritic folding, homoglyph repair.
- `src/core/match/rules.ts` — domain rules as score *adjustments*, not filters:
  base-code preference, marking-aware identifying codes, prepared-dish
  detection, strict-unit conflict.
- `src/core/match/score.ts` — calibration. Weights lexical 0.45 / vector 0.25 /
  RRF 0.30, renormalized over present signals; LLM weight 0.40; margin weight
  0.15; ceiling 0.85 without a reranker.
- `src/core/match/vector-readiness.ts` — refuses to compare a query embedded by
  one model against vectors stored by another.

---

## Evaluation

`npm run eval` → also writes `docs/eval-results.json`.

| Measure | Value |
|---|---|
| Golden set size | **12 of a planned 30** (12 seeded; 18 still owed by the product owner) |
| top-1 accuracy | **8/12 = 66.7%** |
| top-5 accuracy | **10/12 = 83.3%** |
| Reranker ceiling (correct code reached the top-20 pool) | **10/12 = 83.3%**, i.e. 16.7 points of headroom |
| Mean confidence when right / wrong | 0.876 / 0.779 |
| Separation | **+0.097** (positive — confidence is predictive, not inverted) |
| High band | n=5, **100%** top-1 precision |
| Medium band | n=7, **43%** top-1 precision |
| Median latency | ~800 ms (dominated by the exact vector scan the placeholder requires) |

### Decision thresholds agreed in advance

- top-5 < 80% → halt the project
- top-1 60–85% with top-5 > 90% → proceed, intended shape
- top-1 > 95% → golden set too easy

**Current result sits between the stated bands**: top-5 83.3% clears the 80%
halt floor but is below the >90% that "proceed" requires. It was **not** treated
as a pass.

### Cases that never reach the candidate pool

- `pacifier-absent-from-catalog` — no pacifier code exists in the classifier at
  all; correct answer is "other articles of plastics", which shares no words
  with the query.
- `palov-prepared-dish` — the correct catering code contains the word "palov"
  nowhere.

Both are unreachable by lexical retrieval and are exactly what stages 4 and 6
exist to solve.

### Publication status

**These numbers are NOT safe for external publication.** They are a floor
measured with two of six stages degraded on 12 cases, where each case moves the
headline by 8.3 points. The landing page deliberately contains **no accuracy
percentage anywhere**.

### Golden-set integrity note

Two of the 12 labels were corrected *after* seeing results, because the
pipeline's answer was better than the original label (`medical-service`,
`carpet-synthetic`). This moved top-1 from 50% to 66.7%. Recorded here because it
is a self-correction to a test after seeing the score and deserves scrutiny.

---

## Application

Next.js 15 App Router, React 19, TypeScript `strict`, Tailwind v4,
Prisma + Postgres 16 + pgvector, `iron-session` auth.

| Screen | Route | State |
|---|---|---|
| Sign in | `/sign-in` | works; scrypt password, no auth library |
| Upload | `/upload` | works; drag-drop, auto-detected column mapping, 5-row preview, mapping remembered per org |
| Report | `/report` | works; risk headline, four-type breakdown, filters, print stylesheet |
| Review | `/review` | works; hierarchy path + bound unit inline, alternatives, accept / reject / pick-other, bulk "accept all above 90%", keyboard j/k/Enter/r/o |
| Export | `/export` + `/api/export` | works; rebuilds the original file, verified round-trip |
| Landing | `/` | exists, mid-revision |

### Verified application behaviour

- Barcode short-circuit returns confidence 1.00 and skips later stages.
- Bulk accept respected its threshold exactly: 43 findings at ≥0.90 accepted,
  **0** high-confidence rows left pending.
- Export verified by round-trip: 200 rows preserved, original column order kept,
  MXIK/unit overwritten **in place**, `qadoqlash` and `audit_status` appended;
  accepted rows updated, pending/rejected rows byte-identical to input.
  Status counts 45 accepted + 117 clean + 38 pending = 200.
- Append-only audit log records product name, suggested code, chosen code,
  actor and timestamp. It was the only reason a stray-keystroke incident could
  be reconstructed (see Known Problems).

### Five checks

Implemented in `src/core/audit/checks.ts`, four user-visible types.

| Type | Severity | Condition |
|---|---|---|
| `MISSING` | high | no MXIK on the row |
| `NOT_FOUND` | high | code present but absent from the classifier; also covers retired codes, with `wasRetired` set |
| `MISMATCH` | medium | code valid but scores < 0.6 against the product name |
| `UNIT_CONFLICT` | medium | row unit contradicts a **strictly** bound unit; recommended units never fire |

### Demo data

`npm run seed` → org "Demo Savdo MChJ", user `buxgalter@demo.uz` /
`demo12345`, one 200-row catalogue deliberately messy in the ways Gate 0
measured. `npm run seed:audit <id>` audits it.

Current DB: 438,925 codes (all embedded), 1 catalogue, 200 items, **85 findings
all `pending`**, 0 leads. Demo distribution: 23 MISSING / 16 NOT_FOUND /
33 MISMATCH / 13 UNIT_CONFLICT, 83 risky rows of 200.

---

## Landing Page

**Current state:** implemented at `/` in `src/app/page.tsx` (863 lines). Public,
statically prerendered, 6.99 kB route / 113 kB first load.

Section order as actually on disk:

| Line | Section |
|---|---|
| 353 | Hero — *"Katalogingizdagi xavfli MXIK kodlarini toping."* |
| 410 | *"Katta katalogni qoʻlda tekshirish mumkin emas"* — scale argument |
| 443 | *"Rasmiy qidiruv har doim ishonchli javob bermaydi"* — portal-failure evidence |
| 511 | *"Notoʻgʻri kod nimaga olib keladi"* — four consequences |
| 553 | *"Uch qadam"* — three steps with real screenshots |
| 585 | `#hisobot` — *"Birinchi ekranda — bitta son"*, the sample report |
| 708 | *"Sizga nima qaytadi?"* — deliverables |
| 725 | *"Dastur tavsiya qiladi. Yakuniy qarorni siz qabul qilasiz."* — objections |
| 767 | *"Narxlar"* — pricing |
| 812 | `#audit` — lead form CTA |

Notable properties of the current implementation, worth preserving:

- Every figure is a named constant with a `docs/gate0-report.md` section
  reference in a comment, and a comment block explicitly recording what is
  **deliberately absent**: the 66.7% / 83.3% accuracy numbers, and the
  disproved "99% strict unit binding" figure.
- `CONSEQUENCES` carries a per-item `verified: boolean` plus a comment warning
  not to attach the VMQ 595 citation to the three unverified items.
- The evidence section uses contrast pairs (`HEADLINE_EVIDENCE`): the same
  product spelled two ways, answered usefully once and uselessly the other time.
- `STEPS` declares explicit intrinsic `width`/`height` per screenshot.
  **Verified: all four declared sizes match the actual PNG headers exactly**
  (2560×1800, 2208×268, 2560×1640, 2560×1520), so there is no layout shift.
- `src/app/lead-form.tsx` shows the picked file's size, turns the drop zone
  green when a file is staged, and replaces the form on success with a numbered
  three-step "what happens next" list under `aria-live="polite"`.

**Design direction (as implemented after this session's partial revision):**

| Token | Value |
|---|---|
| paper | `#FBFBFC` |
| ink | `#14161C` |
| ink-soft | `#4E5564` |
| rule | `#DDE0E7` |
| risk | `#A32B22` |
| verified | `#1B6B52` |
| serif | Newsreader |
| sans | IBM Plex Sans |
| mono | IBM Plex Mono |

Fonts are self-hosted via `next/font/google` in `src/app/layout.tsx`.

Explicitly avoided: gradients, glassmorphism, AI illustrations, heavy rounded
cards, purple/blue SaaS palettes, animation, fake screenshots.

**Assets it depends on** (all real, captured from the running app by
`npm run capture` via Playwright):

- `public/screenshots/step-1-upload.png` — upload with column mapping + preview
- `public/screenshots/step-2-report.png` — the risk report
- `public/screenshots/step-3-review.png` — review with hierarchy path
- `public/screenshots/report-headline.png` — the risk headline crop
- `public/demo/namuna-katalog.xlsx` — downloadable sample file
- `src/lib/sample-report.generated.ts` — anonymised real findings

**Known issues:** see `Known Problems`. In particular the revision is
**incomplete and unreviewed**, and the screenshots were captured **before** the
typography change, so they may not match the page's own fonts.

---

## Business Validation

| Claim | Status |
|---|---|
| The engine reduces manual work | **Suggested, not proven.** Measured on 12 synthetic cases with two stages degraded |
| A real customer catalogue works end to end | **NOT TESTED.** No real customer data has ever been through the tool |
| An accountant can use the review screen | **NOT VALIDATED.** No user has ever used it |
| Accountants will trust the output | **NOT VALIDATED** |
| Pricing (700k / 1.5M / 4M soʻm) | **HYPOTHESIS.** Never tested against willingness to pay |
| Free-audit-as-acquisition works | **UNVERIFIED** |

The demo catalogue is synthetic. Its confidence figures skew high because the
seed derives product names from real classifier entries, so exact matches are
over-represented relative to a real customer catalogue.

---

## Legal / Compliance

| Claim | Status |
|---|---|
| EHF issuance restricted when goods absent from the national catalogue | **VERIFIED** against lex.uz — VMQ No. 595, 22.09.2021, <https://lex.uz/docs/5650010>. The document restricts invoice issuance for unregistered products and establishes taxpayer risk groups |
| Buyer's input VAT credit conditional on a matching e-Faktura | **VERIFIED in substance** from secondary sources; primary-source citation NEEDS VALIDATION |
| Razriv → desk audit | Administrative mechanism, **no single citable article**; stated on the page without a citation |
| Fine under **Tax Code art. 223** | **REJECTED AS INACCURATE.** Art. 223 covers concealment / understatement of the tax base, not invoice or MXIK defects (confirmed across two independent searches). The page states the fine consequence **without** an article number |
| The article that actually governs invoice-formatting violations | **UNVERIFIED** — candidate is art. 225 but this was not confirmed |

**Action for a future context:** have a tax adviser confirm the fine provision
before any public launch. Do not add an article number on guesswork.

---

## Important Decisions

Do not revisit these without a specific reason.

1. **Excel export is the primary ingestion source.** The API is enrichment and
   incremental refresh only. Never crawl 439k codes through paginated search.
2. **`ARCHIVED` is folded into `NOT_FOUND`**, with `wasRetired` preserved on the
   finding. Decided by the product owner after Gate 0 proved no source exposes
   deprecation. Snapshot retention (`CatalogSnapshot`) was built from day one so
   the archive dimension accrues; surface it as its own check only once two
   imports exist.
3. **Catalogue re-pull happens at the start of each gate**, not frozen, since
   the portal regenerates the export per request.
4. **Strict vs recommended units are distinct.** Only strict bindings can
   produce `UNIT_CONFLICT`; recommended never does; unresolvable units on either
   side never do.
5. **No accuracy number appears in public copy** while the golden set is
   incomplete and stages are disabled.
6. **No unsupported legal claim.** Cite only what is verified; state the rest
   without false precision.
7. **Confidence is capped at 0.85 without a reranker**, so nothing is ever
   pre-checked for bulk accept on retrieval signals alone.
8. **The vector stage will not mix models.** `embedding_state` records the
   provider; on mismatch the query falls back to the stored provider when that
   is the local one, otherwise the stage is disabled. A *matching* non-semantic
   stage beats a *mismatched* semantic one.
9. **`MXIK_ANTHROPIC_BASE_URL`, not `ANTHROPIC_BASE_URL`**, overrides the API
   endpoint — agent tooling sets the latter and would misroute the caller's key.
10. **Never run `prisma migrate dev`.** See Known Problems.
11. **Permanent upstream failures are not retried** (auth, `insufficient_quota`);
    transient ones are.
12. **The audit log is append-only.** Only `create` is ever called on it.

---

## Out of Scope

Explicitly excluded from the MVP:

- Razriv audit (needs EHF data)
- Tax privilege / VAT rate conflict checking (`taxPrivilegeIds` stored, nothing
  checked)
- 1C / МойСклад / Biznex integrations — Excel is the interface
- Fiscalization, OFD, receipt submission
- Automatic MXIK application submission
- Subscriptions, recurring monitoring, notifications
- Payment processing (first clients pay by bank transfer)
- Russian or English UI (the `Dict` type is built so a mirror is
  compiler-checked, but no Russian strings are written)
- Roles and permissions; multi-tenancy beyond org scoping
- NKSR construction-resources cross-search

---

## Known Problems

Documented, **not fixed**.

1. **The landing page revision has never been looked at.** Four implementation
   files changed during the session that produced this document:
   - `src/app/globals.css` — design tokens replaced (Newsreader / IBM Plex,
     `#FBFBFC` / `#14161C` / `#DDE0E7` / `#A32B22` / `#1B6B52`), added
     `--color-rule-strong`, `--color-paper-raised`, `.mono`, `.eyebrow`,
     `prefers-reduced-motion`
   - `src/app/layout.tsx` — `next/font/google` for the three faces (Plex Sans and
     Plex Mono include the `cyrillic` subset, which matters because 23% of
     classifier names carry Cyrillic brand text), plus a `viewport` export
   - `src/app/page.tsx` — rewritten to 863 lines; structure listed under
     `Landing Page`
   - `src/app/lead-form.tsx` — file-size display, staged-file state, post-submit
     next-steps list

   Automated state is green: `tsc` clean, 198 tests pass, lint 0 errors, clean
   production build, `/` statically prerendered, image dimensions verified.
   **But no human or agent has viewed the rendered page at any viewport since
   these changes.** Everything below in this list is a consequence of that.

2. **Screenshots predate the typography change.** `public/screenshots/*.png`
   were captured with the old Georgia / Segoe UI stack, before the switch to
   Newsreader / IBM Plex. The page's own type may therefore not match the type
   inside its screenshots. Re-run `npm run capture` (needs `npm run dev`
   running) once the fonts are settled.

3. **No undo on the Review screen.** Once a finding is decided there is no way
   to reverse it in the UI. The decision is recorded in `AuditEvent`, so the
   history exists, but the reviewer cannot correct a misclick.

4. **Stray-keystroke incident (now mitigated).** The Review keyboard handler
   originally listened on `window` with no focus guard, so any `Enter`/`r`
   reaching the page mutated a decision. During testing this silently produced
   one bulk-accept plus 15 accepts and 8 rejects. A focus guard was added
   (shortcuts only fire when focus is inside the list; modifier keys ignored;
   list self-focuses on mount) and verified. **The missing undo remains.**

5. **`prisma migrate dev` is unusable on this project.** The schema uses three
   Postgres features Prisma cannot express — a generated `tsvector` column, a
   GIN index with `gin_trgm_ops`, and two HNSW vector indexes — so its diff
   wants to drop all of them, and it also tries to `ALTER` the generated column
   and fails. Use `migrate diff` → delete every statement touching `mxik_code`
   → hand-author the migration → `migrate deploy`. Documented in the README.

6. **`data/mxik.ndjson` is 1.14 GB.** Hierarchy names are repeated in three
   languages on all 438,925 rows. Splitting the four hierarchy levels into
   lookup tables (117 / 1,283 / 2,860 / 10,215 rows) would roughly halve the
   load and make the hierarchy path cheap to fetch.

7. **Scoring weights are reasoned, not fitted.** 12–30 cases cannot tune six
   constants. Re-derive from accumulated `AuditEvent` decisions.

8. **The vector weight (0.25) is currently unearned.** With the placeholder
   embedder the vector stage is a second lexical channel correlated with the
   0.45 already allocated to lexical.

9. **`ts_rank_cd` is unbounded**, so the full-text score is normalized against
   the best hit in its own result set — a relative, not absolute, signal.

10. **Not a git repository.** `git status` cannot be run; there is no history and
    no way to diff or revert. Consider `git init` before further changes.

11. **`npm run build` while `npm run dev` is running corrupts `.next`** and the
    dev server starts returning 500s. Stop dev first. Relatedly, deleting
    `.next` while a build is in flight produces a misleading
    `ENOENT: build-manifest.json` / "Failed to collect page data" error that
    looks like a real build failure but is not — re-run from a clean `.next`
    to confirm. This was observed and confirmed harmless.

12. **375 rows have unresolvable unit strings** and 39 barcodes were dropped as
    invalid GTIN lengths. Both are data-quality facts, not bugs.

---

## Open Questions

1. Does the full six-stage pipeline clear the >90% top-5 bar? Cannot be answered
   without an `ANTHROPIC_API_KEY`.
2. Which Tax Code article actually governs invoice-formatting penalties?
3. Will an accountant trust and understand the report? Never tested.
4. Is the pricing right? Never tested.
5. Should the hierarchy be normalized into lookup tables before scale?
6. Should the Review screen get undo, or is the audit log sufficient?
7. What is the real retention/deletion policy for uploaded customer files? The
   landing page currently promises deletion on request; no mechanism exists.

---

## Recommended Next Steps

1. **Decide the fate of the in-progress landing page revision.** Review it at
   desktop and mobile, then either finish it (re-run `npm run capture` so the
   screenshots match the new typography) or revert the three files listed in
   Known Problems #1. This is the only genuinely half-finished thing in the repo.
2. **Supply an `ANTHROPIC_API_KEY` and re-run `npm run eval`.** ~1 minute, a few
   cents, no re-embedding needed. Stage 6 has 16.7 points of headroom and this is
   the only way to resolve the Gate 1 decision rule.
3. **Get one real customer catalogue through the tool with an accountant
   watching.** Higher value than any further code. Everything measured says the
   engine works; nothing measured says a human will trust it.
4. Supply the remaining 18 golden cases.
5. Have a tax adviser verify the fine provision before public launch.

---

## Files That Matter

| Path | Why |
|---|---|
| `docs/SESSION_STATE.md` | this file — read first |
| `docs/gate0-report.md` | full data-discovery findings with every number |
| `docs/scoring.md` | confidence formula, weights and their justification |
| `docs/eval-results.json` | last eval run, machine-readable |
| `README.md` | cold-start quickstart, every npm script, migration procedure |
| `prisma/schema.prisma` | 10 models + 5 enums |
| `src/core/normalize/` | where most of the accuracy lives |
| `src/core/match/pipeline.ts` | the six-stage cascade |
| `src/core/match/score.ts` | calibration |
| `src/core/audit/checks.ts` | the four user-visible checks |
| `src/core/match/vector-readiness.ts` | the model-mixing guard |
| `src/app/page.tsx` | landing page (mid-revision) |
| `src/lib/i18n.ts` | typed `Dict`, all Uzbek Latin copy |
| `eval/golden.json` | 12 of 30 labelled cases |
| `scripts/lib/xlsx.ts` | streaming reader for the 205 MB classifier sheet |

---

## DO NOT REPEAT

- **Do not rediscover the API.** All endpoints, parameter quirks and auth status
  are recorded above and in `docs/gate0-report.md`.
- **Do not re-ingest the classifier** unless a fresh snapshot is wanted;
  438,925 rows are loaded and embedded.
- **Do not redo Gate 0.** The measurements are reproducible via named scripts.
- **Do not rebuild the matching engine or the normalization layer.**
- **Do not rebuild Gate 2.** All four screens work and are verified.
- **Do not re-verify VMQ No. 595** — verified.
- **Do not re-add Tax Code art. 223** as the citation for MXIK errors — it was
  checked and is wrong.
- **Do not re-run the exhaustive group enumeration** (groups 001 and 015) — the
  archive question is settled.
- **Do not re-benchmark the enrichment endpoints** — ~2,025 req/s, no limiting.
- **Do not change the database schema** without reading Known Problems #5 first.

---

## NEXT CONTEXT HANDOFF

### Current repository state

`C:\Users\User\Desktop\pets\mxik-audit`. Not a git repository. Node 20.18.2,
Docker running `mxik-audit-db` (Postgres 16 + pgvector) on host port **54329**
(5432/5433 are taken by other projects). Dev server runs on port **3100**.

Quality gate as of this writing: `tsc --noEmit` clean · `npm run lint` 0 errors,
1 accepted warning · `npm test` **198 passing, 12 files** · `npm run build`
succeeds · 5 Prisma migrations applied, `migrate status` clean.

Data: 438,925 classifier codes all embedded with the **placeholder** embedder;
1 demo catalogue, 200 items, 85 findings all `pending`; 0 leads.

Providers, from `npm run check:providers` (verified, no values printed):
`ANTHROPIC_API_KEY` **not set** · `VOYAGE_API_KEY` **not set** ·
`OPENAI_API_KEY` **set, 164 chars, no billing quota**. `.env` also has
`DATABASE_URL` and `SESSION_SECRET`. The OpenAI key is harmless: the
`vector-readiness` guard sees that the stored vectors came from the local
provider and substitutes it for queries, so the vector stage stays valid.

### Current task

Gate 3 landing page UX/conversion revision — **started, not finished, not
reviewed.**

### What has already been completed

Gates 0, 1 and 2 in full. Gate 3 exists with all seven required sections. See
Completed Gates above.

### What must NOT be changed

Gate 0 ingestion scripts, the Gate 1 matching engine and normalization layer,
the Gate 2 application screens and their server actions, the Prisma schema, the
existing tests, and the decisions listed under Important Decisions.

### Exact first action

Start the database and dev server, open `/` at desktop **and** 375 px mobile,
and judge the in-progress revision described in Known Problems #1:

```bash
docker compose up -d
npm run dev          # http://localhost:3100
```

Then decide: finish it (and re-run `npm run capture` so screenshots match the
new typography) or revert `src/app/globals.css`, `src/app/layout.tsx` and
`src/app/page.tsx`.

### Files to inspect first

1. `docs/SESSION_STATE.md` (this file)
2. `src/app/page.tsx`
3. `src/app/globals.css`
4. `src/app/layout.tsx`
5. `public/screenshots/`

### Expected outcome

A landing page that makes a visitor understand within seconds that they can
upload a catalogue and find which MXIK positions are risky, with the report
screenshot prominent, the measured portal-search failures used as evidence, no
accuracy percentages, and no unverified legal citation.

### Validation required

- `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`
- Visual check at 1280 px and 375 px; no horizontal scroll (previously verified
  at 375 px: `scrollWidth` 375 == viewport 375)
- All four screenshots and `namuna-katalog.xlsx` load (no 404s)
- No console errors
- Lead form still submits: contact-only, and contact + file (previously verified
  — file stored, row count parsed correctly as 200)
- Signed-in app flow still works: `/upload`, `/report`, `/review`, `/export`
- Demo credentials `buxgalter@demo.uz` / `demo12345`

**Do not run `npm run build` while `npm run dev` is running.**
