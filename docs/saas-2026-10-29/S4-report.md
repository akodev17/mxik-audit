# S4 — Dictionary safety and provenance (report)

Branch `feat/s4-dictionary` (cut from `feat/saas-hardening-plan` @ `4288271`), worktree
`.claude/worktrees/agent-a34fbd5e0e85f880a`. Findings F1 (Critical), F9 (High), F17 (Med), F16 part
(carry-over provenance); decision D6. Not pushed, not merged.

## What was verified in the code first

All four claims held on 29 Oct: `dictionary.ts:40` built the name key from `sortedKey` only and
`attrsKey` (`noise.ts:131`, already exported through `normalize/index.ts`, so `noise.ts` was not
touched) was used only by `import-diagnostics.ts`; `decisions.ts` learned only on accept and
`suggestion-feedback.ts` never touched `firm_mapping`; `row-signals.ts` showed only "confirmed N
times"; `editMapping` was `mayWrite` and set `confirmations: 1`; `learn()` replaced a code silently;
`versions.ts:113` set `decidedAt` to the carry-over time. Differences from the plan: the six pairs
are all distinct under `sortedKey|attrsKey|unit` without any change to the normaliser ("Cement M400"
/ "M500" and the Samsung models through the vendor-code attribute). The dev DB had 41 name entries
and no barcode entries.

## What was done

**F1 / D6 — key.** `packages/core/src/match/dictionary.ts`: `dictionaryKeys()` returns `attrs` and
`name = sortedKey|attrsKey|unit` through one helper `nameKeyOf()`. Every writer and reader goes
through it: `learn`/`snapshotMappings`/`loadDictionary` (domain `dictionary.ts`), `pipeline.ts`
(lookup), `products/match.ts` and `version-pairs.ts` (unchanged code, same function),
`scripts/rekey-normalized.ts` (now builds the new key too, so a later run cannot undo the re-key).
`FirmMapping` gains `attrsKey`, `needsReconfirm`, `disputedAt`, `disputedBy`; `learn()` stores
`attrsKey`. Migration `20261108000300_firm_mapping_attrs` (rollback note in
`docs/accounting-2026-10-23/migrations.md`). `scripts/rekey-dictionary.ts` (`npm run
dictionary:rekey [-- --dry-run --org <id>]`): reads name entries with `attrsKey IS NULL`, recomputes
the key from the stored label, and for labels with attributes sets `needsReconfirm = true`,
`confirmations = 0` and writes a `dictionary.rekeyed` audit event with the old key and count; a key
already taken by another entry is reported and left alone; barcode entries untouched; idempotent.

**F9 — disputes.** New `packages/domain/src/dictionary-dispute.ts`: finds the entry a dictionary
suggestion came from (the `dictionaryEntryId` the audit now stores in the evidence, else the row's
barcode/name key, only while the entry still holds the suggested code) and marks it disputed
(`disputedAt`, `disputedBy`, one `dictionary.disputed` event each). Called from a single reject
(`recordDecision`), a group reject (`recordGroupDecision` → `decideMany`) and "suggestion wrong"
(`recordWrongSuggestion`). The decision event keeps `dictionaryDisputed`; its undo lifts the dispute
(only if nothing changed the entry since; a partial undo of a group keeps it). A disputed entry is
still suggested, but: auto-accept skips it, the "confirmed" filter excludes it, the "reconfirm"
filter and a red "Eʼtiroz bildirilgan" badge show it, and only an admin clears it (confirm or edit).

**Auto-accept** (`dictionary-accept.ts`): besides the evidence (`dictionaryConfirmations ≥ 1` and no
`dictionaryHold`), it re-reads the entry named in the evidence and requires it live, same code,
confirmed, not `needsReconfirm`, not disputed. A finding whose evidence names no entry (audited
before this change) is left for a person. `loadDictionary` passes `hold: 'reconfirm' | 'disputed'`
into the pipeline, which stores `dictionaryEntryId` and `dictionaryHold` in the evidence
(`evidence.ts` reads both back; the row signal says the entry waits / is disputed).

