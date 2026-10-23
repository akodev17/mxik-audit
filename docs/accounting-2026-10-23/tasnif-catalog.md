# Tasnif catalogue access (cls-api): what Tasnivo uses, with today's live evidence

Date: 2026-10-23 (probes run 11:23–11:41 UTC from the development machine, no authentication).
Base URL: `https://tasnif.soliq.uz/api/cls-api`. There is **no official API documentation**: every
endpoint below is one the tasnif.soliq.uz portal itself calls (research note §3). Each row says what
was verified today, by which request, and what the product relies on. Owner of this file: Agent 4.

## 1. Endpoints the product uses

| Endpoint | Used by | Verified today | Evidence |
|---|---|---|---|
| `GET /excel/get/category?lang=uz\|ru\|uz_cyrl` | `scripts/fetch-catalog.ts` → `ingest-catalog.ts` → `classifier:update` (bulk copy of all codes) | yes, range request | `HTTP 206`, `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename=category_0_ru.xlsx`, `Content-Range: bytes 0-1023/31500804` (31.5 MB for `lang=ru`), 0.04 s to first KB. Columns as in research note §3; no status, no marking flag. |
| `GET /mxik/get/by-mxik?mxikCode=&lang=` | `products/tasnif-client.ts` `card()` — packaging list, lazily | yes | `03004413004009066&lang=ru` → 200, 3 038 B, 0.055 s: `mxikName`, `label: 1`, `lgotaId: 102870`, `packages[3]` (below). `00101001001000000&lang=uz` → 1 package `{code:1378325, unitId:1, unitName:"дона", parentValue:1, name:"дона", isUnitPackage:"1"}`. Unknown code (`00000000000000000`, `12345678901234567`) → 200 with the plain-text body `MXIK ma'lumotlari topilmadi` (not JSON). Recorded answer: `packages/domain/src/products/fixtures/card-03004413004009066.json`. |
| `GET /integration-mxik/get/history/{code}` | `tasnif-client.ts` `history()` — activity (`isActive`, `status`) and the Uz/Ru names of each package | yes | `03004413004009066` → 200, 2 156 B, 0.037 s: `isActive:"1"`, `status:0`, `createdAt "29.04.2022 14:47:09"`, `updatedAt "03.10.2022 21:13:45"`, `packageNames[3]` (`nameRu "упаковка=1 флакон (14 шт (таблетка (90 мг))"`). Unknown code → `{"success":false,"code":0,"reason":"Mxik code not found!","data":null}`. Restricted generalized code `02505001002000000` (news 5063, in `restricted_code`) → `isActive:"1"`, `status:0`, 9 packages: **restriction is not deactivation**. Recorded: `fixtures/history-03004413004009066.json`. |
| `GET /integration-mxik/references/get/units/all?pageSize=200` | `scripts/generate-units.ts` (unit table behind `normalize/units.ts`) | yes | 200, 3 503 B, 0.039 s, `recordTotal: 90`, 90 rows (`{id:1,name:"дона"}`, `{id:5,"килограмм"}`, `{id:96,"дона (таблетка)"}`, …). |
| `GET /elasticsearch/search?search=&size=&page=&lang=` | `scripts/probe-api.ts`, `check-portal-examples.ts` (diagnostics; not on the product path) | yes | `search=sement&size=3&page=0&lang=uz` → 200, 4 608 B, 0.055 s, `recordTotal: 69`, 33 fields per item incl. `label`, `usePackage`, `nonChangeable`, `packageName`. |
| `GET /mxik/search/by-params?mxikCode=&size=1&page=0&lang=` | `ingest-catalog.ts --enrich` (marking `label` per code) | yes | `02505001002000000` → 200, Spring page with one `content[]` item. |

Not available (research note §3, re-checked today): `/news`, `/news/get/all` → 404 (no machine-readable
announcement feed); `/package`, `/statistics` → 401; no packaging reference list endpoint.

### Packaging structure (`packages[]` of the card), as stored in `packaging_code`

`03004413004009066` (Эторелекс 90 мг №14), today:

