# S12 — ops docs, plan banner, /admin/billing paging (30 Oct 2026)

Branch `feat/s12-ops-docs`, cut from `main` at `db755db`. It closes FINAL_REPORT §5 gaps 4 (DEPLOY.md
and `.env.example`), 6 (`/admin/billing` has no paging) and 7 (plan banner shows one state). Nothing
was pushed or merged. `main` has since moved to `e007b2a` (the landing T2.4 merge); this branch does
not touch those files.

## What changed

| File | Change |
|---|---|
| `DEPLOY.md` | §3: a row for `BILLING_REQUIRED_FOR_EXPORT` (`true` in production), and a paragraph on `PAYME_TEST_ALLOW_PROD` and `ONEC_ALLOW_PRIVATE_HOSTS`, both off by default. §5 (fresh server): `mx npm run load:restricted -- data/perechen.xlsx` is in the order list. §8 "Updating to a new version": `mx npx prisma migrate deploy` and `mx npm run dictionary:rekey` come before `up -d`. A numbered "Order for this release" gives three steps, in both npm and `mx` forms: migrate deploy, then `dictionary:rekey` before the first audit (with the reason and the `/dictionary` → "Qayta tasdiqlash kerak" note), then `load:restricted`. |
| `.env.example` | `# PAYME_TEST_ALLOW_PROD=1` (Payments) and `# ONEC_ALLOW_PRIVATE_HOSTS=1` (api section). Both are commented out, with a meaning and an "unset (default)" line each. `BILLING_REQUIRED_FOR_EXPORT=false` stays; its comment now says that `false` is for local development and that production sets `true` (DEPLOY.md 7b). |
| `apps/web/src/ui/shell/plan-banner-lines.ts` (new) | Pure `bannerLines(plan)` → `{ tone, lines[] }` or null. The limit line (expired, then full, then warn) comes first and sets the tone. "Trial ends in N days" or "subscription ends in N days" (≤ 7 days) is then appended in every state except `expired`. `joinSentences` joins the phrases into sentences. |
| `apps/web/src/ui/shell/plan-banner-lines.test.ts` (new) | 6 node:test cases: hidden, expiry alone, warn + expiry, full + expiry (danger), expired alone, sentence joining. |
| `apps/web/src/ui/shell/plan-banner.tsx` | Renders `bannerLines` as one strip with the same tokens. Example: "Chegaraga yaqinlashdingiz: foydalanuvchilar. Obuna muddati: 3 kun qoldi". No new i18n strings; it reuses `ta.plan.*` and `ta.setX.plan.endingSoon`. |
| `packages/contracts/src/modules/admin.ts` | `admin.billing` (same operation) gains an optional query: `page` (1-based, 1–10000) and `pageSize` (1–200, default 50). Its response gains `total`, `page`, `pageSize` and `pageCount`. The summary says the 30-day figures cover all orgs. |
| `packages/domain/src/billing/admin-billing.ts` | `billingOverview({ page, pageSize, now })`. Paging arithmetic is in a pure `pageWindow()`, which clamps a page past the end to the last page. The org count and the 30-day totals (`order.groupBy testMode` over every customer org: paid, `paidAt ≥ now−30d`) are platform-wide. Orgs (newest first) and their orders are read for the current page only. |
| `packages/domain/src/billing/admin-billing.test.ts` (new) | `pageWindow` unit tests (4 cases). |
| `apps/api/src/admin/admin.controller.ts` | Passes the validated query through. |
| `apps/web/src/app/(app)/admin/billing/page.tsx` | Reads `?page=`. The "Mijoz tashkilotlari" stat shows `total`, not the length of the page. Below the table: "51–100 / 271" with "Oldingi sahifa" / "Keyingi sahifa" links (`ButtonLink size="sm"`). The metadata and the page share one cached call per page. |
| `packages/i18n/src/i18n-parts/settings.ts` | `adminBilling.pages`, `range`, `prev` and `next` in uz and ru. |
| `apps/api/test/e2e/admin-billing.test.ts` | New case. It checks the default page (page 1, size 50, `pageCount`). It checks that `?pageSize=1&page=10000` answers the last page: one org, not the test's customer, while `last30` still holds the customer's payments. It checks that `page=0`, `page=abc`, `pageSize=0` and `pageSize=201` answer 400. |
| `docs/saas-2026-10-29/screens/16-plan-banner-both.png`, `17-admin-billing-paged.png` | Screenshots (below). |