**F17.** (a) Drawer: new `dictionary-source.tsx` block under the signals (product name the entry was
taught from, confirmations, first and last person with dates, source, dispute, link to
`/dictionary?q=`), fed by new `GET /api/findings/{findingId}/provenance` (`finding-provenance.ts`,
scoped by `findingScope`; the dictionary part is null for scoped members since entries hold every
client's names). (b) `PATCH`/`DELETE /api/dictionary/{id}` are `role: 'admin'` in the contract and
`mayAdministerDictionary` in the domain; an edit sets `confirmations: 0`, `needsReconfirm: true`
unless the admin ticks "Yangi kodni hozir tasdiqlash" (`confirm: true` → 1, false); an edit or
confirm by an admin ends a dispute. New `POST /api/dictionary/{id}/confirm` (writer, unscoped): +1
confirmation, lifts `needsReconfirm`; a disputed entry answers `disputedAdminOnly` for a non-admin.
The page shows edit/delete to admins only, "Tasdiqlash" to writers (admins also on disputed rows),
and tells accountants that edits are admin-only. (c) Scoped learner: `learnerOf()` (actor's
`clientIds`, else role + `ClientAssignment` count); a scoped member's accept, group or bulk decision
writes `confirmations: 0`, `needsReconfirm: true` on a new entry and adds no confirmation to an
existing one; their undo subtracts none (`scoped: true` in the event). The products "Confirm MXIK"
and product import paths also go through `learn()`, which looks the scope up itself, so they follow
the same rule. (d) When `learn()` replaces a code, the statement returns the previous code and counts
(CTE over the pre-image) and writes `dictionary.code_replaced`; `needsReconfirm` is set when the old
code had a person's confirmation or the learner is scoped (a person correcting a bulk-only entry is
a plain correction); any dispute on the old code ends. Decision events (single and many) now carry
`deciderEmail` for S2's fallback.

**F16 part.** `Finding.carriedFromCatalogId`, `originalDecidedAt` (same migration). `carryOver`
fills them with the upload and moment the decision was first made, also through chained carry-overs.
`decision-info.tsx` shows "Qaror «file» faylida qabul qilingan (date)" (or "…u fayl oʻchirilgan"
when that upload was deleted) and pairs the original decider with the original date.

**i18n** (uz with U+02BB/U+02BC, ru mirrored): `wsX.dict` (filter `reconfirm`, hints, badges,
dispute line, `confirmNow`, `adminOnlyHint`, `disputedAdminOnly`, `sourceLabel.confirm`, new
`editHint`), `wsX.dictSource`, `matchX.dictionary.{reconfirm,disputed}`,
`matchX.carriedFrom{File,Deleted}`.

## Files

Core: `packages/core/src/match/{dictionary.ts, dictionary.test.ts (new), evidence.ts,
evidence.test.ts, pipeline.ts, pipeline.test.ts}`. DB: `packages/db/prisma/schema.prisma`
(FirmMapping, Finding), `migrations/20261108000300_firm_mapping_attrs/`. Domain:
`dictionary.ts, dictionary-dispute.ts (new), dictionary-accept.ts, dictionary-ops.ts,
dictionary-review.ts, decisions.ts, decide-many.ts, suggestion-feedback.ts, row-signals.ts,
versions.ts, finding-provenance.ts (new)`; tests `dictionary-safety.test.ts (new),
dictionary.test.ts, dictionary-review.test.ts, matching-provenance.test.ts, versions.test.ts,
row-signals.test.ts`. Contracts: `modules/dictionary.ts`. API: `apps/api/src/dictionary/
dictionary.controller.ts`, `apps/api/test/e2e/dictionary.test.ts`. Web: `(app)/dictionary/{page,
dictionary-view, dictionary-table, dictionary-params}.tsx/ts`, `(app)/catalogs/[id]/{decision-info.tsx,
drawer-body.tsx (one line + import), dictionary-source.tsx (new), use-provenance.ts (new)}`,
`tests/web-parity/params.test.ts`. i18n: `i18n-parts/{workspace,matching}.ts`. Scripts:
`scripts/rekey-dictionary.ts (new)`, `scripts/rekey-normalized.ts`, `package.json`. Docs:
`docs/accounting-2026-10-23/migrations.md`, `apps/api/README.md` (dictionary routes), `packages/contracts/README.md` (regenerated checklist), this report. Also `packages/domain/src/activity.ts` and `i18n-app(-ru).ts` (activity group and labels of the new audit actions).

Outside the S4 list, kept minimal: `packages/core/src/match/evidence.ts` (two optional evidence
fields and their reader; no other task owns it), `dictionary-review.ts` (the filter),
`scripts/rekey-normalized.ts` (key agreement), `matching-provenance.test.ts` and
`dictionary-review.test.ts` (expectations of the new behaviour), `tests/web-parity/params.test.ts`
(the new filter value).

## Migration and re-key on the dev DB (127.0.0.1:54329)

- `npx prisma migrate deploy` applied `20261108000300_firm_mapping_attrs` (S1's
  `20261108000100_user_verified_via` and S3's `20261108000200_item_check_error` were already in the
  DB from their worktrees).
- `npm run dictionary:rekey -- --dry-run`, then `npm run dictionary:rekey`: **41 name entries
  re-keyed, 22 with sizes/grades/models set to needs-reconfirm (confirmations 0), 0 empty names, 0
  conflicts**; 22 `dictionary.rekeyed` events written. A second run: 0 to re-key (idempotent).
  After: 41 name entries, 22 `needsReconfirm`, 11 still confirmed, 0 with `attrsKey` NULL; 0
  barcode entries in the dev DB.

## Tests

