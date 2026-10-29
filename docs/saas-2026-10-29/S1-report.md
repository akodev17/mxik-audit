# S1: Identity and invites (report)

Branch `feat/s1-identity` (cut from `feat/saas-hardening-plan` = `4288271`), worktree
`.claude/worktrees/agent-ae57e0731f83d2684`. Findings closed: F2, F8 (decision D5), F20 items
owned by S1 (invite join limit + generic error, Telegram login state, 2FA enable ends other
sessions, absolute session age). Not pushed, not merged.

## Findings verified against the code (29 Oct line numbers)

| Finding | Plan said | Code at `4288271` | Result |
|---|---|---|---|
| F2 | `invites.ts:121` pre-verifies, `google.ts:181-186` links | `invites.ts:116` set `emailVerifiedAt` when `invite.email` was set; `google.ts:184` linked any account with `emailVerifiedAt` | Confirmed, fixed |
| F8 | `invites.ts:108` `emailTaken`, copy sends to sign-in, `team-forms.ts:50` same-org check only | As described | Confirmed, fixed (D5) |
| F20 invite | `team-forms.ts:149`, `invites.ts:113` | No limit on `POST /api/invites/{token}/join`; `emailTaken` answer named registered addresses | Confirmed, fixed |
| F20 Telegram | `login-callbacks.ts:43-49` | Sign-in callback took any signed widget answer, no browser-bound state (bind flow had one) | Confirmed, fixed |
| F20 2FA | `two-factor.ts:55` | `confirmSetup` left every session alive | Confirmed, fixed |
| F20 session age | `session-store.ts:8` | Idle limit (7 days) only | Confirmed, fixed |

The brief names `security/session.ts`; that file does not exist. The session cookie type lives in
`packages/domain/src/session.ts`, which is the file changed.

## What was done

### F2: an invite never confirms an address; Google links only code/link-confirmed accounts
- `User.verifiedVia` (nullable text: `code`, `link`, `google`, `telegram`, `legacy`). Migration
  `20261108000100_user_verified_via` adds it and backfills `legacy` where `emailVerifiedAt` is set;
  rollback note in `docs/accounting-2026-10-23/migrations.md`.
- Written where an address gets confirmed: `confirmCode` → `code`, `confirmEmail` (old verify links)
  → `link`, password reset → `link` (keeps `code`), `createAccount` → `google` / `telegram`.
- `acceptInvite` creates the user unconfirmed (`emailVerifiedAt` and `verifiedVia` null) and mails
  the code for every invite, as the open-link flow and sign-up do. `joinWithInviteForm` refuses, as
  sign-up does, when no mail can be delivered (production without SMTP), instead of creating a
  locked account.
- `googleUser`: an existing account is joined only when `verifiedVia` is `code` or `link`;
  otherwise `google_unconfirmed` with copy that says to sign in with the password and confirm, or
  set a new password with the reset link (which records `link`). `google_conflict` now means only
  "already bound to another Google account" and its copy says so.

### F8 / D5: joining with an existing account
- New `packages/domain/src/invite-move.ts`: `checkInviteMove` and `moveWithInvite`. Allowed when the
  user's current org is a customer org with no other users, no catalogues and no running paid
  subscription (the last condition is mine, see open questions). Refusals: `inviteBad`,
  `inviteWrongEmail`, `sameOrg`, `orgKind`, `members`, `catalogs`, `paid`; every refusal except
  `inviteBad` carries the inviting admin's address (the invite's creator while still an admin,
  else the org's first admin).
- The move is one transaction under both orgs' usage locks (fixed order): invite claimed atomically,
  the old org re-checked, the user's old client assignments and saved views removed, `orgId` and
  role from the invite, client assignments from the invite (as for a new member; no seat re-check,
  the invite holds its seat, as for a new member), the old org closed the way
  `security/account.ts#requestDeletion` closes it (`deletedAt`; the daily purge erases it after the
  grace period; nothing deleted synchronously), every session of the user revoked, audit events
  `account.deletion_requested` (payload: `reason: 'joined_org'`, the address, the new org) in the old
  org and `team.joined` (`existingAccount: true`) in the new one; no new action name, so the activity
  groups (`activity.ts`) need no change. The API then renews this browser's session in the new org.
  `requestDeletion` itself is not called (it is not transaction-aware and S5 owns `account.ts`); the
  same update and audit action are written inside the move's transaction.