**Registry:** no operation was added. `npx tsx packages/contracts/src/checklist.ts --write` changed
nothing but line endings, so I reverted it. The counts in `routes.test.ts` and `workspace-docs.test.ts`
are unchanged, and both files pass.

**API env schema:** `apps/api/src/config/env.ts` validates only what the API itself reads. Its header
says anything only a domain service reads stays with that service. The two flags are read only in
`packages/domain` (`billing/config.ts`, `onec/host-guard.ts`), so I did not add them to the schema.

## Tests run (real results, this worktree)

| Command | Result |
|---|---|
| `npm run typecheck` (all workspaces + root) | exit 0 |
| `npx eslint` on every changed path | exit 0 |
| `npm run lint` (full, >10 min) | exit 0; 0 errors, 1 warning, pre-existing and not in a file I touched: `scripts/lib/xlsx.ts:131` no-non-null-assertion |
| `tsx --test apps/web/src/ui/shell/plan-banner-lines.test.ts` | 6/6 pass |
| `tsx --test packages/domain/src/billing/admin-billing.test.ts` | 4/4 pass |
| `tsx --test apps/api/test/e2e/admin-billing.test.ts` (alone, after the change) | 3/3 pass |
| `tsx --test` admin-billing + admin-lexicon + admin e2e (api admin tests) | 10/10 pass, 142 s |
| `tsx --test` every `apps/web/src/**/*.test.ts` (web unit tests) | 199/199 pass |
| `tsx --test apps/api/test/unit/routes.test.ts apps/api/test/e2e/workspace-docs.test.ts` | 7/7 pass |
| `tsx --test` packages/contracts + packages/i18n tests + `tests/web-parity/*` | 115/115 pass |

I did not run the whole `npm test`, because three sibling agents shared the DB.

## Screenshots

Taken in Edge headless (Playwright `channel: 'msedge'`, 1440 px, deviceScaleFactor 1, uz). Servers:
`next dev` on 3072 against the API from source (`tsx apps/api/src/main.ts`, `API_PORT=4072`,
`ADMIN_EMAILS` set to the seeded admin). Seeding and driving were done by `tmp/s12/shots.ts`
(not committed).

| File | Shows | Size |
|---|---|---|
| `16-plan-banner-both.png` | `/dashboard` of a throwaway firm on the accountant tier: 4 of 5 seats used (80 %) and a subscription ending in 3 days. Banner: "Chegaraga yaqinlashdingiz: foydalanuvchilar. Obuna muddati: 3 kun qoldi", warn tone | 113 KB, 1440×900 |
| `17-admin-billing-paged.png` | `/admin/billing?page=2` as a platform admin. Platform-wide stats (271 orgs, 136 paid in 30 days), rows 51–100, and the pager "51–100 / 271" with both links. The app frame scrolls inside its own container, so the viewport was grown to the content height for one full view | 121 KB, 1440×2774 |

Cleanup: both seeded orgs, their users, sessions and orders were deleted. A query afterwards found
0 orgs and 0 `s12-` users. The two dev servers were stopped.

The org count rose from 253 to 271 between my two runs. Sibling agents' tests were creating orgs at
the time, which is why the stat says 271.

## Not done / caveats
- The first screenshot attempt got a 500 from `/api/admin/billing`. The cause was a Prisma error in
  `isPlatformAdmin` (the admin guard, before my code runs), after 23 s, while `/api/dashboard` and
  `/api/billing/plan` failed the same way. That points to pool/DB contention under `connection_limit=4`
  with sibling test runs, not to the paging. The retry a few minutes later answered 200 in 6 s.
- The screenshots come from `next dev`, not a production build. A build beside running dev servers
  is disallowed on a shared checkout, and the change is server-rendered markup only.
- A page number past the end is clamped by the API and rendered as the last page. The URL keeps the
  number typed; there is no redirect, unlike `/notifications`.
- `pageSize` is open to any platform admin (max 200). The web page never sends it; it exists for the
  test and for scripts.

## Open questions for the owner
1. On a firm that is both full on a limit and near expiry, the strip stays danger red with the expiry
   sentence appended. Should expiry ≤ 1 day also make the tone danger on its own? *Built: no; the
   expiry alone stays warn, as before.*
2. Should `/admin/billing` get a search or filter by state (trial/expired/firm) next? With 50 per page,
   finding one org by name means paging. *Not built.*
