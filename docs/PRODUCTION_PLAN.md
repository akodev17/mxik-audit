# Production plan: the five things that block a real pilot

Written 2026-10-21 after the first audit of real-world files (see
`tmp/found-catalogs/`, not committed) in a fresh local account. Each item is
self-contained so it can be handed to a separate agent. Items 1–3 are code
and can run in parallel in their own worktrees. Items 4–5 are operations on
the owner's machine and server.

What the real-data test showed, in one paragraph: 423 rows carrying the
construction codes that are restricted in EHF from 1 July 2026 came back as
"no risk" (there is no restricted-code check); 168 metal price-list rows
without codes all got low-band suggestions in degraded mode (no semantic
vectors, no reranker), including "Труба ГД б/ш 32х3,0" → Portland cement
because "б/ш" transliterates to "sh" and matched the cement grade "B-Sh", and
"Трубы эл/св …" → carbonated water; the upload page showed "Tahlil navbatda…"
while the database said analyzing 141/168; the import diagnostic called 115
rows duplicates because the normalizer drops sizes; the local classifier is
the 20.08.2026 version (438,925 codes) while the landing sample was generated
from the 15.10.2026 export (442,719), which is why `sample-report.test.ts`
fails locally on one code (`01512001001103020`).

---

## 1. Matching quality on real catalogues (code, worktree)

**Problem.** Stage 3 (trigram + full-text) lets two-letter fragments decide a
match, metal/construction abbreviations are not expanded, and the duplicate
diagnostic ignores sizes.

**Scope.**
- Abbreviation dictionary applied in `src/core/normalize` before matching, both
  scripts: `б/ш` → бесшовная, `г/к` → горячекатаный, `х/к` → холоднокатаный,
  `эл/св` → электросварная, `ВГП` → водогазопроводная, `ГД`/`ХД`
  (горячедеформированная/холоднодеформированная), `проф.` → профильная,
  `арм.` → арматура, `ж/б`, `н/ж`, `оцинк.`, plus the Uzbek Latin equivalents.
  Keep it a data file with tests, not inline code.
- In `src/core/match/store.ts` / `score.ts`: a matched word shorter than 3
  letters, or one that is only a transliteration fragment, must not count as
  evidence on its own (`matchedWords: ["sh"]` was the whole case for cement).
- Import diagnostic (`src/lib/catalog-import.ts`, duplicate detection): compare
  on a key that keeps dimensions and grades; "Труба ВГП 15х2,5" and
  "Труба ВГП 20х2,5" are different rows.
- Add the two real files as a named eval case (`eval/`), with hand-checked
  expected groups for at least 40 rows (pipes → 0730/7306 steel pipes, hot-rolled
  sheet → 0720x flat products, rebar → 0721x), and record top-1/top-5 before and
  after in `docs/eval-results.json`.

**Done when.** The metal file audited in degraded mode produces no suggestion
outside the ferrous-metal groups for pipe/sheet/rebar rows; the duplicate
warning for that file is 0; `npm run typecheck && npm run lint && npm test`
pass; eval numbers recorded.

## 2. Restricted construction codes from 1 July 2026 (code, worktree)

**Problem.** The strongest sales argument for construction sellers is missing:
the app cannot say "this code will be refused in EHF from 1 July".

**Scope.**
- New table `restricted_code` (code, effectiveFrom, reason, source, importedAt)
  via a Prisma migration (`migrate deploy` style, see README). Loader script
  `npm run load:restricted -- <xlsx>` that reads the official list format
  (columns: №, МХИК коди, name Latin, name Cyrillic, name Russian; header on
  row 4, data from row 5). The current list (423 codes) came from
  legalise.uz `perechen.xlsx`; the official origin is tasnif.soliq.uz news 5063,
  and a second stage of ~200 more codes was announced. Keep the source URL in
  the table.
- New finding type `RESTRICTED` in `src/core/audit/checks.ts` with severity
  high when `effectiveFrom <= today + 90 days`, reason text in uz and ru
  (`src/lib/i18n-parts`), shown in the workspace filters, the report summary,
  the PDF, and the xlsx/1C exports as its own column.
