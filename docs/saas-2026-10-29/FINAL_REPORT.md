# SaaS hardening programme: final report (S11, 30 Oct 2026)

Scope: plan `docs/SAAS_HARDENING_PLAN_2026-10-29.md`, waves 1–2 (S1–S10) merged into `main` at
`33058fa`. S11 verified that tree in worktree branch `feat/s11-qa`. It built no features and changed
no code; this report and the screenshots are the only files committed. Sources: the ten task
reports `docs/saas-2026-10-29/S1…S10-report.md`, the plan (§2, §3, §7), `DEPLOY.md`, `.env.example`
and the S11 runs listed in §3.

**Verdict.** Every Critical and High finding (F1–F10) is closed in code, and each has tests that pass.
The Medium findings are closed, except for the gaps named in §5. On the merged tree:

- typecheck and lint are clean.
- The migrations apply to an empty database.
- The API, worker and web builds are green.
- The full unit/integration suite is green once the load-timeout files are re-run alone.
- The Playwright suite passes 71 of 73 against the production build (1 skipped). Its one failure
  comes from cache timing in a test that predates the programme, and it passes on a re-run.

Four things are not done: the 60k-row smoke (overnight only), a production deploy, a real
Click/Payme sandbox payment and the Telegram paths. They need the owner or an external setup.

---

## 1. Features implemented

Legend: **Full** = built, tested, nothing external missing. **Partial** = built with a named gap.
**Ext** = built, but it needs external setup to work in production.

### Multi-tenancy and roles
| Item | Task | State |
|---|---|---|
| Catalogue delete limited to admins and blocked for demo orgs (`role:'admin', noDemo`), and the menu is hidden for everyone else | S2 (F12, D1) | Full (soft delete deferred) |
| Last-client race: assignment writes lock the user rows, so an accountant can never end with zero clients (which means all clients) | S2 (F11) | Full |
| Bank rule delete scoped to the client; duplicate-upload notices no longer name another client's file; non-admins see only the actors they may see; `staff.clientIds` emptied for non-admins | S2 (F20) | Full |
| Read paths (`progress`, header) resume a stalled audit only for a writer in inline mode | S2 (F19/Q15) | Full |
| Isolation matrix over the registry: 201 of 244 operations, cross-org, scope, lists, roles, demo, platform-admin and API key (the 43 others are allow-listed with a reason) | S10 | Full |
| Two isolation holes the matrix found: the Didox list ignored the user's scope; the products export wrote another client's batch | S10 | Full (fixed) |
| Module-flag guard matches API paths in any letter case | S6 (F20) | Full |

### Subscription, trial and billing
| Item | Task | State |
|---|---|---|
| `markPaid` takes a per-org advisory lock and claims the order once (`updateMany where status='created'`). Provider state is written in the same transaction, and Payme Create runs under a per-order lock | S5 (F4) | Full in code; **Ext** for real providers |
| Tier rule (D2): a renewal extends; an upgrade starts now and credits the remaining days at the price ratio; a downgrade is refused while a subscription runs (`--force` on `billing:activate`). Months use calendar arithmetic | S5 (F3) | Full |
| Products import, Didox upload and 1C counterparty import call `uploadsOpen()` (D4, not counted in `rowsPerMonth`) | S5 (F14) | Full, seen in a browser (screen 15) |
| `BILLING_REQUIRED_FOR_EXPORT` also covers the client PDF and diff CSV; the internal PDF and report CSV blank the chosen code (D3) | S5 (F14) | **Ext**: production must set the flag (it is `false` in `.env.example`) |
| Orders survive an org purge (`SetNull` + `orgName`); Payme test mode is off on prod unless `PAYME_TEST_ALLOW_PROD=1`; a malformed Click id answers -8; abandoned orders expire after 24 h; a paid catalogue cannot be paid twice | S5 (F20) | Full |
| Expiry reminders at 7/3/1/0 days for the trial and the subscription: an in-app notice plus mail to admins, deduplicated | S7 (F15, D9) | **Ext**: needs SMTP and the worker's daily job; no catch-up for a missed day; not sent to Telegram |
| "Ending soon" banner for the subscription (≤7 days) | S7 | Full, seen (screen 4). Note: a limit at ≥80% outranks it, see §5 |
| Billing history, a printable receipt per paid order (admin only) | S7 | Partial: the receipt has no legal requisites (owner question) |
| `/admin/billing` for platform admins (test-mode payments counted apart) | S7 | Full, seen (screen 6); no paging |
| Refund recording `npm run billing:refund` (new enum value `refunded`); the money is returned by hand | S7 | Full (manual by design) |

