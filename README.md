# MXIK Audit

Audits a company's product catalogue against Uzbekistan's national goods and
services classifier (MXIK / IKPU / SPIC). Upload a catalogue, get a risk report,
confirm the suggestions, export the corrected file.

A wrong or missing MXIK code means an EHF cannot be issued at all (VMQ No. 595,
22.09.2021), the buyer's input VAT credit is denied, razriv mismatches trigger a
desk audit, and Tax Code penalties apply for invoice defects. The official portal supports one lookup at a time against **438,925
codes**, so a 3,000-SKU shop has no practical way to check its own catalogue.

**Status: Gates 0–3 complete.** The classifier is ingested and searchable, the
matching engine runs end to end, the four application screens work against live
data, and the landing page is at `/`.

## Cold start

Requires Node 20+ and Docker.

```bash
npm install
docker compose up -d          # Postgres 16 + pgvector on host port 54329
npm run fetch:catalog         # 93 MB, three language variants, ~20 s
npm run ingest -- --enrich    # normalize + fetch marking flags, ~4 min
npm run load:db               # COPY 438,925 rows into Postgres, ~2 min
npm run embed:catalog         # populate vectors + build HNSW, ~3 min
npm run eval                  # matching accuracy against eval/golden.json

npm run seed                  # demo org + a messy 200-row catalogue
npm run seed:audit <id>       # audit it (the seed prints the id)
npm run dev                   # http://localhost:3100
```

Demo sign-in: `buxgalter@demo.uz` / `demo12345`.

Do not run `npm run build` while `npm run dev` is running — they share
`.next` and the dev server will start returning 500s.

Then `npm run typecheck && npm run lint && npm test`.

`.env` is loaded automatically by every script that needs it (via
`src/lib/load-env.ts` — Node 20 has no `--env-file-if-exists`, and cmd.exe
does not expand globs, so neither could be relied on). Real environment
variables always win over the file.

## Scripts

Every script below is real and maps 1:1 to a file in `scripts/` or `eval/`.

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` under `strict` |
| `npm run lint` | ESLint, type-aware |
| `npm test` | 173 unit tests over `normalize/`, `match/` and `embed/` |
| `npm run eval` | matching accuracy, confidence calibration, per-case breakdown |
| `npm run eval:translit` | transliterator accuracy against 438,925 real parallel names |
| `npm run fetch:catalog` | downloads the three official Excel exports |
| `npm run ingest` | Excel → `data/mxik.ndjson`; `-- --enrich` adds marking flags |
| `npm run load:db` | NDJSON → Postgres, with snapshot diffing |
| `npm run embed:catalog` | populates `embeddingUz`/`embeddingRu`, builds HNSW |
| `npm run check:providers` | reports which embedding/rerank providers the environment selects |
| `npm run seed` | demo org, user, and a deliberately messy 200-row catalogue |
| `npm run seed:audit <id>` | audits a stored catalogue from the CLI |
| `npm run capture` | real screenshots of the running app, for the landing page |
| `npm run make:sample` | writes `public/demo/namuna-katalog.xlsx` |
| `npm run make:sample-report` | freezes an anonymised sample report for the landing page |
| `npm run generate:units` | regenerates `units.generated.ts` from the portal's unit reference |
| `npm run inspect:xlsx` | column-by-column census of the export |
| `npm run inspect:columns` | unit/hierarchy deep dive |
| `npm run compare:langs` | cross-language join of the three exports |
| `npm run probe:api` | API surface, search quality, rate limits, archive hunt |
| `npm run enumerate:group <nnn>` | exhaustive hierarchy walk vs the export |
| `npm run bench:enrich` | throughput of the per-code enrichment endpoints |
| `npm run check:marking` | marking-flag coverage analysis |
| `npm run check:services` | service-code census |

## How matching works

An ordered cascade; the first strong hit wins, but the top five are always
returned so a reviewer has alternatives.

| # | Stage | Confidence |
|---|---|---|
| 1 | Barcode exact (GTIN → `internationalCode`) | 1.00 |
| 2 | Folded name exact | 0.95 |
| 3 | Lexical: pg_trgm `word_similarity` + full-text | scored |
| 4 | Vector: pgvector cosine over per-language embeddings | scored |
| 5 | Reciprocal rank fusion of 3 and 4 | scored |
| 6 | LLM rerank, given each candidate's full hierarchy path | scored |

The formula, weights and their justification are in [`docs/scoring.md`](docs/scoring.md).

### Normalization is where the accuracy lives

Uzbek catalogues are chaotic, and so is the official classifier. Measured, not
assumed — see [`docs/gate0-report.md`](docs/gate0-report.md):

- The Uzbek apostrophe appears as **seven different characters** in the official
  export. The orthographically correct U+02BB appears in 74 of 438,925 rows.
  `no'xat` returns 1 wrong result from the portal; `noʻxat` returns 105.
- **23%** of the "Latin" export is mixed-script, because brand names stay
  Cyrillic inside Latin text. Transliteration therefore runs *within* strings.