- Contracts (`packages/contracts/src/modules/team.ts`): `team.joinCheck` `GET /api/invites/{token}/account`
  and `team.joinWithAccount` `POST /api/invites/{token}/account` (session, any role, no demo);
  `InviteState.existingAccount`. Controller: `apps/api/src/team/team.controller.ts`.
- Admin warning: `inviteMemberForm` answers `existingAccount` (a sentence, the org is never named)
  when the invited address is registered anywhere outside the org.
- Web: `apps/web/src/app/invite/[token]/page.tsx` + new `join-account.tsx`. Signed in (real org,
  confirmed): "join with this account" with what happens, or the refusal and the admin's address,
  plus "sign in with another account". Signed in but unconfirmed: a link to the code step. Signed
  out: the password form, the Google button (`GoogleLogin`, the sign-in page's component, with
  `next=/invite/<token>`) and "already have an account? sign in" (`/sign-in?next=/invite/<token>`).
  A new Google user lands back on the invite with a fresh empty trial org, which the move closes.

### F20 (S1 items)
- (a) `RULES.inviteJoinIp` (10 per hour per client address) on `POST /api/invites/{token}/join`;
  a registered address gets `authX.invite.addressUnavailable` ("could not open an account with
  this address; if you have one, sign in and open the link again") instead of `emailTaken`.
- (b) Telegram sign-in state: `startTelegramLogin` (one-time state in the session cookie, 10 min),
  new `auth.telegramLoginStart` `POST /api/auth/telegram/login`; the callback moved to
  `GET /api/auth/telegram/login/{state}` and refuses (`telegram_state`) a missing, wrong or stale
  state, spending it either way, before the signature is checked. Web: new
  `apps/web/src/app/sign-in/telegram-sign-in.tsx` used by the sign-in and sign-up pages;
  `ui/telegram-login.tsx` no longer has a default callback URL (the old one no longer exists).
- (c) `confirmSetup(user, code, keepSid)` ends every other session of the user
  (`endUserSessions`), the audit payload records how many; the controller passes this browser's sid.
- (d) `SESSION_ABSOLUTE_MAX_MS` = 30 days on `UserSession.createdAt`, checked in `isLive` (demo
  limits too) and in `listSessions`.

## Files changed
Domain: `invites.ts`, new `invite-move.ts`, `team-forms.ts`, `signup.ts` (verifiedVia only),
`session.ts`, `security/{google,rate-limit,two-factor,session-store,verification,password-reset,account-security}.ts`,
`telegram/login-callbacks.ts`; tests `invites.test.ts`, `security/google.test.ts`,
`telegram/login-callbacks.test.ts`.
Contracts: `modules/team.ts`, `modules/auth.ts`, `README.md` (checklist regenerated, new rows ticked W3).
API: `auth/auth.controller.ts`, `team/team.controller.ts`; tests `test/e2e/team.test.ts`, `test/e2e/security.test.ts`.
DB: `schema.prisma` (User only), migration `20261108000100_user_verified_via`.
Web: `invite/[token]/{page,join-account}.tsx`, `sign-in/{page,telegram-sign-in}.tsx`,
`sign-up/page.tsx`, `ui/telegram-login.tsx`, `(app)/team/invite-form.tsx` (one line).
i18n: `i18n-parts/auth.ts` (`authX.invite.*`, `verifyX.notices.google_unconfirmed`, `google_conflict`
text), `i18n-parts/security.ts` (`secX.notices.telegram_state`), `i18n-parts/settings.ts`
(`setX.team.invite.existingAccount`). Docs: `migrations.md`, this report.

Outside the S1 list, kept to the lines named: `security/verification.ts`, `security/password-reset.ts`,
`security/account-security.ts` (record `verifiedVia`, pass `keepSid`; no other task owns them),
`sign-up/page.tsx` + `ui/telegram-login.tsx` (the sign-up page's Telegram button would otherwise
call a callback that no longer exists), `(app)/team/invite-form.tsx` (S2's folder: one line that
shows `existingAccount`; merge note for S2), `packages/contracts/README.md` (generated checklist;
other tasks that add endpoints regenerate it on merge).

## How it was tested
- `npx prisma migrate deploy` on the dev DB (127.0.0.1:54329): `20261108000100_user_verified_via`
  applied. Backfill checked: 84 confirmed users → `legacy`, 131 unconfirmed → null.
- New and changed API tests (all green):
  - `apps/api/test/e2e/team.test.ts`: an address-bound invite leaves the account unconfirmed
    (`emailVerifiedAt`/`verifiedVia` null, one code mailed, `/api/team` answers 403 `unverified`)
    until the code is entered (`verifiedVia = 'code'`); a registered address on the join form gets
    the generic error; the 11th join from one address in an hour is refused; the admin gets
    `existingAccount` for an address registered elsewhere (and not for a new one); an empty org's
    user joins with the account (role and client access from the invite, old org `deletedAt`, audit
    events in both orgs, other sessions and the old cookie 401, new cookie in the new org, invite
    spent); refusals for other users, catalogues, wrong address and same org carry the reason and
    the inviting admin's address and change nothing.
  - `apps/api/test/e2e/security.test.ts`: two-factor enable ends the other session and keeps this
    one (audit `sessionsEnded: 1`); Telegram sign-in through `POST /api/auth/telegram/login` +
    `GET /api/auth/telegram/login/{state}`; a callback without this browser's state, with a wrong
    one or after the state was spent is refused and signs nobody in; a session created 31 days ago
    is refused although seen now (29 days: accepted; the expired one is not listed); Google refuses
    an invite-made unconfirmed account and a `legacy` one, and links once `verifiedVia = 'code'`.
  - Domain: `invites.test.ts` (address-bound invite mails the code, stays unconfirmed),
    `security/google.test.ts` (unconfirmed / legacy / unknown origin → `google_unconfirmed`, already
    bound → `google_conflict`), `telegram/login-callbacks.test.ts` (state required, spent, 10-minute
    expiry).
  - `apps/api/test/unit/routes.test.ts`: operation count 59 → 62 (my three new operations).
- `npm run typecheck`: green. `npm run lint`: green apart from one pre-existing warning
  (`scripts/lib/xlsx.ts:131` non-null assertion, not touched).
- `npm test` (271 files, 2022 tests, run while five sibling agents were also running tests and dev
  servers): 2015 pass, 3 skipped, 4 failed. Two were mine and are fixed since (the routes count;
  `activity-actions.test.ts` refused the new `team.left` action, now folded into
  `account.deletion_requested`); both rerun green. The other two were timeouts under load and pass
  when rerun alone in this worktree:
  - `apps/api/test/e2e/imports.test.ts:85` "cheques: upload, apply…": `Error: timed out waiting for the cheque check`.
  - `packages/domain/src/audit-jobs.test.ts:57` "returns at once and finishes the audit in the
    background": no `catalog.audited` event within the wait.
- By hand, API on 4051 and web on 3051 from this worktree (the Browser pane did not respond, so the
  server-rendered HTML was checked with curl): the invite page signed out shows the password form
  and "sign in and join" with `next=/invite/<token>` (Google is off in the dev `.env`, so its button
  is not rendered); signed in as a solo account it shows "join with this account", the explanation
  and "sign in with another account"; `POST /api/invites/<token>/account` through the web's `/api`
  proxy answered `{ redirect: '/dashboard' }` and `/api/auth/me` with the renewed cookie showed the
  firm's org and the invite's role. The fixture orgs were dropped afterwards.

## Remaining, unverified, open questions
- Owner decision: D5 says "no other users and no catalogues". I also refuse an org with a running
  paid subscription (`subscriptionUntil > now`), because the paid time would be lost with the closed
  org. Remove the `paid` branch in `invite-move.ts#blocker` if that is not wanted.
- Other data of the empty org (clients, products, bank or Didox imports, API keys, Telegram chats)
  goes with the closed org at the purge, as with any account closure. D5 only names users and
  catalogues; say if more should block the move.
- Legacy accounts (`verifiedVia = 'legacy'`, 84 rows on the dev DB) can no longer have Google bound
  by address until the holder resets the password (records `link`) or a Google sign-in is bound
  from a signed-in session (not built). Accounts created through address-bound invites before this
  change are among them, which is the point of F2.
- An `existingAccount` warning tells an admin that an address is registered somewhere, as the brief
  asks; it is an account-existence oracle for admins (rate-limited only by the invite seat cap).
- Telegram sign-in on production needs nothing new in BotFather (the domain is the same); the
  callback path changed from `/api/auth/telegram` to `/api/auth/telegram/login/<state>`.
- Not seen in a real browser (the pane did not respond): the Telegram widget with its state, the
  refused view's layout and the Google button on the invite page are unverified visually. The
  Playwright suite was not run (S11); `account-flows.e2e.ts` "an invite link is created, joined…"
  still matches the signed-out flow.
- Merge notes: `packages/contracts/README.md` is generated (regenerate after merging other waves);
  `apps/api/test/unit/routes.test.ts` counts auth/account/team operations (62 with S1);
  `(app)/team/invite-form.tsx` gained one line (S2's folder).
