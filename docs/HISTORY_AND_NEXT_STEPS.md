# MXIK Audit: history and how to continue

> This briefing comes from the git history of `C:\Users\User\Desktop\pets\mxik-audit` (branch `transform-2026`, HEAD `a544529`) and the docs in the repo. It was a read-only review: no tests, builds or database queries were run. Anything marked **(uncertain)** could not be confirmed from git or the code.

**Words used in this document**
- **MXIK / IKPU**: the national 17-digit product classification code. Every line of an electronic invoice (EHF) needs one.
- **Reranker**: an optional AI step (Claude). It re-orders the candidate codes for uncertain rows.
- **Migration**: a SQL file that changes the database structure.
- **e2e test**: a test that drives a real browser against the running app.
- **Fast-forward merge**: main simply moves forward to the newer branch. There is no new merge commit and no conflicts.
- **i18n**: translation of the interface. Here that means Uzbek (`uz`) and Russian (`ru`).
- **GTIN**: the standard for barcode numbers.
- **RRF**: a way to merge several ranked lists into one.
- **HNSW**: the fast index for vector search.
- **tsvector / trigram**: two kinds of Postgres text search.
- **CSP**: a browser rule that says which scripts may run.
- **TOTP / 2FA**: 6-digit codes from a phone app, used as a second login step.
- **Tombstone**: a log entry that records that something was deleted.
- **Held transition**: React keeps showing the old page and never finishes the update.
- **Watchdog**: a timer that rescues a stuck navigation.
- **Size S / M / L** (section 7): S = under a day, M = 1–3 days, L = a week or more. This is a suggested scale. Please confirm it.

---

## 1. Summary

MXIK Audit is a tool that checks product catalogues for MXIK code risks, for companies in Uzbekistan.
- A company uploads its product list (Excel/CSV). The app matches every row against the national MXIK classifier, which had 442,719 codes in the 15 Oct 2026 export.
- It flags missing, unknown and mismatched codes, unit conflicts and several newer checks.
- A person accepts, rejects or edits each suggestion. Nothing changes without that decision.
- The app exports a corrected file, a 1C file or a PDF. It keeps an append-only log of decisions.

**Audience.** Owners of accounting outsourcing firms were a target user from the first commit (`b4f3417`), but the first version had no multi-client features. From 16 Oct (`78e21f5`, then pass 2) the app gained what firms need: clients, roles, a dashboard, a review queue, reminders, Telegram and an API.

**Where it stands today:**
- `main` = `origin/main` = `429ac94`, the end of "product pass 2" on 19 Oct.
- `transform-2026` = `a544529` is **23 commits ahead of main and 0 behind**, so a fast-forward is possible. 7 of the 23 are merges of `wp/*` branches, so the history is not a straight line.
- The branch has **no remote copy**. These 23 commits exist only on this computer.
- `docs/TRANSFORMATION_REPORT.md` says "nothing is merged or pushed". `docs/SESSION_STATE.md` says "Not merged into main and not pushed". Merging is the owner's decision.
- **Work in progress right now:** a linked session ("check-router-refresh-ser") has uncommitted changes in this same folder. They touch the navigation shell and the report, and add two new untracked files. See section 6.
- The app has **never been deployed**. The AI reranker has **never run with a real key**. **No real customer catalogue** has been audited.

---

## 2. Timeline

### Era 0: 20 Aug 2026, working MVP imported (`b4f3417`, `11b9583`)
- `b4f3417` imports a working local MVP ("Gates 0–3") in one commit:
  - Classifier loading: 438,925 codes in 3 languages, taken from the portal's Excel export and stored in Postgres + pgvector.
  - A six-stage matcher, four checks (MISSING, NOT_FOUND, MISMATCH, UNIT_CONFLICT) and the app for upload, report, review and export.
  - An append-only `AuditEvent` log, and an Uzbek landing page with a lead form.
- `11b9583` changes docs only. The landing uses diagrams instead of screenshots.
- No commits follow for about 8 weeks.

### Era 1: 15 Oct, 21:01–23:07, "P0 demo readiness" (33 commits, `d2d7385^..cce4531`)
- The goal was to be demo-ready for the UzCombinator accelerator (SESSION_STATE line 120).
- Landing claims now match the code and cited sources. Unverified legal claims sit behind flags that are off by default (`ff095e8`, `adb44fb`, `ad8accc`, `cc44eed`).
- A safe, gated Claude reranker (`eb10b2c`). It also fixes a bug where a *failed* AI call still gave a 0.985 "bulk-acceptable" score. It has never run with a key.
- The server enforces a minimum score of 0.90 for bulk accept (`8a7180c`).
- Undo, decision history, catalogue deletion and retention services (`bfc8f43`, `8c07746`).
- Eval harness v2 (`4df60fa`, `a9f18c1`), the `/demo` that needs no signup (`451ab41`), and a landing sample report generated from the demo (`3baf944`, `cce4531`).
- Dockerfile, `/api/health` and DEPLOY.md (`ac04f33`).
- MISMATCH is now raised only when the code is in a different 8-digit position. The owner approved this (`faa1c3d`).
- **Reversals:** the old reranker was replaced. The landing was split and then restructured. The review/undo UI from `8c07746` was replaced the next day by `53221ab`.

### Era 2: 15 Oct 23:09 → 16 Oct 02:45, "P1 block" (21 commits, `90459d7^..6d06c5a`)
- Free, local multilingual-e5 embeddings, with a backfill that can resume (`9162d74`, `952d0f3`).
- Audits run in the background, with a heartbeat, and resume after a restart (`9692a84`, `93cbed8`, `e7d8ffe`). Export returns 409 until the audit is ready.
- A performance harness (`9692a84`, `d1fd8f4`). The planned 60,000-row run was **never recorded**.
- Faster retrieval: a term cutoff for full-text search, and no second self-match pass (`401fbb5`, `373c84c`). The store retries when a connection drops (`baef328`).
- `/admin` traction numbers "for the accelerator application" (`9e6c651`).
- The landing was rebuilt twice in one night. It ended as a "spreadsheet-native" page (`a0f3022` → `d6e3eed`, `6d06c5a`).
- **Reversals:**
  - Batch size went 64 → 256 → back to 64, sorted by length (`cadfe23`, `2a44c42`).
  - Thread count went from the ONNX default to half the CPUs (`83adb89`), then to a fixed min(4, CPUs) after a measurement: 4 threads gave 46 texts/s and 8 gave 27 (`952d0f3`).
  - q8 weights became fp32.
  - e5 made the real-case top-5 **worse** (83.3% → 66.7%). It was adopted anyway, for speed and privacy.

