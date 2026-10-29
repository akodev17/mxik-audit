# S2 — Scope, roles, team and review integrity: report (29–30 Oct 2026)

Branch `feat/s2-scope-roles` (cut from `feat/saas-hardening-plan`), worktree
`.claude/worktrees/agent-abfdca346ddecc283`. Not pushed, not merged.

## What was done, per finding

Each claim of the plan was checked against the code first. All held. The differences are listed
under "Where the code differed from the plan".

### F11 (Med): last-assignment race, `client-lifecycle.ts`
- `setClientAccountants` now writes in an interactive transaction. It first locks the user rows
  of everyone it adds or removes (`SELECT … FROM "user" … ORDER BY id FOR UPDATE`; id order so two
  callers cannot deadlock). It then re-reads their assignments and refuses with `last` if a
  removal would leave someone with none, or `unrestricted` if an added person now has none. The
  read outside the transaction is advisory only.
- `deleteClient` already rechecked inside its transaction. That recheck now takes the same locks
  on the client's assigned members, so a client delete and an assignment removal running at once
  are serialised too.
- Test: `packages/domain/src/client-assignment-race.test.ts`, modelled on `plan-caps-race.test.ts`.
  It removes both of an accountant's two clients at once (3 rounds), then runs a delete against a
  removal, then checks the unrestricted refusal. **On the old code the first test fails; with the
  fix all pass** (checked by swapping the old file in).

### F12 (Med) / D1: catalogue delete for admins only
- `contracts/modules/catalogs.ts` `remove`: `role: 'admin', noDemo: true`.
- `domain/catalogs.ts` `deleteCatalog`: any role other than admin gets `forbidden`. Callers
  without a role are internal and trusted, as before. `deleteClient` passes the admin actor.
- Web: the delete menu (`catalog-row-actions.tsx`) appears only when `canDelete`.
  `catalogs/page.tsx` → `catalog-results.tsx` and `clients/[id]/page.tsx` now pass
  `admin && !demo` instead of `writer`.
- Tests: `backend.authz.test.ts` (scoped and unscoped accountant refused, nothing deleted, admin
  succeeds). The API catalogs e2e covers an accountant (403 `forbidden`, catalogue kept) and a
  demo org (403 `demo`). Soft delete was not implemented.

### F18a (Med): removing a member with open reviews
- `team-members.ts`:
  - `removeTeamMember(actor, userId, { reassignTo?, dropReviews? })` locks the member's row, then
    counts their open reviews.
  - With open reviews it needs either `reassignTo` or `dropReviews: true`; otherwise it answers
    `{ reason: 'open_reviews', openReviews }`.
  - `reassignTo` must be another member, not a viewer, who can open every client of those
    reviews; otherwise `bad_reassign`. Reassigned reviews get the new assignee, `revision + 1` and
    `updatedAt`.
  - The `team.removed` event records `openReviews`, `reviewsReassigned`, `reviewsDropped`,
    `reviewsReassignedTo` (an e-mail), and still the member's e-mail.
- `memberRemovalCheck` and the new endpoint `GET /api/team/members/{userId}/removal` (admin,
  noDemo) return the open-review count and who can take them all.
- `DELETE /api/team/members/{userId}` takes `?reassignTo=…&dropReviews=true` as query parameters,
  not a body. The registry test "GET and DELETE carry no body" forbids a DELETE body. The answer
  becomes `{ ok:false, error, openReviews }` when the member still holds reviews.
- The form logic lives in a new file, `domain/team-removal.ts`. `team-forms.ts` belongs to S1 and
  was not touched. The team controller now calls `team-removal` for `removeMember` and
  `removalCheck`. `team-forms.removeMemberForm` is no longer called by anything. It still
  compiles, because the two new reasons were added to `ta.setX.team.errors`. S1 or the merge can
  delete it.
- Web: a new `team/remove-dialog.tsx`, used by `team-members.tsx`. It reads the removal check, then
  shows the open-review count and a select: hand over to <member>, or drop. It refuses to confirm
  without a choice. If the server answers `openReviews` (new reviews arrived meanwhile), it reads
  the check again.
- **Decider e-mail after removal:** decision events do not snapshot the e-mail today
  (`decisions.ts` belongs to S4, untouched). Instead, `team.removed` keeps the e-mail, and a new
  `domain/member-emails.ts` falls back to it. `row-detail.ts` (`decidedBy`) and the review view
  (`doneBy`) use it, so a removed member's address still shows.
  **Note for S4:** a decision-event e-mail snapshot would make this independent of the removal
  event.