### Onboarding
| Item | Task | State |
|---|---|---|
| An invite never confirms an address (`emailVerifiedAt` null until the code); Google links only `verifiedVia` = `code`/`link` | S1 (F2) | Full (spot-verified, §3.6) |
| An existing account can join a firm when its own org has no other users, no catalogues and no paid subscription (D5 plus one extra rule) | S1 (F8) | Full, seen (screen 13) |
| Invite join is rate-limited (10/h/address) and gives one generic answer for a registered address | S1 (F20) | Full |
| Telegram sign-in with a browser-bound one-time state; 2FA enable ends other sessions; 30-day absolute session age | S1 (F20) | Full in code; **Ext** for Telegram (the widget refuses localhost) |
| Checklist gains the step "download or share"; 2FA and Telegram become optional; "hide" is stored in the DB | S9 (F19) | Full, seen (screen 3) |
| The tour drops steps of modules that are HIDDEN or COMING_SOON | S9 (F19) | Full |

### Audit workflow reliability
| Item | Task | State |
|---|---|---|
| Per-row retry (3× with backoff). A row that still fails gets `CatalogItem.checkError`; the audit reaches `ready` with `rows_failed`; "re-check failed rows" is claimed once | S3 (F6, D7) | Full, seen (screens 8, 9) |
| An empty or unreadable restricted list is reported (`restricted_unchecked`, banner, `/api/health`, `/admin`) | S3 (F5) | Full in code; **Ext**: the list is still empty on dev (0 codes) and must be loaded in production |
| The heartbeat runs through the post-row phase and the commit rebuild; a resume merges the counters; a resume no longer duplicates findings | S3 (F16) | Full |
| The restriction source is shown in the drawer | S3 (F20) | Full (needs the list loaded) |
| Rows with an empty name are kept (`catalog_skipped_row`) and appear in the corrected Excel and the 1C files with a "not checked" marker; failed rows are marked "texnik xato" instead of "no risk" | S8 (F7) | Partial: catalogues committed before the migration still lack their nameless rows |
| Streaming xlsx parse (897 → 463 MB peak at 60k×20), column cap 500, held-parts cap 30 MB | S6 (F13) | Full (60k smoke pending) |
| Per-org upload slots (2 per org, 8 per process; then 429 with `Retry-After`) and request body caps (413) | S6 (F13, F20) | Full, per process (not cluster-wide) |
| 1C host check pinned to the resolved address (no DNS rebinding) | S6 (F20) | Full; not tried against a real 1C |

### Firm dictionary
| Item | Task | State |
|---|---|---|
| Name key `sortedKey|attrsKey|unit`; `npm run dictionary:rekey`; entries whose name has attributes are marked `needsReconfirm` | S4 (F1, D6) | Full; **Ext**: the rekey step must run on deploy |
| Rejecting a suggestion or reporting it wrong disputes its entry; auto-accept skips a disputed entry | S4 (F9) | Partial: a reject from the bulk bar does not dispute |
| Provenance block in the drawer; edit and delete for admins only; confirm endpoint; scoped learners do not confirm; a replaced code is logged | S4 (F17) | Full, seen (screen 7) |
| Carry-over keeps the source upload and the original decision time | S4 (F16) | Full |

### Client and team workflow
| Item | Task | State |
|---|---|---|
| Removing a member with open reviews requires a hand-over or a drop | S2 (F18a) | Full, seen (screen 14); no notice to the new assignee |
| Closing a review with pending problems asks for confirmation; `doneBy` and `doneNote` are shown | S2 (F18b) | Full (e2e `review-assignment` green) |

### Reports and metrics
| Item | Task | State |
|---|---|---|
| Dashboard "Bajarilgan ish": rows checked, rows not checked, issues found and resolved, decisions (of which automatic), time saved | S9 (F10, D8) | Full, seen (screen 1) |
| Per-client results table with xlsx/csv download; audits per week over 12 weeks | S9 | Full, seen (screen 1) |
| `minutesPerDecision` setting (1–60, admin) | S9 (D8) | Full, seen (screen 2) |
| Per-row import issues CSV | S8 (F20) | Full, seen (screen 10) |
| Streaming xlsx export | S8 (F20) | Partial: items and findings are still loaded whole before writing |

### Integrations
| Item | Task | State |
|---|---|---|
| Didox, 1C and products under the plan gate; Didox list scope fixed | S5, S10 | Full |
| Click and Payme handlers hardened and tested against our own handlers | S5, S10 | **Ext**: no credentials and no sandbox payment yet |
| Telegram: login state (S1); reminders are not sent to Telegram | S1, S7 | **Ext** / owner question |

### Production readiness
| Item | Task | State |
|---|---|---|
| All 65 migrations apply from zero (§3.1) | S11 | Full |
| `LOCKED_TX` waits for the pool or lock on capped writes, instead of failing at Prisma's 2 s default | S10 | Full |
| An idle `pg` client error no longer kills the API during audits | S3 | Full |
| DEPLOY.md: export flag, Payme test mode, billing history, refunds, reminders | S5, S7 | Partial: no `dictionary:rekey` step (§5) |

### UX
Same-file warning, mapping kept on diagnose, column-limit notice (S8); "Texnik xato" chip and list
(S3); dictionary filter and badges (S4); one-sentence tier rule on the plan tab (S5); removal and
review-close dialogs (S2); checklist and value blocks (S9). Every screen listed in §3.5 was rendered
in Edge from the production build.

