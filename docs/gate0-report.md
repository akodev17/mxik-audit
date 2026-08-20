# Gate 0 — Data acquisition and inspection

Everything below is measured from the live portal and the official export on **2026-08-20**.
Every number is reproducible via an npm script; script names are given inline.

---

## 1. Ingestion result

| | |
|---|---|
| Codes ingested | **438,925** |
| Brief expected | ~438,964 |
| Deviation | **−39 (0.009%)** — within noise, no action |
| Duplicate codes in the export | **0** |
| Code length | 17 chars for **all** 438,925 rows |
| Output | `data/mxik.ndjson` (1.14 GB), `data/units.json`, `data/ingest-manifest.json` |

Two brief figures were slightly off and are corrected here:

| Brief said | Actual | Source |
|---|---|---|
| 115 groups | **117** groups exist; **115** contain codes | `/group` vs code prefixes |
| ~438,964 codes | 438,925 | `dimension ref="A1:O438927"` minus 2 header rows |
| 191,585 with barcodes | **191,675** | column I fill count |
| 37,530 with tax privilege ids | **37,530** — exact match | column O fill count |
| 100,060 digitally marked | **124,169** confirmed marked (of 400,633 resolvable) | API `label` enrichment |

### The Excel export is not a static file
`GET /api/cls-api/excel/get/category?lang={uz|ru|uz_cyrl}` generates the workbook per
request (the copy pulled today was stamped 05:03 the same morning). There is no stale
snapshot to work around, and `category_id=N` narrows it to one of 10 top-level categories.
`npm run fetch:catalog`

---

## 2. Excel export vs. the documented API field vocabulary

The export has **15 columns under a two-row merged header, with data starting at row 3.**
This differs materially from the brief's assumed field list.