- Tests: `team-members.test.ts` covers:
  - the refusal with its count;
  - `bad_reassign` for a narrower accountant and for a viewer;
  - reassign moves both reviews and logs the count;
  - drop deletes the review and logs the count;
  - `memberEmails` returns the removed member's address;
  - another org's check answers `null`.

### F18b (Med): closing a review with pending findings
- `review-assignments.ts`:
  - `completeReview(…, now, confirm = false)` counts the catalogue's risky findings that have no
    decision. This is the same "muammo" the workspace counts as not reviewed: severity high or
    medium, `decision = 'pending'`.
  - If there are any and `confirm` is not set, it answers `{ error: 'pending', pending }`. The
    `review.completed` event records `pending`.
  - `ReviewView` gains `doneBy` (an e-mail, also after removal), `doneNote` and `pending`.
- `catalog-review.ts` / the contract: the `finishReview` body takes `confirm?: boolean`. A refusal
  is `{ ok:false, error: ta.review.pendingConfirm(n), pending }`.
- `review-control.tsx`:
  - Before closing, it shows "N ta muammo hali koʻrib chiqilmagan." and the button becomes
    "Baribir yakunlash", which sends `confirm: true`.
  - If the server reports a newer count, it switches to the confirm state.
  - After closing, it shows "Yakunladi: <email>" and «note».
- uz and ru copy: `ta.review.pendingOpen`, `pendingConfirm`, `closeAnyway` and `doneBy`, plus
  `ta.setX.team.reviewsOnRemoval.*` and `errors.open_reviews` / `bad_reassign`.
- Tests:
  - `review-assignments.test.ts`: pending refusal, confirm, `doneBy` and `doneNote` in the view,
    and a fully decided catalogue that closes without confirm.
  - API catalogs e2e: pending refusal with its message, close with confirm, `doneBy`/`doneNote`
    in the review read.
  - `apps/web/e2e/review-assignment.e2e.ts`: the catalogue gets one undecided problem; the test
    checks "1 … pending", "close anyway", then `doneBy` and the note in the header.

### F19 part (Q15): read paths resuming audits
- `catalog-pages.ts`: a new `resumesOnRead(user, mode = jobsMode())` returns true only for
  `JOBS_MODE` inline and a writer role.
- Only the two resume lines changed (`catalogProgress`, `catalogHeader`). S5's export-gate lines
  are untouched.
- The `progress` contract note now says the same.
- Test: `catalog-resume-gate.test.ts`, with a pure check plus database cases using a fake
  dispatcher:
  - a viewer's header and progress reads queue nothing;
  - in bullmq mode even an admin's reads queue nothing;
  - inline, a writer's read queues the stalled audit.

### F20 (S2 items)
- **(a) Bank rule scope.** `removeBankRule` loads the rule:
  - a client's rule needs `canSeeClient`;
  - an org-wide rule (`clientId` null) needs an unscoped member;
  - anything else is answered like a missing rule.
  `bank/store.removeRule` deletes only while the rule still has that `clientId`.
- **(b) Duplicate-upload leak.**
  - Bank preview: `duplicateOf` is `{ batchId: null, filename: null, createdAt: null }` when the
    earlier statement belongs to a client the user cannot open. This follows `visibleBatch`'s
    rule. The contract fields `batchId`/`createdAt` became nullable.
  - Bank `createStatement` (both duplicate paths) leaves out `duplicateOf` in that case.
  - Web `bank/upload/check-step.tsx` shows a generic notice, `duplicateElsewhere` (uz/ru), with no
    link.
  - Didox: in `didox/service.ts` only the refusal's `duplicateOf` changed. A new `shownDuplicate`
    checks the batch against `batchScope`. The message itself was already generic.
    S5's `uploadsOpen` line is untouched.
- **(c) E-mails and assignments.**
  - `activity-view.ts`: the member picker lists every member for an admin. Anyone else sees only
    the actors on events they may see, via a new `activityActorIds` in `activity.ts` that reuses
    the log's own scoping conditions. A `user` filter outside that list is ignored.
  - `client-page.ts`: `staff[].clientIds` is `[]` for non-admins. The web never read it.
