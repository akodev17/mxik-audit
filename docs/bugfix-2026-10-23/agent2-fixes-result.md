# Agent 2 fix session: result, 23 Oct 2026

Branch `agent2-bug-fixes` (worktree `practical-meninsky-adcf4f`), cut from `f11abc4` and fast-forwarded to the
discovery branch `claude/agent2-bug-discovery-b07a47` (`915007a`, bug list at `67214b3`). Not pushed.
API on 4016, web (`next dev`) on 3016, shared dev Postgres `127.0.0.1:54329`. Screenshots and notes are in
`docs/bugfix-2026-10-23/agent2-fixes/`.

**Outcome: 19 of 21 bugs fixed (all 5 S2, 14 of 16 S3), 2 not fixed (B9 not reproduced, B15 deferred).**
Every fix has a regression test that names the bug id.

## Per bug

| Bug | Sev | Status | Regression test | How verified |
|---|---|---|---|---|
| B1 search: apostrophes, multi-word | S2 | fixed | `workspace-review.test.ts` "B1: search folds the apostrophe family and needs every word, in any order" | Browser: `go'shti`, `goʻshti`, `go‘shti` all 13; `sut nestle` 5 rows incl. names with `´` and `’` (`b01-*.jpg`) |
| B2 column guess: `Т/р` taken as name | S2 | fixed | `mapping-guess.test.ts` "B2: reads an Uzbek-Cyrillic list …" | Real `tmp/found-catalogs/perechen.xlsx` through the wizard: name = "МХИК номи (Лотин алифбосида)", MXIK = "МХИК коди" (`b02-perechen-name-column.png`); draft discarded |
| B3 relative times "-1 min" in Uzbek | S2 | fixed | `session-rows.test.ts` "B3: Uzbek never goes through Intl …" | Browser: team page after client navigation "1 daqiqa oldin"; sessions "3 daqiqa oldin", "19 soat oldin" (`b03-*.jpg`) |
| B4 catalogue list vs header switcher | S2 | fixed | `catalog-pages.test.ts` "B4: with no client asked for, the list is narrowed to the header switcher's active client" | Fresh Playwright session as the seed user: switcher and filter both "Demo Savdo MChJ", only its catalogues (`b04-*.png`) |
| B5 CSV codes read as numbers by Excel | S2 | fixed | `diff-csv.test.ts` and `report-summary.test.ts` "B5: …" | Browser: findings CSV of demo-katalog writes `"=""00204004001000000"""` (`b05-findings-csv-head.txt`) |
| B6 sidebar collapse lost on quick reload | S3 | fixed | `nav.test.ts` "B6: writes the sidebar cookie …"; e2e `shell-layout` 23 (selector fixed) | Browser: collapse then immediate reload → `data-rail="collapsed"`, 64 px (`b06-*.jpg`); cookie reset afterwards. e2e shell-layout 4/4 |
| B7 e2e confirm heading ambiguous | S3 | fixed | the e2e itself: `review-flow.e2e.ts` (2 places) and `scale.e2e.ts`, commented "B7" | Full e2e run (below) |
| B8 e2e refresh 4 can't pass on `next dev` | S3 | fixed | `refresh.e2e.ts` test 4 skips on a dev server (`isDevServer` in `fixture.ts`) | e2e refresh: test 4 SKIP with the reason on `next dev`; unchanged for `next start` |
| B9 e2e demo-access flaky under load | S3 | **not reproduced** | none | See "Not done" |
| B10 `demo.test.ts` global count | S3 | fixed | `demo.test.ts` (counts visits since the test began, keeps sessions first) | `npm test` |
| B11 fake `.xlsx` → "no data rows" | S3 | fixed | `spreadsheet.test.ts` "B11: a text file renamed to .xlsx …" | Browser upload of a text file named `fake.xlsx` (`b11-*.png`) |
| B12 drafts in public API and export | S3 | fixed | `public-api.test.ts` (draft in the fixture, list must not show it); `security/export.test.ts` "B12: …" | API e2e test against the Nest app; no browser step (needs an API key on the seed org) |
| B13 notifications stored in Uzbek | S3 | fixed | `notification-locale.test.ts` "B13: …" (2 tests) | Browser with `mxik_locale=ru`: a new notice reads "Проверка готова: Demo Savdo MChJ", an older one keeps its stored Uzbek (`b13-*.jpg`); test notice deleted, cookie back to `uz` |
| B14 404 status/title | S3 | fixed (title); 200 status accepted | e2e `navigation.e2e.ts` "B14 /admin and /admin/metrics …" | Browser: `/admin` tab title "Sahifa topilmadi — Tasnivo" (`b14-b18-browser-checks.txt`) |
| B15 landing/legal Uzbek only | S3 | **deferred** | none | See "Not done" |
| B16 no robots.txt | S3 | fixed | `robots.test.ts` "B16: …" (2 tests, one checks every `(app)` section is disallowed) | `GET /robots.txt` 200 (`b16-robots.txt`) |
| B17 diff select too narrow | S3 | fixed | e2e `navigation.e2e.ts` "B17 …" (fails at 119 px before the fix) | Browser: 288 px, "k.csv · 20.08.2026" in full (`b17-*.jpg`) |
| B18 count/chips stale after one decision | S3 | fixed | e2e `navigation.e2e.ts` "B18 …" (fails before the fix) | Browser: 83 → 82 after one rejection, 83 after undo (`b14-b18-browser-checks.txt`) |
| B19 journal: unconfirmed uploads, undo without product | S3 | fixed | `activity.test.ts` "B19: …" | Browser: journal "Fayl oʻqildi (tasdiqlanmagan)"; dashboard "Soʻnggi harakatlar" without it (`b19-*.jpg`) |
| B20 drop zone lists `.xls` | S3 | fixed | `upload-extensions.test.ts` "B20: …" | Browser: chips `.xlsx` `.csv` `20 MB gacha` (`b20-*.jpg`) |
| B21 sessions list unlimited | S3 | fixed | `session-rows.test.ts` "B21: …" | Browser: 10 rows and "Hammasini koʻrsatish (50)" (`b03-b21-*.jpg`) |