| Col | Header (row 1 / row 2) | Fill | Maps to brief field |
|---|---|---|---|
| A | GURUH NOMI | 100% | `groupCode` + `groupName` (fused as `001-NAME`) |
| B | SINF NOMI | 100% | `classCode` + `className` |
| C | POZITSIYA NOMI | 100% | `positionCode` + `positionName` |
| D | SUBPOZITSIYA NOMI | 100% | `subPositionCode` + `subPositionName` |
| E | BREND NOMI | 100% | `brandCode` + `brandName` |
| F | ATRIBUT NOMI | 100% | `attributeName` |
| G | MXIK KODI | 100% | `mxikCode` |
| H | MXIK NOMI | 100% | `mxikName` |
| I | SHTRIX KODI | 43.7% | `internationalCode` |
| J | BIRIKTIRILGAN (QAT'IY) / O'LCHOV GURUHI | 87.8% | **strictly bound unit** |
| K | ⟵ / O'LCHOV BIRLIGI | 0.02% | *(dead column — see below)* |
| L | ⟵ / QADOQLAR | 8.0% | `packages` / `packageName` |
| M | FOYDALANISHGA TAVSIYA ETILGAN / O'LCHOV GURUHI | 0.5% | recommended unit *dimension* |
| N | ⟵ / O'LCHOV BIRLIGI | 1.7% | `recommendedUnitsName` |
| O | IMTIYOZ ID | 8.6% | `taxPrivilegeIds` |

The hierarchy is fully present, and the embedded code prefixes are **100% consistent** with
the 17-digit code (0 mismatches across 438,925 rows), so group/class/position/subposition
codes can be sliced from the code itself (3 / 5 / 8 / 11 / 14 chars).

### Fields in the brief's vocabulary that the export does NOT contain

| Missing field | Obtainable? | From where |
|---|---|---|
| `label` (marking flag) | **Yes** | per-code API only — see §5 |
| `unitCode` / `commonUnitCode` (numeric ids) | Partly | `/integration-mxik/references/get/units/all` gives 90 id→name pairs, but per-code `unitCode` came back `null` on every code sampled |
| `mnnName` (pharma INN) | No, but recoverable | not a column; INN is embedded in the name text (`Kaliy xlorid … - A12BA01: …`) |
| `myProduct`, `useCard`, `property`, `nonChangeable`, `surveyCategoryId` | Not in export | present on `/elasticsearch/search`; irrelevant to the five checks |
| `isArchived`, `archivedAt`, `replacedByCode` | **No — nowhere** | see §3 |

`npm run inspect:xlsx` · `npm run inspect:columns`

---

## 3. Archive / deprecation status — **BLOCKED**

**Neither source exposes it.** This is the one Gate 0 finding that changes the plan.

Evidence, in order of strength:

1. **No column.** The export has 15 columns, enumerated above. None is a status flag.
2. **No field.** `/integration-mxik/get/history/{code}` returns 27 fields:
   `id, pkey, parentPkey, mxikCode, groupNameUz/Ru/Lat, classNameUz/Ru/Lat,
   positionNameUz/Ru/Lat, subPositionNameUz/Ru/Lat, brandName, attributeNameUz/Ru/Lat,
   description, isActive, createdAt, updatedBy, updatedAt, status, packageNames`.
   Programmatic search for any field matching `/replac|new|old|instead|substit|prev|next|archiv|delet|revok/i`
   returns **NONE**. Despite the endpoint's name it returns a single current record, not a version series.
3. **`isActive` is always `1`.** True for every code checked — 10 codes spread across the
   catalog, plus all 45 codes of group 001 and every orphan candidate.
4. **No reachable code is absent from the export.** 10 search queries × up to 50 results
   each produced **0 orphans** (codes the API returns that the export lacks).
5. **The count discrepancy is stale counters, not hidden codes.** `/group` sums to 441,607
   against the export's 438,925 (delta 2,682, spread over 36 groups). Two groups were
   enumerated exhaustively through the portal's own hierarchy walk:

   | Group | `count` claims | API tree leaves | Excel rows | API-only | Excel-only |
   |---|---|---|---|---|---|
   | 001 | 52 | **45** | **45** | 0 | 0 |
   | 015 | 1,977 | **1,971** | **1,971** | 0 | 0 |

   The inflated number appears only at the class/position level; brand-level counts are
   accurate. So the 2,682 delta is counter drift.

`npm run probe:api` · `npm run enumerate:group 001`

### Consequence for the `ARCHIVED` check
As specified, `ARCHIVED` **cannot be implemented on day one.** The only mechanism that can
ever produce it is **snapshot diffing**: retain each catalog import, and treat a code present
in import *N* but absent from *N+1* as archived. That yields zero findings until a second
import exists, and it can never populate `replacedByCode` — no source carries the mapping.

I did not implement a workaround. **This needs your decision** (options in §8).

Note also: I could not reproduce the brief's premise that pre-Aug-2022 medical service codes
were revoked. Service groups 099–117 exist and are populated (group 109
"SOG'LIQNI SAQLASH SOHASIDAGI XIZMATLAR" carries 137 service-unit codes), and codes with
`createdAt` of 29.04.2022 are still `isActive=1`. The revoked originals are simply not
visible from any accessible source. `npm run check:services`

---

## 4. Strict vs. recommended unit binding — **yes, distinguishable**, but not as described

Distinguishable and clean: strict binding is column **J**, recommended is columns **M/N**.
The brief's *quantities*, though, are wrong in a way that matters.

| | Brief | Actual |
|---|---|---|
| Strictly bound | 434,418 (99%) | **385,414 (87.8%)** |
| Recommended | 7,903 | 7,560 rows have a recommended unit; **4,223 (1.0%)** have *only* recommended |
| Neither | — | **49,288 (11.2%)** |

So `UNIT_CONFLICT` remains a high-value, near-universal check — but it is silent on **11.2%**
of the catalog, not 1%. "99% of codes have a strictly bound unit" should not go on the
landing page; **87.8%** should.

Three further corrections:

- **Column K is dead.** The strict block's "O'LCHOV BIRLIGI" sub-column is filled on 74 of
  438,925 rows and contains junk (`"0"`, and the dimension label `"Og'irlik birligi"` where a
  unit belongs). The real strict unit is column J. Ignore K.
- **J is not a scalar.** It fuses unit + packaging (`dona (pэt butilka)  0.75 litr`) and
  sometimes holds a comma-separated *list* of acceptable units
  (`tsentner, tonna, ming tonna, …, dona`). Raw distinct values: **11,054**. After parsing the
  head token, folding apostrophes and applying aliases: **168 canonical units**. `UNIT_CONFLICT`
  must therefore compare against a *set*, not a single value.
- **M and N are different things.** M holds dimension classes (`Og'irlik birligi` = weight,
  `Xajm birligi` = volume), N holds actual units. Both are comma-separated multi-value.

### Unit dictionary
Two dictionaries exist and they do not share a script:

- `/integration-mxik/references/get/units/all?pageSize=200` → **90** units, **Cyrillic** names
  with numeric ids (`{id:5, name:"килограмм"}`). Note the endpoint's pagination param is
  `pageSize`, not `size` or `limit` — with `size` it silently returns only 10 of 90.
- The Latin export yields **168** canonical units in Latin (`kilogramm`, `dona`, `kv. metr`).

Both are saved to `data/units.json`. Mapping the 168 Latin forms onto the 90 official ids is a
Gate 1 normalization task; nothing was invented.

---

## 5. Marking flag (`label`) — obtainable, and cheap

Not in the export, but `GET /mxik/search/by-params?mxikCode={code}` returns it, and
`/mxik/get/by-mxik` agrees with it on 120/120 codes. Full-catalog enrichment was **run, not
just benchmarked**:

- **438,925 codes enriched in ~3.6 minutes** at ~2,025 req/s, concurrency 25, zero non-200s.
- **`label` is three-state, not boolean:** 124,169 marked · 276,464 unmarked ·
  **38,292 (8.7%) null**.
- The nulls are **systematic, not transient** — 40 retried sequentially, 0 resolved; the
  endpoint answers `success=true, content=1, label=null`. They are scattered across 89 groups
  (worst: group 073 at 34%), with no group entirely null.

The flag is real and behaves correctly: by query, `pivo` and `aroq` are 200/200 marked,
`dori` 195/200, `sigareta` 195/200, `sut` 7/200 — matching Uzbekistan's actual marking regime.

Consequence for the domain rule "*only suggest identifying codes when `label` indicates a
marked category*": it is implementable for 91.3% of the catalog, and must degrade safely
(prefer the base code) for the remaining 8.7%.

`npm run bench:enrich` · `npm run check:marking`

---

## 6. Languages — all three, complete

| `lang` | filename served | bytes | script |
|---|---|---|---|
| `uz` | `category_0_lat.xlsx` | 30,748,917 | Uzbek **Latin** |
| `ru` | `category_0_ru.xlsx` | 31,189,897 | Russian |
| `uz_cyrl` | `category_0_uz.xlsx` | 31,353,616 | Uzbek **Cyrillic** |
| `en` | → identical to `uz` | — | no English exists |

Joining all three on `mxikCode`:

- **438,925 codes present in all three variants. Zero gaps** (0 missing in any variant).
- 433,564 have three genuinely distinct names; only 2 are untranslated (Latin == Cyrillic).
- So `nameUz`, `nameRu`, `nameUzCyrl` can all be `NOT NULL`. Embedding each separately, as the
  brief requires, is fully supported.

### The normalization findings that matter most

**The Uzbek apostrophe appears as seven different characters** in the Latin export's name
column, and the officially-correct U+02BB is almost absent:

| Char | Codepoint | Rows |
|---|---|---|
| `’` | U+2019 | **137,432** |
| `'` | ASCII | **73,645** |
| `` ` `` | U+0060 | 157 |
| `‘` | U+2018 | 129 |
| `´` | U+00B4 | 89 |
| `ʻ` | **U+02BB (correct)** | **74** |
| `ʼ` | U+02BC | 10 |

211,077 rows (48%) carry one. The brief anticipated two variants; there are seven. Folding all
seven to one form is mandatory for matching — and separately, the UI must *emit* U+02BB.
Live proof this dominates retrieval: `no'xat` (ASCII) → 1 result, and it is **wrong**
(an acrylic polymer dispersion); `noxat` → 99; `noʻxat` (U+02BB) → 105.

**The "Latin" export is 23% contaminated with Cyrillic.** 101,617 of 438,925 Latin names are
mixed-script, because brand names stay Cyrillic inside Latin text
(`Muzlatilgan suyaksiz go’sht (mol go’shti): Родной дом, PET paket 150 g`). Transliteration
must run *within* a string, not per-document. The same leaks into units — `dona (pэt butilka)`
puts a Cyrillic э inside a Latin word, and `sht.` (Russian шт.) appears as a unit.

**The official transliteration is itself inconsistent** — `GO’ShT`, `TA’MIRLASh`,
`MA’MURIY VA YoRDAMChI` — so case folding cannot be trusted as a signal.

`npm run compare:langs`

---

## 7. Rate limits — effectively none

No throttling was observed at any level tested. All responses 200.

| Test | Result |
|---|---|
| Sequential, 1 req | 13 ms |
| Concurrency 5 / 15 / 30 | 44 / 60 / 87 ms wall, all 200 |
| 60 sequential requests | 60/60 OK, 13 ms avg, 0.8 s total |
| 150 reqs @ concurrency 50 | ~1,128 req/s |
| **438,925 reqs @ concurrency 25** | **~2,025 req/s, 3.6 min, zero failures** |

No `Retry-After`, no 429, no rate-limit headers. The API is unauthenticated. I still capped
enrichment at concurrency 25 rather than 50 — being a polite client on a government service
costs 2 minutes and avoids being the reason they add a limiter.

### Other API facts worth recording

- **`lang` is ignored by `/elasticsearch/search`.** `uz`, `ru`, `uz_cyrl`, `en`, `kaa`, empty,
  and the literal string `garbage` all return identical Cyrillic results. `lang` only works on
  `/excel/get/category`. Do not expect the search API to return Latin.
- **The catalog cannot be walked via search.** `size=1000` works, but deep pagination fails
  (`size=200&page=50` → error), i.e. a ~10k result window; and `search=`, `search=*`,
  `search=%20` all return 0. Bulk access is the Excel export or the hierarchy walk, nothing else.
- **`label` is typed inconsistently** — a JSON *number* from `by-params`, a *string* from
  `/elasticsearch/search`. Coerce both.
- **`id` from the history endpoint is not stable** — three consecutive calls for the same code
  returned three different `id` values with identical content. Key on `mxikCode`, never `id`.
- **Undocumented endpoints found** (from the portal bundle, all public):
  `/group`, `/class/short-info?groupCode=`, `/position/short-info?classCode=`,
  `/subposition/short-info?positionCode=`, `/brand/short-info?subPositionCode=`,
  `/attribute/by-brand?brandCode=`, `/category/get/all`, `/category/list?category_id=`,
  `/integration-mxik/references/get/units/all`, `/integration-mxik/references/lgota`,
  `/excel/get/category`. `/advanced-search` and `/search-deep` require auth (401).

### Search quality — this is the business case, quantified
The portal's own search is bad, which is worth keeping as landing-page evidence:

| Query | Result |
|---|---|
| `цемент портланд` (two valid Russian words) | **0 results** |
| `tibbiy xizmat` (valid Uzbek Latin) | **0 results** |
| `тиббий хизмат` (Cyrillic) | 297 results — top hits are **electric kettles and diapers** |
| `Coca-Cola 1.5L` | top hit is **Paracetamol / Цефекон Д** |
| `Coca Cola` (noise removed) | 68 results, top hit correct |
| `no'xat` vs `noʻxat` | 1 (wrong) vs 105 |

Noise in the query and the wrong apostrophe each destroy relevance outright.

---

## 8. Decisions I made that you did not specify

1. **Downloaded all three language variants, not one.** The brief said "the export" (singular);
   language is a query parameter, and all three are needed for the trilingual schema you
   specified. 93 MB total.
2. **Ingest writes NDJSON, not Postgres.** Gate 0 says write no application code and the data
   model is specified in Gate 2, so `data/mxik.ndjson` is the "single table" in file form,
   ready for a Gate 2 `COPY`. No Prisma schema, no Docker Compose yet.
3. **Ran the full marking-flag enrichment** rather than only benchmarking it, because the
   feasibility answer *was* the deliverable and it cost 3.6 minutes.
4. **Hand-rolled the xlsx reader** (`scripts/lib/xlsx.ts`). SheetJS loads the whole workbook;
   the sheet is 205 MB of XML and 1.5 M shared strings. The reader streams and is not a
   general-purpose parser — it targets this one machine-generated layout.
5. **Capped enrichment concurrency at 25** despite 50 testing faster (§7).
6. **Kept every diagnostic as a named npm script** so each number in this report is
   reproducible rather than asserted.

## 9. What I would do differently / what needs your call

**Blocking — needs your decision:**

- **`ARCHIVED` is unimplementable as specified.** Three options:
  **(a)** Ship four checks now; add `ARCHIVED` once two snapshots exist, and never populate
  `replacedByCode`. **(b)** Fold `ARCHIVED` into `NOT_FOUND` — the user's remedy is identical
  ("this code is not valid, here is a suggestion"), so the report loses a row but no user value;
  keep the archive dimension internally for when snapshots accumulate. **(c)** Keep it in the
  schema and UI, always empty on first import, which I'd advise against — an always-zero row on
  the money screen invites "is this thing working?".
  My recommendation: **(b)**, with the snapshot machinery built from day one so the data starts
  accruing immediately.

**Non-blocking, but you should know:**

- **The 1.14 GB NDJSON is a symptom.** Hierarchy names are repeated in 3 languages on every
  one of 438,925 rows. Your Gate 2 `MxikCode` schema already stores mostly *codes*, so I'd
  split the four hierarchy levels into small lookup tables (117 / 1,283 / 2,860 / 10,215 rows)
  and join for display. That cuts the load by roughly half before embeddings and makes the
  hierarchy path — the LLM reranker's strongest disambiguation signal — cheap to fetch.
- **"Prefer base codes by default" needs a caveat.** Only **6,985** codes (1.6%) are base codes,
  covering **68.4%** of the 10,215 subpositions. For the other 31.6% there is no base code to
  fall back to, so the rule needs a defined behaviour when the safe answer does not exist.
- **Barcode data needs cleaning before it can be an exact-match key.** 190,679 are EAN-13, but
  662 are EAN-8, 288 UPC-A (12), and **39 are 10 or 11 digits — not valid GTIN lengths at all**.
  Normalize to GTIN-14 and treat the 39 as unusable rather than letting them produce
  confidence-1.0 matches.
- **I'd re-run `fetch:catalog` at the start of Gate 1** so the eval set is scored against the
  same catalogue the golden answers were written from; the file is regenerated server-side per
  request and the catalogue demonstrably grows.

---

## 10. Reproducing this

```
npm install
npm run fetch:catalog              # 93 MB, 3 files, ~20 s
npm run ingest -- --enrich         # ~4 min, writes data/mxik.ndjson
npm run inspect:xlsx               # column-by-column census
npm run inspect:columns            # unit/hierarchy deep dive
npm run compare:langs              # cross-language join
npm run probe:api                  # lang, search quality, archive hunt, rate limits
npm run enumerate:group 001        # exhaustive hierarchy walk vs Excel
npm run check:marking              # marking-flag coverage analysis
npm run typecheck                  # clean under strict
```

Machine-readable outputs: `docs/gate0-xlsx-report.json`, `docs/gate0-columns.json`,
`docs/gate0-langs.json`, `docs/gate0-api-report.json`, `docs/gate0-enumerate-001.json`,
`docs/gate0-enumerate-015.json`, `data/units.json`, `data/ingest-manifest.json`.