- Tests:
  - `bank/service.test.ts`: rule scope (another client's rule, org-wide rule, own rule, admin,
    other org) and the hidden duplicate in preview and create.
  - `didox/service.test.ts`: a scoped accountant of client B gets `duplicate_invoice` with the same
    words and no `duplicateOf`.
  - `people-visibility.test.ts`: the activity picker for admin and scoped accountant, and the
    client page's staff `clientIds`.

## Where the code differed from the plan / brief
- `team-forms.ts` (S1) holds `removeMemberForm`. Rather than editing it, a new `team-removal.ts`
  carries the S2 form, and the controller points there.
- DELETE bodies are forbidden by the registry test, so `reassignTo`/`dropReviews` are query
  parameters.
- Decision events carry no e-mail snapshot, so the fallback reads the `team.removed` event instead
  (see the S4 note above).
- Small touches outside the listed files, each needed by the change:
  - `catalog-review.ts`: the review wrapper.
  - `activity.ts`: one new export.
  - `contracts/modules/bank.ts`: nullable duplicate fields.
  - `bank/upload/check-step.tsx`: the generic notice.
  - `catalog-results.tsx`, `catalogs/page.tsx`, `clients/[id]/page.tsx`: the delete button flag.
  - `contracts/README.md`: the regenerated checklist. Ticks restored for `catalogs.remove`; W3
    ticked for the new `team.removalCheck`.
  - `apps/api/test/unit/routes.test.ts`: W2a route count 59 → 60.
  - `didox/service.test.ts`, `review-assignments.test.ts`, `team-members.test.ts`: tests.

## Merge notes
- `apps/api/src/team/team.controller.ts`, `packages/contracts/src/modules/team.ts`,
  `packages/i18n/src/i18n-parts/settings.ts` (the `ta.setX.team.errors` record type) and
  `routes.test.ts` (the operation count) are also S1 territory. Expect small hand-merges.
- `catalog-pages.ts`: S5 edits the export-gate lines. S2 changed only the import line, the new
  `resumesOnRead`, and the two resume calls.

## How it was tested
All commands were run from the worktree root against the dev database on 127.0.0.1:54329, with
`&connection_limit=4`.

- `npm run typecheck`: green (exit 0).
- `npm run lint`: green, 0 errors. The 1 warning predates this work (`scripts/lib/xlsx.ts:131`,
  no-non-null-assertion).
- Targeted runs while working: 81/81 passed for the race, team-members, review-assignments,
  backend.authz, client-lifecycle and catalogs tests. 45/45 passed for bank, didox,
  people-visibility, activity, catalog-pages and resume-gate. 126/126 passed for the contracts,
  API unit and api-client tests.
- `npm test` (full, 1598 tests, while five sibling agents used the same Postgres): 1555 passed,
  32 failed, 5 cancelled, 6 skipped. Every failure was a database connection or timeout error
  from the shared server, not an assertion:
  - "Server has closed the connection"
  - "Unable to start a transaction in the given time"
  - "Connection terminated unexpectedly"
  - 5 s timeouts on 401-before-query and body-size tests
  
  The failing files were the API e2e `catalogs-docs` and `workspace-docs`, `unit/http-wiring`,
  `didox-real`, `matching-provenance`, `onec/export`, `plan-caps-race`,
  `products/{catalog,import,products}`, `review-assignments`, `search-codes`, and
  `security/{email-code,password-reset,session-store}`.
- Rerun of exactly those 15 files with `--test-concurrency=1`: **110 tests, 109 passed, 0 failed,
  1 skipped.** No assertion failure is attributable to this branch. The API catalogs e2e,
  including the new accountant/demo delete and pending-review cases, passed in the full run.
- The race test was also run against the old `client-lifecycle.ts`. It fails there, as intended.
- Playwright `apps/web/e2e/review-assignment.e2e.ts`: updated, not run (see below).

## What remains / unverified
- Reassigned reviews send no notification to the new assignee. The review appears in their
  dashboard list, and the removal event records the hand-over. A notice would need the
  per-locale `reviewAssignedText` per review; this was left out to keep the change small.
- `apps/web/e2e/review-assignment.e2e.ts` was updated but not run. It needs a running web + API
  and Playwright. The domain and API e2e tests cover the same behaviour.
- `team-forms.removeMemberForm` is now dead code (left for S1, see above).

## Open questions for the owner
- Should a dropped review notify the person who handed it out?
- Should viewers see the audit-log member picker at all? Today they get the actors of the events
  they can see.