## What changed, briefly

- **B1** `packages/domain/src/workspace.ts`: the name is compared through `translate()` folding `ʻ ʼ ‘ ’ \` ´` to `'`;
  the query is folded the same way and split into words, each `ILIKE`d (AND). Digits still search codes and barcodes.
- **B2** `mapping-guess.ts`: Uzbek-Cyrillic name words (`номи`, `номланиши`, `маҳсулот номи` …), a half-point
  preference for a header naming the Latin script, and `Т/р`, `П/п`, `t/r`, `tr` as identifier (row number) headers.
- **B3** `settings/session-rows.ts`: Uzbek words spelled out (`N daqiqa/soat/kun oldin`, `kecha`, `hozir`); Russian keeps `Intl`.
- **B4** `catalogListPage` falls back to `resolveVisibleClient` (the shell's rule) and returns `clientId`; the page uses it.
  Contract `catalogs.list` gained `clientId` (nullable, defaults to null so an older answer still parses).
- **B5** `accuracy.ts` `csvCodeCell`: all-digit codes as `="…"` in the findings CSV and the diff CSV. The 1C CSV stays plain
  (its menu already says "1C importi uchun CSV (Excelda ochmang)").
- **B6** `ui/shell/prefs.ts` `sidebarCookie` + `app-frame.tsx` writes `mxik_sidebar` in the browser before the PUT.
  Touches `apps/web/src/ui/shell/*` (Agent 4's primitives) with a two-line bug fix only, no refactor.
- **B11** `spreadsheet.ts`: new `ParseError('not_xlsx')` (uz/ru message) when a non-zip file named `.xlsx` has no rows and
  fewer than two columns as text; a real CSV renamed to `.xlsx` is still read, a header-only one is still "no rows".
- **B12** `api/handlers.ts` (`listCatalogsOperation`) and `security/export.ts` skip `status: 'uploaded'`.
- **B13** new nullable `notification.text` (JSONB, migration `20261027130000_notification_text`, additive, applied to
  the shared DB). Every `notify()` caller (audit ready, classifier update, review assigned/completed, monthly
  reminder) stores both languages via `inEveryLocale`; the list and bell read `text[reader's locale]`, falling back to
  `title`/`body` (older rows, Telegram).
- **B14** `admin/allowed.ts`: a request-cached traction read decides the title of `/admin` and `/admin/metrics`.
  The HTTP status stays 200 (the `(app)` segment streams behind `loading.tsx`; documented in review-flow 13b).
- **B16** `apps/web/src/app/robots.ts`.
- **B17** diff page select `sm:min-w-72`, form `max-w-2xl`.
- **B18** `workspace.tsx`/`use-decisions.ts`: a single decision or undo invalidates the counts query, debounced 600 ms.
- **B19** `activity.ts`: an upload whose catalogue is a draft or was discarded is shown as `catalog.previewed`
  ("Fayl oʻqildi (tasdiqlanmagan)"); the dashboard and client page (`committedOnly`) leave it and the discard out; a
  one-row undo takes its product from `payload.findings[0].productName`. The stored events are unchanged
  (`catalog.uploaded` still names the uploader for the list and for discarding one's own previews).
- **B20** `READ_EXTENSIONS` (`.xlsx`, `.csv`) for the chips; `.xls` stays in `accept`.
- **B21** `shownSessions`: this device plus the 9 latest, "Hammasini koʻrsatish (N)" / "Kamroq koʻrsatish".

## Checks

All from the worktree root, 23 Oct 2026, against the shared dev DB.

- `npm run typecheck`: green (exit 0).
- `npm run lint`: green, 0 errors, 1 warning that predates this branch (`scripts/lib/xlsx.ts:131` non-null assertion).
- `npm test` (with `REDIS_URL=redis://127.0.0.1:63799`): **1672 tests, 1670 pass, 0 fail, 2 skipped** (baseline
  1647 / 1642 / 3 fail / 2 skipped; the 3 `demo.test.ts` failures are B10).
- `E2E_BASE_URL=http://localhost:3016 E2E_CHANNEL=msedge npm run test:e2e` against `next dev`, one full run:
  **59 tests, 55 pass, 3 fail, 1 skipped** (baseline 56 / 38 / 9 fail / 9 skipped).
  - **review-flow 17/17 and scale 3/3 pass end to end** for the first time since the UI refresh (B7); nothing new
    surfaced in them. shell-layout 4/4 (B6), demo-access 5/5 (B9 did not show up), refresh test 4 skipped on
    `next dev` with its reason (B8).
  - refresh 1–2 ("router.refresh() … commits without any other update") failed in the full run and **pass when the
    file is run alone** (3 pass, 1 skip; measured 155–250 ms against the 2 000 ms limit when warm). This is Agent 5's
    F3: dev-server timing (first compile / load from the other files), passes on a production build. Not changed.
  - navigation 21 ("a page slow to appear opens from one click") failed because my B17 test left a second catalogue
    in the fixture's client B; B17 now deletes it (`navigation` re-run alone: **8/8 pass**). Why an extra ready,
    empty catalogue makes the queue tab render once per click was not investigated.
- No full e2e re-run after that last test fix; `navigation` and `refresh` were re-run alone as above.
- Not run: `npm run build`, `build:api`, `build:worker` (not asked of this session; `next build` would share
  `apps/web/.next` with the running dev server).

## Not done

- **B9** (demo-access "ends a demo after 30 idle minutes" flaky): not reproduced. Read the open path end to end
  (`openDemoLink` → `claimDemoAccess` → `startDemoSession` → `enterDemo`, `session-store.isLive`): a failed claim keeps
  the browser on the link page with an error, so a landing on `/sign-in` means the new session was refused right after
  it was set, and nothing in that path explains it. One shared-database hazard found on the way, not proven to be
  the cause: `startDemoSession` copies the newest `demo_template` org in the whole database, so `demo.test.ts` runs of
  other sessions (which create and drop their own template) change what an e2e demo copies. No code change.
- **B15** (landing, `/maxfiylik`, `/oferta` Uzbek only): deferred. The landing body is hard-coded Uzbek
  (`components/landing/*`), so a switcher there would only flip the header and footer (`SHELL_COPY` has `ru`); a
  Russian privacy policy and offer are legal texts the owner must supply or approve. Product decision.
- Not mine and left alone: the "Handed to other agents" items in `bugs.md`.

## For Agent 4 (integration)

- One additive migration: `packages/db/prisma/migrations/20261027130000_notification_text` (already applied to the
  shared DB). Unique timestamp; keep the folder name.
- Contract change: `catalogs.list` response gained `clientId` (nullable, default null).
- Small edits in Agent 4's areas: `apps/web/src/ui/shell/prefs.ts` and `app-frame.tsx` (B6),
  `apps/api/src/notifications/notifications.controller.ts` (B13: passes `@Locale()` to the list and the bell),
  `packages/i18n/src/i18n-parts/security.ts` (B21: two keys under `secX.sessions`), `imports.ts` (B11 key),
  `i18n-app.ts`/`i18n-app-ru.ts` (B19 label).
- `.claude/launch.json` has uncommitted entries `tasnivo-api-4016` / `tasnivo-web-3016`.

## Commits

- `ea1cb3b` B17 e2e: delete the extra catalogue it creates, so navigation test 21 sees the fixture as set up
- `e031dbc` Agent 2 fixes: browser evidence for B5, B6, B13, B14, B16–B20
- `43770a6` B4/B11 follow-ups: catalogs.list clientId defaults to null (an older answer still parses); B11 only for text with no table shape, so a header-only CSV named .xlsx stays 'no rows'; first browser screenshots
- `482006a` B7: name the bug at the fixed locators
- `5a99e3b` B4: add the regression test that the earlier commit missed; B5: test strips the BOM without a literal BOM character (lint)
- `b4aad3e` B21: the sessions list shows this device and the 9 latest others, with 'show all (N)'
- `3c5e35a` B20: the drop zone's chips list .xlsx and .csv only; .xls stays accepted so it gets the 'save as .xlsx' message
- `1e80197` B19: uploads never confirmed read 'Fayl oʻqildi (tasdiqlanmagan)' in the journal and stay out of the dashboard and client summaries; a one-row undo names its product
- `44b62b5` B18: a single decision or undo recounts the workspace's problem count and chips (debounced)
- `de5b5ab` B17: diff page 'compare with' select gets a minimum width (was 119 px, cut the file name)
- `a32a3e7` B16: robots.txt allows the public pages, disallows the app, token links and the API, and names the sitemap
- `c5c91a0` B14: /admin and /admin/metrics show the not-found title to non-admins (traction read once per request); the 200 status behind loading.tsx stays, as documented
- `b3e0397` B13: notifications are stored in every interface language (new nullable notification.text) and read in the reader's; older rows fall back to title/body
- `dc74a5d` B12: drafts (unconfirmed uploads) stay out of GET /api/v1/catalogs and the account export
- `c81708b` B11: a non-zip file named .xlsx with nothing readable says it is not an Excel workbook, in both languages
- `1fff10e` B8: e2e refresh test 20 (hover prefetch) skips against next dev, where router.prefetch is a no-op
- `1f82ef6` B10: demo.test keeps its sessions before asserting and counts only visits since the test began (shared database)
- `7d9ee3a` B7: e2e confirm-step heading locator is exact (it also matched 'Keyin nima boʻladi')
- `79524ef` B6: the sidebar toggle writes mxik_sidebar at once so a quick reload keeps it; e2e 23 finds the sidebar's own nav by its label
- `021e23c` B3/B4: typecheck follow-ups (initial list data carries clientId; Intl stub via Reflect)
- `bdcc67a` B5: findings and diff CSVs write MXIK codes as Excel text (="…") so leading zeros and 17 digits survive; the 1C CSV stays plain for the importer
- `5d07c1b` B4: the catalogue list falls back to the header switcher's active client, and the API says which client it chose
- `fbdccd3` B3: Uzbek relative times (team, sessions) are spelled out instead of Intl, which browsers lack for uz
- `b7a532a` B2: column guess reads Uzbek-Cyrillic name headers, prefers the Latin one, and skips row-number columns (Т/р, П/п)
- `2881cbc` B1: workspace search folds the apostrophe family and needs every word, in any order
- (this file)

## Owner inputs

None needed for these fixes. B15 needs a decision (translate the landing, or not) and, for Russian legal pages,
approved texts.