### Era 3: 16 Oct 17:16–19:02, "Product pass A–O" (`8283cd4` through `72368d1`)
- Confidence is shown as words instead of %. Each suggestion explains "why this code" (`8283cd4`, `d51d1c9`).
- Group review of similar rows (`d2a3b49`). Organisation → clients → catalogues (`78e21f5`).
- Classifier update with a diff, re-check of clients and notifications (`c23a8d8`). Telegram bot (`1b9cf22`). White-label PDF (`8c3543e`).
- New checks:
  - Purchases → NOT_PURCHASED (`0f5954d`).
  - Tax privileges (`4eb81dc`). PRIVILEGE_OPPORTUNITY is always info. PRIVILEGE_CODE is info, or medium when the same code also has a pending MISMATCH. Neither changes anything by itself.
  - Marking flag (`8831a4f`), money at risk (`01302ba`), code-request draft (`136ecd0`).
- Import presets, 1C export, Click/Payme (`b3e1104`). Construction "general vs detailed" codes were investigated and **not built** (`9aa7dd3`).
- **Two landing lines.** The A–O pass and pass-2 features 1–14 (`8283cd4`..`c8064ad`) were built on a line that forked at `a0f3022`. That line never had the spreadsheet landing.
  - On that line the owner asked to undo the "v3" landing from `a0f3022` (anatomy, opening, workflow, workspace, mxik-code). `7d2d2ef` restored the landing as of `3baf944`.
  - The spreadsheet landing (`d6e3eed`, `6d06c5a`) stayed on a separate local line until a merge (Era 4).
  - Nothing records whether the owner had seen the spreadsheet page when asking for the rollback.
- No tests were added for A–O.

### Era 4: 16 Oct, "Product pass 2", features 1–14, merge and Docker services
- App design system v1, and one catalogue workspace at `/catalogs/[id]` that replaces the separate report, review and export pages (`e5681ab`, `53221ab`).
- Team and roles with invites (`aa0a096`). The firm dictionary becomes "stage 0" of matching (`d811783`). Decisions are carried over when a file is uploaded again (`81bf709`).
- Accuracy metrics (`3db0c6b`), bulk actions (`d9ceaa7`), share links (`b84d14e`), signup with a 14-day trial and plan limits (`a207af9`).
- Russian UI (`e8c4de4`), dashboard (`6da754c`), comments (`cd0ad1e`), saved views (`168aa2d`), activity log (`2df83a9`), reminders with a daily cron job (`2fb830e`), cheque-list import (`c8064ad`).
- Features 1–14 were committed in another checkout and arrived through `origin`. The merge message says "take the app work from the remote".
- Merge `6c581af` (parents `6d06c5a` and `c8064ad`) **kept the spreadsheet landing**. The landing in the merge is identical to `6d06c5a`, so the `7d2d2ef` rollback's landing was dropped. No record shows the owner choosing between the two.
- `9228e08` adds scheduler, backup and Telegram-bot containers. The app runs `prisma migrate deploy` when it starts.
- No tests were written for these 14 features.

### Era 5: 19 Oct 11:49–12:12, features 15–21 (`9228e08..429ac94`)
- Sales check (`bfeedc2`). Its logic had already shipped in `c8064ad`.
- Names from barcode (`0c47ed3`) and unit/packaging advice (`e4a1e45`). Both only make suggestions.
- Public REST API v1 with keys and OpenAPI (`ba5c492`).
- Google Sheets add-on, as **source code only** (`6fa0563`).
- Help centre `/yordam` in uz and ru (`d0e411e`).
- Security and data control: TOTP 2FA, server sessions, export, close account, retention of raw files (`3bf66e9`).
- `429ac94` marks the pass complete. **This is main today.**

### Era 6: 19–20 Oct, the transformation on `transform-2026` (23 commits, `main..transform-2026`, `efd9e06` through `a544529` inclusive)
- This followed a review of 8 areas. Work ran in parallel `wp/*` branches in two waves. Each wave ended with an integration commit (`09f1279`, `2181433`).
- Foundation migration (`efd9e06`).
- Security hardening (`f2bf128`): Telegram sign-in only through a personal binding, rate limits stored in the database, CSP headers, and a platform admin that needs three conditions.
- Matching correctness and honest labels (`a27c2e9`):
  - Fixes a bug where the runner-up got full confidence.
  - Checks that barcodes are valid GTINs.
  - Honest "moslik" (match) labels: "Yuqori moslik / Ortacha moslik / Tekshirish kerak" (spelling as in the commit message). The low band became "Past" / "Низкое" in `65b9ab0` and `74268bb`.
- Design system v2 with a dark theme (`ed62a89`). New shell and command palette (`e55d940`).
- Firm screens and `/queue` (`296bd7a`), settings tabs and "honest billing" (`519f658`), import wizard (`b7b2d15`), review workspace (`99f408d`).
- QA round (`65b9ab0`, 263 files): 24 e2e tests and 45 backend authorization tests.
- `74268bb`: low-band label "Past"/"Низкое" everywhere, workspace chips that wrap, and the transformation report. `c704ed0`: final results in the report.
- `a544529`: the root fix for stuck navigations. It adds `RouteBoundary` (`src/ui/shell/route-boundary.tsx`) and removes the same-route document loads from `65b9ab0`. It also adds the 25th e2e test: client row → breadcrumb back → another client.
- **Reversals:**
  - The watchdog from `65b9ab0` is now only a safety net. It waits 8 s instead of 5 s, then "nudges" React with a state update, and after 1.5 s more it loads the page as a document. `E2E_NO_NAV_FALLBACK=1` turns that last step off.
  - Deleting a catalogue no longer deletes its audit events. It writes a tombstone instead (`296bd7a`).
  - Retention no longer applies to uploads made before the change (`rawRetentionSince`).

---

## 3. What exists now (on `transform-2026`)

Legend: **Done** = built and tested locally. **Partial** = built, with known gaps. **Not verified live** = the code exists but was never tested against the real outside service.

**Landing and demo**
- **Done:** spreadsheet-style landing, in Uzbek only. Six sections: Hero with a live scan, WhyCodes, Consequences, HowItWorks, AccountantsTrust, GetStarted (`src/app/page.tsx`, `src/components/landing/*`).
- **Done:** `/demo`. Each visitor gets a private copy of an invented 186-row catalogue (kept 24 h, at most 500 live at once).
- **Done:** lead form with phone/Telegram validation, a honeypot field and a rate limit.
- **Partial:**
  - `/maxfiylik` (privacy) and `/oferta` (offer) are drafts with `<Todo>` blanks and are marked `noindex`.
  - The frozen landing sample and the live `/demo` template were both made before later matching changes. See section 6.
  - The "multi-client" landing flag comment still says "NOT BUILT", although the feature exists. The flag is off by default.

**Firm workspace**
- **Done:** dashboard, cross-client `/queue`, clients (rename, archive, delete, schedule), activity log, notifications, command palette (Ctrl/Cmd+K), dark theme, mobile navigation.

**Catalogue review** (`src/app/(app)/catalogs/[id]/*`)
- **Done:**
  - Virtualised grid, row drawer with evidence, match labels.
  - Decisions for one row, a group or in bulk, with a server dry run first. Undo works, including undo of what the dictionary learned. Each row has at most one accepted code.
  - Comments and flags, saved views, share links, version diff with carry-over.
  - Names from barcode, unit advice, code-request draft, money at risk.
  - Keyboard shortcuts that also work on Cyrillic layouts, and card view on phones.