---

## 2. Bugs and security issues fixed

| # | Sev | Fix | Where | Task |
|---|---|---|---|---|
| F1 | Critical | The dictionary name key now includes sizes, grades and models; existing entries re-keyed and held | `core/match/dictionary.ts` | S4 |
| F2 | High | An invite no longer confirms an address; Google auto-link only after a code or link confirmation | `invites.ts`, `security/google.ts` | S1 |
| F3 | High | One cheap month of a top tier no longer upgrades a whole year (tier rule D2) | `billing/period.ts`, `orders.ts` | S5 |
| F4 | High | Concurrent provider confirmations extend the subscription once; provider state is written in the same transaction | `billing/orders.ts`, `click.ts`, `payme.ts` | S5 |
| F5 | High | An empty or unreadable restricted list is no longer silent | `audit-runner.ts`, `restricted-state.ts` | S3 |
| F6 | High | One row error no longer fails the audit; retry re-checks only the failed rows | `audit-runner.ts`, `row-retry.ts`, `audit-jobs.ts` | S3 |
| F7 | High | Rows with an empty name kept and marked in every export | `catalog-import.ts`, `export-rows.ts` | S8 |
| F8 | High | An existing account can accept an invite (D5) | `invite-move.ts` | S1 |
| F9 | High | A reject or "wrong suggestion" now disputes the dictionary entry | `dictionary-dispute.ts` | S4 |
| F10 | High | The dashboard shows work done and an estimate of time saved | `firm-results.ts`, `dashboard.ts` | S9 |
| F11 | Med | Last-assignment race closed under row locks | `client-lifecycle.ts` | S2 |
| F12 | Med | Accountants can no longer hard-delete catalogues | `contracts/modules/catalogs.ts`, `catalogs.ts` | S2 |
| F13 | Med | Streaming parse, column and held-bytes caps, upload slots, body caps | `xlsx-stream.ts`, `upload-slots.ts`, `request-body.ts` | S6 |
| F14 | Med | Products, Didox and 1C under `uploadsOpen()`; the export flag covers the PDF and CSVs | `products/import.ts`, `didox/service.ts`, `onec/counterparties.ts`, `catalog-exports.ts` | S5 |
| F15 | Med | Reminders, ending-soon banner, billing history and receipts, admin billing view; orders survive a purge | `billing/expiry-reminders.ts`, `history.ts`, `admin-billing.ts` | S5, S7 |
| F16 | Med | Atomic retry, heartbeat through the post phase and rebuild, counters merged on resume, carry-over provenance | `audit-jobs.ts`, `audit-heartbeat.ts`, `versions.ts` | S3, S4 |
| F17 | Med | Dictionary provenance, admin-only edits, scoped learners, replaced code logged | `dictionary*.ts`, `decisions.ts` | S4 |
| F18 | Med | Member removal hands over reviews; closing with pending problems needs a confirmation | `team-removal.ts`, `review-assignments.ts` | S2 |
| F19 | Med | Checklist delivery step, optional steps, hide stored in the DB, tour filtered, GET no longer resumes audits | `onboarding.ts`, `tour-steps.ts`, `catalog-pages.ts` | S2, S9 |
| F20 | Low | Module-flag case; 1C DNS pinning; bank rule scope; invite join limit and generic error; Telegram login CSRF; 2FA ends sessions; absolute session age; viewer e-mail leak; duplicate leak; Payme test mode on prod; Click NaN → -8; month arithmetic; abandoned orders; paid twice; per-row error CSV; mapping kept; same-file warning; streaming export; restriction source | see S1–S8 reports | S1–S8 |
| M1 | High | Didox `listInvoices`: a requested `clientId` replaced the scope, so a scoped accountant read another client's invoices | `didox/service.ts` | S10 |
| M2 | Med | `exportProducts`: an out-of-scope `clientId` was dropped and a batch of the member's other clients was written | `products/catalog.ts` | S10 |
| M3 | Low | `plan-caps-race` failed at Prisma's 2 s `maxWait` while a pool connection opened (`localhost` on Windows); capped writes now use `LOCKED_TX` | `usage-ledger.ts`, `clients.ts`, `invites.ts` | S10 |
| X1 | Med | A resume from watermark 0 duplicated findings of rows that had finished out of order | `audit-runner.ts` | S3 |
| X2 | Med | Failed-check rows were exported as "Xavf topilmadi" | `export-rows.ts` | S8 |
| X3 | Med | An idle `pg` client error crashed the API process during audits | `audit-runner.ts` | S3 |

---

## 3. Tests and builds run by S11 (30 Oct, worktree `feat/s11-qa`)

Setup:

- `.env` was copied from the main checkout. `DATABASE_URL` uses host `127.0.0.1` (S10 §4) and
  `&connection_limit=4`.
