# Tasnivo

Audits a company's product catalogue against Uzbekistan's national goods and
services classifier (MXIK / IKPU / SPIC). Upload a catalogue, get a risk report,
confirm the suggestions, export the corrected file.

A wrong or missing MXIK code means an EHF cannot be issued at all (VMQ No. 595,
22.09.2021), the buyer's input VAT credit is denied, razriv mismatches trigger a
desk audit, and Tax Code penalties apply for invoice defects. The official portal supports one lookup at a time against **442,719
codes** (export of 2026-10-15), so a 3,000-SKU shop has no practical way to check its own catalogue.

**Status: Gates 0–3, the P0 demo-readiness block and the P1 block complete.** The
classifier is ingested and searchable with local semantic vectors, the matching
engine runs end to end, audits run in the background with progress and resume,
the landing page is at `/`, a no-signup demo is at `/demo`, and traction metrics
are at `/admin`. See [`docs/SESSION_STATE.md`](docs/SESSION_STATE.md) for what is
measured and what is not.

## Cold start

Requires Node 20+ and Docker.

```bash
npm install
docker compose up -d          # Postgres 16 + pgvector on host port 54329
npx prisma migrate deploy     # schema (never `migrate dev`; see Migrations)
npm run fetch:catalog         # 93 MB, three language variants, ~20 s
npm run ingest -- --enrich    # normalize + fetch marking flags, ~10 min
npm run load:db               # COPY 442,719 rows into Postgres, ~3 min
npm run embed:catalog         # local e5 vectors + HNSW: ~2.7 h on 4 CPU threads, resumable
npm run eval:synthetic        # optional: rebuild eval/synthetic.csv
npm run eval                  # matching accuracy, real vs synthetic, per stage

npm run seed:demo             # the invented 186-row demo behind /demo
npm run seed                  # sign-in org + a messy 200-row catalogue
npm run seed:audit <id>       # audit it (the seed prints the id)
npm run dev                   # http://localhost:3000
```

No-signup demo: `http://localhost:3000/demo`. Sign-in org: `buxgalter@demo.uz` / `demo12345`.

One app, one port: locally the app is `npm run dev` on 3000 and Docker runs
only the database (plain `docker compose up -d` starts just `db`). The
compose `app` profile is the production build for servers and also listens
on 3000 — don't start it next to the dev server. If it is running locally,
`docker compose --profile app rm -s -f app` removes it (image and data stay).
Deploying to a server: [`DEPLOY.md`](DEPLOY.md).

Do not run `npm run build` while `npm run dev` is running — they share
`apps/web/.next` and the dev server will start returning 500s.

Run every command from the repository root. `npm run dev`/`build`/`start` run
`next <command> apps/web` there, so the working directory stays the root
(`data/`, `node_modules/` and `scripts/` resolve against it) and the root `.env`
is loaded (apps/web/next.config.ts).

Then `npm run typecheck && npm run lint && npm test`.

`.env` is loaded automatically by every script that needs it (via
`packages/domain/src/load-env.ts` — Node 20 has no `--env-file-if-exists`, and cmd.exe
does not expand globs, so neither could be relied on). Real environment
variables always win over the file.

## Scripts