**Matching engine** (`src/core/match/*`)
- **Done:** stage 0 firm dictionary (0.96), barcode identity (1.00, valid GTIN only), exact name (0.95), trigram + full-text + vector, RRF fusion, a relevance guard, and seven finding types.
- **Not verified live:** stage 6, the Claude reranker. No key has ever been set, and all 13 eval runs say "noop".
- **Data state:** on 19 Oct the dev database held 438,925 live codes with "hashing" (non-semantic) vectors (`docs/scoring.md` ~line 336; eval runs 9–13). The 442,719-code e5 setup from 15 Oct (runs 3–8) is no longer what the dev database holds, so e5 runs 7–8 cannot be compared with later runs.

**Imports and exports**
- **Done:**
  - Upload wizard: checks the real file content, refuses old `.xls` files, guards against zip bombs, reads cp1251 text, and remembers column mappings.
  - Purchase lists, cheque lists and sales lists.
  - Exports: xlsx, 1C (xlsx/CSV) and PDF, with a guard against formula injection.
- **Partial:** the 1C, MoySklad and Billz presets are labelled "taxminiy" (approximate). They were never checked against real files.

**Team and security**
- **Done:**
  - Roles admin / accountant / viewer, scoped to clients, and invites.
  - TOTP 2FA with a QR code and recovery codes. Server sessions.
  - Auth rate limits stored in the database. CSP headers.
  - Account export, close and restore. Retention of raw files.
- **Access rules:**
  - An accountant or viewer with **no assigned clients sees every client** of the org (DEPLOY.md §7c).
  - An accountant scoped to some clients cannot read or edit the firm dictionary at all (`mayUseDictionary`, `src/lib/dictionary.ts:189`).
- **Not verified live:** SMTP email (invites, verification, password reset). Without SMTP, links are shown on screen, and `npm run password:set` is the way to reset a password.

**Billing and plans**
- **Done:** 14-day trial and plan limits. Reading data is never blocked.
- **Not verified live:** Click and Payme.
- **Partial:** `PLAN_FIRM_PRICE` is not set, so the firm plan shows "not for sale". The plan and API limits are placeholders.

**Integrations**
- **Telegram: not verified live.** Bot for file upload and summaries, notifications, and sign-in through a personal binding.
- **Public API: done.** `/api/v1` with check, catalogs, report and openapi; `Idempotency-Key`; rate-limit headers. **Partial:** the rate limit lives in memory, per process.
- **Google Sheets add-on: not published, never run.** Source only, in `integrations/google-sheets/`.
- **Help centre: done, needs review.** `/yordam` and `/yordam/ru`, with 8 MDX articles per language. The Russian text needs a review by a native speaker.
- **Admin: done.** `/admin` (traction) and `/admin/metrics` (accuracy), for the platform admin only.

---

## 4. How it is built

**Stack**
- Next.js `^15.5.23` (App Router, server actions), React `^19.2.8`, TypeScript in strict mode.
- Prisma `^6.19.3` and `pg`, on Postgres 16 + pgvector (`pgvector/pgvector:pg16`).
- AI and embeddings: `@anthropic-ai/sdk`, and `@huggingface/transformers` pinned to exactly 4.3.0 (local e5, 384 dimensions).
- Libraries: exceljs, pdfkit, grammy (Telegram), iron-session, nodemailer, zod, Tailwind 4 with custom tokens, and home-made UI primitives in `src/ui`.
- Node 22 in Docker (`node:22-bookworm-slim`).

**Where the code weight is** (lines at `transform-2026`)

| Area | Lines | What |
|---|---|---|
| `src/lib` (root files) | ~17.6k total: ~9.7k services, ~5.8k tests, ~2.1k i18n | Server services: decisions, audits, imports, dictionary, clients, exports |
| `src/app/(app)` | ~11.5k | Signed-in screens. The catalogue workspace `catalogs/[id]` alone is ~4.4k |
| i18n (root files + `src/lib/i18n-parts`) | ~5.5k | uz/ru dictionaries |
| `src/ui` + `src/ui/shell` | ~4.9k | Primitives, app frame, navigation |
| `scripts/` | ~4.3k | Classifier loading, ops, demo, diagnostics |
| `src/core/match` | ~4.0k | Matching engine |
| `prisma/schema.prisma` | 1,091 | 43 models, 10 enums, 39 migrations |

How the code is organised:
- `src/core` holds mostly pure logic. There are a few exceptions: the matcher's Postgres retrieval (`src/core/match/store.ts`), the rerank cache (`rerank-cache-pg.ts`) and model loading in `src/core/embed`. The database connections are passed in from outside.
- Database orchestration lives in `src/lib`.
- Server actions in `src/app/actions` (25 files, 92 actions) stay thin.
- There is no `middleware.ts`. The `(app)` layout and each route check auth themselves.

**Data model highlights**
- Classifier: `MxikCode` (names in 3 scripts, units, vectors, a generated tsvector), `CatalogSnapshot`, `ClassifierChange`, `EmbeddingState`.
- Tenancy: `Organization` (customer, demo_template, demo, internal), `User` (role, 2FA, platformAdmin, telegramUserId), `Client`, `ClientAssignment`.
- Audit: `Catalog` → `CatalogItem` → `Finding` (decision, `decisionEventId` for undo, `decisionSource`).
- `AuditEvent`: app code only ever creates rows. Deleting a catalogue keeps them and adds a tombstone. Events are still removed when a whole org is hard-deleted, because they cascade from `Organization`. That happens in the purge of closed accounts (`src/lib/security/account.ts:46`) and the purge of demo copies (`src/lib/demo.ts:95`). The dev seed also clears them (`prisma/seed.ts:120`).
- Firm features: `FirmMapping` (dictionary), `ShareLink`, `FindingComment`, `SavedView`, `ReminderTask`, `DocList`, `PurchaseList`, `ApiKey`, `Order`.

**Background jobs**
1. In-process audit worker (`src/lib/audit-jobs.ts`). It writes a heartbeat and a progress marker. `src/instrumentation.ts` resumes stale audits when the server starts. There is no queue and no lock across several app instances.
2. Scheduler container (`scripts/scheduler.mjs`, times in UTC+5):
   - `purge:expired` daily at 03:15.
   - `classifier:update` on Mondays at 04:00.
   - `POST /api/cron/daily` at 06:15. It runs reminders, raw-file retention, the preview sweep, the purge of closed accounts, cleanup of old auth attempts and cleanup of old API idempotency records (`src/lib/daily.ts`).
   - It fires only at the exact minute. A job missed while the scheduler is down is not run later.
3. Backup container: `pg_dump` every night at 03:45, kept for 14 days, saved in `./backups` on the same server.
4. Telegram bot: a webhook (`/api/telegram/webhook`) or long polling (`npm run telegram:bot`).