| code | parentCode | containerCode / Name | unitId / unitName | parentValue | name | isUnitPackage | nameRu (history) |
|---|---|---|---|---|---|---|---|
| 1074787 | 1070335 | 58 упаковка | 1 шт. | 1 | 1 флакон (14 шт (таблетка (90 мг)) | "2" | упаковка=1 флакон (14 шт (таблетка (90 мг)) |
| 1070335 | 1062101 | 10 флакон | 1 шт. | 14 | 14 шт (таблетка (90 мг)) | "2" | флакон=14 шт (таблетка (90 мг)) |
| 1062101 | — | — | 1 шт. | 1 | шт (таблетка (90 мг)) | "1" | шт (таблетка (90 мг)) |

So a package is a tree (`parentCode`), `parentValue` is how many of the child it holds, and `unitId`
is the unit the whole chain counts in. `isUnitPackage` was `"1"` on the leaf (the unit itself) and
`"2"` on containers in every card seen today; that reading is ours, not documented.

### Activity status survey

`npm run classifier:update -- --activity-only 4 --activity-sample 300` (the new step, below) asked the
history endpoint about 300 random live codes (`TABLESAMPLE SYSTEM (1)`): **300 active (`isActive:"1"`),
0 inactive, 0 not found, `status` 0 for all 300**; 300 requests in 18 s at the client's limits
(4 in flight, ≥ 60 ms between starts, ≈ 17 req/s), no 429 and no 5xx. Snapshots #1 (2026-08-20,
438 925 codes) → #4 (2026-10-21, 442 964 codes) retired **0** codes: in two months nothing disappeared
from the export (4 039 added, 4 507 renamed, 12 unit changes).

## 2. How the product keeps it current

- **Bulk (unchanged): `npm run classifier:update`** downloads the three exports, normalises them, loads
  a new snapshot with its diff (added / retired / unit changed / name changed), embeds only the added
  codes, re-checks client catalogues. Codes are never re-embedded or re-ingested by the product module.
- **New step in the same command: activity of retired codes.** After a load, every code the new export
  no longer contains is asked about at `/integration-mxik/get/history/{code}`; the answer (isActive,
  status, or "not found") goes to `mxik_code_state`. `classifyProducts` then reports such a code as
  `mxik_inactive_api` ("inactive per API") when the API said `isActive:"0"`, and as `mxik_inactive`
  (retired by absence) with `params.api` = `active` / `not_found` / `unknown` otherwise. Flags:
  `--activity-only <snapshotId>` (ask without loading anything), `--activity-sample <n>` (survey of
  random live codes). `TASNIF_LIVE=false` skips the step. A failure is logged, never fails the update.
  Code: `packages/domain/src/classifier-activity.ts`, `scripts/update-classifier.ts`.
- **Packaging, lazily, never crawled.** `packagesFor(codes)` (`products/packaging.ts`) reads
  `packaging_code` for codes whose `mxik_code_state.packagesFetchedAt` is younger than 30 days; for the
  others it calls the card (and the history, for the Uz/Ru package names) through the runtime client,
  at most 200 codes per call, 4 in parallel, and caches the result. `classifyProducts` asks only for the
  codes of lines that carry a package code (`packaging: 'given'`, default); the product drawer asks for
  one code when opened. Activity is read from the cache during classification (no live call per code)
  unless `liveActivity: true`.
- **Runtime client** (`products/tasnif-client.ts`): 8 s timeout, 2 retries with 300/600 ms backoff on
  network errors, timeouts, 429 and 5xx, a process-wide limiter (4 in flight, ≥ 60 ms between starts),
  an in-memory answer cache (1 h, 5 000 entries; outages are not cached), the kill switch
  `TASNIF_LIVE=false` (default on), `TASNIF_BASE_URL` to point elsewhere. Tests use a fake client and
  recorded answers; nothing in `npm test` touches the network.

## 3. Unknown, and what would settle it

1. **What a deactivated code looks like.** Seen today: only `isActive:"1"` and `status:0` (301 codes).
   Whether a deactivated code answers `isActive:"0"`, another `status`, "not found", or still `"1"`, and
   whether it leaves the Excel export, is not known; the export retired nothing in two months. The
   product handles all four answers (`mxik_inactive_api`, `params.api`), but the owner should give one
   **code known to be deactivated** (from a tasnif.soliq.uz announcement or the Tax Committee Telegram) so
   it can be probed: `npx tsx scripts/update-classifier.ts --activity-only <snapshot>` after adding it,
   or `curl https://tasnif.soliq.uz/api/cls-api/integration-mxik/get/history/<code>`.
2. **`status` semantics** (only `0` seen) and `isUnitPackage` / `type` values ("1"/"2", "1").
3. **Whether ЭСФ accepts every package in `packages[]` or only the taxpayer's own** (ПКМ №263 summary
   says "only the taxpayer's own created packages"). The card lists packages created by anyone
   (`createdBy: "user"`); `package_not_of_code` is therefore a warning, not an error.
4. **Rate limits**: undocumented. 17 req/s sustained for 300 requests was accepted today; the client
   stays at that ceiling.
5. **Stability of the endpoints**: they are the portal's internal calls and can change without notice;
   every reader tolerates missing fields, and the kill switch turns live checks off.