- The portal transliterates ц **both** ways — `sement` but `tsentner` — so both
  readings are indexed.
- `npm run eval:translit` scores the transliterator at **97.9%** against the
  catalogue's own 438,925 parallel Cyrillic/Latin name pairs.

## Configuration

Copy `.env.example` to `.env`. Only `DATABASE_URL` is required.

| Variable | Effect if unset |
|---|---|
| `DATABASE_URL` | defaults to the docker-compose database on port 54329 |
| `ANTHROPIC_API_KEY` | **stage 6 is skipped** and confidence is capped at 0.85, so nothing reaches the bulk-accept band |
| `VOYAGE_API_KEY` / `OPENAI_API_KEY` | stage 4 falls back to a local non-semantic stand-in |

Both fallbacks are loud: `npm run eval` prints a warning banner, every
`MatchResult` carries a note, and `npm run check:providers` reports the
current selection without making any API call.

Two ways to turn the pipeline up:

1. **Reranker only** (minutes, cents). Set `ANTHROPIC_API_KEY` and re-run
   `npm run eval`. No re-embedding needed. This is the bigger lever: stage 6
   currently has 16.7 points of headroom against the retrieval pool.
2. **Reranker plus real embeddings.** Also set `VOYAGE_API_KEY` (or
   `OPENAI_API_KEY`) and re-run `npm run embed:catalog` — the stored vectors
   come from the stand-in and must be regenerated. That is 439k rows × 2
   languages; requests are batched and run 8-wide (`EMBEDDING_CONCURRENCY`), and
   `exactVectorScan` should then be switched off so HNSW is used.

`MXIK_ANTHROPIC_BASE_URL` — not `ANTHROPIC_BASE_URL` — overrides the API
endpoint. Agent tooling sets the latter for its own routing, and inheriting it
would send your key somewhere you did not choose.

### The vector stage will not mix models

Embedding a query with one model and comparing it to vectors stored by another
produces confident nonsense, so `embedding_state` records which provider
produced the stored vectors and every run reconciles against it:

- **Match** → vector stage runs normally.
- **Mismatch, stored vectors are the local provider** → queries fall back to that
  provider, with a printed explanation. A *matching* non-semantic stage beats a
  *mismatched* semantic one.
- **Mismatch otherwise** → vector stage is disabled rather than trusted.

So configuring a new embedding key does nothing until `npm run embed:catalog`
has actually re-embedded the catalogue. The run tells you which case you are in.

A provider that is configured but failing (quota exhausted, outage) degrades the
vector stage to lexical-only with a note; it never takes down the audit. Permanent
failures — auth, `insufficient_quota` — are not retried, since retrying a
billing error four times per batch across thousands of batches accomplishes nothing.

## Migrations

**Never run `prisma migrate dev` on this project.** The schema uses three
Postgres features Prisma's schema language cannot express — a generated
`tsvector` column, a GIN index with the `gin_trgm_ops` opclass, and two HNSW
vector indexes — so its diff wants to drop all of them, and `migrate dev` also
tries to `ALTER` the generated column and fails.

The working flow:

```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma   --to-schema-datamodel prisma/schema.prisma --script > /tmp/next.sql
# review, delete every statement touching mxik_code, then:
#   prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate deploy
```

## Layout

```
src/core/normalize/   pure text normalization (script, apostrophes, noise, units)
src/core/match/       cascade, fusion, scoring, domain rules, Postgres store
src/core/embed/       swappable embedding providers
scripts/              ingestion, enrichment and Gate 0 diagnostics
eval/                 golden set and the evaluation harness
prisma/               schema and migrations
docs/                 Gate 0 findings, scoring rationale, machine-readable reports
```

## Known limitations

- **`ARCHIVED` cannot be implemented as specified.** No source — export or API —
  exposes deprecation status or a replacement code. Verified by exhaustive
  hierarchy enumeration; see `docs/gate0-report.md` §3. Retirement is detected by
  snapshot diffing across imports, which yields nothing on a first import.
- **`data/mxik.ndjson` is 1.14 GB** because hierarchy names are repeated per row.
  Splitting the four levels into lookup tables would roughly halve the load.
- **The scoring weights are reasoned, not fitted.** 30 eval cases cannot tune six
  constants. They should be re-derived from accumulated `AuditEvent` decisions.
- **The landing page's legal citations are partly unverified.** VMQ No. 595 of
  22.09.2021 was checked against lex.uz and is accurate. The brief's citation of
  Tax Code art. 223 was **not** used: art. 223 covers concealment of the tax
  base, not invoice defects. The fine consequence is therefore stated without an
  article number pending a tax adviser's confirmation.
- **The sample report on the landing page comes from synthetic demo data.** Its
  confidence figures skew high because the seed derives product names from real
  classifier entries, so exact matches are over-represented relative to a real
  customer catalogue.

## Out of scope

Razriv audit, tax-privilege/VAT conflict checking, 1C/МойСклад/Biznex
integrations, fiscalization, automatic MXIK applications, subscriptions,
payments, Russian or English UI, roles and permissions, NKSR cross-search.