**Tests**
- Unit and DB tests: `npm test` runs node:test through tsx (`scripts/test.mjs`). There are 135 test files with about 940 cases.
  - The committed report says 943 tests, 942 passing. The one failure is `src/lib/sample-report.test.ts` (data drift).
  - 48 DB suites skip **with a reason** ("database not reachable" or "classifier not loaded", from `dbSkipReason()` in `src/lib/test-fixtures.ts`). They count as skipped, not failed, so `npm test` still exits 0. Check the skipped count in the output.
  - When a database is reachable, the tests write to and delete from the database in `DATABASE_URL`.
- e2e: `npm run test:e2e` uses the Playwright library with node:test, against a running server. There are 25 tests. The report says 25/25 passed with `E2E_NO_NAV_FALLBACK=1`, run against `next start`.
- Accuracy: `npm run eval` (12 hand-written real cases + 191 synthetic cases) and `npm run demo:quality`.
- There is **no CI** (no `.github/` folder). Tests run only locally.

**Deployment** (`DEPLOY.md`, never tried for real)
- One Linux VPS (4 vCPU / 8 GB recommended), nginx on the host with certbot, and Docker Compose.
- Compose profiles: the default starts only `db`; `app` adds app + scheduler + backup; `bot` adds telegram-bot.
- `NEXT_PUBLIC_*` values are fixed at build time, so changing them needs a rebuild.

---

## 5. Decisions and conventions to keep

**Product principles**

| Rule | Why | Where |
|---|---|---|
| Every public claim must trace to code or a cited source. Unverified legal claims go behind `NEXT_PUBLIC_*` flags that are off by default. No accuracy % in public text. | Accountants "punish overclaiming". | `src/components/landing/data.ts`, `config.ts` |
| A score is a *match* score, never a probability ("Yuqori/Oʻrtacha/Past moslik"). | "Aniq" (certain) promised too much. | `docs/scoring.md`, `confidence-labels.ts` (`a27c2e9`) |
| Nothing changes without a human decision. Automatic passes never overwrite a reviewer's decision. Advice features only suggest. | Accountants own the result. | `classifier-recheck.ts`, `barcode-name.ts`, `unit-advice.ts` |
| No invented prices and no fake checkout. Say why something cannot be bought. | Honesty. Prices are the owner's call. | `src/lib/billing/availability.ts` |
| "A missing suggestion beats a wrong one." Hide weak candidates that share no word with the product. | Avoid absurd matches. | `src/core/match/pipeline.ts:298`, `relevance.ts` (both `72368d1`) |
| Without the reranker, scores are capped at 0.85. So only barcode, exact-name or dictionary hits can be bulk-accepted (≥ 0.90, enforced on the server). | A failed AI call once looked "certain". | `score.ts`, `8a7180c`, `eb10b2c` |
| Only the cleaned name and unit of a customer row may go to an AI provider. Caches are separate per organisation. | Privacy. | `rerank-prompt.ts`, `rerank-cache*.ts` |
| Legal and tax findings stay informational unless a source is cited. GENERIC_CODE stays unbuilt. | No unsupported legal claims. | `docs/imtiyoz-data.md`, `docs/construction-codes.md` |
| App code only appends to the audit log. Deleting a catalogue writes a tombstone. Undo is a new event. | The log is evidence for a tax inspector. | `src/lib/catalogs.ts`, `decisions.ts` |
| The landing sample report must equal the demo. After any change to findings, run `npm run make:sample-report` again. | Visitors would distrust both. | SESSION_STATE decision 16 |
| Scoring weights and thresholds change only with eval evidence **and** the owner's approval. Do not reload the classifier or rebuild matching/normalisation without a reason. | They are tuned and measured. | SESSION_STATE "What must NOT be changed", "DO NOT REPEAT" |
| The vector stage never mixes embedding models. `embedding_state` records which provider made the vectors. | Mixed vectors give wrong matches. | SESSION_STATE decision 8 |

**Code conventions**
- Every query is scoped by `orgId`. An id from another org behaves exactly like a missing one (404).
- Server actions validate input with zod and call `writer()`/`admin()` (`src/lib/guard.ts`). Libraries check roles again (`actor-role.ts`, `write-access.ts`). `src/lib/backend.authz.test.ts` is the tenancy contract.
- Every browser sign-in goes through `openSession()` in `src/lib/security/sign-in.ts`. The demo is the only exception.
- Tokens are random. Only their sha256 hash is stored.
- Every change writes an `AuditEvent` with a dotted name. A bulk change is one event, so it can be undone in one step.
- Pure modules get `env` as a parameter, so tests never read `process.env`.
- Use `MXIK_ANTHROPIC_BASE_URL`, **never** `ANTHROPIC_BASE_URL`. Agent tools such as Claude Code set the second one, and it could send your key to the wrong endpoint (SESSION_STATE decision 9).
- Constants have a comment with the measured reason for their value.
- Server-side imports use `.js` suffixes, so tsx can run them.

**Migrations**
- Migrations are hand-written SQL that only add things. **Never run `prisma migrate dev`**: Prisma would drop the tsvector column and the trigram and HNSW indexes.
- Apply migrations with `npx prisma migrate deploy`.
- Name new migrations with a date **after `20261022100000`**. Existing folders already use future dates.

**i18n (uz/ru)**
- Every UI string goes in both languages. The typed `Dict`/`AppDict` makes a missing key a compile error.
- Each area has its own file in `src/lib/i18n-parts/<area>.ts`. Server code uses `getI18n()`; client code uses `useI18n()`.
- Uzbek apostrophes must be U+02BB/U+02BC.
- Numbers and dates go through `src/lib/format.ts` (fixed separators, Asia/Tashkent time). Never use `toLocaleString`: it causes hydration error #418. Two old call sites still break this rule: `src/lib/catalog-page.ts:22` (a label) and `src/core/match/rerank-usage.ts:15` (a log line).

**Design system** (`docs/DESIGN_SYSTEM.md`)
- Use tokens only (no hex colours), one primary action per view, and `ConfirmDialog` for destructive actions.
- Status is always shown as colour + icon + text. Codes are shown in a monospace font through `CodeChip`.
- Use one fixed glossary of words in both languages.
- Landing tokens use the `lp-` prefix under `.landing`. App tokens live under `.app`. Keep them separate.

**Testing and measuring habits**
- DB tests skip with a reason when Postgres is down.
- Measure matching changes with `npm run eval` and `demo:quality`. Record the before/after numbers **and the costs** in `docs/scoring.md`. Runs are added to `docs/eval-results.json`.
- Never run tests against a staging or production `DATABASE_URL`. Real environment variables win over `.env`. A test once deleted every live demo in a shared database (`f1cb5de`).

