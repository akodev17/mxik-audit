# S15: review hand-over notices and expiry reminder catch-up (report)

Branch `feat/s15-notices-catchup`, cut from `main` @ `db755db`. Worktree
`.claude/worktrees/agent-a561d211c73a3d708`. This closes two gaps from FINAL_REPORT §5 item 6: S2's "reassigned
reviews send no notice" and S7's "missed reminder days are not caught up". It also answers owner decisions 4 and 17
with the behaviour the brief asked for. Nothing was pushed or merged.

## Checking the brief against the code
- **Ordinary reassignment already notifies.** `assignReview` (`review-assignments.ts`) sends `review.assigned` to the
  new assignee on every real change, including a change of person. The dedupe key is
  `review.assigned:<reviewId>:<revision>`, and nobody is told when they assign a review to themselves. No change
  was needed there. The hand-over reuses that kind, its wording (`reviewAssignedText`) and its key design.
- **The notice design does not group.** It is one notice per review, so a hand-over of N reviews makes N notices.
- **Where review wording lives.** Review notice wording lives in `packages/domain/src/notification-text.ts`
  (`REVIEW_WORDS`, uz and ru), not in `packages/i18n`. The new strings went there next to their siblings, using
  U+02BB in Uzbek.
- **Where the removal happens.** It happens in `team-members.ts` `removeTeamMember`; `team-removal.ts` is only the
  form wrapper the API calls. The notices are sent from `removeTeamMember` after its transaction commits, so every
  caller gets them, the API included.
- **Reminder text needed no new i18n.** `setX.expiry.title(kind, days)` already words any number of days.

## What changed

### 1. Review hand-over notices (S2 gap)
- **Hand-over** (`removeTeamMember` with `reassignTo`). Each handed-over review gives the new assignee one notice:
  - kind `review.assigned`, with the same text as an ordinary assignment (client, file, due date, note, and
    "Topshirdi: <admin who removed the member>");
  - link `/catalogs/<id>`;
  - dedupe key `review.assigned:<id>:<revision after the bump>`. The revision is read back inside the transaction,
    under the rows' locks.
  - No notice goes out when the admin hands the reviews to themselves, the same as `assignReview`.
- **Drop** (`dropReviews: true`). Each dropped review gives the member who handed it out (`createdBy`) one new
  notice:
  - kind `review.dropped`;
  - uz "Tekshiruv bekor qilindi: <client>", ru "Проверка отменена: <client>";
  - the body names the file and the member who left, says the review went to nobody and can be handed out again,
    and names the admin who dropped it;
  - dedupe key `review.dropped:<id>:<revision>`.
  - Skipped when `createdBy` is null, is the removed member, is the admin doing the removal, or is no longer a member
    of the org. `Notification.userId` has a foreign key to `user`, so a stale id would otherwise fail the insert.
- **What all these notices share:**
  - personal (`userId` set), with the review's `clientId`, and `external: false`, so no Telegram and no mail;
  - visibility comes from the existing `noticeScope`: only the addressee in the same org sees them;
  - they are sent after the removal has committed. A failed notice is logged (`[review-handover <id>]`) and never
    fails or undoes the removal.
- `review.dropped` was added to the bell's "review" group (`notifications.ts` `GROUP_KINDS`).

### 2. Expiry reminder catch-up (S7 gap)
- A new `owedThreshold(days)` in `billing/expiry-reminders.ts`:
  - with `days` left from 0 to 7, a run owes the smallest threshold ≥ `days`. That is today's own threshold, or on a
    day between thresholds the last one passed (2 days left → 3, 4 to 6 → 7);
  - outside that range it owes nothing.
- The run sends that threshold through the unchanged `notify()` dedupe. This gives the required behaviour:
  - at most one reminder per org per run;
  - a threshold already sent is never sent again;
  - an earlier threshold is never sent (day 2 never sends the 7-day one);
  - nothing is sent for an end date a renewal replaced, because the key contains the end date and the old end is no
    longer the org's end.
- **The dedupe key is S7's:** `billing.expiring:<kind>:<local end date>:<threshold>`.
- **The words count the days actually left.** A 3-day reminder caught up on day 2 reads "2 kundan keyin tugaydi" (and
  the Russian equivalent), not "3 days". The tests check the Uzbek wording only.
- `DEPLOY.md` §7e: the sentence "not caught up" now describes the catch-up instead.

## Files changed
- New: `packages/domain/src/review-handover-notices.ts`
- `packages/domain/src/team-members.ts`: `removeTeamMember` selects the review fields, reads back the revisions, and
  sends the notices after commit.
- `packages/domain/src/notification-text.ts`: `reviewDroppedText`, plus uz/ru words.
- `packages/domain/src/notifications.ts`: `review.dropped` in the review group.
- `packages/domain/src/billing/expiry-reminders.ts`: `owedThreshold`, with the key on the threshold and the words on
  the days left.
