# Bug list, Agent 2 discovery, 23 Oct 2026

Found by walking the site in the in-app browser (web 3012, API 4012, branch `claude/agent2-bug-discovery-b07a47`
cut from `f11abc4`), by driving the API with the seed user, and by one full run of `npm test` and
`npm run test:e2e` (`E2E_BASE_URL=http://localhost:3012 E2E_CHANNEL=msedge`, against `next dev`).
Screenshots are in `docs/bugfix-2026-10-23/agent2/`.

Severity: **S1** crash or data loss, **S2** wrong behaviour, **S3** cosmetic or minor.
"Blocks e2e" marks a bug that keeps `npm run test:e2e` or `npm test` red, which the definition of done
in `docs/BUGFIX_PLAN_2026-10-23.md` §6 requires to be green.

Baseline numbers:

- `npm test`: 1647 tests, 1642 pass, 3 fail (all in `packages/domain/src/demo.test.ts`, B10), 2 skipped.
- `npm run test:e2e`: 56 tests, 38 pass, 9 fail, 9 skipped. Failures: review-flow 4–8 and scale 16 (B7),
  refresh 4 (B8), shell-layout 23 (B6), demo-access 4 (B9). Re-run alone, demo-access passes 5/5 and
  shell-layout 23 fails again.

No S1 was found. Areas walked with nothing wrong found: landing and its live demo grid, `/demo` request →
`/demo/verify/<token>` → private demo copy (upload blocked, settings reduced), sign-in, dashboard numbers
(cross-checked against the queue and the catalogue), catalogue workspace (row drawer, approve, reject,
undo, bulk reject, chips, density), every export (Excel, 1C Excel, 1C CSV, PDF internal and client,
findings CSV, diff CSV), report page, diff page, clients list and client page, check/sales imports and
purchases (upload, column choice, result page, templates), queue, activity, notifications, dictionary,
team, settings (account, security, plan, integrations incl. API key create → use → revoke, data incl.
the zip export), share link as a visitor (page, PDF, revoked link), public API v1 (`/check`, `/catalogs`,
report, 401/400/404 answers), Swagger `/api/docs`, `/api-docs`, `/yordam`, legal pages, invite/reset with a
bad token, 404 pages, dark mode, and 375 px width (no horizontal overflow on dashboard, catalogues,
workspace, report, client page, settings, team, upload, landing).

---

## S2: wrong behaviour

### B1. Workspace search depends on which apostrophe the user types, and multi-word queries miss

- **Where:** catalogue workspace search box (`/catalogs/<id>`, "Nom, kod yoki shtrix-kod").
- **Steps:** sign in as `buxgalter@demo.uz`, open `demo-katalog.xlsx`
  (`/catalogs/cmt1jk6jw0004vj646ukct7x7`), type in the search box, one at a time:
  `go'shti` (ASCII), `goʻshti` (U+02BB, the official Uzbek letter), `go‘shti` (U+2018), `sut nestle`.
- **Expected:** the three spellings of "goʻshti" find the same rows; `sut nestle` finds
  "Sut: Nestle, vakuumli qadoq …".
- **Actual:** 3, 2 and 0 results; `sut nestle` finds 0 (screenshot `agent2/b01-search-apostrophe.jpg`). The
  catalogue mixes `'`, `ʻ` and `’` in names, so whatever the user types misses part of the rows. The
  landing page sells exactly this problem of the tax portal's search.