**Commit and branch habits**
- The usual pattern (P0/P1, A–O and most transform commits): the subject is "Area: what changed", the body explains *why* with measured numbers, and it ends with a `Co-Authored-By` line. History did not always follow it. 41 of 121 non-merge commits have only a subject, including all pass-2 feature commits (`aa0a096`…`3bf66e9`) and `efd9e06`, `ed62a89`, `72368d1`.
- **Sessions never push. Only the owner pushes to origin** (SESSION_STATE line 783).
- Do not commit build files (`tsconfig.tsbuildinfo`). It is gitignored on transform-2026 but **still tracked on main**.
- Large passes used one `wp/*` branch per area, plus "Integrate wave N" commits.
- Remove the `node_modules` junction before `git worktree remove`. This comes from your saved memory note.
- *Suggestion from this review, not a recorded project rule:* stage files with explicit paths instead of `git add -A`. SESSION_STATE said this once, as a one-time warning about someone else's staged work (added in `8831a4f`, removed in `ab55e95`).

---

## 6. Open threads and risks

**Work in progress right now (uncommitted)**
- The linked session "check-router-refresh-ser" is working on "held transitions": `router.refresh()` calls and server actions that revalidate a page. These stay on the same address, so `RouteBoundary` and the watchdog do not cover them.
- Its uncommitted changes are:
  - Modified: `src/ui/shell/{app-frame.tsx, navigation.ts, navigation.test.ts}` and `docs/TRANSFORMATION_REPORT.md`.
  - New, untracked: `src/ui/shell/response-nudge.ts` (41 lines) and `e2e/refresh.e2e.ts` (77 lines).
- The committed report says no held transition "was seen in e2e". The uncommitted report edits say one was **reproduced** in the production build (`next start`): 16 of 16 refreshes on `/dashboard` were held until a toast closed after 6 s. A nudge after each server response fixes it (0 of 48 held). The edits also say 948 tests, 947 passing.
- None of this is in `a544529` yet.

**Never verified against the real world**
- AI reranker: no `ANTHROPIC_API_KEY` since `b4f3417`. The gate values 0.95/0.10 and the LLM weight are not tuned, and the cost per 1,000 rows is unknown. A key alone turns on the default model `claude-opus-5-5`, the most expensive one (`rerank-config.ts:39`).
- No real customer catalogue and no session with a real accountant.
- The golden set has 12 of a planned 30 cases, all hand-written. **The remaining 18 are owed by the product owner.** 2 labels were changed after the results were seen.
- Go/no-go thresholds were agreed in advance: top-5 < 80% means halt; "proceed" needs top-5 > 90% with top-1 between 60% and 85%. The current real-case result (hashing vectors, top-5 83.3%) sits between the two and "was not treated as a pass". With e5 it is 66.7%. Each case moves the result by 8.3 points. Most product work since 15 Oct was built while this gate is still open.
- The app was never deployed. SMTP, the Telegram bot and login, Click and Payme were never tested live.
- The Google Sheets add-on was never run. Reading the code suggests that each re-run would add 4 more output columns **(uncertain)**.
- Whether the UzCombinator application was sent, and any deadline, is not in git. Check with the owner **(uncertain)**.

**Quality and accuracy**
- Real cases with hashing vectors: top-1 66.7%, top-5 83.3%. With e5: top-5 66.7%, below the project's own "halt below 80%" line. Nobody measured e5 again after the `a27c2e9` fixes.
- MISMATCH on the invented demo: precision 56% (19 correct of 34 flagged) after `a27c2e9`, 58% before. Recall is 100%. 14 of 76 clean rows are still flagged. A wrong code **inside** the same 8-digit position is not flagged.
- The right suggestion appears in 38 of 77 demo problem rows. Pacifier and palov never reach the candidate pool.
- The weights were chosen by reasoning, not fitted to data.

**Known broken or stale**
- `src/lib/sample-report.test.ts` fails: code `02201001001401003` is missing from the local classifier.
  - The likely cause: the dev DB had 442,719 codes on 15 Oct but 438,925 on 19 Oct, the same count as the Aug load. That suggests an older classifier load **(uncertain; not checked whether the code is in the 442,719 export)**.
  - The same code is in `prisma/demo-catalog.json`, so the demo may also treat it as NOT_FOUND **(uncertain)**.
- **The landing claim about deletion is wrong.** `DATA_FLOW.appDeletion` (`src/components/landing/data.ts:243-245`, shown in `accountants-trust.tsx` and `faq.tsx`) says decision records are deleted with the catalogue. But `deleteCatalog` keeps audit events (`src/lib/catalogs.ts:142`), and `/maxfiylik` says they are kept. The two pages contradict each other.
- The landing sample was last generated in `a0f3022`, before `72368d1`, `d811783` and `a27c2e9`.
- The live `/demo` template in the database was not audited again after `a27c2e9`. `scoring.md` says re-seeding "would touch a shared database". `make:sample-report` refuses to write if a displayed code is missing from the classifier, so it cannot be regenerated before the classifier is reloaded.
- Stale docs:
  - `README.md`: "324 tests". Its "out of scope" list names payments, Russian UI and roles, which all exist now. It also says "Node 20+".
  - `docs/SESSION_STATE.md`: Known Problems #5, #8, #9 and #10; Important Decision #12 (it says deleting a catalogue deletes its audit rows, which `296bd7a` changed); the landing description; "waiting for P1"; the old repo path; `PLANS.firmMonthly.price`.
  - `DEPLOY.md` §6: "audited inside the upload request".
  - `docs/DESIGN_SYSTEM.md` rule 11 (line 214): "same-route navigation loads a document". `a544529` removed that behaviour.
  - Comments in `config.ts` (multi-client "NOT BUILT"), and the header comments of `prisma/schema.prisma` and `src/lib/session.ts`.
  - `docs/TRANSFORMATION_REPORT.md` says "4 migrations". The real count is 3.
- `backend.authz.test.ts:288` says "HOLE (kept failing)". The comment is stale: the report's final run lists only the sample-report failure, and `mayUseDictionary` now exists (`src/lib/dictionary.ts:189`).

