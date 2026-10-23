# Architecture review, 23 Oct 2026 (Agent 4, Phase A)

Branch `claude/agent4-integration-d41667`, cut from `f11abc4`. Scope: the cross-cutting layers after
the monolith split: `apps/api/src/auth-core/`, `apps/api/src/http/`, `packages/contracts`
(endpoint definitions and registry), `@tasnivo/api-client` and how `apps/web` uses it,
`packages/domain/src/security/`, `plan.ts`, `catalog-upload.ts`, `catalogs.ts`, `signup.ts`, and
the job dispatch. Every finding was reproduced against the API on port 4014, or read in the code at the
cited line, and checked against the 166 registry entries (dumped with `allEndpoints()`).

## 0. Fixed on this branch (one commit each, all tested)

| # | Commit | Defect | Test |
|---|---|---|---|
| F1 | `5daaf96` | Body-parser and raw-body throw `http-errors` objects, which are not Nest `HttpException`s. A JSON body over the limit (and a 415 charset or 400 encoding error) was answered **500 `server_error`**, with a stack trace logged on every request. Reproduced: a 2 MB `POST /api/auth/sign-in` → 500. `apps/api/src/http/exception.filter.ts` `toErrorResponse`. | `http.test.ts` "keeps the status of body-parser's client errors"; live: 413 |
| F2 | `976a17a` | **Body limit 100 KB (the body-parser default) is smaller than the contract allows.** `BulkTarget.ids` allows up to 20 000 ids and `decideGroup.findingIds` up to 5 000 (`packages/contracts/src/modules/workspace.ts:116,213`). The grid sends the checked ids (`workspace.tsx:335`, `use-decisions.ts:159`), so selecting more than ~3 500 rows failed with the 500 above. Before the split, server actions accepted 1 MB. Now `BODY_LIMIT = '1mb'` for JSON and urlencoded bodies (`apps/api/src/app.ts`). | `http-wiring.test.ts` "request bodies" (fails on 100 KB) |
| F3 | `870b0ac` | **Secret tokens in the logs.** The request log, and the 500 log line, wrote the full path, so `/api/auth/password/reset/{token}`, `/api/auth/verify/{token}`, `/api/invites/{token}[/join]`, `/api/demo/links/{token}`, `/api/share/{token}[/pdf]` and `/api/auth/telegram/bind/{state}` put usable reset, invite and share secrets in the log. Paths whose registry entry has a `{token}`/`{state}` parameter are now logged as the template. `apps/api/src/http/middleware.ts` `loggablePath`. | `http.test.ts` "never logs a secret path segment"; live log line `GET /api/auth/password/reset/{token} 200` |
| F4 | `0d7e067` | **i18n gap: generic refusals in English.** `apps/web/src/lib/api/refusal.ts:11` shows the API's message to the user for any 4xx except `invalid_*`. 401 "Sign in to continue." (`session.guard.ts:18`), 404 "Not found." (`http/payload.ts:5`, `workspace.controller.ts:36`, `reminders.controller.ts:27`), "Client not found." (`clients.service.ts:43,105`), "Catalogue not found." (`billing.service.ts:23`), 413 and CSRF texts all reached Uzbek and Russian users in English. The filter now words these in the `mxik_locale` language from a new i18n area, `httpX` (`packages/i18n/src/i18n-parts/http.ts`, uz and ru). Messages the thrower already worded are unchanged, and `/api/v1` stays English. | `http.test.ts` "generic refusals … in the request's language"; `e2e/auth.test.ts:47` |
| F5 | `1c35074` | **No registry-wide check of guard wiring.** `routes.test.ts` covers auth, account and team only. The new `apps/api/test/unit/http-wiring.test.ts` walks every controller in the real `AppModule` and fails when an entry has no handler or two, or a handler is not declared from the registry. It also fails when a session route lacks `SessionGuard`→`AccessGuard` (the three manual-session routes are listed by name), when an apiKey, cron or platform-admin route lacks its guard, or when `@SkipCsrf()` disagrees with the entry's `csrf` flag. Today all 165 served entries (all 166 except `health.get`) pass. This is the safety net for Agent 1's guard change. | itself; checked by removing one manual route from the list (fails) |
| F6 | `bb1aaeb` | **Sent mail kept in Redis.** The `mail` queue kept the last 1 000 completed jobs, and failed ones for 7 days, each with the full text: reset and confirmation links, and soon sign-up codes (`packages/domain/src/jobs/queues.ts:52`). Now completed jobs are removed and failed ones are kept for 1 day. | `dispatcher.test.ts` "keeps no sent mail in Redis" |
| — | docs commit | `apps/api/README.md`: a duplicated intro paragraph left over from the split was removed, and F1–F5 are documented under "Errors". | — |