- **Files:** `packages/domain/src/workspace.ts:93-98` (`ci."rawName" ILIKE '%q%'` on the raw query).
- **Proposed fix:** normalise both sides: fold the apostrophe family (`'`, `ʻ`, `ʼ`, `‘`, `’`, `` ` ``) to one
  character in the query and compare with `translate(ci."rawName", 'ʻʼ‘’`', '''''''')` (or a stored
  normalised column if one exists in `packages/core`'s text helpers); split the query on whitespace and
  require every token (`AND` of `ILIKE`s), so word order and punctuation between words do not matter.
  Regression test: domain test on the workspace filter with names containing each apostrophe and a
  two-word query.

### B2. Column guess maps the row-number column as the product name in Uzbek-Cyrillic files

- **Where:** upload wizard, step "Ustunlar".
- **Steps:** upload `tmp/found-catalogs/perechen.xlsx` (headers
  `Т/р | МХИК коди | МХИК номи (Лотин алифбосида) | МХИК номи (Ўзб) | МХИК номи (Рус)`), or call
  `POST /api/catalogs/preview` with it.
- **Expected:** "Tovar nomi" = one of the "МХИК номи …" columns.
- **Actual:** `mapping.name = 0`, the `Т/р` column (values 1, 2, 3 …), marked "taxmin". If the user
  accepts the guess every row is audited against its row number and comes back MISMATCH.
- **Files:** `packages/domain/src/mapping-guess.ts` (`HINTS.name`, `NAME_WORDS`, `IDENTIFIER_HEADER`).
- **Proposed fix:** add the Uzbek-Cyrillic name words (`номи`, `номланиши`, `маҳсулот`, `товар номи`,
  `маҳсулот номи`) to `NAME_WORDS`/`HINTS.name`; add `т/р`, `т р`, `п/п`, `№ п/п`, `t/r`, `tr` to
  `IDENTIFIER_HEADER`; when several "… номи" columns exist prefer the Latin one, then the first. Optionally,
  let the fallback skip a column whose sample values are all integers. Regression test in
  `packages/domain/src/mapping-guess.test.ts` with these exact headers.

### B3. Relative times show English/negative text in Uzbek ("-1 min", "-19 h", "yesterday", "now")

- **Where:** Team page "Oxirgi faollik" column; Settings → Xavfsizlik → "Faol seanslar" → "Oxirgi faollik".
- **Steps:** UI in Uzbek (default). Open `/dashboard`, then click "Jamoa" in the header (client-side
  navigation); or open Settings → Xavfsizlik.
- **Expected:** "1 daqiqa oldin", "19 soat oldin", "kecha", "hozir" (the server render does say
  "1 daqiqa oldin").
- **Actual:** "-1 min", "-19 h", "yesterday", "now" (screenshot `agent2/b03-team-minus-1-min.png`). Chromium
  and Edge ship no Uzbek relative-time data, so `Intl.RelativeTimeFormat('uz')` falls back to the root
  locale. Russian is fine.
- **Files:** `apps/web/src/app/(app)/settings/session-rows.ts` (`agoLabel`), used by
  `settings/session-list.tsx:67` and `team/team-members.tsx:29`.
- **Proposed fix:** do not use `Intl.RelativeTimeFormat` for `uz`; build the words from the dictionaries
  (`apps/web/src/lib/pure/relative-day.ts` already has `agoText` with `AgoWords`), e.g. add minute/hour
  words to `packages/i18n` and format "N daqiqa oldin" / "N soat oldin" / "kecha" / "hozir"; keep
  `Intl` for `ru` or use the same table for both. Regression test: extend
  `settings/session-rows.test.ts` to assert the Uzbek strings and that no output starts with "-".

### B4. Catalogue list: header client switcher names a client the list is not filtered by

- **Where:** `/catalogs` right after signing in (session with no active client chosen yet).
- **Steps:** sign in fresh as `buxgalter@demo.uz` (org with two clients, Demo Savdo is the default), open
  "Kataloglar".
- **Expected:** switcher and list agree: either both "Barcha mijozlar" or both "Demo Savdo MChJ".
- **Actual:** header switcher shows "Demo Savdo MChJ" (checked in its menu) while the "Mijoz" filter
  says "Barcha mijozlar" and Baraka's catalogues are listed (screenshot
  `agent2/b04-catalogs-switcher-vs-filter.jpg`). After visiting any client page (which sets the session's
  active client) the two agree.
- **Files:** `apps/web/src/app/(app)/catalogs/page.tsx` (`requested` uses `user.clientId`, null for a fresh
  session); `packages/domain/src/shell-frame.ts` (`activeFor` falls back to the default/first visible
  client); `apps/web/src/ui/shell/nav.ts` `switcherScope` (`/catalogs` → `{ kind: 'active' }`).
- **Proposed fix:** one source of truth. Either make `switcherScope('/catalogs', '')` return `all` when the
  page shows all (pass the effective scope down), or make the page use the same fallback as the shell
  (`shell.activeClient`) when `sp.client` is absent. Regression test: unit test of the page's scope
  decision, or an e2e that signs in and compares the switcher label with the filter's selected option.

### B5. CSV exports write 17-digit MXIK codes and barcodes as bare numbers; Excel rounds them

- **Where:** report page "Topilmalar (CSV)" (`/api/catalog-report-csv`), diff page "CSV yuklab olish"
  (`/api/catalog-diff`), export menu "1C (CSV)" (`/api/export?format=1c`).
- **Steps:** export the findings CSV of `demo-katalog.xlsx` and open it in Excel.
- **Expected:** `00204004001000000` stays as is.
- **Actual:** the file holds `…,00204004001000000,…` unquoted; Excel reads it as the number
  2.04004E+14 (leading zeros gone, and any code over 15 significant digits rounded). Saving the file back
  corrupts every code and barcode.
- **Files:** `packages/domain/src/report-csv.ts`, `packages/domain/src/diff-csv.ts`,
  `packages/domain/src/export-1c.ts` (`build1cCsv`).
- **Proposed fix:** for the two human-facing CSVs write code and barcode cells as `="00204004001000000"`
  (Excel text formula, read as text by LibreOffice too); keep the 1C CSV plain if 1C's importer needs it, but say in the menu hint that it is meant for 1C, not
  Excel (or check what the 1C importer accepts and apply the same rule). Regression test: unit tests that
  the CSV cell for a code starting with 0 is emitted in text form.

---

## S3: minor, cosmetic, test robustness

### B6. Collapsing the sidebar is forgotten if the page is reloaded right away (blocks e2e)

- **Steps:** at ≥1280 px click "Yon panelni yigʻish", then reload within a moment (or navigate by URL).
  `apps/web/e2e/shell-layout.e2e.ts` test 23 does exactly this and fails every run (screenshot
  `agent2/b06-e2e-rail-not-collapsed-after-reload.png`: sidebar expanded after the reload).
- **Cause:** `toggleRail` in `apps/web/src/ui/shell/app-frame.tsx:53-58` changes local state and fires
  `api.account.setSidebar` without waiting; the `mxik_sidebar` cookie only exists once that response
  arrives, and a navigation cancels the request. The API sets the cookie correctly when it completes.
- **Second cause, in the test (from Agent 5's baseline note):** `shell-layout.e2e.ts:105` queries
  `[data-rail="collapsed"] nav[aria-label]`, which since U2 first matches the header's TopNav (it got an
  `aria-label`), so the width check could not pass even with the cookie set. Scope the selector to the
  sidebar's own nav (e.g. by its label or a `data-` hook).
- **Proposed fix:** also write `mxik_sidebar` from the browser immediately (`document.cookie`, same name,
  `Path=/; Max-Age=31536000; SameSite=Lax`, it is not HttpOnly) and keep the PUT. Same pattern for the
  theme toggle if it has the same shape. Fix the test selector. Make test 23 pass; add a unit test for
  the cookie writer.

### B7. e2e: the confirm step's heading locator is ambiguous, 6 upload tests fail (blocks e2e)

- **Steps:** `npm run test:e2e`. `review-flow.e2e.ts:257` and `scale.e2e.ts:78` wait for
  `getByRole('heading', { name: 'Nima boʻladi' })`, which since the UI refresh matches both
  "Nima boʻladi" (h2) and "Keyin nima boʻladi" (h3): Playwright strict-mode error. review-flow 5–8 then
  fail in cascade (step 5 waits 15 min for "Tahlil tugadi"); scale 16's two follow-ups are skipped.
  The upload flow itself works (verified by hand with a CP1251 CSV through all six steps).
- **Proposed fix:** `{ exact: true }` on that locator in both files (or locate `#confirm-title`). Then
  run review-flow and scale to the end; they have never passed since U1–U5 and may reveal more.

### B8. e2e refresh test 4 cannot pass against `next dev` (blocks e2e in dev)

- `apps/web/e2e/refresh.e2e.ts:84-89` waits for the RSC prefetch that `intent-prefetch.ts` triggers on
  hover, but Next.js skips `router.prefetch` in development, so against `next dev` no request comes
  (screenshot `agent2/b08-e2e-refresh-prefetch.png`). The handoff's 56/56 run was against production
  images.
- **Proposed fix:** skip that test when the server is a dev server (e.g. an `E2E_DEV=1` flag set by the
  runner, or detect the dev overlay script) with a message; or document that e2e runs against
  `next build && next start`. Do not weaken the assertion for production.

### B9. e2e demo-access "ends a demo after 30 idle minutes" is flaky under load

- Failed once in the full run (after clicking "Demoni ochish" the page landed on `/sign-in` instead of
  `/catalogs`, screenshot `agent2/b09-e2e-demo-idle-signin.png`), passed 5/5 when the file ran alone. Not
  reproduced by hand (the same flow on `[::1]:3012` opened the demo).
- **Proposed fix:** investigate with tracing on: likely the demo session's `lastSeenAt` update from the
  previous test or a slow first compile; at minimum wait for the open-demo response before asserting
  the URL. Low priority once B7/B8 are fixed.

### B10. `demo.test.ts` counts a global table on a shared database (blocks `npm test`)

- `packages/domain/src/demo.test.ts:33-39` asserts `db.demoVisit.count()` grew by exactly 2; any other
  process creating a demo visit at the same time (another agent's tests, an e2e run) makes it 431 ≠ 430.
  Because `sessions.push(one, two)` comes after that assertion, tests 2 and 3 fail too ("sessions.push"
  falsy). 3 of the 5 `npm test` failures.
- **Proposed fix:** push the sessions before asserting; count only visits linked to the two new sessions
  (filter by their org ids or by `createdAt >= start` plus the returned ids) instead of the global count.

### B11. A damaged or fake `.xlsx` is reported as "no data rows found"

- **Steps:** upload a text file renamed to `fake.xlsx`.
- **Actual:** "Faylda maʼlumot qatorlari topilmadi." **Expected:** "The file is not a valid Excel workbook
  (damaged or another format)". Empty files and PDFs already get precise messages.
- **Files:** the preview parser behind `POST /api/catalogs/preview` (`packages/domain/src/spreadsheet.ts`).
- **Proposed fix:** check the zip signature (`PK\x03\x04`) for `.xlsx` before parsing and return a
  dedicated message in both languages; unit test with a non-zip `.xlsx` buffer.

### B12. Unconfirmed uploads (drafts) leak into the public API list and the account export

- **Steps:** upload a file and stop at the column step; then `GET /api/v1/catalogs` with an API key, or
  Settings → Maʼlumotlar → "Arxivni yuklab olish".
- **Actual:** the draft is listed with `status: "uploaded"` in the API and as `catalogs/00N-<name>.xlsx`
  in the zip, though the web list keeps drafts apart and they are deleted after 48 h.
- **Files:** `packages/domain/src/api/handlers.ts:68-80` (`listCatalogsOperation`),
  `packages/domain/src/security/export.ts:52`.
- **Proposed fix:** exclude `status: 'uploaded'` in both (or add a `drafts` flag to the API); tests for
  both queries.

### B13. Notifications are stored as rendered Uzbek text, so Russian users read Uzbek

- **Steps:** finish an audit, switch the interface to Русский, open `/notifications`.
- **Actual:** "Tekshiruv tugadi: …" / "Katalog tekshirildi, natijalarni koʻrib chiqishingiz mumkin …".
- **Files:** `packages/domain/src/notifications.ts` (stores `title`/`body` strings).
- **Proposed fix:** store a kind + parameters and render in the reader's locale (keep the stored text as
  fallback for old rows), or store both languages. Same family as the known `Finding.reason` issue.

### B14. Record-level 404s answer HTTP 200, and `/admin` keeps its title for non-admins

- `/clients/<unknown>`, `/catalogs/<unknown>` and `/admin` (non-admin) show the 404 page but with status
  200; the `/admin` tab title stays "Koʻrsatkichlar — Tasnivo".
- **Cause:** `notFound()` is thrown after the `(app)` loading boundary has streamed; `generateMetadata` runs
  before the access check.
- **Proposed fix:** check access in `generateMetadata` (return the not-found title) and, where cheap, call
  `notFound()` before any Suspense boundary; otherwise accept the 200 (these pages are not indexed).

### B15. Landing, `/maxfiylik` and `/oferta` are Uzbek only and ignore the `ru` locale

- With `mxik_locale=ru` the app and auth pages are Russian, these three are not, and they have no
  language switcher. Text is hard-coded in `apps/web/src/components/landing/*` and `app/page.tsx`.
- **Proposed fix:** product decision; at minimum add the uz/ru switcher the auth pages have and a Russian
  version of the legal pages. Can be deferred.

### B16. No `robots.txt`

- `GET /robots.txt` → 404 while `/sitemap.xml` exists. **Fix:** add `apps/web/src/app/robots.ts` allowing
  the public pages, disallowing the app routes (`/dashboard`, `/catalogs`, `/clients`, `/settings`, `/r/`,
  `/invite/`, `/reset/`, `/demo/verify/`) and pointing at the sitemap.

### B17. Diff page: the "Qaysi katalog bilan" select is too narrow

- `/catalogs/<id>/diff` for a catalogue without a linked previous version: the select shows "baraka-sotu"
  of "baraka-sotuv.csv · 16.10.2026" (screenshot `agent2/b17-diff-select-truncated.jpg`).
- **Fix:** give the select a min width (e.g. `min-w-64`) or full width on that empty state.

### B18. Workspace "N muammo" count and the chips do not change after a single decision

- **Steps:** with "Koʻrib chiqilmagan" selected, approve one row in the drawer.
- **Actual:** progress goes 3/86 → 4/86 but the toolbar still says "83 muammo" and "Hammasi 83" until
  something triggers a recount; a bulk action updates them at once.
- **Files:** `apps/web/src/app/(app)/catalogs/[id]/workspace.tsx` (`recount` is only passed for bulk) and
  `use-decisions.ts`.
- **Fix:** adjust the counts locally like `delta`, or invalidate `keys.counts` (debounced) after single
  decisions and undos.

### B19. Activity journal records "Katalog yuklandi" for uploads that were never confirmed

- Every preview writes "Katalog yuklandi", followed by "Tasdiqlanmagan yuklash bekor qilindi" when the
  draft is replaced, so the dashboard's "Soʻnggi harakatlar" fills with uploads that never became
  catalogues. "Qaror bekor qilindi" entries also omit the product name that "Taklif rad etildi" shows.
- **Fix:** log the upload at commit (or name the preview event "Fayl oʻqildi"); include the row name in
  undo events.

### B20. Drop zone lists `.xls` as accepted

- The chips under the drop zone say `.xlsx .xls .csv`; an `.xls` is then refused with "save it as .xlsx".
  The message is good; the chip promises too much. **Fix:** drop `.xls` from the chips (keep it in `accept`
  so the helpful message is still reached).

### B21. Sessions list has no limit

- Settings → Xavfsizlik lists every live session (50+ rows for the seed user). **Fix:** show the latest
  10 with "show all", or group by device.

---

## Could not reproduce / not tested

- A stale grid row after undoing a bulk rejection row by row (seen once: the second row kept "Rad etildi"
  although its undo returned `ok`); five deliberate attempts did not reproduce it.
- Two-factor enable/disable in the browser was not run on the shared seed user (it would lock other
  sessions out mid-run); API coverage exists in `apps/api/test/e2e/security.test.ts`.
- Telegram (no bot configured), Click/Payme payments, mail delivery (no SMTP), the worker/BullMQ mode,
  and the print preview of the report were not exercised.
- e2e ran against `next dev` only (see B8).

## Handed to other agents

Also written to `docs/bugfix-2026-10-23/handoff-agent2.md`.

- **Agent 3 (quota):** deleting a catalogue gives its rows back to the monthly allowance. Reproduced: plan
  tab showed "Qatorlar (shu oy) 12 / 5 000" after a 1-row upload; after `DELETE /api/catalogs/<id>` it
  shows "11 / 5 000". Root cause as in the plan §2 (`usageOf` sums live `rowCount`).
- **Agent 1 (auth):** known from the plan §2 and not re-tested here: without `SMTP_URL`/`MAIL_FROM` a
  password sign-up is signed in at once and verified; no Google sign-in; the Telegram button is hidden
  without a bot. The sign-in page itself works (wrong password message, redirect to dashboard).
- **Agent 4 (cross-cutting):** `/api/docs` (Swagger) is public and documents all 165 first-party
  operations, including admin and cron. Decide whether production should serve it only to admins or only
  the public v1 spec (`/api/v1/openapi.json` + `/api-docs` already cover external developers).