**Fragile**
- Held transitions: see "Work in progress" above. In the committed code there are 35 `router.refresh()` calls in 24 files (including a polling interval in `src/ui/catalog-status-client.tsx:13`) and about 56 `revalidatePath`/`revalidateTag` calls. They concern the production build (`npm run build` + `npm run start`), not `npm run dev`.
- The navigation fix makes every navigation inside a section remount the page, so local state on the page is lost.
- Audit speed with hashing vectors and no reranker is 3.8 rows/s, so a 3,000-row catalogue takes about 13–14 min (863 s in e2e). With e5 the only recorded speed is 2.4 rows/s (a 300-row run on 15 Oct), so 3,000 rows take about 21 min before any reranker time. DEPLOY.md gives 2.4–15 rows/s on 4 vCPU, depending on the products. Jobs run in one process with no lock across instances.
- These limits live in memory, per process: the API rate limit (`src/lib/api/limits.ts:36`) and the demo-start limit (`src/app/actions/demo.ts`, plus `MAX_LIVE_DEMOS = 500`). The lead form and auth limits are stored in the database (`auth_attempt`).
- Finding reasons are stored as Uzbek sentences, so the API and exports cannot translate them.
- CSP allows `'unsafe-inline'`. Sessions do not store an IP. Private not-found pages return HTTP 200.
- The scheduler and telegram-bot containers reuse the app image and its HEALTHCHECK (`Dockerfile:36-37`, `localhost:3000/api/health`), with no override in `docker-compose.yml`. Neither listens on 3000, so they **will** show as unhealthy. This was read from the files, not run. The effect is only cosmetic, because no service waits for their health.
- **`CRON_SECRET`**: if it is unset or shorter than 16 characters, the scheduler only logs "skip". Reminders, raw-file retention, the preview sweep, auth-attempt cleanup and the purge of closed accounts then never run, without any error. `/maxfiylik` promises several of these.
- **`SESSION_SECRET`** also encrypts the TOTP secrets and signs the recovery codes. If you rotate or lose it, every user's 2FA breaks, and each user needs an operator SQL reset (DEPLOY.md §7g).
- **`classifier:update`** runs every week without a person watching. It marks every code missing from the download as retired, then re-checks all clients and notifies them. No guard refuses a suspiciously small download (`scripts/lib/load-classifier.ts:241-243`), so a cut-off or changed export could retire many codes at once. This was found by reading the code, not by running it.
- Backups stay on the same disk and nothing copies them off the server. A restore was never tested. DEPLOY.md says "a backup on the same disk is not a backup".
- DEPLOY.md §7 sets up host crontab jobs, and §9 says the scheduler and backup containers replace them. Someone who follows the file from top to bottom would run purge and backup twice.
- Group review only groups the rows loaded on the current page. NOT_PURCHASED and privilege findings are not refreshed after a reviewer accepts a new code.
- Admins created through Telegram get a random password that is never shown. Closing an account asks for the password, and password reset needs an email, but these accounts have a `tg-<id>@telegram.invalid` address. Only an operator can unblock them, with `npm run password:set`. This was confirmed in the code, not run.
- `e2e/` is not type-checked or linted. `eslint-config-next` 16 is installed but never imported, so no Next or react-hooks lint rules run.
- Dead code: `src/ui/catalog-table.tsx`, `column-select.tsx`, `sparkline.tsx`.
- Two pricing models exist side by side, and both are untested ideas:
  - The landing sells one-off checks per catalogue (700k / 1.5M / 4M soʻm), paid "by bank transfer after the work" (`src/components/landing/config.ts:78-83`).
  - The app sells the same tiers through Click/Payme (`src/lib/billing/plans.ts:7-9`), plus a firm subscription.
  - The catalogue prices are typed in both places and must be kept equal by hand.
- `NEXT_PUBLIC_FEATURE_MULTI_CLIENT` is false by default in the Dockerfile and in compose. A default build therefore hides the per-client feature on the landing, although firms are now the main audience.
- Node versions disagree: Docker uses 22, this PC runs 20.18.2, README says "Node 20+", SESSION_STATE says 24.18. There is no `engines` field, `.nvmrc` or `.node-version`.

**Another checkout (uncertain)**
- Features 1–14 were committed in another checkout. SESSION_STATE line 783 names `C:\Users\USER\Desktop\Pets\mxik-audit-\mxik-audit`, which does not exist on this PC.
- If that checkout still exists on another machine, check it for unpushed commits or its own `.env` before relying on origin.

**Leftover branches**
- `feature/product-pass` (`6ac76a5`) and the 7 `worktree-wf_*` branches are already in main (= origin/main). They are safe to delete now. `git worktree list` shows no extra worktrees.
- `wp/firm`, `wp/imports`, `wp/matching`, `wp/security`, `wp/settings`, `wp/shell`, `wp/workspace` exist only inside `transform-2026`. Delete them only after `transform-2026` is pushed or merged.

**Upgrade risks**
- Next.js/React: `a544529` works around a React bug (a dropped `pingSuspendedRoot`). After any upgrade, run the e2e suite with `E2E_NO_NAV_FALLBACK=1`. The caret in `^15.5.23` lets a fresh `npm install` pick a newer version; `npm ci` keeps the locked one.
- Next 16: check the custom webpack `extensionAlias` and the `serverActions` body-size limit. This is an inference; verify with the upgrade guide.
- Prisma 7: the config file, generator and seed location may change. This is an inference.
- `@huggingface/transformers` is pinned at 4.3.0. An upgrade could change the query vectors without the provider-name guard noticing. Re-embedding takes about 2.7 h.

---

## 7. Recommended next steps (in priority order)

1. **Back up the branch, then decide the merge.** Size: **S**.
   - *Why:* 23 commits exist only on this computer, with no backup. Main has none of the security and tenancy fixes.
   - *(a) Backup now, before you decide on the merge:* `git push -u origin transform-2026`. This is your call: the visibility of `github.com/akodev17/mxik-audit` was not checked, and sessions never push.
   - *(b) Wait* until the linked session has committed or stopped its work. Do not check out, build or test in this folder while it is working.
   - *(c) Check on a clean tree:* `npm run typecheck && npm run lint && npm test`, then `npm run build`, then the e2e suite (section 8).
   - *(d) Merge without a checkout:* `git fetch origin`, then `git fetch . transform-2026:main` (this only works as a fast-forward), then `git push origin main`.
   - *Deploy effects* (TRANSFORMATION_REPORT §6): 3 new migrations; existing logins are signed out; `/admin` stays closed until `platformAdmin` is set in SQL; `rawRetentionSince` is set at deploy time.
     - There is no production yet, so today these effects apply only to your local database. They would also apply to any server created before this merge.
     - Migration `20261021100000_replay_unique` deletes duplicate `tg_replay` rows from `auth_attempt` before it adds a unique index, so it does not only add things.
     - On a new server, set `platformAdmin` with the SQL in DEPLOY.md §7g. The address must also be in `ADMIN_EMAILS` and confirmed (`src/lib/admin.ts:18-19`).

2. **Owner decisions that block other work.** Size: **S** (decisions, not code).
   - Choose the landing. Your 16 Oct rollback request (`7d2d2ef`) undid the "v3" page from `a0f3022`. The spreadsheet page (`d6e3eed`), built on a separate line, was kept by merge `6c581af`. No record shows you choosing between the two.
   - Choose one payment story: bank transfer after the work (landing) or Click/Payme (app). Then make `src/lib/billing/plans.ts` the single source of prices, and set `PLAN_FIRM_PRICE`.
   - Set the plan and API limits (`src/lib/billing/limits.ts`, `.env.example`).
   - Decide whether to build with `NEXT_PUBLIC_FEATURE_MULTI_CLIENT=true` (a rebuild is needed), and fix the comment in `config.ts:60`.
   - Fix the wrong deletion claim on the landing (`data.ts:243-245`) so it matches `/maxfiylik`. Size S.