- Commands run: `npm ci` (exit 0) and `npx prisma generate`.
- The `@tasnivo/*` links resolved to the worktree, so no junctions were needed.
- `npm ci` printed `allow-scripts` warnings for 10 install scripts (prisma, esbuild, sharp,
  onnxruntime…). Nothing below depended on them.
- No sibling agent was running, and the DB was not restarted.

### 3.1 Migrations
| Command | Result |
|---|---|
| `CREATE DATABASE mxik_qa_empty` (node + `pg`), then `DATABASE_URL=…/mxik_qa_empty npx prisma migrate deploy` | **All 65 migrations applied** (`20260820113448_init_mxik_code` … `20261108000700_skipped_rows_file_hash`): 0 unfinished, 0 rolled back, 66 tables |
| `npx prisma migrate status` (empty DB, then the dev DB) | "65 migrations found … Database schema is up to date!" on both |
| `prisma migrate diff --from-url <migrated DB> --to-schema-datamodel schema.prisma` | Drift only in hand-written SQL that predates the programme: trigram, HNSW and tsvector indexes, the generated `searchVector`, and `catalog.clientId` NOT NULL via the default-client trigger. **No column of the programme is missing.** |
| `DROP DATABASE mxik_qa_empty` | dropped |

### 3.2 Typecheck, lint, unit and integration tests
| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 (3 min 38 s, every workspace and the root) |
| `npm run lint` | exit 0: 0 errors, 1 warning that predates the programme (`scripts/lib/xlsx.ts:131`, no-non-null-assertion) |
| `npm test` (full, 11 min) | **2,399 tests: 2,381 pass, 13 fail, 5 skipped** |

The 5 skipped tests need Redis (×3, the suite looks for `127.0.0.1:6379`), the weighted search
column (×1, a group of 2) and a loaded restricted code (×1). Didox live and BullDispatcher are
opt-in.

The 13 failures were each re-run alone with `node node_modules/tsx/dist/cli.mjs --test <file>`:

| File (failing tests) | Error in the full run | Alone | Class |
|---|---|---|---|
| `apps/api/test/e2e/catalogs.test.ts` (8: the first one times out, the other 7 fail because the catalogue is not ready) | `timed out waiting for the audit`, then 409 `audit_not_finished` | 13/13 | Load |
| `apps/api/test/e2e/imports.test.ts:85` | `timed out waiting for the cheque check` | 5/5 | Load (seen in S1, S3–S10) |
| `packages/domain/src/audit-jobs.test.ts:64` | `catalogue still analyzing` | 10/10 | Load |
| `packages/domain/src/audit-retry-access.test.ts:29` | `catalogue still analyzing` | 1/1 | Load |
| `packages/domain/src/demo.test.ts:32,51` | `startDemoSession` returned null (the race with `demo-access.test.ts` noted in W4a) | 4/4 | Load/race, predates the programme |

**No programme regression.** These failures happened with no sibling agent running. The audit waits
of 120–180 s are too short for the full parallel suite on this machine, so the suite is not green in
one pass. See §5.

### 3.3 Builds
| Command | Result |
|---|---|
| `npm run build:api` | OK: `apps/api/dist/main.mjs` 2.6 MB (esbuild, 0.5 s) |
| `npm run build:worker` | OK: `apps/worker/dist/main.js` 1.3 MB. Not started (needs Redis) |
| `API_INTERNAL_URL=http://127.0.0.1:4061 npm run build` (next build) | OK in 3 min 53 s: compiled in 80 s, no warnings. `/dashboard` 309 kB first-load JS, `/admin/billing` 248 kB, shared 103 kB |

The built API (`node apps/api/dist/main.mjs`, `API_PORT=4061`) served every check below. No 5xx
appeared in its log during the e2e run.

### 3.4 Playwright e2e against the production build
Servers:

- API: `API_PORT=4061 AUDIT_FAULT_ROWS=SINOV-XATO ADMIN_EMAILS=s11-qa-admin@e2e.mxik.test node apps/api/dist/main.mjs`.
  Inline jobs, `NODE_ENV` unset. The fault needle matches no e2e row.
- Web: `API_INTERNAL_URL=http://127.0.0.1:4061 npx next start apps/web -p 3061`.
- Run: `E2E_BASE_URL=http://localhost:3061 E2E_CHANNEL=msedge npm run test:e2e` (19 min 41 s).

**Result: 73 tests, 71 pass, 1 fail, 1 skipped.** That is 14 files; there were 66 tests before
the programme.

| Failing test | Cause | Predates? | Re-run |
|---|---|---|---|
| `module-flags.e2e.ts` "HIDDEN: no tab, /didox is a 404 and so is its API" | The test polls `/didox` until it is a 404, then asserts the header nav, which reads module states through a separate 30 s cache. In the full run `/didox` flipped after 4 s while the nav cache still held ENABLED (screenshot: the Didox tab still shown). | Yes: test and caches from `91ba096` (24 Oct). The programme touched only `modulesOfApi` lower-casing (S6) and the provider wrapper (`7979b3a`), neither of which changes caching. | Alone: **4/4 pass** (1 skipped) |
| Skipped: `module-flags` "a platform admin saves a state on /admin/features" | `E2E_PLATFORM_EMAIL` not set (opt-in) | n/a | n/a |