- Suggest the detailed replacement when the classifier has children of the
  same 8-digit position (the new detailed codes with fixed units); otherwise
  say "request a detailed code on mkinfo.uz".
- Landing/help article: one paragraph on the 1 July rule, no legal claims
  beyond what the official news item says.

**Done when.** Uploading `stroy-materials-423.xlsx` (same shape as the official
list) yields 423 RESTRICTED findings; existing checks unchanged; tests for the
loader, the check and the i18n keys; typecheck, lint, tests pass.

## 3. Classifier freshness (code, worktree; then run once here)

**Problem.** The classifier changes often and the local copy is two months
old. An old copy makes the audit confirm retired codes.

**Scope.**
- `scripts/update-classifier.ts` (`npm run classifier:update`) already exists:
  wire it into the daily job with a lock, write every added/retired/renamed
  code into `classifier_change`, and run `src/lib/classifier-recheck.ts` on
  every ready catalogue afterwards so clients get a notification "N of your
  codes changed".
- Report and workspace banner when the classifier version is older than 7
  days or an update failed; the version date is already shown.
- `/api/health` reports classifier version date and age.
- Make `sample-report.test.ts` state which classifier version it expects, and
  skip with a clear reason when the local copy is older, instead of failing.

**Done when.** Running the update on the 20.08 copy brings it to the current
portal export, the diff is in `classifier_change`, the sample test passes,
and the banner shows on a stale copy.

## 4. Semantic matching switched on (operations, this machine, then server)

**Problem.** `embedding_state.provider` is "hashing (local, non-semantic)";
`npm run embed:catalog` (local multilingual-e5, ~2.7 h on 4 threads) has
never run; `.env` has no Anthropic or Voyage key, only an OpenAI key that the
pipeline refuses to use against hashing vectors.

**Steps.**
1. Refresh the classifier first (item 3's script or `fetch:catalog` →
   `ingest -- --enrich` → `load:db`), so vectors are built for the current codes.
2. `npm run embed:catalog` overnight; it is resumable.
3. Re-audit `tmp/found-catalogs/uzmetallsavdo-168.xlsx` and compare the
   suggestion distribution with the degraded run (49 profile pipe / 38 perforated
   sheet / 28 brass sheet / 22 cement / 19 carbonated water, all low band).
4. Decide the reranker: set `ANTHROPIC_API_KEY`, run the same file, record
   cost per row from `rerank-usage`. The reranker has never run with a real key.
5. For the server: ship the vectors as a Postgres dump instead of recomputing
   2.7 h on the VPS; document in DEPLOY.md.

**Done when.** `pipelineMeta.degradedReasons` is empty for a fresh audit and
the metal file's high-band share is recorded.

## 5. Deploy and the first three pilots (operations, with the owner)

**Problem.** The app has never been deployed and no real customer catalogue
has been audited.

**Steps.**
1. One VPS, `DEPLOY.md` as written (Docker app profile, nginx, HTTPS, ufw),
   domain, `NEXT_PUBLIC_SITE_URL`, `SESSION_SECRET`, SMTP for sign-up
   confirmation and password reset, Telegram bot token if reminders are used.
2. Nightly `pg_dump` to off-server storage; test a restore once.
3. Fix the small blockers found in the browser test: "Tahlil navbatda…" shown
   while the audit is running (upload progress polling,
   `src/lib/i18n-parts/imports.ts` `waiting`), and `npm run inspect:xlsx`
   overwriting `docs/gate0-xlsx-report.json`.
4. Update `README.md` and `docs/SESSION_STATE.md`: main now equals
   transform-2026, pushed 2026-10-21.
5. Pilots: three accounting firms or construction-materials sellers, free
   audit of their real 1C export, corrected file back, one question at the end:
   "will you pay for the next run?" Construction sellers first; the 1 July rule
   gives them a date.

**Done when.** `/api/health` is green on the domain, a sign-up e-mail arrives,
one real customer file has been audited end to end, and the three answers are
written down.