3. **Close the held-transition gap.** Size: **M**.
   - *Why:* report §4 lists it as a known gap in the production build. The linked session has now reproduced it and has an uncommitted fix (see section 6).
   - *Where:* `src/ui/shell/same-route-links.ts` (watchdog, `goTo`), `src/ui/shell/navigation.ts`, `src/ui/shell/route-boundary.tsx`, `src/ui/catalog-status-client.tsx:13`, the 35 `router.refresh()` calls, plus `src/ui/shell/response-nudge.ts` and `e2e/refresh.e2e.ts` from the linked session.
   - Review and commit that work first. Then rewrite DESIGN_SYSTEM rule 11.

4. **First staging deploy, with live tests of SMTP, Telegram and one payment provider.** Size: **M/L**.
   - *Why:* it is priority #1 in the report, and the app has never been deployed.
   - *Where:* `DEPLOY.md` §7a–7g and §9, `docker-compose.yml`.
   - Use **either** the §7 host crontab **or** the §9 containers, not both.
   - Set `CRON_SECRET` (16+ characters). Keep a secure copy of `SESSION_SECRET` outside the server.
   - Set up an automatic off-site copy of `./backups`, and test `pg_restore` once (DEPLOY.md §8 "Restoring a backup").
   - The one-off SQL in DEPLOY.md lines 234–240 is only for a database that already had members before transform-2026, for example if you promote your local database. A fresh server does not need it.

5. **Run the reranker with a real key.** Size: **M** (needs your key).
   - *Why:* open since `b4f3417`. The README calls it "the biggest remaining lever".
   - *How:*
     1. Set `ANTHROPIC_API_KEY`, and choose `ANTHROPIC_MODEL` on purpose. The default is `claude-opus-5-5`. `ANTHROPIC_EFFORT`, `ANTHROPIC_FALLBACKS` and `RERANK_PRICE_INPUT_PER_MTOK` / `RERANK_PRICE_OUTPUT_PER_MTOK` affect the cost and the cost figures.
     2. Run `npm run check:providers`.
     3. Run `npm run eval -- --label "with reranker"`. Tune `RERANK_GATE_*` and record the cost per 1,000 rows.
     4. Then run `npm run seed:demo`, `npm run demo:quality` and `npm run make:sample-report`.
     5. `MXIK_LLM_ENABLED=false` switches the reranker off.
   - *Where:* `src/core/match/rerank-config.ts`, `docs/scoring.md`.

6. **One real customer catalogue with an accountant watching; grow the golden set to 30+.** Size: **L** (needs you and a customer).
   - *Why:* the business case has been unproven since the first commit, and the go/no-go gate is still open. You owe the remaining 18 golden cases.
   - Then measure MISMATCH again on real data, and fit the weights from real decisions (`eval/golden.csv`, `/admin/metrics`).

7. **Settle the data state.** Size: **M**.
   - Decide e5 or hashing vectors for production. Run the eval with e5 on top of `a27c2e9`, and explain the drop in real top-5.
   - Order of steps: `npm run fetch:catalog` → `npm run ingest -- --enrich` → `npm run load:db` → `npm run embed:catalog` (if you use e5, about 2.7 h) → `npm run seed:demo` → `npm run demo:quality` → `npm run make:sample-report` → `npm test`.
   - Make the sample with the same vectors and reranker setting that production will use.
   - *Where:* `scripts/embed-catalog.ts`, `src/core/match/vector-readiness.ts`, `src/lib/sample-report.generated.ts`.