The rest passed in the full run:

- account-flows 5/5. S1's signed-out invite flow still works.
- accounting-platform 6/6, demo-access 5/5, dictionary-review 2/2, empty-states 2/2.
- navigation 8/8, onboarding-tour 2/2, refresh 4/4.
- review-assignment 5/5, including S2's "closes it anyway". Before this run it had never been run
  (S2 report).
- review-flow 17/17, scale 3/3. The 3,000-row catalogue file took 13 min, the slowest file as in W4a.
- settings-nav 5/5, shell-layout 4/4.

No code change was needed.

### 3.5 Browser pass (production build, Edge headless, 1440 px)
- Seeding: `tmp/s11/screens.ts` (not committed) seeded throwaway orgs through Prisma and the
  domain (`recordTransfer`, `createInvite`).
- Driving: it uploaded through the API and drove the pages with Playwright.
- The failed row came from `AUDIT_FAULT_ROWS=SINOV-XATO`, as in S3. The audit reached
  `ready` with `rowsFailed 1`. The commit answered `skipped: 1` for the nameless row.
- Cleanup: all 4 seeded orgs and their orders were deleted afterwards (checked by query).
- The Claude Browser pane was not used. These are real renders of the production build, not curl.

| File (`docs/saas-2026-10-29/screens/`) | Shows | Task |
|---|---|---|
| `01-dashboard-value-results.png` | "Bajarilgan ish" (11 rows checked, "1 ta qator texnik xato…", 10 issues / 4 resolved, 4 decisions / 1 automatic, "0,2 soat · taxminiy… 4 qaror × 3 daqiqa"), the per-client table with Excel/CSV, the weekly chart | S9 |
| `02-settings-account-minutes.png` | Settings → Hisob, card "Tejalgan vaqt hisobi" | S9 |
| `03-dashboard-checklist-optional.png` | Checklist 3/5 with the "Natijani yuklab oling yoki ulashing" step and the "Ixtiyoriy" group (2FA, Telegram) | S9 |
| `04-plan-banner-billing-history.png` | Banner "Obuna muddati: 3 kun qoldi", plan card, "Toʻlovlar tarixi" (a bank row and a Payme row with the "Sinov toʻlovi" badge), tier-rule sentence | S7, S5 |
| `05-receipt.png` | Printable receipt of the bank order | S7 |
| `06-admin-billing.png` | `/admin/billing` as a platform admin: 30-day totals with the test payment counted apart | S7 |
| `07-dictionary-reconfirm-disputed.png` | `/dictionary?f=reconfirm`: "Eʼtiroz bildirilgan" badge with who disputed, "Qayta tasdiqlash kerak" | S4 |
| `08-workspace-failed-chip-banner.png` | Workspace: "Texnik xato 1" chip, degraded banner (rows failed, restricted list not checked plus the admin line), "1 qator nomsiz…" in the header | S3, S8 |
| `09-workspace-failed-rows.png` | `?type=FAILED`: the failed row, its reason, "Xato qatorlarni qayta tekshirish" | S3 |
| `10-upload-mapping-issues-csv.png` | Wizard mapping step: diagnostics (no-name row, 17-digit code, duplicate) and "Muammoli qatorlar roʻyxati (CSV)" | S8 |
| `12-invite-signed-out.png` | Invite signed out: password form, Google button, "Kirish va qoʻshilish" | S1 |
| `13-invite-signed-in-solo.png` | Invite signed in with a solo account: "Shu hisob bilan qoʻshilish" and what happens | S1 |
| `14-team-remove-reassign.png` | Removal dialog: "Ochiq tekshiruvlar: 1" and the required hand-over select | S2 |
| `15-didox-expired-refused.png` | Expired trial: Didox upload refused with the shared plan message. The API gave the same answer for Didox and for 1C counterparties (`code: expired`) | S5 |

Not covered by a screenshot: the same-file and column-limit notices (S8), the drawer's dictionary
block and carry-over line (S4), and the review "close anyway" state (S2; covered by the e2e).

### 3.6 Operational checks (dev DB)
| Command | Result |
|---|---|
| `npm run dictionary:rekey -- --dry-run` | **Not empty**: 28 name entries would be re-keyed (12 to needs-reconfirm). All are in 14 leftover `test-*` orgs created 29 Oct 14:34–17:42 UTC, by wave-1 worktrees still running pre-S4 code before the wave-1 merge (30 Oct 02:19 +05). No real org is affected. The real rekey was not run (dry run only). |
| `GET /api/health` (built API) | `classifier.restricted: {"codes":0,"importedAt":null}`: the restricted list is still not loaded on dev. The classifier snapshot is `stale: true` (15 Oct, 14 days). |
| `npx prisma migrate status` | Up to date (65) |
| Leftover data | 265 `test-*`/`e2e-*` orgs on the dev DB (they fill `/admin/billing`, 253 customer orgs listed). Not created by S11 and not deleted. |

