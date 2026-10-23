# Agent 1 result: e-mail verification, SMTP, Google and Telegram sign-in, trial

Branch `claude/agent1-auth-e2dff1` (worktree `.claude/worktrees/agent1-auth-e2dff1`), cut from
`f11abc4`. Not pushed. API on 4011, web on 3011.

## What changed

1. **Verification is mandatory.** A password sign-up creates the trial org and the admin with
   `emailVerifiedAt = null`, mails a 6-digit code and signs the browser in to the code step at
   `/sign-up/verify`. Sign-in with an unconfirmed address lands there too (whatever `next` says),
   and so does a member who joined through an invite link without a bound address.
   - Codes: new additive table `email_code` (keyed HMAC of user id + code, 15-minute expiry,
     attempt counter capped atomically at 5, a new code retires the old). `packages/domain/src/security/email-code.ts`, `verification.ts`.
   - Guard: `loadAccess` returns `verified` (a demo org counts as confirmed); `SessionService`
     puts it on `req.user`; `AccessGuard` answers **403 `unverified`** (localized message) on every
     `auth: 'session'` endpoint except those marked `allowUnverified` in the registry: `auth.me`,
     `auth.verifyCode`, `auth.resendCode`. Sign-out is public. The one manual-session route that
     acts for a user (`auth.telegramBind`) treats an unconfirmed user as signed out.
   - Rate limits: new `RULES.verifyCodeUser` (10 entries / 15 min per user, on top of 5 per
     code); resend uses the existing `RULES.resendIp` / `RULES.resendEmail` (3 an hour per mailbox).
   - Web: `/sign-up/verify` (six boxes, "send again", "sign in with another account"); `pageData`
     sends 403 `unverified` to the code step; `/sign-in` and `/sign-up` send a signed-in unconfirmed
     user there. `me` carries `verified`.
   - Old 48-hour confirmation links (`/api/auth/verify/{token}`) still confirm; new mails carry
     the code only. `confirmation/resend` (email + password) now sends a code.
   - Contract + client: `auth.verifyCode` (`POST /api/auth/verify-code`), `auth.resendCode`
     (`POST /api/auth/verify-code/resend`), `auth.google`, `auth.googleCallback`, `config.google`,
     `CurrentUser.verified`, `allowUnverified` on `Endpoint` (+ `x-allow-unverified` in OpenAPI).
     `@tasnivo/api-client` picks them up from the registry; README checklist regenerated.
2. **SMTP.** `nodemailer` / `deliverMail` kept. Without `SMTP_URL` + `MAIL_FROM` outside
   production every message is written to the API log and `tmp/outbox/<timestamp>-<pid>-<n>.txt`
   (`MAIL_OUTBOX_DIR` overrides); the fallback sits in `deliverMail`, so the worker uses it too.
   In production without SMTP, `/sign-up` refuses ("temporarily unavailable", logged) and the API
   logs an error at start-up; verification is never skipped. `npm run mail:test -- <address>`
   sends one test message. `DEPLOY.md` 7c documents Gmail (2-Step Verification, app password,
   `smtps://you%40gmail.com:<app-password>@smtp.gmail.com:465`), `.env.example` too.
3. **Google sign-in.** `packages/domain/src/security/google.ts`: authorization-code flow with
   PKCE (S256), one-time `state` and `nonce` sealed in the session cookie (10 min, spent on use,
   compared with `safeEqualText`), `next` through `safeNext`. ID token verified with `node:crypto`
   against Google's JWKS (RS256 only, issuer, audience, expiry/iat with 60 s skew, nonce; one JWKS
   refetch on an unknown `kid`). No new dependency (`jose` was not in the lockfile). A verified
   Google address counts as confirmed; it signs in the user bound by `googleSub` (new nullable
   unique column), else joins a **confirmed** user with that address (binding it,
   `security.google_bound`), refuses an unconfirmed one (`google_conflict`), else opens a new
   14-day trial account. Buttons on `/sign-in` and `/sign-up`, hidden unless `GOOGLE_CLIENT_ID`
   and `GOOGLE_CLIENT_SECRET` are set; `GOOGLE_REDIRECT_URI` optional.
4. **Telegram sign-in audit.** Widget (redirect mode; the relative `data-auth-url` resolves against
   the page, CSP already allows `telegram.org` / `oauth.telegram.org`), hash check, replay claim,
   `loginTarget`, `openTelegramAccount`, bind/unbind: no defect found. A new Telegram user gets a
   confirmed 14-day trial org and lands on the dashboard; returning signs in the same user. Only
   change: the manual bind callback ignores an unconfirmed session. Manual check with a real bot
   documented in `DEPLOY.md` 7d.
5. **Trial.** `trialEndsAt = now + 14 days` is set in the same transaction for password,
   Telegram and Google sign-ups; `planStatus` reports `trial` with `daysLeft: 14` for all three
   (test). Settings → Tarif shows "Sinov muddati · 14 kun qoldi, <date> gacha"; the shell banner
   shows "Sinov muddati: N kun qoldi" from 5 days left (existing design, see hand-over). `plan.ts`
   untouched.
6. Seed: `buxgalter@demo.uz` is created confirmed. Test fixtures (`makeOrg`, `makePerson`) create
   confirmed users.

Migration: `packages/db/prisma/migrations/20261027100000_email_code_google` (new table
`email_code`, nullable unique `user.googleSub`; `IF NOT EXISTS`, applied to the shared dev DB).
Same timestamp as Agent 3's `20261027100000_usage_ledger`; both are applied, keep both names.
No backfill of `emailVerifiedAt`: before this branch every password sign-up was confirmed at
creation (mail was off), so only link-invite members are unconfirmed; they get the code step and a
code, which is the intended behaviour.