Shared notes for the other sessions: `side-session-notes/…/agent4-notes-for-agents.md`. Agent 1
was messaged directly about items A1 and A2 below.

## 1. Cross-cutting defects and risks (not fixed here)

Severity: **H** = breaks a workstream's acceptance or security; **M** = real defect, limited
impact; **L** = hygiene.

### Authorization

| Sev | Where | Finding | Proposed fix / owner |
|---|---|---|---|
| **H** | `packages/db/prisma/seed.ts:128`, `packages/domain/src/demo.ts:44`, `packages/domain/src/invites.ts:100` | Three paths create users with `emailVerifiedAt = null`: the seed user `buxgalter@demo.uz` (everyone's e2e and Agent 2's walk-through), every demo-org user, and a user who joins through a link invite with no bound e-mail. Once Agent 1 makes `SessionGuard`/`AccessGuard` refuse unverified users, all three are locked out. Existing production rows need the same decision. | **Agent 1**: set it in the seed; exempt demo orgs or set it at creation; send a code to link-invite joiners or treat them as verified; grandfather existing rows in the migration (backfill `emailVerifiedAt = createdAt` where null, once). |
| **H** | `apps/api/src/http/route.ts:104`, `account.controller.ts:104,111`, `auth.controller.ts:208` | `Route(e, { session: 'manual' })` skips `SessionGuard` and `AccessGuard`. `account.closedStatus`, `account.reopen` and `auth.telegramBind` read the session themselves (`telegramBind` through `sessions.currentUser`). A verification check placed only in `SessionGuard` misses them. `account.reopen` is `role: 'admin'` in the registry, but `AccessGuard` never runs for it; the domain re-checks `role: 'admin'` (`account-security.ts:123`), so this is correct today, though only by convention. | **Agent 1**: put the verified check in `SessionService.currentUser` (or a helper the manual routes call). F5 now lists the three routes and fails on a fourth. |
| M | `apps/api/src/auth-core/access.guard.ts:28,33` | A demo-org refusal (`403 demo`) shows the "not enough rights" text (`ta.firmX.errors.forbidden`), not "not available in the demo". | Agent 2 (copy) or Agent 4 later; low risk. |
| L | `README.md` "billing/" row vs `contracts/modules/billing.ts` | The README says checkout answers a non-admin `{ ok: false }`, but the registry gives `role: 'admin'`, so it is a 403 now. The web's `orRefused` handles both. | docs only. |
| L | Read endpoints with `role: any` | Scoping is done in the domain (`catalogScope`, `canSeeClient`, `teamOverview` returns empty lists for non-admins). Spot checks of `catalogs.*`, `imports.*` and `team.list` found no gap; `packages/domain/src/backend.authz.test.ts` covers most of them. | none |

### CSRF

The model is sound: a global `CsrfGuard` requires `X-Requested-With: tasnivo` on every non-GET
first-party request, plus the `Origin` check when `NEXT_PUBLIC_SITE_URL` is set. `needsCsrf()` exempts
only apiKey, cron, providerSignature and shareToken entries, and `Route()` adds `@SkipCsrf()` exactly for
those. F5 now checks this per entry.