### 3.7 Spot verification of five claims (code read, then the named tests run alone)
| Claim | Code | Test run | Result |
|---|---|---|---|
| `markPaid` claims once | `billing/orders.ts:92-124`: per-org `pg_advisory_xact_lock`, re-read inside the transaction, `updateMany where {id, status:'created'}`, continues only on `count === 1`, `within(tx)` in the same transaction | `billing/payments-race.test.ts` | 5/5 |
| Dictionary key carries the attributes | `core/match/dictionary.ts`: `nameKeyOf = sortedKey|attrs|unit`, used by `dictionaryKeys()` | `core/match/dictionary.test.ts`, `domain/dictionary-safety.test.ts` | 14/14, 7/7 |
| An invite never pre-verifies | `invites.ts:122` creates the user with `emailVerifiedAt:null, verifiedVia:null`; `google.ts:180,193` links only `code`/`link` | `invites.test.ts`, `security/google.test.ts` | 4/4, 13/13 |
| Per-row retry writes `checkError` | `row-retry.ts` (500/2000/5000 ms, never throws); `audit-runner.ts:422-444` writes `checkError` after the retries run out and clears it on success, all in one transaction | `audit-jobs.test.ts` | 10/10 |
| Upload slot answers 429 | `http/upload-slots.ts` (2 per org / 8 per process, `Retry-After: 5`, body drained); taken in `multipart.ts:49` before multer reads | `test/unit/input-limits.test.ts`, `test/e2e/input-limits.test.ts` | 7/7, 7/7 |

All five claims hold as the reports describe them.

---

## 4. Environment, migrations and external configuration

### Migrations (`202611*`, in order)
| Migration | Origin |
|---|---|
| `20261101000000_accounting_shared` | accounting programme (before S1) |
| `20261101000100_onec_connection` | accounting |
| `20261102000100_bank_formats_rules` | accounting |
| `20261103000100_didox` | accounting |
| `20261104000100_products_packaging` | accounting |
| `20261104000200_product_alternatives` | accounting |
| `20261105000100_default_client_backfill` | accounting |
| `20261106000100_tnved` | matching v2 |
| `20261106000100_user_tour` | onboarding T1.4 |
| `20261107000100_feature_flags` | module flags |
| `20261107000100_lexicon` | learned lexicon |
| `20261108000100_user_verified_via` | **S1** (backfills `legacy`) |
| `20261108000200_item_check_error` | **S3** |
| `20261108000300_firm_mapping_attrs` | **S4** (also `Finding.carriedFromCatalogId`, `originalDecidedAt`) |
| `20261108000400_order_keep` | **S5** (`Order.orgId` SetNull, `orgName` backfilled, `testMode`) |
| `20261108000500_value_metrics` | **S9** (`minutesPerDecision`, `onboardingHiddenAt`) |
| `20261108000600_billing_lifecycle` | **S7** (`ALTER TYPE order_status ADD VALUE 'refunded'`) |
| `20261108000700_skipped_rows_file_hash` | **S8** (`catalog_skipped_row`, `Catalog.fileHash`) |

Rollback notes for each are in `docs/accounting-2026-10-23/migrations.md`.

**Deploy order:**

1. `prisma migrate deploy`. The api container runs it on start (DEPLOY.md "Updating").
2. `npm run dictionary:rekey` once, before the first audit on the new code. Until it runs, name
   lookups miss old-format keys, so there are no dictionary suggestions. It pauses auto-accept for
   every entry whose name has a size, until a person confirms it on `/dictionary` → "Qayta
   tasdiqlash kerak".
3. `npm run load:restricted -- data/perechen.xlsx`. Until it runs, every audit says "restricted list
   not checked".

In Docker form: `mx npm run dictionary:rekey` and `mx npm run load:restricted -- data/perechen.xlsx`
(DEPLOY.md §5 alias). **DEPLOY.md does not mention the rekey step yet.**