- `DEPLOY.md` §7e (one sentence).
- Tests:
  - `packages/domain/src/team-members.test.ts`
  - `packages/domain/src/review-assignments.test.ts`
  - `packages/domain/src/billing/expiry-reminders.test.ts`
- This report.

There were no contract, registry, schema, web, Telegram, billing-provider or receipt changes. Because the registry
was not touched, the checklist and route counts were not regenerated.

## Tests (run here, dev DB 127.0.0.1:54329, `connection_limit=4`)
Each file was run alone with `node node_modules/tsx/dist/cli.mjs --test <file>`.

- **`team-members.test.ts`: 13/13.** The new case "a hand-over tells the new assignee, a drop tells whoever handed the
  review out; nobody else sees either (S15)" checks:
  - two handed-over reviews give the taker exactly two unread `review.assigned` notices, keyed
    `review.assigned:<id>:2`, carrying the note and the admin's address, with no Telegram;
  - the giver, a bystander, the org admin, an admin of another org, and the taker's id under another org see none of
    them;
  - four dropped reviews (given by an accountant, by the removing admin, by the leaver, and by nobody) give exactly
    one `review.dropped`, to that accountant, naming the leaver, with the right ru title;
  - nobody else sees it, and it is listed under the bell's review group.
  - **This case fails against the old `team-members.ts`.** I checked by swapping the committed file back in
    temporarily.
- **`review-assignments.test.ts`: 17/17.**
  - New: reassigning from one member to another notifies only the new one, with the same kind and title. The
    previous assignee, a member scoped to another client, a viewer and another org get nothing.
  - The pure test also checks the uz/ru wording of `reviewDroppedText`.
- **`billing/expiry-reminders.test.ts`: 10/10.**
  - New pure check of `owedThreshold`.
  - New "a day the job missed" suite (June 2031, clear of the March orgs):
    - The 3-day run is skipped, and the job runs on day 2: the 3-day reminder goes out once, worded "2 kundan
      keyin" in the notice and the mail subject. Two more runs that day send nothing, and the 1-day reminder still
      goes out on its own day.
    - With both the 7- and 3-day runs missed, a single notice and mail go out, keyed `:3`.
    - An org that renewed before the catch-up gets nothing more for the old end, over three further runs.
  - **One existing expectation was changed on purpose.** The S7 test listed "a trial ending in 5 days" among the orgs
    that get nothing. Under catch-up it now gets the 7-day reminder at once, worded "5 kundan keyin". The test
    asserts that now (see open question 1).
  - I did not run the new reminder tests against the old code: the file imports the new `owedThreshold`, so it would
    fail at import, which proves nothing. By reading the old code: it sent only when `days` was exactly 7, 3, 1 or
    0, so day 2 sent nothing.
- **Final combined run, once, with `--test-concurrency=2`: 119/119 passed, 0 failed.** Files:
  - API e2e: `team`, `notifications`, `catalogs` (with the review assign and finish cases), `billing-history`;
  - domain: every `billing/*.test.ts`, `team-members`, `review-assignments`, `workspace-review`.
- `npm run typecheck`: exit 0 across all workspaces and the root.
- `npx eslint` on the eight changed `.ts` files: clean, no warnings.
- **Not run:**
  - the full `npm test` (three sibling agents share the DB; the brief asked for targeted runs);
  - the web Playwright suites;
  - any browser check.

## Not done or unverified
- **No browser check.** The new kind shows through the existing bell list, which renders kind-agnostic title and body.
  I have not seen it on screen.
- **The previous assignee is not told.** On an ordinary reassignment, the person who loses a review gets nothing. That
  was not asked for and is unchanged.
- **Hand-over notices name the admin as "Topshirdi".** The review's `createdBy` stays the original giver, as S2 left
  it. So the completion notice still goes to the original giver, not to the admin who handed it over.
- **Catch-up stops at the end date.** Once the end date has passed (days < 0) nothing is caught up. The day-0
  reminder missed on the last day is not sent afterwards, because access is already closed by then.
- **Mail can still be lost.** As in S7, if the mail queue fails after the notice is stored, that threshold's mail is
  lost. Catch-up does not retry it, because the notice's key already exists.

## Open questions for the owner
1. **Late entry into the 7-day window.** An org whose end first comes within 7 days on a day between thresholds now
   gets the 7-day reminder (worded with the real days left) on the first run. Examples are a trial shorter than 7
   days, an admin-extended trial, or a refund that shortens the period. Before, it waited for the 3-day one. This
   follows the brief's rule; the job cannot tell "missed" from "never applied" without a run log. Is that wanted? If
   not, catch-up could be limited to thresholds whose day came after the org's last change of end date.
2. **Hand-over notices.** Should they also go to the original giver ("your review moved to X"), and should the
   previous assignee be told on an ordinary reassignment?
3. **Telegram and mail.** Both notices are in-app only, pending the owner decision on Telegram and mail for review
   notices.