New and changed tests:
- `packages/core/src/match/dictionary.test.ts` (new, pure): the six pairs ("Sut 3.2% 1l"/"2.5%",
  "Шампунь 250 мл"/"500мл", "Труба ВГП 15х2,5"/"20х2,5", "Cement M400"/"M500", "Samsung Galaxy
  A515F"/"G991B", "Coca-Cola 0.5L"/"1.5L") give distinct keys; six true duplicates ("Coca-Cola 1.5L"
  / "Coca Cola 1,5 l", "Sut 3.2% 1l" / "sut 3,2 % 1 L", "Шампунь 250 мл" / "шампунь 250мл", "Труба
  ВГП 15х2,5" / "труба вгп 15x2.5", case, word order) give the same key; key shape; unit apart.
- `packages/domain/src/dictionary-safety.test.ts` (new, DB): variants learned into separate entries
  and found by their own rows; scoped accountant's accept unconfirmed + needsReconfirm, auto-accept
  refuses it, an unscoped accept confirms it, the scoped undo subtracts no confirmation, decider
  e-mail in the event; replaced code logged with old code/counts and held (a bulk-only one is not);
  single reject disputes (event, `dictionaryDisputed`, auto-accept skips, out of "confirmed", in
  "reconfirm", `loadDictionary` hold) and its undo lifts it; group reject and "suggestion wrong"
  (old evidence without entry id, matched by keys) dispute; confirm/edit/delete rights and the
  confirm-now rule; provenance for unscoped, none for scoped, null for another org.
- `versions.test.ts`: carried-over decision keeps upload and original time across two carry-overs,
  provenance shows the file name, and null name after that upload is deleted.
- `apps/api/test/e2e/dictionary.test.ts`: admin-only PATCH/DELETE (accountant and viewer 403),
  edit without/with `confirm`, the confirm endpoint (viewer 403, disputed → `disputedAdminOnly` for
  an accountant, admin clears), provenance endpoint (shape, 404 for another org and a scoped member).
- Adjusted to the new behaviour: `dictionary.test.ts`, `matching-provenance.test.ts` (auto-accept
  needs a live entry; carry-over payload has `fromCatalogId`/`originalDecidedAt`),
  `dictionary-review.test.ts` (`reconfirm` count), `pipeline.test.ts`, `evidence.test.ts`,
  `row-signals.test.ts`, `tests/web-parity/params.test.ts`, `workspace-docs.test.ts` (43 operations),
  contracts checklist regenerated (`npx tsx packages/contracts/src/checklist.ts --write`), activity
  groups/labels for the four new audit actions.

Commands and results (worktree root, dev DB shared with five sibling agents):
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0; 0 errors, 1 warning that predates this branch
  (`scripts/lib/xlsx.ts:131` no-non-null-assertion).
- `npm test` (final run): 2039 tests, 2034 pass, 3 skipped, **2 fail**, both timeouts of
  background work under load and not in S4 code: `apps/api/test/e2e/imports.test.ts:85` ("timed
  out waiting for the cheque check") and `packages/domain/src/audit-retry-access.test.ts:29`
  ("catalogue still analyzing" after 120 s). Run alone right after, both files pass (6/6). The first
  full run also had "Can't reach database server at localhost:54329" failures (Postgres at 68/100
  connections with the sibling worktrees' tests); those passed on the second run. S4 regressions
  found by the first run (checklist, `replaces`, activity groups, Swagger count) were fixed.

## Remaining, unverified, open questions

- Not checked in a browser (the machine was saturated by five parallel worktrees): the `/dictionary` badges/filter/confirm/edit flow and the drawer's
  dictionary block and carried-from line are covered by typecheck, the API e2e test and the domain
  tests, not by a screenshot. `apps/web/e2e/dictionary-review.e2e.ts` (Playwright) still matches
  the page (it signs in as admin) but was not run and has no case for the new chip yet.
- Bulk reject from the bulk bar (`bulk.ts`, not an S4 file) does not dispute entries; single and
  group rejects and "suggestion wrong" do. Bulk *learning* by scoped members is covered (`learn()`
  looks the scope up).
- Findings audited before this change have no `dictionaryEntryId`: auto-accept leaves them for a
  person, and the drawer shows no dictionary block for them (the keys fallback is used only for
  disputes). Re-auditing fills it.
- Per-client dictionaries stay deferred (plan §4); a replaced code is now logged and held instead.
- Owner questions: (1) should a code replacement by an unscoped manual decision of a bulk-only entry
  also need a second confirmation (now: no)? (2) should confirming a `needsReconfirm` entry stay open
  to every unscoped accountant (now: yes; disputes are admin-only)? (3) the rekey reset 22 dev
  entries to 0 confirmations; production will reset every entry whose name carries a size, which
  pauses auto-accept for those products until someone confirms them on `/dictionary` (filter
  "Qayta tasdiqlash kerak").
- Deploy order: migrate, then `npm run dictionary:rekey` once, before the first audit on the new code
  (until then name lookups miss old-format keys, i.e. no dictionary suggestions, no wrong ones).