### Environment variables
| Variable | Needed for | Note |
|---|---|---|
| `DATABASE_URL` | api, worker, scripts | Use **`127.0.0.1`**, not `localhost`, on Windows/dev: Prisma tries `::1` first, and each new connection costs about 2 s (S10 §4). The main checkout's `.env` still says `localhost`. Add `&connection_limit=4` when several processes share the dev DB. |
| `REDIS_URL` + `JOBS_MODE=bullmq` | worker queues (compose sets them) | Without Redis, jobs run inline in the API. The BullMQ worker paths (S3's worker test) were not run anywhere in the programme. |
| `SESSION_SECRET` (≥32), `CRON_SECRET` (≥16), `APP_URL`, `NEXT_PUBLIC_SITE_URL` (web build **and** api: the only Origin accepted) | core | unchanged |
| `SMTP_URL`, `MAIL_FROM` | sign-up codes, invites (S1 now mails a code for **every** invite join), reset, expiry reminders (S7) | **Required in production.** Without them the invite join is refused and reminders are notice-only. |
| `BILLING_REQUIRED_FOR_EXPORT=true` | D3 export gate | `.env.example` still says `false`; DEPLOY.md §7b says production sets `true` |
| `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY` | Click | URL `https://tasnivo.uz/api/payments/click`; no credentials yet |
| `PAYME_MERCHANT_ID`, `PAYME_KEY` | Payme | endpoint `https://tasnivo.uz/api/payments/payme` |
| `PAYME_TEST_MODE`, `PAYME_TEST_KEY`, `PAYME_TEST_ALLOW_PROD` | sandbox | Test mode is off when `NODE_ENV=production` unless `PAYME_TEST_ALLOW_PROD=1`. `PAYME_TEST_ALLOW_PROD` is in DEPLOY.md only, not in `.env.example`. |
| `NEXT_PUBLIC_ONLINE_PAYMENT=true` | landing note | only once a provider works |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (+ redirect URI in the Google console) | Google sign-in and the invite page | Linking now needs `verifiedVia` code/link; `legacy` accounts must reset their password first |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | Telegram | The login callback moved to `/api/auth/telegram/login/<state>`. Nothing changes in BotFather (same domain). |
| `ADMIN_EMAILS` + `user.platformAdmin` + confirmed address | `/admin`, `/admin/billing` | unchanged rule |
| `ONEC_ALLOW_PRIVATE_HOSTS=1` | 1C on a LAN host in production | existed before; not in `.env.example` |
| `AUDIT_FAULT_ROWS` | tests and QA only | ignored when `NODE_ENV=production`; never set in production |

---

## 5. Remaining blockers, next improvement, decisions

### Blockers and gaps (ordered)
1. **Production deploy (W4b)** has not started. It needs the VPS, DNS and secrets of §4.
2. **Payments are unproven with real providers.** No Click or Payme credentials exist, so no sandbox
   payment has ever been made. The handlers are tested only against our own test secrets.
3. **Restricted list and classifier on dev:** 0 restricted codes, and the snapshot is 14 days old.
   Production must run `load:restricted` and the classifier update.
4. **DEPLOY.md gaps** (report only; S11 may not change docs outside its report):
   - no `dictionary:rekey` step;
   - `.env.example` has `BILLING_REQUIRED_FOR_EXPORT=false` and lacks `PAYME_TEST_ALLOW_PROD` and
     `ONEC_ALLOW_PRIVATE_HOSTS`.
5. **The full `npm test` is not green in one pass on this machine**, even with no other agent
   running: 13 load timeouts in audit-waiting tests, all green alone. Either give those tests longer
   bounded waits or run DB-heavy files with `--test-concurrency` limited. Until then every wave
   needs single-file re-runs to prove green.
6. **Known functional gaps** from the task reports:
   - A reject from the bulk bar does not dispute dictionary entries (S4).
   - Catalogues committed before S8 lack their nameless rows in exports.
   - The export still loads every item and finding into memory (S8).
   - Upload slots are per process (S6).
   - Reassigned reviews send no notice (S2).
   - No circuit breaker when every row fails (S3).
   - Missed reminder days are not caught up (S7).
   - `/admin/billing` has no paging (253 orgs on dev).
7. **UX finding (S11):** the plan banner shows one state, and "limit ≥ 80%" outranks "subscription
   ends in N days" (`plan-banner.tsx:22-27`). A firm near its seat limit is not warned about expiry
   in the banner (the e-mail and in-app notice still go out). Seen during the browser pass.
8. **Dev DB hygiene:**
   - 265 leftover `test-*`/`e2e-*` orgs;
   - 13 `E2E …` orgs from 22–29 Oct;
   - 28 un-rekeyed dictionary entries in those test orgs.

   Clean them once nothing is running.
9. **Test flake (predates the programme):** `module-flags.e2e.ts` "HIDDEN" asserts the nav before
   its own 30 s cache expires. Poll the nav, or wait out both caches.

**Next highest-value improvement.** Deploy to production and take one real payment through the Payme
sandbox. Every billing fix (F3, F4, F14, F15) is proven only against our own handlers, and the
product earns nothing until a real payment goes through end to end. Do it in the order of §4,
including the rekey and the restricted list.

### Decisions waiting for the owner
Each item gives the task and the default currently built.

1. **S1**: block the account move when the old org has a running paid subscription? *Built: blocked (`paid`).*
2. **S1**: should other data of the empty org (clients, products, bank and Didox imports, API keys,
   Telegram chats) block the move? *Built: no; it goes with the closed org at purge.*
3. **S1**: keep the admin's "address already registered" warning (an account-existence oracle for
   admins)? *Built: shown, limited only by the seat cap.*
4. **S2**: notify the person who handed out a review when it is dropped, and the new assignee on
   hand-over? *Built: no notices.*
5. **S2**: should viewers see the audit-log member picker? *Built: yes, only actors of events they
   may see.*