| Sev | Where | Finding | Proposed fix / owner |
|---|---|---|---|
| M | `packages/domain/src/catalog-pages.ts:81,104` (`GET /api/catalogs/{id}/progress`, `GET /api/catalogs/{id}`) | GET handlers with side effects: they resume stalled audits (`resumeStaleAudits`). With a `SameSite=Lax` cookie, a cross-site top-level navigation triggers it. The impact is small (it restarts an audit that should run anyway), but GET is assumed safe everywhere else. | Later: move the resume to the worker's scheduler or a POST. Not urgent. |
| L | `packages/domain/src/share.ts:68` (`GET /api/share/{token}`) | Each GET increments `views`, so prefetchers and link unfurlers inflate the count. | Product decision. |
| note | upcoming `GET /api/auth/google/callback` | Like `auth.telegramLogin`, a GET callback has no CSRF header. It must bind `state` and the PKCE verifier to the browser (sealed in the session cookie), compare with `safeEqualText`, and be single-use, or it is a login-CSRF. | **Agent 1**; **Agent 5** to verify. |

### Rate limiting

| Sev | Where | Finding | Proposed fix / owner |
|---|---|---|---|
| M | `apps/api/src/http/request.ts:43` with `packages/domain/src/security/client-ip.ts` | The per-address limits trust `X-Real-IP`, and otherwise the rightmost `X-Forwarded-For` hop. That is safe only behind Caddy, which overwrites both (`infra/routes.caddy`); compose binds the API to loopback (`docker-compose.yml:177-179`). Any deployment that exposes `:4000` directly, or puts the API on another origin (`NEXT_PUBLIC_API_URL`), lets a client choose its own address and bypass `signInIp`, `signupIp`, `resendIp`, `demo*` and `leadIp`. | Document it in DEPLOY.md, or add a `TRUST_PROXY` setting that makes the API ignore these headers when it is unset. Agent 4 later. |
| M | `apps/api/src/auth-core/auth-core.module.ts:20-21` | `AuthCoreModule` provides an in-memory `RATE_LIMIT_STORE` and an `ApiKeyGuard` that nothing uses: `PublicApiModule` provides its own Redis-backed store (`redis-rate-limit.store.ts:80`), because a guard resolves its dependencies in the controller's module. If a second module ever uses `ApiKeyGuard` without that provider, it silently gets the per-process window. | Remove the defaults from `AuthCoreModule` (or export `rateLimitStoreProvider` from it). After merge, to avoid touching `auth-core` while Agent 1 works there. |
| L | `GET /api/codes/search`, `POST /api/catalogs/preview`, the PDF exports | No per-user throttle on the most expensive first-party calls (vector search, 20 MB parse, PDF render). Plan gates cap volume per month, not per minute. | Later: one `hit()` rule per user. |
| ok | `packages/domain/src/security/rate-limit.ts` | DB-backed limits record the row before counting, so parallel attempts cannot pass the limit. Agent 1's code-attempt and resend limits should reuse `RULES` and `hit()`. | — |

### Error handling and leakage