8. **Refresh stale docs.** Size: **S/M**.
   - Update `README.md`, `docs/SESSION_STATE.md` (fix the existing text, don't just add to the end; include decision #12), DEPLOY §6, DESIGN_SYSTEM rule 11 and its "Open" list, the `config.ts` comments, the schema and session header comments, and the authz-test comment.
   - *Why:* future sessions read these files first.

9. **Audit speed.** Size: **L**. Report priority #3: batch the per-row queries, then measure with a real embedder and the reranker. *Where:* `src/lib/audit-runner.ts`, `src/core/match/store.ts`, `scripts/perf-catalog.ts`.

10. **Store finding reasons as a code plus parameters.** Size: **M**. Report priority #4. This lets the API and exports translate them. *Where:* `src/core/audit/checks.ts`, `src/lib/api/serialize.ts`, the exports.

11. **Security follow-ups.** Size: **M**. CSP nonces and session IP (report #5). Move the API rate limit into the database, like the auth limits (`src/lib/api/limits.ts`). *Suggestion:* add a guard to `classifier:update` that refuses a load which would retire more than N codes, and run `npm run classifier:update -- --dry-run` before the first server run.

12. **Expert reviews.** Outside work.
    - Native Russian review (`i18n-ru.ts`, `i18n-app-ru.ts`, `src/content/yordam/ru`).
    - A lawyer fills the `<Todo>` blanks in `src/app/oferta` and `src/app/maxfiylik`.
    - A tax adviser checks art. 223 p.5 and the privilege wording.
    - Real sample files from 1C, MoySklad and Billz.

13. **Hygiene.** Size: **S** each.
    - Add `e2e/` to `tsconfig.json` and to the lint script.
    - Wire in the Next lint rules, or align `eslint-config-next`.
    - Add `healthcheck: { disable: true }` to the scheduler and telegram-bot services.
    - Delete the leftover branches (see section 6 for which ones are safe now) and the dead `src/ui` files.
    - Pick one Node version (22 matches Docker), and add `engines` and `.nvmrc`.
    - Fix the two leftover `toLocaleString` calls.
    - *Suggestion, not from the docs:* a small CI job that runs typecheck, lint and test.

---

## 8. Quick reference

**First time on a new machine** (details in README "Cold start")
1. `npm ci`
2. Copy `.env.example` to `.env`. Set `SESSION_SECRET` (`openssl rand -hex 32`) and point `DATABASE_URL` at `127.0.0.1:54329`.
3. `docker compose up -d`
4. `npx prisma migrate deploy`
5. Load the classifier: `fetch:catalog` → `ingest -- --enrich` → `load:db` → `embed:catalog`.
6. `npm run seed:demo`, then `npm run seed`.
7. `npx playwright install chromium` (needed only for e2e).

**Daily commands**
```bash
docker compose up -d                 # database only, on 127.0.0.1:54329
npx prisma migrate deploy            # only after pulling new migrations; never `prisma migrate dev`
npm run dev                          # http://localhost:3000
npm run typecheck && npm run lint && npm test
npm run build && npm run start       # never while `npm run dev` is running
```

**e2e tests** (they need a production build, and take 15+ minutes)
- Terminal 1: `npm run build; npm run start`
- Terminal 2 (PowerShell): `$env:E2E_NO_NAV_FALLBACK="1"; npm run test:e2e`. In Git Bash: `E2E_NO_NAV_FALLBACK=1 npm run test:e2e`.
- `E2E_BASE_URL` sets the server address. `E2E_SCALE_ROWS=300` shortens the 3,000-row scale test. `E2E_HEADED=1` shows the browser.
- The tests create and delete throwaway orgs in the `DATABASE_URL` database. Never point it at a real database.

**Other commands**
- **Seeds:** `npm run seed`, `npm run seed:demo`, `npm run seed:audit <id>`.
  - `npm run seed` creates the local sign-in user. Its default credentials are public in README / `prisma/seed.ts` (you can override them with `SEED_EMAIL`/`SEED_PASSWORD`). **Never run `npm run seed` on a server.** DEPLOY.md uses only `seed:demo`.
  - To open `/admin` locally, set `ADMIN_EMAILS` and the `platformAdmin` flag (DEPLOY.md §7g).
- **Quality:** `npm run eval`, `eval:synthetic`, `demo:quality`, `check:providers`, `perf`, `make:sample-report`.
- **Classifier:** after the first setup, `classifier:update` and `privileges:fetch`. If enrichment is blocked, run `ingest` without `--enrich`; the marking flag then stays unknown.
- **Ops:** `purge:expired`, `lead:delete`, `password:set`, `telegram:bot`, `telegram:webhook`.
- **Server:** `docker compose --profile app up -d`. Add `--profile bot` for long polling.
- **Windows tips:** use `127.0.0.1` (not `localhost`) in `DATABASE_URL`. `prisma generate` fails with EPERM while the dev server is running.

**Environment variables** (names only; see `.env.example` and `DEPLOY.md`)
- **Required:** `DATABASE_URL`, `SESSION_SECRET` (never rotate or lose it casually). On any server, also `CRON_SECRET` (16+ characters).
- **AI:** `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`, `ANTHROPIC_FALLBACKS`, `MXIK_ANTHROPIC_BASE_URL`, `MXIK_LLM_ENABLED`, `RERANK_GATE_CONFIDENCE`, `RERANK_GATE_MARGIN`, `RERANK_BATCH_SIZE`, `RERANK_BATCH_WAIT_MS`, `RERANK_TIMEOUT_MS`, `RERANK_MAX_RETRIES`, `RERANK_PRICE_INPUT_PER_MTOK`, `RERANK_PRICE_OUTPUT_PER_MTOK`
- **Embeddings:** `EMBEDDING_PROVIDER`, `LOCAL_EMBEDDING_MODEL`, `LOCAL_MODEL_DIR`, `LOCAL_EMBED_THREADS`, `LOCAL_EMBED_DEVICE`, `EMBED_BATCH`, `VOYAGE_API_KEY`, `OPENAI_API_KEY`
- **Mail:** `SMTP_URL`, `MAIL_FROM`, `APP_URL`
- **Telegram:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_API_ROOT`
- **Payments:** `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY`, `PAYME_MERCHANT_ID`, `PAYME_KEY`, `PAYME_TEST_MODE`, `PAYME_TEST_KEY`, `BILLING_REQUIRED_FOR_EXPORT`
- **Plans and API:** `PLAN_FIRM_PRICE`, `PLAN_TRIAL_*`, `PLAN_FIRM_*`, `API_RATE_PER_MINUTE`, `API_CHECKS_PER_MONTH_TRIAL`, `API_CHECKS_PER_MONTH_FIRM`, `API_CHECK_MAX_ITEMS`
- **Ops:** `ADMIN_EMAILS`, `POSTGRES_PASSWORD`, `LEAD_FILE_RETENTION_DAYS`, `ACCOUNT_DELETE_AFTER_DAYS`, `DEMO_TTL_HOURS`, `CLASSIFIER_UPDATE_LOG`, `INTERNAL_APP_URL` (used by the scheduler)
- **Seeds:** `SEED_EMAIL`, `SEED_PASSWORD`
- **Build-time:** `NEXT_PUBLIC_DEMO_URL`, `NEXT_PUBLIC_TELEGRAM_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SHOW_LEGAL_223`, `NEXT_PUBLIC_FEATURE_MULTI_CLIENT`
- **Tests and tools:** `E2E_BASE_URL`, `E2E_NO_NAV_FALLBACK`, `E2E_HEADED`, `E2E_SCALE_ROWS`, `E2E_AUDIT_TIMEOUT_MS`, `E2E_SCALE_AUDIT_TIMEOUT_MS`, `E2E_ARTIFACTS`, `CAPTURE_CHANNEL`, `CAPTURE_BASE_URL`
- **Never set:** `ANTHROPIC_BASE_URL`. The app ignores it, and agent tools use it.

**Outside services**
- Required: Postgres 16 + pgvector, and one-time access to huggingface.co (about 470 MB of e5 weights).
- `tasnif.soliq.uz` (the official export and per-code API) is needed by `fetch:catalog`, `ingest --enrich` and the weekly `classifier:update`.
- Optional: Anthropic, an SMTP server, Telegram BotFather (`/setdomain`) and telegram.org for the login widget (allowed in the CSP), Click, Payme.

**Key docs**
- `docs/TRANSFORMATION_REPORT.md`: the most current state, tests, known issues (§4) and priorities (§7). It currently has uncommitted edits from the linked session.
- `docs/PROJECT_OVERVIEW.md`: what the product does.
- `docs/SESSION_STATE.md`: the running log, decisions, evaluation gate and known problems (partly stale).
- `docs/scoring.md`: the matching formula and eval history. `docs/eval-results.json` and `docs/perf-results.json` hold the raw run data.
- `docs/DESIGN_SYSTEM.md`: UI rules and glossary.
- `DEPLOY.md`: VPS setup. §7a–7g cover integrations and security; §8 covers restoring a backup; §9 covers the compose jobs.
- `docs/gate0-report.md`, `docs/imtiyoz-data.md`, `docs/construction-codes.md`: facts about the data, and why some checks were not built.
- `README.md` (stale), `.env.example`, `integrations/google-sheets/README.md`.

---

## How this was checked

This briefing was built from the git history (129 commits, 20 Aug – 20 Oct 2026) and the repository docs. Independent reviewers then checked it against git and the code. The final pass re-checked these facts with read-only git commands:
- The commit counts per era.
- The 7 merge commits.
- Which branches are already merged.
- The 24/25 e2e test counts.
- The ancestry of the two landing lines.
- The rate-limit storage, MISMATCH numbers, eval classifier counts, default model, daily jobs and HEALTHCHECK setup.
- The current uncommitted work in the folder.

No tests, builds or database queries were run.

Claims that remain uncertain:
- Whether the owner ever saw or rejected the spreadsheet landing (nothing is recorded).
- Why `02201001001401003` is missing: an older classifier load is likely but not proven. Also whether the demo treats that code as NOT_FOUND.
- Whether the other checkout (`...\mxik-audit-\mxik-audit`) still exists somewhere with unpushed work.
- Whether the UzCombinator application was sent, and its deadline.
- Whether the Sheets add-on adds 4 columns on each re-run (read from the code, never run).
- The upgrade risks for Next 16 and Prisma 7 (inferences).
- The visibility of the GitHub repo (not checked).
- The S/M/L size scale (a suggestion for you to confirm).
- The linked session's fix: it is uncommitted and its results are only in uncommitted report edits.