Every script below is real and maps 1:1 to a file in `scripts/` or `eval/`.

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` under `strict`, in every workspace and for `scripts/` + `eval/` |
| `npm run lint` | ESLint, type-aware, over `apps/web/src`, `packages/*/src`, `scripts/`, `eval/` |
| `npm test` | 324 tests: unit tests, plus database integration tests (undo, deletion, demo, background audits, traction and cross-org isolation) that skip with a reason when Postgres is not reachable |
| `npm run eval` | top-1/top-5 and high-band precision, real vs synthetic, each stage on/off; appends to `docs/eval-results.json` |
| `npm run eval:synthetic` | rebuilds `eval/synthetic.csv` from classifier names with realistic noise |
| `npm run perf` | builds a 60,000-row noisy .xlsx (`-- --rows N`), uploads, audits and reports it with per-stage timing; appends to `docs/perf-results.json` |
| `npm run perf:nav` | tab switching benchmark against a running production build (`next start -p 3001`, never `next dev`): cold/warm tabs, settings tabs, workspace filters, Back/Forward, heap; `-- --slow` adds Fast 3G, `-- --server-log FILE` counts queries per route from a server started with `PRISMA_LOG=1`; appends to `docs/perf-nav-results.json` |
| `npm run seed:demo` | audits `packages/db/prisma/demo-catalog.json` into the demo template behind `/demo` |
| `npm run make:demo-catalog` | rebuilds that fixture from `scripts/demo/products.ts` (hand-checked codes) |
| `npm run demo:quality` | per-check precision/recall of the demo audit against the fixture's labels |
| `npm run purge:expired` | erases lead files past retention and deletes expired demo orgs (run daily) |
| `npm run lead:delete` | lists leads, or erases one lead's file (`--all`: the whole lead) on request |
| `npm run eval:translit` | transliterator accuracy against 438,925 real parallel names |
| `npm run fetch:catalog` | downloads the three official Excel exports |
| `npm run ingest` | Excel → `data/mxik.ndjson`; `-- --enrich` adds marking flags |
| `npm run load:db` | NDJSON → Postgres, with snapshot diffing |
| `npm run embed:catalog` | populates `embeddingUz` (`-- --columns uz,ru` for both), builds HNSW; resumes from `data/embed-checkpoint.json`, `-- --restart` starts over |
| `npm run check:providers` | reports which embedding/rerank providers the environment selects |
| `npm run seed` | demo org, user, and a deliberately messy 200-row catalogue |
| `npm run seed:audit <id>` | audits a stored catalogue from the CLI |
| `npm run capture` | real screenshots of the running app from a demo session, desktop and phone (docs/demos; the landing page uses none) |
| `npm run make:sample` | writes `apps/web/public/demo/namuna-katalog.xlsx` |
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
| 6 | LLM rerank of uncertain rows only, given each candidate's full hierarchy path | scored |

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

Copy `.env.example` to `.env`; every variable is documented there. Only
`DATABASE_URL` and `SESSION_SECRET` are required.

| Variable | Effect if unset |
|---|---|
| `DATABASE_URL` | defaults to the docker-compose database on port 54329 |
| `ANTHROPIC_API_KEY` | **stage 6 is skipped** and confidence is capped at 0.85, so nothing reaches the bulk-accept band |
| `ANTHROPIC_MODEL` | `claude-opus-5-5`; see `.env.example` for cheaper models and prices |
| `MXIK_LLM_ENABLED` | `true`; set `false` to never call the LLM, even with a key |
| `RERANK_GATE_CONFIDENCE` / `RERANK_GATE_MARGIN` | `0.95` / `0.10`: only rows below these go to the LLM |
| `EMBEDDING_PROVIDER` | `local` (recommended) embeds with multilingual-e5-small on the server's CPU; unset = Voyage/OpenAI when a key is set, else the non-semantic stand-in |
| `VOYAGE_API_KEY` / `OPENAI_API_KEY` | hosted embeddings for stage 4; not measured (no key), and they would send every row name to that provider |
| `ADMIN_EMAILS` | nobody can open `/admin` (traction metrics across all customers) |

### What the reranker sends

Only rows the gate marks uncertain, and only these fields: the cleaned product
name, the row's unit as written, a derived yes/no "prepared dish" flag, and up
to 20 public classifier candidates (code, name, hierarchy path, unit, marking).
Never prices, barcodes, existing codes, company names or other columns. The
model may only pick among those candidates or answer "none"; every returned
code is checked against the candidate list and the live classifier, and the
0.85 cap is lifted only for candidates it actually scored. Any failure
(timeout, refusal, bad JSON) leaves the row on the capped retrieval ranking.
Verdicts are cached per org by a hash of model + prompt + normalized name +
unit, and each audit logs rows sent, tokens, latency and estimated cost in its
`catalog.audited` event.

Both fallbacks are loud: `npm run eval` prints a warning banner, every
`MatchResult` carries a note, and `npm run check:providers` reports the
current selection without making any API call.

The biggest remaining lever is the reranker. Set `ANTHROPIC_API_KEY` and re-run
`npm run eval`; no re-embedding is needed. Top-1 sits 8.3 points below the
retrieval pool on real cases (66.7 vs 75.0) and 17.8 on synthetic (79.1 vs
96.9): that is what stage 6 can win back. Then re-run
`npm run seed:demo` and `npm run demo:quality` to see what it does to the demo's
false alarms.

### Embeddings (stage 4)

The stored vectors come from `Xenova/multilingual-e5-small` (384 dimensions),
run locally through ONNX Runtime. It was chosen over the hashing stand-in on
measurement (P1.1, `docs/eval-results.json` runs 3–4, demo numbers in
`docs/SESSION_STATE.md`):

- **Speed.** Its dense vectors let HNSW work. The stand-in's sparse vectors
  defeat HNSW, so it needs an exact scan of 442k vectors per row (~1.7 s); the
  demo audit took 31 s with e5 and 260–340 s with the stand-in.
- **Accuracy is mixed, not a clean win.** Synthetic top-5 rose 89.0 → 92.7 and
  typo misses fell 19 → 11; the gap between mean confidence on right and wrong
  answers widened on real cases (0.10 → 0.22). But 2 of the 12 real cases left
  the top 5, and on the demo MISMATCH precision fell 58% → 45%.
- **Cost and privacy.** Free; nothing leaves the server. Weights are ~470 MB,
  downloaded once from Hugging Face into `LOCAL_MODEL_DIR`. Embedding all
  442,719 names takes ~2.7 h on 4 CPU threads, or ~21 min on a GPU through
  DirectML (`LOCAL_EMBED_DEVICE=dml`, Windows). A query costs ~25 ms of CPU.

Hosted embeddings (`VOYAGE_API_KEY`, `OPENAI_API_KEY`) are supported but were
not measured: there is no key, and they would send every customer row name to
that provider. Embedding the classifier once would cost about $0.33 with OpenAI
`text-embedding-3-small` (~16M tokens at $0.02/M).

`MXIK_ANTHROPIC_BASE_URL` — not `ANTHROPIC_BASE_URL` — overrides the API
endpoint. Agent tooling sets the latter for its own routing, and inheriting it
would send your key somewhere you did not choose.

### The vector stage will not mix models

Embedding a query with one model and comparing it to vectors stored by another
produces confident nonsense, so `embedding_state` records which provider
produced the stored vectors and every run reconciles against it:

- **Match** → vector stage runs normally.
- **Mismatch, stored vectors are a local provider** (e5 or the stand-in) →
  queries fall back to that provider, with a printed explanation. A *matching*
  stage beats a *mismatched* one.
- **Mismatch otherwise** → vector stage is disabled rather than trusted.
- **Re-embedding in progress** (`rebuilding:` state) → vector stage is off
  until `embed:catalog` finishes, so half-written vectors are never compared.

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
npx prisma migrate diff --from-schema-datasource packages/db/prisma/schema.prisma   --to-schema-datamodel packages/db/prisma/schema.prisma --script > /tmp/next.sql
# review, delete every statement touching mxik_code, then:
#   packages/db/prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate deploy
```

On Windows, `prisma generate` fails with `EPERM ... query_engine-windows.dll.node`
while a dev server has the engine loaded. The TypeScript client is still
written; the engine binary does not change with the schema. Restart the dev
server to pick up new fields.

A checkout (or worktree) whose generated client is older than the database it
points at sees the database's newer enum values as errors: Prisma refuses a
read with `Value 'X' not found in enum 'FindingType'`. Finding reads survive
this (packages/db/src/finding-type-extension.ts: the type is read as text and shown as
"OTHER", with a `[db] finding_type holds a value…` warning in the server log),
but other enums and new columns do not. Run `npx prisma generate` in that
checkout after pulling a migration someone else applied. In development the
error page shows the error message and digest; in every environment the
server logs each page error as `[request-error] <method> <path> route=…
digest=…` (apps/web/src/instrumentation.ts).

## Repository layout

npm workspaces (`apps/*`, `packages/*`). The packages are TypeScript source,
not builds: each `package.json` maps `exports` straight to `src/*.ts`, so
`@tasnivo/domain/catalogs` is `packages/domain/src/catalogs.ts` for Next, tsx and
tsc alike. The split into an API, a worker and a thin web app is planned in
[`docs/BACKEND_SPLIT_PLAN.md`](docs/BACKEND_SPLIT_PLAN.md); this is its Wave 0.

```
apps/web/             Next.js: src/app (screens, server actions, /api routes), src/ui, src/components,
                      src/content (help), src/styles, public/, e2e/; src/lib holds the adapters that
                      need Next or React (session cookie, locale cookie, per-render caches, NextResponse)
packages/core/        @tasnivo/core: matching engine, no framework imports
  src/normalize/      pure text normalization (script, apostrophes, noise, units)
  src/match/          cascade, fusion, scoring, domain rules, Postgres store
  src/embed/          swappable embedding providers
packages/domain/      @tasnivo/domain: server services (decisions/undo, catalogues, demo, retention,
                      audit runner and background jobs, traction), no Next or React
packages/i18n/        @tasnivo/i18n: Uzbek/Russian dictionaries and formatting, pure functions
packages/db/          @tasnivo/db: prisma/ (schema, migrations, seed, demo catalogue fixture) and the
                      shared Prisma client
scripts/              ingestion, enrichment, demo fixture, maintenance and Gate 0 diagnostics
eval/                 golden.csv (real), synthetic.csv, and the evaluation harness
docs/                 Gate 0 findings, scoring rationale, eval history, session state, split plan
```

## Known limitations

- **MISMATCH still raises false alarms without the reranker.** On the demo
  catalogue `npm run demo:quality` measures 45% precision for MISMATCH with the
  e5 vectors (19 right, 23 rows flagged that were built correct or with a
  different problem); it was 58% with the stand-in vectors and 33% before the
  same-position rule of 2026-10-15. MISSING and NOT_FOUND are 100%. The rule no
  longer flags a wrong code inside the code's own 8-digit position; see
  `docs/scoring.md`.
- **Big catalogues take time.** Audits run in the background with a progress
  bar and resume after a restart, but throughput depends on the products:
  ~15 rows/s on the eval's names, ~2.4 rows/s on names sampled uniformly from
  the classifier, where 15.5% are floor slabs (one sub-position of 68,674 near-
  identical codes) that every retrieval channel has to rank. Measured with
  Postgres on 4 CPUs; see `docs/perf-results.json`.
- **The "real" eval cases are hand-written**, not taken from a customer file;
  none has been run through the tool yet.
- **The review screen is built for desktop.** It works at phone width, but the
  table scrolls sideways.
- **`ARCHIVED` cannot be implemented as specified.** No source — export or API —
  exposes deprecation status or a replacement code. Verified by exhaustive
  hierarchy enumeration; see `docs/gate0-report.md` §3. Retirement is detected by
  snapshot diffing across imports, which yields nothing on a first import.
- **`data/mxik.ndjson` is 1.14 GB** because hierarchy names are repeated per row.
  Splitting the four levels into lookup tables would roughly halve the load.
- **The scoring weights are reasoned, not fitted.** 12 real cases cannot tune six
  constants. They should be re-derived from accumulated `AuditEvent` decisions.
- **The landing page's legal citations are partly unverified.** VMQ No. 595 of
  22.09.2021 was checked against lex.uz and is accurate. The brief's citation of
  Tax Code art. 223 was **not** used: art. 223 covers concealment of the tax
  base, not invoice defects. The fine consequence is therefore stated without an
  article number pending a tax adviser's confirmation.
- **The landing page's sample report and the `/demo` catalogue are the same
  invented file** (`packages/db/prisma/demo-catalog.json`, 186 rows) audited by the real
  pipeline. Invented rows, not a customer's file; re-run
  `npm run make:sample-report` after any change that alters findings, so the
  landing and the demo stay equal. The art. 223 note above was written before
  part 5 (1% fine, edition 19.07.2026) was found; it is behind
  `NEXT_PUBLIC_SHOW_LEGAL_223` until a tax adviser confirms it.

## Out of scope

Razriv audit, tax-privilege/VAT conflict checking, 1C/МойСклад/Biznex
integrations, fiscalization, automatic MXIK applications, subscriptions,
payments, Russian or English UI, roles and permissions, NKSR cross-search.