| Sev | Where | Finding | Proposed fix / owner |
|---|---|---|---|
| fixed | F1, F3, F4 | See §0. | — |
| L | `apps/api/src/http/zod-validation.pipe.ts` | A 400 answers the zod `issues` (paths and messages of the request's own fields). That is fine for first-party use; the web never shows `invalid_*` codes. | none |
| L | Nest's own 404 (`Cannot GET /api/nope`) | It echoes the path, now localized by F4 (code `not_found`). | none |

### Job dispatch (inline vs BullMQ)

`jobs()` (`packages/domain/src/jobs/dispatcher.ts`) defaults to `inline`; compose sets
`JOBS_MODE: bullmq` (`docker-compose.yml:39`), so development and production take different paths.

| Sev | Where | Finding | Proposed fix / owner |
|---|---|---|---|
| **H** (for A1) | `packages/domain/src/jobs/inline.ts:37-38` and `apps/worker/src/processors/delivery.processors.ts` | In bullmq mode the **worker** sends mail. A dev fallback that writes the code to the API log and `tmp/outbox/` must live in `deliverMail` (`mailer.ts:14`), or in production-like runs the code ends up in the worker's log. In inline mode, sign-up waits for SMTP inside the request, and `sendMail` swallows a failure (`mailer.ts:23-29`): the user is told "check your e-mail" when nothing was sent. | **Agent 1**. |
| M | `packages/domain/src/jobs/queues.ts:53` (telegram) | Telegram notification jobs are kept like mail was (1 000 completed). They carry ids, not secrets, so this is lower risk. | none |
| L | audits inline | In inline mode a restart loses running audits until a progress GET resumes them (see CSRF/GET above). | Use bullmq in any shared environment. |

### i18n

| Sev | Where | Finding | Proposed fix / owner |
|---|---|---|---|
| fixed | F4 | Generic API refusals. | — |
| M | `packages/domain/src/catalogs.ts` and `Finding.reason` | Known from the handoff: `Finding.reason` is stored in Uzbek only. | Product backlog. |
| note | `packages/i18n/src/i18n-parts/index.ts` | Every new area adds two spread lines; `partsRu: typeof partsUz` enforces uz/ru parity at type level, so a missing ru key fails `typecheck`, not a test. | Keep `npm run typecheck` in every agent's checks (it is). |

### Dead code and leftovers from the split

| Sev | Where | Finding |
|---|---|---|
| L | `packages/domain/src/catalog-upload.ts:30` `formFile` | It converted a web `File` from server-action FormData. Its only caller left is its own test; the API uses `FilePart`. Delete with its test. |
| L | `packages/domain/src/plan.ts:3,54`, `security/sign-in.ts:6`, `apps/api/src/health/health.controller.ts:10` | Comments name files deleted in W4a (`apps/web/src/lib/plan.ts`, `apps/web/src/lib/security/sign-in.ts`, `apps/web/src/app/api/health/route.ts`). 33 domain files still say "the web app's server action …". Rewording is cosmetic and touches many files, so do it after the merge, not now. |
| L | `packages/contracts` `replaces` field | It documents the removed actions (W2/W3 checklist). It is now history; it could be dropped once nobody needs the mapping. |
| L | `apps/api/src/auth-core/auth-core.module.ts:20-21` | Unused defaults (see Rate limiting). |

### Quota (Agent 3's area, recorded for them)

| Sev | Where | Finding |
|---|---|---|
| **H** | `packages/domain/src/catalog-upload.ts:179-182` | `gate()` reads usage, then `applyMapping` commits in a separate statement. Two concurrent commits (two tabs, API plus web) can both pass the cap. When the ledger write moves into the commit transaction, take `pg_advisory_xact_lock(hashtext(orgId))`, or re-check the sum inside it. |
| M | `catalog-upload.ts:91`, `api/handlers.ts`, `telegram/bot.ts` | Four entry points call `gate(...'rowsPerMonth')`: preview, commit, public API and bot. All must read the ledger. |

## 2. Conflict map

Files each workstream is most likely to touch: from the plan's briefs, and from what is already in
their worktrees (Agent 1: `schema.prisma` + migration `20261027100000_email_code_google`; Agent 3:
`usage-ledger.test.ts`).

| File / area | A1 auth | A2 fixes | A3 quota | A4 (done) | Conflict risk and resolution |
|---|---|---|---|---|---|
| `.claude/launch.json` | ✔ | ✔ | ✔ | ✔ | **Certain.** Each session appends its port pair. Keep every entry. |
| `packages/db/prisma/schema.prisma` | ✔ (EmailCode, `User.googleSub`) | ? | ✔ (UsageLedger, relations on Organization/Catalog) | | **High.** Agent 1's working copy also reflows untouched models (`prisma format`), and Agent 1 has been asked to drop that. Resolution: take one side, re-add the other's lines, run `prisma format` once, then `prisma validate`. |
| `packages/db/prisma/migrations/*` | `20261027100000_…` | ? | new folder | | Medium. Both additive and independent. Folder names must be unique and sort after `20261026120000_restricted_code`; rename if two collide. |
| `packages/domain/src/invites.ts`, `team-forms.ts` | ✔ (link-invite verification) | ? | ✔ (seats bypass) | | **Medium.** The same functions (`acceptInvite`) are touched for different reasons. Merge by hand and run both agents' tests. |
| `packages/domain/src/signup.ts` | ✔ owner | | read only (trial) | | Low. |
| `packages/domain/src/plan.ts`, `catalogs.ts`, `catalog-upload.ts`, `api/handlers.ts`, `telegram/bot.ts`, `client-lifecycle.ts` | | ✗ must avoid | ✔ owner | | Low if Agent 2 keeps out; upload-wizard bugs Agent 2 finds in `catalog-upload.ts` go to `handoff-agent2.md`. |
| `packages/domain/src/telegram/login*.ts`, `identity.ts` | ✔ | | (bot.ts only) | | Low (same folder, different files). |
| `packages/domain/src/security/*`, `mailer.ts` | ✔ | | | | Low. |
| `packages/domain/src/jobs/queues.ts` | maybe (mail) | | | F6 | Low: one line. |
| `packages/domain/src/demo.ts`, `packages/db/prisma/seed.ts` | ✔ (verified flag, per §1) | maybe | | | Low/medium. |
| `apps/api/src/auth-core/session.guard.ts`, `access.guard.ts`, `session.service.ts` | ✔ | | | untouched on purpose | Low. F5's test asserts the wiring after the merge. |
| `apps/api/src/http/exception.filter.ts`, `middleware.ts`, `app.ts` | | | | F1–F4 | Low (nobody else expected). |
| `apps/api/src/auth/auth.controller.ts`, `packages/contracts/src/modules/auth.ts` | ✔ (Google, code endpoints) | | | | Low. **Also update `apps/api/test/unit/routes.test.ts:32` (`53`)**; F5's test needs no count. |
| `apps/api/test/e2e/auth.test.ts` | ✔ | | | line 47 (F4) | **Medium.** If Agent 1 edits the 401 test, keep `ta.httpX.unauthorized` as the message. |
| `apps/api/test/unit/guards.test.ts` | ✔ | | | | Low. |
| `packages/contracts/src/modules/billing.ts` (plan usage shape) | | | maybe | | Low. |
| `packages/i18n/src/i18n-parts/index.ts` | maybe (new area) | maybe | maybe | ✔ (`http`) | **Medium, mechanical.** Keep every spread line in both `partsUz` and `partsRu`. |
| `packages/i18n/src/i18n-parts/auth.ts`, `security.ts` | ✔ | maybe (copy fixes) | | | **Medium.** Agent 2 must not reword auth copy Agent 1 is changing. |
| `packages/i18n/src/i18n-parts/settings.ts`, `firm.ts`, `shell.ts` | | ✔ | ✔ (usage meters) | | Medium. Hand-merge keys. |
| `apps/web/src/app/sign-in/**`, `sign-up/**`, `ui/telegram-login.tsx` | ✔ | ✗ | | | Low. |
| `apps/web/src/app/(app)/settings/plan-usage.tsx`, `dashboard/usage-panel.tsx`, `ui/shell/plan-banner.tsx` | | maybe (UI bugs) | ✔ | | **Medium.** Agent 2's UI fixes on these screens collide with Agent 3's meter change. |
| `apps/web/e2e/fixture.ts`, `account-flows.e2e.ts` | ✔ | ✔ | maybe | | **Medium.** Fixture users must stay verified; Agent 2's new specs reuse the fixture. |
| `package.json`, `package-lock.json` | ✔ (`mail:test`, maybe `jose`) | maybe | | | **Medium.** Merge `scripts` by hand; regenerate the lockfile with `npm install`, never hand-merge it. |
| `DEPLOY.md`, `.env.example` | ✔ (SMTP/Google/Telegram) | | | | Low. |
| `docs/bugfix-2026-10-23/*` | own files | own files | own files | own files | None (distinct names). |

**Duplicated work to watch for at merge:**
- **Mail and token helpers.** Agent 1 may add a code generator or hasher next to `email-token.ts`, `secret.ts` (`keyedHash`) and `safe-equal.ts`. Keep the existing primitives: `keyedHash` for stored hashes and `safeEqualText` for compares.
- **Rate-limit rules.** New `RULES` entries belong in `security/rate-limit.ts`, not in local maps.
- **"Not found"/"forbidden" messages.** F4 now localizes the generic ones. Agent 2 should not add per-controller translations of the same texts.

## 3. Integration risks for Phase B

1. **Migration ordering.** The latest on main is `20261026120000_restricted_code`; Agent 1 has `20261027100000_email_code_google`. Agent 3's folder must not collide; rename so names are strictly increasing. Check `npx prisma migrate deploy` on the shared DB (already-applied rows must keep their names: never rename a folder another agent already deployed to the shared DB without updating `_prisma_migrations`) and on an empty scratch schema (`?schema=agent4_scratch`).
2. **Shared DB already holds both agents' migrations.** Each agent ran `migrate deploy` from its own worktree, so `_prisma_migrations` lists them under their original names. Renaming a folder at integration would make Prisma see a new migration (re-applied, so it must be idempotent; Agent 1's uses `IF NOT EXISTS`), plus a missing one. Prefer keeping the original names.
3. **Prisma client regeneration.** After each merge, run `npx prisma generate`, and restart `tsx watch` servers, which crash on an `npm install` under them.
4. **Contracts → api-client.** The client is built from the registry at runtime (`createApiClient` maps `endpoints`), so new endpoints need no client codegen. But `routes.test.ts:32` counts auth/account/team entries, and the web type imports (`ResponseOf<…>`) change shape with the schemas. F5's test catches a registry entry without a handler.
5. **i18n spreads.** See the conflict map; the ru/uz shape check is in `typecheck`.
6. **Verification vs fixtures.** e2e fixtures (`apps/web/e2e/fixture.ts:119,157`) and API test helpers (`apps/api/test/helpers.ts`, `session-helpers.ts:60`) create verified users, so they keep working. The **seed user does not** (§1, A1). Agent 2's bug fixes and every e2e run that signs in as `buxgalter@demo.uz` will fail on the integration branch unless Agent 1 fixes the seed.
7. **Sign-in rate limit during e2e.** Back-to-back full runs trip `signInIp`; clear `auth_attempt` rows between runs on the shared DB (the plan already notes this).
8. **Body limit (F2) vs Caddy.** Caddy allows 30 MB request bodies; the API now allows 1 MB of JSON. Multipart uploads are unaffected (multer caps per file).
9. **Flaky auth e2e on the shared DB.** `apps/api/test/e2e/auth.test.ts` "forgot password" (line 188) and
   "resend confirmation" (line 219) use fixed addresses (`nobody-here@test.local`, `nobody@test.local`).
   Per-e-mail limits are 3 an hour (`RULES.resetEmail`, `resendEmail`), so once three runs from any
   sessions fall within an hour, the next run fails with "Juda koʻp urinish". Observed on this branch:
   237/239 pass; these two fail; both passed an hour earlier. This is not a regression. Fix: unique addresses per run
   (`nobody-${testIp()}@test.local`). Left to Phase B because Agent 1 is rewriting these tests;
   Agent 5 should attribute these two failures accordingly.
