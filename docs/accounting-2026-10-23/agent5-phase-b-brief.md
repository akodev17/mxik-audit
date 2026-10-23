# Agent 5 Phase B: platform fix session brief

You fix the platform bugs Agent 5 found in Phase A. Read first: `docs/TASNIVO_AI_PLAN_2026-10-23.md`
§2 (ground rules) and §6 (ownership), `docs/BUGFIX_PLAN_2026-10-23.md` §3, then
`docs/accounting-2026-10-23/bugs.md` (the list, with steps, root causes, proposed fixes and
regression tests per item) and `docs/accounting-2026-10-23/agent5/probes/README.md` (the scripts that
reproduced each bug; re-run them against your ports after each fix).

## Setup

- Your worktree is cut from `fix/platform-quality` (Agent 5's branch). Rename your branch to
  `fix/platform-quality-fixes` in your first commit (`git branch -m fix/platform-quality-fixes`).
- `cp ../../../.env .env`, append `&connection_limit=4` to `DATABASE_URL`, `npm ci`,
  `npx prisma generate --schema packages/db/prisma/schema.prisma`.
- Ports **API 4026, web 3026**. Add `tasnivo-api-4026`, `tasnivo-web-3026` and
  `tasnivo-web-3026-prod` to `.claude/launch.json` like the 4025/3025 entries, and start them with the
  preview tool. **A production web build bakes the `/api` proxy target at build time**: run
  `API_INTERNAL_URL=http://localhost:4026 npm run build` before `next start` (Q18), or you test someone
  else's API on :4000.
- Shared Postgres; migrations additive only, prefix `202611050*`, `npx prisma migrate deploy` only.
- Seed user `buxgalter@demo.uz` / `demo12345`; verification codes in `tmp/outbox/` of your worktree.

## Ownership

You fix platform areas only: auth, sessions, verification, trial and quota, upload wizard,
workspace, catalogues, clients, team, settings, billing, notifications, i18n, e2e, public API,
`apps/api` bootstrap and http layer, docs. Do **not** edit `packages/domain/src/{onec,bank,didox,products}/**`,
`apps/api/src/{onec,bank,didox,products}/**`, their web pages, their contract modules or i18n parts,
`packages/core/src/match/**`, `packages/core/src/audit/**` (Agent 4). A defect there goes into
`docs/accounting-2026-10-23/handoff-agent5.md`. Q1 can be fixed without touching `packages/core`
(the shared embedder is installed through `useEmbedderSource` in `packages/domain/src/audit-runner.ts`
from the API, as `apps/worker/src/services/audit-context.service.ts` does).

## Work, in this order

1. **Q1 (S1)**: shared embedder in the API process + a per-process cap on concurrent `/api/v1/check`
   runs; re-run `p10-mem.mjs` and then `p9-checkrace.mjs` (40 parallel) and record memory and
   statuses. The API must stay up.
2. **Q2 = FAIL-1**: rotate `sid` after code confirmation via `openSession`/`finish`.
3. **Q4, Q5** (S2), then **Q6** (reserve check allowance atomically; re-run `p15-checkcap.mjs`: total ≤ 500).
4. **Q3 = FAIL-2**: same answer for new and registered addresses; document it in DEPLOY.md 7c.
5. **Q11 = FAIL-3**: `docs/accounting-2026-10-23/migrations.md` with the rollback SQL for every
   migration since `20261027100000` (`email_code_google`, `usage_ledger`, `notification_text`,
   `accounting_shared`), the `_prisma_migrations` rows to delete, and what breaks. Leave a section
   per workstream (`202611010*`…`202611050*`) for the migrations that land later; Agent 5 fills them in Phase C.
6. **Q13 = FAIL-4**, then the S3 items marked "fix now": Q9, Q12, Q14, Q16, Q17 (formFile + 3 wrong
   file names only), Q18, Q7's build check. Skip the items marked "defer".

Each fix: a regression test that fails before and passes after (unit, API e2e in `apps/api/test`, or
web e2e), and the reproduction re-run against your ports (probe script or in-app browser) with the
result written down. One commit per bug, message naming the Q number.

## Done means

- `npm run typecheck`, `npm run lint`, `npm test` green; `npm run test:e2e` on a production build of
  your branch (`E2E_BASE_URL=http://localhost:3026 E2E_CHANNEL=msedge`) green, with any failure attributed.
- `docs/accounting-2026-10-23/agent5-fixes-result.md`: branch, commits, per Q item fixed / not fixed,
  test names, reproduction before/after, what the owner must provide (Q7 legal text), open items.
- Never push; never touch `main` or `integration/tasnivo-2026-10`; do not merge other branches.