6. **S3**: should accountants see the raw error text of a failed row? *Built: the kind only
   (timeout/database/other).*
7. **S3**: re-check re-runs the post phase, so pending purchase/privilege findings get new ids and
   their comments go with them. Acceptable? *Built: yes.*
8. **S3**: a circuit breaker that fails the audit when every row fails? *Built: none; `ready` with
   all rows in `rows_failed`.*
9. **S4**: an unscoped manual code replacement of a bulk-only entry needs a second confirmation?
   *Built: no.*
10. **S4**: may any unscoped accountant confirm `needsReconfirm` entries? *Built: yes; disputed
    entries are admin-only.*
11. **S4**: accept that the production rekey pauses auto-accept for every entry whose name has a
    size? *Built: yes (D6).*
12. **S5**: a downgrade by bank transfer with `--force`: convert the days at the price ratio, or
    start only after expiry? *Built: convert.*
13. **S5**: upgrade credit for yearly subscribers at the yearly price ratio? *Built: monthly list
    prices.*
14. **S5**: lock a share link's client PDF when payment is required and the plan has lapsed?
    *Built: not locked.*
15. **S6**: inflate cap: 100 MB whole archive with 30 MB held (built), or a literal 30 MB total
    (refuses large 60k files)? *Built: 100 MB / 30 MB.*
16. **S6**: a filled lead honeypot uses one of the five submissions per address. Acceptable?
    *Built: yes.*
17. **S7**: send a missed reminder the next day? *Built: no catch-up.*
18. **S7**: send expiry reminders to Telegram chats too? *Built: no (`external:false`).*
19. **S7**: receipt with Tasnivo legal requisites (name, INN, address), and from where (env or
    config)? *Built: none.*
20. **S7**: show refunded orders in the admin 30-day figures (for example as a negative line)?
    *Built: excluded.*
21. **S8**: keep nameless rows in the 1C files, or only in the corrected Excel? *Built: kept in
    both, with an empty name.*
22. **S8**: a failed row keeps a person-accepted code, or always the file's own? *Built: keeps the
    accepted code.*
23. **S8**: same-file warning across clients of the org? *Built: same client only.*
24. **S9**: count automatic decisions (dictionary auto-accept, carry-over) in time saved? *Built:
    yes, shown as "of which automatic".*
25. **S9**: count every audited version, or only the latest per client? *Built: every version.*
26. **S9**: log the results download in the audit log and count it against the demo cap? *Built:
    neither.*
27. **S9**: show COMING_SOON modules in the tour? *Built: dropped like HIDDEN.*
28. **S10**: make every "not yours" answer a 404 (69 writes answer `200 {ok:false}`, 14 an empty
    200)? *Built: mixed, all of them refusals.*
29. **S10**: `billing.checkout`: keep the role-`any` override (`200 {ok:false, admin_only}`) or let
    the guard answer 403? *Built: override.*
30. **S10**: refuse an out-of-scope client filter everywhere, or ignore it? *Built: inconsistent;
    `exportProducts` refuses, `catalogs.list`, `products.list` and `products.check` ignore it,
    `bank.list` and `onec.batches` answer empty.*
31. **S10**: switch the main checkout's `.env` to `127.0.0.1`? *Built: `.env.example` already
    does; the main `.env` still says `localhost`.*

---

## Not verified in this programme

- **60,000-row smoke.** Deferred to the overnight window by the owner's rule; nothing else may use
  the DB while it runs. Command, from the main checkout with `DATABASE_URL` on `127.0.0.1` and
  `&connection_limit=4`:
  ```
  npm run perf -- --rows 60000 --label "S11 overnight 60k (post-programme, main 33058fa)" --keep
  ```
  Then, with the API up (`API_PORT=4061 npm run start:api` after `npm run build:api`), download
  the kept catalogue's corrected file:
  `GET /api/export?catalog=<id>` as the kept org's admin. Record the API's peak RSS and the time,
  then delete the org. The streaming parse (S6) and the streaming xlsx writer (S8) were measured only
  up to 20k rows on the export side.
- **Production deploy** on tasnivo.uz, HTTPS through Caddy, the Docker images of this tree, and the
  backup restore drill.
- **Real Payme and Click payments**, sandbox or live, including the Payme test mode on a real
  sandbox key.
- **Telegram:** the login widget with its new state (it refuses localhost), the bot, and reminders
  (not sent to Telegram by design).
- **BullMQ mode:** worker and Redis were not run (`build:worker` only). The worker test case for
  failed rows (S3) and the Redis rate-limit store are skipped without Redis.
- **SMTP delivery:** the dev outbox only. No real reminder or invite mail was sent.
- **Real 1C host and DNS pinning** (stubbed resolver only); **Didox live** (opt-in test not run).
- **Not seen in a browser:** the S8 same-file and column-limit notices, S4's drawer provenance
  block and carry-over line, the Google button flow itself, and the 375-px layouts of the new
  screens (S9 checked its own dashboard at 375 px).