## Commits

```
5544e28 Schema: only the added lines (undo the whole-file prisma format realignment)
8e1443d Seed: the demo user is a confirmed account; screenshots of the Google button and the unconfirmed sign-in
31c7186 Contracts: me carries verified in round trips and the api-client fixture; new endpoints name their pages; checklist regenerated; security.google_bound grouped
ed20f15 Tests follow mandatory verification: fixtures create confirmed users; auth API tests cover the code step, 403 unverified, resend, Google start, forged state
4acc042 e2e: sign-up blocked until the mailed code (read from the outbox), then the dashboard of a 14-day trial; an open invite link lands on the code step
61d903e Hand-over: drop the default-client note (intended)
0274fa3 Trial: password, Telegram and Google sign-ups all open a 14-day trial; sign-up and invite tests follow mandatory verification; hand-over notes
f3c6d82 Telegram sign-in audit: callback tests; unconfirmed session cannot finish a Telegram bind; manual check documented
3127ec4 Google sign-in: ID-token verification against a fixture JWKS, PKCE, state, account rules; code-flow domain tests
a5d69cd Mail: development outbox, production refusal, npm run mail:test, Gmail setup in DEPLOY.md
46ce82c Auth: mandatory e-mail verification with a 6-digit code
```
(plus the commit adding this file)

## Verified, and how

- `npm run typecheck`: 0 errors. `npm run lint`: 0 errors (1 warning in `scripts/lib/xlsx.ts`, pre-existing).
- `npm test`: 1683 tests, 1678 pass, 2 skipped (Redis), **3 fail: `packages/domain/src/demo.test.ts`**,
  a race on the global `demoVisit` count with `apps/api/test/e2e/demo.test.ts` and other sessions
  on the shared DB; the file passes alone (4/4). Neither file is touched here; see hand-over item 3.
- New tests: `packages/domain/src/security/email-code.test.ts` (issue, verify once, wrong entry,
  expiry, lockout after 5, parallel guesses capped, new code retires old, form rate limit, resend
  limit, sign-up through the outbox, production refusal, unconfirmed sign-in → code step);
  `security/google.test.ts` (fixture JWKS: valid token, other key, unknown kid, changed payload,
  issuer, audience, expired, future iat, nonce, alg none/HS256; RFC 7636 PKCE vector; config;
  callback: forged state, new confirmed trial account, same user again, join only a confirmed
  user, unverified Google address, error from Google, key rotation);
  `telegram/login-callbacks.test.ts`; trial on all three paths in `signup.test.ts`;
  `apps/api/test/unit/guards.test.ts` (every ordinary session endpoint in the registry refuses an
  unconfirmed user; exactly `me`, `verifyCode`, `resendCode` allow it; localized message);
  `apps/api/test/e2e/auth.test.ts` (sign-up → 403 on `/api/auth/sessions`, `/api/catalogs`,
  `/api/shell` → wrong code → code → 200; unconfirmed sign-in; resend; Google start and forged state).
- e2e `apps/web/e2e/account-flows.e2e.ts` against 3011 (Edge): 5/5, including the new
  "sign-up: nothing opens before the mailed code; the code leads to the dashboard of a 14-day trial".
- In-app browser on 3011, screenshots in `docs/bugfix-2026-10-23/agent1/`:
  `01` code step after sign-up, `02` wrong code, `03` dashboard after the code, `04` Settings →
  Tarif "14 kun qoldi", `05` banner at 3 days left (trial moved by hand on the test org),
  `06`/`07` Google button on sign-up/sign-in (dummy client id, local `.env` only, removed after),
  `08` unconfirmed sign-in sent to the code step. `/dashboard` and `fetch('/api/catalogs')` for the
  unconfirmed user: redirect to the code step and 403 `unverified`. `GET /api/auth/google` →
  302 to accounts.google.com with `code_challenge_method=S256`, `state`, `nonce`.
- `npm run mail:test -- <address>` without SMTP wrote to `tmp/outbox`.

## Not done / not verified

- Google and Telegram not exercised against the real providers (no credentials): the token
  exchange and the widget need the owner's client and bot. Covered by the fixture-JWKS and
  signed-widget tests; manual steps in `DEPLOY.md` 7c/7d.
- Real SMTP delivery not tested (no credentials); `npm run mail:test` is ready for it.
- Signing up with an already registered address answers "check your e-mail" while a new address
  goes to the code step, so the two are distinguishable (rate-limited per client address). Hiding
  it fully would need a session-less pending state; left as is and documented in `DEPLOY.md` 7c.
- Trial days visible on the dashboard only from 5 days left (existing banner rule; hand-over item 1).
- In the shared in-app browser I signed out twice on `localhost:3011`; since the pane shares one
  `localhost` cookie jar across ports, that may have ended another agent's browser session record
  (they only need to sign in again).

## What the owner must supply

- `SMTP_URL` and `MAIL_FROM` (required in production; sign-up is refused without them). Gmail:
  2-Step Verification + app password, `DEPLOY.md` 7c; then `npm run mail:test -- you@example.com`.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Google Cloud → OAuth client, Web application,
  redirect URI `https://tasnivo.uz/api/auth/google/callback`), optional.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME`, and `/setdomain tasnivo.uz` in BotFather, optional.
- `APP_URL=https://tasnivo.uz` (absolute links and the Google redirect URI).
