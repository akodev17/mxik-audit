# Deploying Tasnivo on a Linux VPS

Everything runs in Docker Compose on one server; the host needs only Docker and a firewall.

```
tasnivo.uz ──► caddy (HTTPS, :80/:443)
                 ├── /api/*          → api     NestJS, port 4000, applies migrations on start
                 └── everything else → web     Next.js, port 3000, no database access
worker  BullMQ jobs (audits, document checks, mail, Telegram) and the schedule
db      Postgres 16 + pgvector          redis   BullMQ queues
backup  nightly pg_dump into ./backups  bot     optional Telegram long polling (profile "bot")
```

The files: `docker-compose.yml`, `Dockerfile` (targets `web`, `api`, `worker`), `infra/Caddyfile`
(HTTPS, `www` redirect), `infra/routes.caddy` (routing, limits, timeouts, headers) and `.env`.
Nothing here depends on a particular provider.

Every `/api/*` address (the app's own calls, downloads, the public API v1, the payment and Telegram
callbacks, cron, health) is served by the api service. The web container renders pages from the
API's answers (`API_INTERNAL_URL=http://api:4000` inside the network); it gets no `.env`, no
`DATABASE_URL` and no `./data`. A server that still has `API_UPSTREAM=web:3000` in `.env` from the
split period: remove the line (compose no longer reads it).

## 0. What you need

- A VPS with Ubuntu 22.04 or 24.04, **4 vCPU and 8 GB RAM recommended**
  (Postgres, the vector index build and the ~1 GB local embedding model share
  it; 4 GB is the bare minimum), 30 GB disk. Audit speed scales with the CPUs
  Postgres gets: on 4 it measured 2.4–15 rows/s depending on the products.
- The domain `tasnivo.uz` with DNS you can edit (section 2).
- Outbound HTTPS to `huggingface.co` once, for the embedding model's weights, and to
  Let's Encrypt for the certificates.
- An SSH login with `sudo`.

Expect about 3–4 hours, most of it embedding the 442,719 classifier names once
on the CPU (step 5). Everything else takes 30–45 minutes.

## 1. Prepare the server

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get -y install ca-certificates curl git ufw unattended-upgrades

# Docker Engine + compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in for this to apply

# Firewall: SSH and web only (443/udp is HTTP/3).
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable
```

Docker-published ports bypass ufw, so the firewall is not what protects the other services:
`docker-compose.yml` publishes only Caddy on all interfaces; Postgres (54329), Redis (63799),
web (3000) and api (4000) bind to `127.0.0.1`, for `curl` and `psql` on the server itself.
Keep it that way when you edit the file.

Docker's default log driver keeps every line forever; each service in `docker-compose.yml`
rotates its logs (10 MB × 5 files).

## 2. DNS for tasnivo.uz

At the registrar or DNS host, point both names at the server:

| Name | Type | Value |
|---|---|---|
| `tasnivo.uz` (`@`) | `A` | the server's IPv4 address |
| `www.tasnivo.uz` | `A` (or `CNAME tasnivo.uz`) | the same |
| both, if the server has IPv6 | `AAAA` | the server's IPv6 address |

Check before the first start: `dig +short tasnivo.uz` and `dig +short www.tasnivo.uz` must print
the server's address. Caddy proves control of the domain to Let's Encrypt over port 80 (HTTP-01)
or 443 (TLS-ALPN-01), so both must be open and DNS must already resolve; a missing `www` record
only costs that name its certificate (the main site still works, Caddy retries). Optionally add a
`CAA` record `0 issue "letsencrypt.org"`.

A CDN or proxy in front of the server (Cloudflare "orange cloud") changes the client address the
rate limits see; see 7g before turning one on.

## 3. Get the code and configure it

```bash
sudo mkdir -p /opt/mxik-audit && sudo chown "$USER" /opt/mxik-audit
git clone <repository-url> /opt/mxik-audit
cd /opt/mxik-audit
cp .env.example .env
chmod 600 .env
```

The checkout's directory name is the compose project name, and the database volume is named
after it (`mxik-audit_mxik-pgdata`): keep `/opt/mxik-audit`.

Edit `.env` (`nano .env`). Every variable is documented in the file, grouped by the service
that reads it. At minimum:

| Variable | Value |
|---|---|
| `SITE_DOMAIN` | `tasnivo.uz` |
| `POSTGRES_PASSWORD` | a long random string: `openssl rand -hex 24` |
| `SESSION_SECRET` | 32+ characters: `openssl rand -hex 32` (64 hex chars). Never rotate it casually (7g) |
| `CRON_SECRET` | 16+ characters: `openssl rand -hex 24`; only for the HTTP cron routes (section 7) |
| `SMTP_URL`, `MAIL_FROM` | your mail provider, e.g. `smtps://user:password@smtp.example.com:465` and `"Tasnivo <no-reply@tasnivo.uz>"`; **required**: sign-up is refused without them (the verification code cannot be sent), and demo requests, invites and password reset need them. Gmail: 7c. Test with `npm run mail:test -- you@example.com` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional: "Google orqali kirish" (7c); empty hides the button |
| `APP_URL` | `https://tasnivo.uz` |
| `NEXT_PUBLIC_SITE_URL` | `https://tasnivo.uz` |
| `NEXT_PUBLIC_DEMO_URL` | `/demo` |
| `NEXT_PUBLIC_TELEGRAM_URL` | your Telegram link, or leave empty to hide it |
| `NEXT_PUBLIC_API_URL` | leave empty: the browser calls `/api` on the page's own origin |
| `ANTHROPIC_API_KEY` | optional; without it suggestions stay capped below bulk-accept |
| `EMBEDDING_PROVIDER` | `local` (already set in `.env.example`) |
| `ADMIN_EMAILS` | sign-in emails allowed to open `/admin`, comma-separated |

`DATABASE_URL`, `REDIS_URL`, `JOBS_MODE` and `DATA_DIR` in `.env` are ignored inside Docker:
compose points the services at the `db` and `redis` containers and at `/app/data`. The
`NEXT_PUBLIC_*` values are compiled into the web image: rebuild it after changing them. The web
container reads nothing else from `.env`: compose passes it `API_INTERNAL_URL`, `APP_URL` and
`LEAD_FILE_RETENTION_DAYS` only.

The import scripts and the services write to `./data` (embedding models, classifier downloads,
the classifier status file), which is mounted into api, worker and bot. The containers run
as uid 1000 (`node`):

```bash
mkdir -p backups
sudo chown -R 1000:1000 data
```

## 4. Build and start the database

```bash
docker compose --profile app build          # three images (web, api, worker), ~5–8 min
docker compose up -d db redis
docker compose ps                           # db and redis should become "healthy"
```

## 5. Create the schema and import the classifier

Operator commands run in the worker image (it has the scripts and `tsx`), as one-off containers
that do not start the rest of the stack. Run once on a fresh server, in this order:

```bash
alias mx='docker compose --profile app run --rm --no-deps worker'

mx npx prisma migrate deploy        # tables and indexes
mx npm run fetch:catalog            # 3 official Excel exports, ~93 MB, ~1 min
mx npm run ingest -- --enrich       # normalize + marking flags, ~10 min
mx npm run load:db                  # ~443k codes into Postgres, ~3 min
mx npm run embed:catalog            # local e5 vectors, both columns, + HNSW indexes, ~3 h on 4 vCPU
mx npm run seed:demo                # the demo catalogue behind /demo, ~1 min
```

Put the alias in `~/.bashrc` (with `cd /opt/mxik-audit` first in your session) to keep it.

`embed:catalog` first downloads the model (~470 MB) into `./data/models`, which
persists across rebuilds. It is resumable: if the session drops, run the same
command again and it continues from `data/embed-checkpoint.json`. Run it inside
`tmux` or `screen` so a dropped SSH session does not stop it.

The HNSW indexes (`m = 32, ef_construction = 200`, `scripts/lib/hnsw.ts`) are
built **serially** with `maintenance_work_mem = 1GB`. A parallel build places
its whole working memory in one shared-memory segment of `maintenance_work_mem`
bytes, and the database container's `/dev/shm` is `shm_size` in
`docker-compose.yml` (2 GB): a 2 GB segment did not fit on 2026-10-22 and the
build failed ("could not resize shared memory segment … No space left on
device"). If you enable parallel builds yourself, keep `maintenance_work_mem`
well below `shm_size`. To rebuild the indexes later without re-embedding (for
example after changing those parameters), run `mx npm run vectors:reindex`
(dry run with `-- --dry-run`): it builds each new index `CONCURRENTLY` beside
the old one, so plan ~0.9 GB of free disk per column, and the app keeps
answering throughout.

`ingest -- --enrich` calls the public tasnif.soliq.uz API for every code; if
that is unreachable from the server, run `mx npm run ingest` (without
`--enrich`) and the marking flag stays unknown.

## 6. Start the stack

```bash
docker compose --profile app up -d
docker compose --profile app ps             # every service "healthy" within a few minutes (backup has no check)
docker compose logs caddy | grep -i certificate   # "certificate obtained successfully" for both names
curl -s https://tasnivo.uz/api/health
# {"status":"ok","database":true,"classifier":{"loaded":true,"takenAt":"2026-10-21T12:51:50.918Z","ageDays":1,"codeCount":442964,"stale":false,"lastUpdate":{"outcome":"success",...}}}
```

Start order is enforced by the healthchecks: db and redis → api (runs `prisma migrate deploy`,
then serves) → worker and web → caddy. `http://tasnivo.uz` and `https://www.tasnivo.uz` redirect
to `https://tasnivo.uz`. The session cookie is `Secure` in production, so sign-in only works
over HTTPS.

`/api/health` answers 503 until the classifier is loaded (section 5), so on an empty database
the api stays "unhealthy" and web, worker and caddy do not start: load the classifier first.

What each healthcheck asks: api `GET /api/health` (database reachable, classifier loaded); worker `GET /healthz` on
`WORKER_PORT`; web a static file (`/icon.svg`, no database); redis `redis-cli ping`; caddy its
admin endpoint; db `pg_isready`. The Telegram bot has no check.

Audits run in the worker. If it restarts mid-audit, it resumes the catalogue from its last
finished row when it starts again.

## 7. Scheduled jobs

The worker runs them itself; there is no host crontab and no scheduler container any more (the
former `scheduler` service and its "unhealthy" status are gone). Times are Uzbekistan time
(UTC+5, no daylight saving), whatever the server's zone:

| Time | Job |
|---|---|
| 03:15 | purge: erase lead files past `LEAD_FILE_RETENTION_DAYS`, delete expired demo copies |
| 03:45 | backup container: `pg_dump` into `./backups` (section 9) |
| 04:00 | classifier update: download, diff, embed new codes, re-check every client's latest catalogue, notify affected orgs (in the app and on Telegram) |
| 06:15 | daily jobs (7e) |

Only one classifier update runs at a time (a Postgres advisory lock); a second start exits. The
daily jobs also start an update when the newest snapshot is more than a day old and none is
running, so a missed 04:00 run catches up. A snapshot of a day or less is left alone.

The same two jobs can be started over HTTP, e.g. from an external scheduler, when `CRON_SECRET`
(16+ characters) is set; without it these routes answer 503. They return at once (the work is
queued for the worker):

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://tasnivo.uz/api/cron/classifier-update
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://tasnivo.uz/api/cron/daily
```

Coming from the single-container setup? Remove its crontab lines (`crontab -e`); they would
run the jobs a second time.

## 7a. Telegram bot (optional)

1. Create a bot with @BotFather; put the token in `.env` as
   `TELEGRAM_BOT_TOKEN`, a long random `TELEGRAM_WEBHOOK_SECRET`, the bot's
   `TELEGRAM_BOT_USERNAME`, and `APP_URL=https://tasnivo.uz`. Recreate the services:
   `docker compose --profile app up -d`.
2. Choose **one** way to receive updates:
   - **Webhook** (recommended on the server): `mx npm run telegram:webhook` points Telegram at
     `https://tasnivo.uz/api/telegram/webhook` (`-- --delete` removes it). Caddy and the api
     serve it; nothing else to run.
   - **Long polling** (no public HTTPS, or for testing): `docker compose --profile app --profile bot up -d bot`.
     The bot removes any webhook when it starts; audits it starts are queued for the worker.
     Do not set the webhook again while it runs.
3. Users link a chat in the app: Sozlamalar → Telegram → "Ulash kodini olish",
   then send `/start CODE` to the bot. Linked chats can send .xlsx/.csv files
   (20 MB Bot API limit), pick the client, and get the summary when the audit
   finishes; classifier-update notifications go to every linked chat.

On a development machine, `npm run telegram:bot` runs the same long-polling bot on the host.

## 7b. Payments (optional)

Click and Payme stay off until their keys are in `.env` (see `.env.example`);
without them no payment button appears and Settings → Tarif says that no
payment provider is configured. Every price — the three subscription tiers, monthly and yearly,
and the one-off catalogue tiers — is in `packages/domain/src/billing/plans.ts` (the landing repeats
them; `tests/web-parity/pricing.test.ts` keeps the two equal; `PLAN_FIRM_PRICE` is no longer read).
Only admins see pay buttons; other roles are told that an administrator pays. A bank transfer is
recorded by hand: `npm run billing:activate -- --org <org id or e-mail> --plan company_yearly`
(optionally `--amount` when a different sum was agreed, `--catalog <id>` for a one-off catalogue);
it writes a paid order with provider `bank` and extends the subscription by 1 or 12 months.
Set `NEXT_PUBLIC_ONLINE_PAYMENT=true` in the web build once Click or Payme works, so the landing
pricing note mentions it.

- **Click** (SHOP API): in the merchant cabinet set both Prepare URL and
  Complete URL to `https://tasnivo.uz/api/payments/click`; put
  `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY` in `.env`.
- **Payme** (Merchant API): set the endpoint to
  `https://tasnivo.uz/api/payments/payme`, account field `order_id`; put
  `PAYME_MERCHANT_ID` and `PAYME_KEY`. For the sandbox
  (test.paycom.uz), set `PAYME_TEST_MODE=true` and `PAYME_TEST_KEY`.
- `APP_URL` must be the public https origin (return links after payment).
- `BILLING_REQUIRED_FOR_EXPORT=true` makes the corrected-file download
  require a paid order for that catalogue or an active subscription. The landing promises the free
  plan has no corrected file, so production needs it.

The callback URLs stayed the same through the backend split: Caddy sends `/api/payments/*` to the
api service. A paid order writes `billing.paid` to the audit log;
orders and provider transactions are in the `order` and `payment_transaction` tables.

## 7c. Team, email and roles (optional)

### Email delivery (required) and Gmail

Every password sign-up must confirm its address with a 6-digit code sent by mail before anything
else in the app opens, so production needs `SMTP_URL` and `MAIL_FROM`. Without them the API logs
an error at start-up and `/sign-up` answers "temporarily unavailable"; it never lets an account in
unconfirmed. (In development, without SMTP, every message goes to the API log and to
`tmp/outbox/<time>.txt`; read the code there.)

With a Gmail or Google Workspace mailbox:

1. Turn on 2-Step Verification for the account (myaccount.google.com → Security).
2. Create an app password: myaccount.google.com/apppasswords → name it "Tasnivo" → copy the
   16 letters (leave the spaces out).
3. In `.env`:
   ```
   SMTP_URL=smtps://you%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465
   MAIL_FROM="Tasnivo <you@gmail.com>"
   ```
   The `@` of the address is written `%40` inside the URL. `MAIL_FROM` must be that mailbox
   (or an alias set up in Gmail → "Send mail as"), or Gmail rewrites the sender.
4. Recreate the api and worker (`docker compose up -d api worker`) and send a test:
   `docker compose exec api npm run mail:test -- you@example.com` (locally:
   `npm run mail:test -- you@example.com`). "Sent to …" means Gmail accepted it; `Invalid login`
   means the app password or the address is wrong. Gmail limits a personal account to about 500
   recipients a day; for more, use Workspace or a transactional provider (any `smtp://` /
   `smtps://` URL works).

Codes are valid 15 minutes, a code allows 5 wrong entries, a new code replaces the old one, code
entries are limited to 10 per 15 minutes per user, and "Kodni qayta yuborish" to 3 an hour per
address. Links from confirmation mails sent before the codes still work for their 48 hours.

### Google sign-in (optional)

1. Google Cloud Console → APIs & Services → OAuth consent screen: External, app name Tasnivo,
   scopes `openid`, `email`, `profile`; publish it.
2. Credentials → Create credentials → OAuth client ID → Web application. Authorised redirect URI:
   `https://tasnivo.uz/api/auth/google/callback` (for local testing add
   `http://localhost:3000/api/auth/google/callback` and set `GOOGLE_REDIRECT_URI` to it).
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and recreate the
   api. The button appears on /sign-in and /sign-up.

The flow is the authorization-code flow with PKCE, a one-time `state` and a `nonce` (kept in the
session cookie for 10 minutes); the ID token is checked against Google's published keys
(signature, issuer, audience, expiry, nonce). A Google account whose address Google has verified
signs in as the user bound to it; else as the user with the same address **if that address is
already confirmed** (the Google account is then bound to them, `security.google_bound`); an
unconfirmed account with that address is refused (sign in with the password and confirm it
first). Otherwise a new 14-day trial account is opened, confirmed. A Google-only account has a
random password; "Parolni unutdingizmi?" sets one.

### Team

Members join through invite links created in Sozlamalar. To also email the link set `SMTP_URL` and `MAIL_FROM`; without them the link is only shown on screen. `APP_URL` makes links absolute (emailed confirmation and password-reset links need it). Roles: admin (everything), accountant (works on assigned clients), viewer (read-only). An accountant or viewer with no assigned clients sees every client of the org.

Removing a member (Sozlamalar → Jamoa) is one transaction, checked first so the last admin can never be removed: their sessions end, the API keys they created are revoked (an `apikey.revoked` event per key; programs using those keys get 401), the Telegram chats they linked are unlinked and their pending invites are deleted; `team.removed` records the counts. The API key list shows who created each key.

Address confirmation and invites:

- An invite created **with** an email address confirms that address when it is accepted (the admin chose it).
- An invite created **without** one lets the person type any address. A verification code is mailed on join and the member lands on the code step; nothing else opens until the code is entered (a new code can be requested there, and signing in again leads back to it).
- Members who joined through an emailed invite before this version were never marked confirmed. Before turning SMTP on, confirm them once:

```bash
docker exec -it mxik-audit-db psql -U mxik mxik -c "UPDATE \"user\" u SET \"emailVerifiedAt\" = now() FROM invite i WHERE u.\"emailVerifiedAt\" IS NULL AND i.\"usedAt\" IS NOT NULL AND i.\"orgId\" = u.\"orgId\" AND lower(i.email) = u.email;"
```

Signing up with an address that already has an account answers exactly like a new address: the same `{ redirect: "/sign-up/verify" }`, status and session cookie, so the sign-up form and the API cannot tell registered addresses apart. The cookie is a decoy (`packages/domain/src/security/decoy.ts`): it names no user, `/api/auth/me` shows it as a new unconfirmed admin, every other signed-in endpoint answers 403 `unverified`, no code confirms it ("wrong code", with the same per-user limit) and "send again" says the code was sent without mailing anything. Sign-up stays rate-limited per client address (8 an hour, 7g). The owner gets either a "someone tried to sign up" note (confirmed account) or a link to confirm and choose a password (unconfirmed account), so the sign-up page never reveals which addresses are registered and nobody can pre-register someone else's address with a password they know.

## 7d. Signup, trial and plan limits

/sign-up opens a 14-day trial organisation (`trialEndsAt` = now + 14 days, set when the organisation is created) and signs the new admin in to the code step: the address must be confirmed with the mailed code (7c) before any other page or API call works (the API answers 403 `unverified`). Accounts opened with Telegram or Google get the same trial and count as confirmed. Limits (clients, rows per month, seats, API checks) are each plan's, in `packages/domain/src/billing/plans.ts` (the trial and the tiers; the tier is that of the org's latest paid subscription order, the top tier when a subscription was set by hand). At 80% the app warns, at 100% (or after the trial) uploads, new clients and invites are refused while everything stays readable; upgrade goes through the Click/Payme flow or a recorded bank transfer (7b).

An upload waits at the column-mapping step as an uncommitted preview, and its rows count against the monthly allowance only once the mapping is confirmed. Previews are limited on their own: a user's new upload deletes their earlier open preview, an upload is refused (with a message) when the org's open preview rows from the last 24 hours would exceed the plan's monthly row limit (200,000 when the plan has none; `PREVIEW_ROWS_UNCAPPED` in `packages/domain/src/plan.ts`), and the daily job (7e) deletes previews left for 48 hours. Each deletion writes `catalog.upload_discarded` with `reason` `replaced` or `expired` (the latter without an actor). These numbers are not `.env` settings.

Uploads are limited to 20 MB by the app and to 30 MB per request body by Caddy (`infra/routes.caddy`); catalogue uploads, exports and the public API may take up to 300 s, other `/api` requests 60 s to start answering.

"Telegram orqali kirish" appears when TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME are set and the bot domain is registered with BotFather (`/setdomain` → `tasnivo.uz`). It is covered by automated tests of the signature check and the account logic, not yet by a live bot. How Telegram sign-in decides who you are is in 7g.

Manual check with a real bot (once, after deploy):

1. @BotFather → `/newbot` (or the existing bot) → note the token and the @username; `/setdomain` →
   the bot → `tasnivo.uz` (for a local test, a tunnel's HTTPS host: the widget refuses `localhost`).
2. `.env`: `TELEGRAM_BOT_TOKEN=…`, `TELEGRAM_BOT_USERNAME=…` (without @); recreate the api and web.
3. In a private window open /sign-in → the Telegram button → confirm in Telegram. A Telegram account
   never seen before lands on /dashboard of a new trial org (the plan banner shows 14 days left);
   the audit log has `account.created` with `via: telegram`.
4. Sign out, sign in with the same Telegram account → the same org (no second org).
5. As a password user: Settings → Xavfsizlik → bind Telegram, sign out, sign in with Telegram →
   that user. A Telegram id that is only a notification chat of some org, never bound, is refused
   (`telegram_unbound`).

## 7e. Daily jobs (monthly reminders)

The worker runs them at 06:15 (section 7); `POST /api/cron/daily` with `CRON_SECRET` starts them by hand or from an external scheduler. Besides the jobs below they start a classifier update (section 7, same lock and log) when the newest snapshot is more than a day old and none is running.

They create the monthly-check tasks that are due (per client: Sozlamalar of the client page), tell the accountant responsible on Telegram when the bot is configured, delete upload previews left uncommitted for 48 hours (7d) and run the retention jobs listed in 7g. Dates use Uzbekistan time (UTC+5).

## 7f. Public API

Admins create keys in Settings → Integratsiyalar (shown once, only a hash is stored). Endpoints: `POST https://tasnivo.uz/api/v1/check`, `GET /api/v1/catalogs` (paged with `limit` and `cursor`), `POST /api/v1/catalogs`, `GET /api/v1/catalogs/:id/report`; spec at `/api/v1/openapi.json`, docs at `/api-docs` (the api's Swagger UI at `/api/docs` once Wave 2 has moved the routes; the v1 contract does not change). Every response to a valid key carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`. Both POST endpoints accept `Idempotency-Key`: a repeat with the same key under the same API key within 24 hours returns the first successful response (`Idempotent-Replayed: true`); rows live in `api_idempotency` and the daily job (7e) prunes them.
Limits: `API_RATE_PER_MINUTE` (kept per process, so it resets on restart and is per instance), `API_CHECK_MAX_ITEMS` and `API_CHECK_CONCURRENCY` (checks one API process runs at once, default 4; beyond it `/api/v1/check` answers 429 `rate_limited` with `Retry-After: 2`, so a burst cannot multiply matching work) are config; the API process keeps one embedding provider for its life (a local model loads its weights once); the monthly check allowance is each plan's (`packages/domain/src/billing/plans.ts`). Uploaded rows count against the plan's monthly row limit like uploads in the app. Set `APP_URL` so the OpenAPI document names the public origin.

## 7g. Security and data control

- **Two-factor sign-in** (authenticator app, 6-digit TOTP, set up by scanning a QR code) and one-time recovery codes are per user, in Settings. The TOTP secret is stored encrypted, and recovery codes (80 bits each) as an HMAC, both with keys derived from `SESSION_SECRET`: if you rotate `SESSION_SECRET`, two-factor secrets and recovery codes stop working and those users need an operator to turn two-factor off (`UPDATE "user" SET "totpSecret" = NULL, "totpEnabledAt" = NULL, "totpLastStep" = NULL WHERE email = '...'`) before they set it up again. Recovery codes issued before this version keep working until regenerated. Five wrong codes end a pending sign-in (the password is asked again); ten wrong codes per user per hour block further tries for that hour. The web app and the api read the same session cookie with the same secret; do not rotate it during the backend split.
- **Active sessions** are recorded in the database; a user can end any of their sessions in Settings. A session not seen for 7 days (the cookie lifetime) is dead. Cookies without a session record (issued before session records existed) are no longer accepted: those users sign in once more. Demo visitors are the only sessions without a record.
- **Rate limits** live in the `auth_attempt` table, so they survive restarts and apply across instances: 5 password attempts per email per 15 minutes (then a cooldown message; the right password clears the count), 30 sign-in attempts per client address per 15 minutes, 3 password-reset and 3 confirmation-resend mails per address per hour (10 per client address), 8 signups per client address per hour. The client address is `X-Real-IP`, else the **rightmost** `X-Forwarded-For` hop, never the leftmost (the client writes that one), and only when `TRUST_PROXY=1` says a proxy sets them (`docker-compose.yml` sets it for the api behind Caddy). Without it in production (`NODE_ENV=production`, or `TRUST_PROXY=0` anywhere) the headers are ignored and the socket address is used, so an API reached around the proxy (port exposed, `NEXT_PUBLIC_API_URL` on another origin, the web's `/api` rewrite without Caddy) cannot pick a fresh bucket by sending its own `X-Real-IP`; set `TRUST_PROXY` only where every request comes through a proxy that overwrites these headers. Caddy sets `X-Real-IP` to the connection's address and replaces any `X-Forwarded-For` a client sends (`infra/routes.caddy`); keep web and api bound to 127.0.0.1 so nothing reaches them around Caddy. If a CDN or another proxy sits in front of Caddy, add its address ranges as `trusted_proxies` in the global options of `infra/Caddyfile` (`servers { trusted_proxies static <ranges> }`), or every visitor shares the proxy's address. Stored keys are HMACs, not raw emails or addresses. The daily job (7e) deletes attempts older than a day.
- **Passwords**: Settings → Xavfsizlik changes the password (the current one is required; every other session of the user ends; `security.password_changed` in the audit log). "Parolni unutdingizmi?" on the sign-in page mails a reset link (1 hour, single use, only the newest link works; using it sets the password, confirms the address and ends every session of the user; `security.password_reset`). The page answers the same whether or not the address has an account. **Without SMTP no link can be sent**; the page says an administrator has to set the password, and the operator does it on the server:

```bash
mx npm run password:set -- user@example.com                   # prints a new random password once
echo 'new-password' | docker compose --profile app run --rm --no-deps -T worker npm run password:set -- user@example.com --stdin
mx npm run password:set -- user@example.com --confirm-email   # also marks the address confirmed
```

  It ends every session of that user and writes `security.password_reset` (via operator). Ask the user to change the printed password in Settings.
- **Telegram sign-in** ("Telegram orqali kirish") signs in only the user who bound that Telegram account in Settings → Xavfsizlik while signed in (the widget's callback carries a one-time state from that browser's session, so a link from someone else cannot bind their Telegram to your account). Notification chats linked with a code (7a) never sign anyone in: a Telegram account that is only such a chat is refused with a message to sign in by email and bind Telegram in Settings. Removing a member deletes their binding with the user. A Telegram account seen nowhere opens a new 14-day trial account bound to it (the self-serve behaviour that existed before; that account's placeholder address ends in `.invalid`, it cannot be used to sign up or join, and the binding of such an account cannot be removed because it has no other way in). Accounts opened with Telegram before this version are bound on their next Telegram sign-in. The widget's signed data is accepted for 5 minutes and only once (replays are refused).
- **Platform admin** (`/admin`, cross-org numbers) needs all three: the `platformAdmin` flag on the user, the address listed in `ADMIN_EMAILS`, and the address confirmed. The flag is set only by hand:

```bash
docker exec -it mxik-audit-db psql -U mxik mxik -c "UPDATE \"user\" SET \"platformAdmin\" = true, \"emailVerifiedAt\" = COALESCE(\"emailVerifiedAt\", now()) WHERE email = 'owner@example.uz';"
# revoke: UPDATE "user" SET "platformAdmin" = false WHERE email = 'owner@example.uz';
```

- **Closed accounts** stop everything that runs without a sign-in: API keys, share links, the Telegram bot (the chat is treated as unlinked; notifications and audit summaries are not sent; old link codes do nothing).
- **HTTP headers** (`packages/domain/src/security/headers.ts`, sent by the web app on every route): Content-Security-Policy (`default-src 'self'`, `frame-ancestors 'none'`, scripts from the site and `https://telegram.org` for the login widget, its iframe from `https://oauth.telegram.org`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (no camera, microphone, geolocation), `X-Frame-Options: DENY`, and in production `Strict-Transport-Security: max-age=31536000`. `script-src` keeps `'unsafe-inline'` because Next.js bootstraps pages with inline scripts; per-request nonces would need middleware and a verified production build, which is future work. `'unsafe-eval'` and the hot-reload websocket are allowed only in development. Caddy adds the same values (except the CSP) only to responses that lack them, e.g. from the api, and never a second copy: with two `Content-Security-Policy` headers the browser enforces both, so keep `set` directives for these out of the Caddyfiles.
- **Landing-page lead form** accepts files up to 5 MB, and an .xlsx that would inflate past 100 MB (or has more than 5,000 entries) is refused before it is parsed.
- **Account data export** (admin, Settings): a zip with team, clients, dictionary, activity log and one Excel file per catalogue. Passwords, API keys and two-factor secrets are never included.
- **Closing an account**: the admin confirms with the password; nobody can sign in except an admin, who may restore the account. After `ACCOUNT_DELETE_AFTER_DAYS` (default 30) the daily job (section 7e) erases the organisation and everything under it, including its log entries.
- **Raw-file retention**: each org chooses 7, 30 (default) or 90 days, or "keep". The daily job blanks the uploaded cells that are not in a mapped column (names, codes, units, prices are kept, so reports and exports keep working). It is never retroactive: only uploads created at or after the org's `organization."rawRetentionSince"` are blanked, once older than the window. That date is when the org was created, and for orgs that existed before retention shipped, the moment its migration ran; uploads from before it are never touched, and an org whose `rawRetentionSince` is NULL is skipped entirely. Settings → Maʼlumotlar shows the date. Changing the window does not move it; to apply retention to an org's older uploads (only on that org's written request) set it earlier by hand, e.g. `UPDATE organization SET "rawRetentionSince" = '2026-01-01' WHERE id = '...';`.
- **The server**: only ports 22, 80 and 443 open (section 1); `.env` readable by its owner only (`chmod 600`); SSH with keys (`PasswordAuthentication no` in `/etc/ssh/sshd_config`); `unattended-upgrades` installs security updates. Images are rebuilt from `node:22-bookworm-slim` on every upgrade (8), which picks up its patches.

## 8. Operating it

| Task | Command |
|---|---|
| Status of every service | `docker compose --profile app ps` |
| Health (public / on the server) | `curl -s https://tasnivo.uz/api/health` / `curl -s http://127.0.0.1:4000/api/health` |
| Logs | `docker compose --profile app logs -f --tail=200 api worker` (also `web`, `caddy`, `db`, `bot`) |
| Restart one service | `docker compose --profile app restart worker` |
| Queue state | `docker compose exec redis redis-cli --scan --pattern 'bull:*' \| head` |
| Erase a lead's file on request | `mx npm run lead:delete -- --list`, then `mx npm run lead:delete -- <leadId>` (`--all` also removes the contact) |
| Rebuild the demo | `mx npm run seed:demo` |
| Which LLM/embedding setup is active | `mx npm run check:providers` |
| Traction metrics | `https://tasnivo.uz/admin`, signed in as a platform admin (7g) |
| Set a user's password (no SMTP) | `mx npm run password:set -- user@example.com` (7g) |
| psql | `docker exec -it mxik-audit-db psql -U mxik mxik` |

### Updating to a new version

```bash
cd /opt/mxik-audit
git pull
docker compose --profile app build          # or `pull`, if the images come from a registry
docker compose --profile app up -d --remove-orphans
docker compose --profile app ps
```

`up -d` recreates every service whose image changed. The api applies pending migrations
(`prisma migrate deploy`) before it starts serving, and the worker and web wait until the api is
healthy, so the order build → migrate → restart is kept without extra steps. Watch it with
`docker compose logs -f api`. Never run `prisma migrate dev` against this database; see README
"Migrations".

The Prisma client is generated into each image at build time and has to match the schema, so
every service must run an image built from the same commit (`build` then `up -d` does this). A
container still running an old image reads a finding type a new migration added as "OTHER" (a
neutral "other finding" label; the API reports `"OTHER"`) and logs
`[db] finding_type holds a value this Prisma client does not know` once; recreate it from the
new image to see the real type.

Rolling back: `git checkout <previous tag>`, then `build` and `up -d` as above. Migrations are
not undone; a release whose migration the previous version cannot read says so in its notes,
and the way back is the restore of section 9.

### Moving from the single-container setup (nginx, `app`, `scheduler`)

Once, on a server that ran the previous `docker-compose.yml` behind nginx and certbot:

```bash
cd /opt/mxik-audit && git pull                 # then add SITE_DOMAIN and CRON_SECRET to .env
docker compose --profile app build
sudo systemctl disable --now nginx certbot.timer   # Caddy takes ports 80 and 443 and its own certificates
crontab -e                                     # delete the mxik lines: the worker schedules the jobs now
docker compose --profile app up -d --remove-orphans   # removes the old app, scheduler, telegram-bot containers
```

The database volume and `./data`, `./backups` are reused as they are; nothing is migrated by hand.
If the long-polling bot ran before, start it again with `--profile bot` (its service is now `bot`).

### Codes restricted in EHF

The RESTRICTED check reads table `restricted_code`, loaded from the official
list of generalized construction codes (perechen.xlsx: header "МХИК коди" on
row 4, data from row 5; announced in tasnif.soliq.uz news 5063). Load it once,
and again whenever a further stage of the list is published (copy the file into `./data` first,
the container sees it as `data/...`):

```bash
mx npm run load:restricted -- data/perechen.xlsx                       # from 2026-07-01
mx npm run load:restricted -- data/next-stage.xlsx --from YYYY-MM-DD --source <news url>
```

It upserts and prints how many codes were added, updated and found in the
classifier. Audits started afterwards use the list; earlier audits keep their
findings.

### Refreshing the classifier

The portal regenerates its export on every request. The worker picks up new codes daily
(section 7); by hand:

```bash
mx npm run classifier:update                    # what the 04:00 job runs
mx npm run classifier:update -- --dry-run       # download and show the diff, write nothing; prints the
                                                # snapshot age before and the counts after
mx npm run classifier:update -- --recheck <id>  # re-check clients against snapshot <id> again
```

The update downloads the export, records a new snapshot with its diff
(added, retired, unit binding changed, name changed — table
`classifier_change`), marks vanished codes as retired, embeds only the codes
it added (same model as the stored vectors), then re-checks every client's
latest catalogue: rows whose code changed are re-checked and new problems are
added with the reason prefix "Tasniflagich yangilandi:"; earlier decisions are
kept. Each affected client gets a `classifier.updated` event and a
notification.

#### Stale copy: banner and health

The classifier changes often and a retired code that the copy still lists would be
confirmed by the audit, so a stale copy is made visible:

- **Banner.** The catalogue workspace and the catalogue report show a warning (Uzbek or
  Russian) when the newest snapshot is more than 7 days old, or when the last update
  failed. A failure counts until a newer snapshot is loaded. The rule is `packages/domain/src/classifier-freshness.ts`.
- **Health.** `/api/health` has `classifier.takenAt`, `ageDays`, `codeCount`, `stale` (the same
  7-day rule) and `lastUpdate` (`outcome` `success` or `failed`, `at`, and the failure
  `message`, one line from the update script). A stale copy does not turn the status to
  503, so point an uptime check at `classifier.stale` or `ageDays` if it should alert.
- **Where the outcome is kept.** `catalog_snapshot` only records updates that succeeded, so
  each run also writes `data/classifier-update-status.json` (override with
  `CLASSIFIER_UPDATE_STATUS`); `data/` is the host folder mounted into api, worker, bot and web.
  Dry runs and a start refused by the lock write nothing. If the file is missing, the last
  update is taken to be the newest snapshot.
- After a failure read `data/classifier-update.log` and `docker compose logs worker`, fix the
  cause and run the update by hand.

`npm run embed:catalog` is only needed to switch embedding models: it
re-embeds every code (~2.7 h on 4 vCPU) and the vector stage stays off until it
finishes. Run it off-hours.

## 9. Backups

The `backup` service writes `./backups/mxik-YYYY-MM-DD.dump` (`pg_dump -Fc`) at 03:45 UTC+5 and
keeps 14. A backup on the same disk is not a backup: copy them off the server every day. Redis
holds only queued jobs and is not backed up; `./data` can be rebuilt (section 5) but saves hours,
so copy `data/classifier-update-status.json` along if you like.

**With rclone** (any S3-compatible storage, Backblaze B2, Google Drive, another server over SFTP):

```bash
sudo apt-get -y install rclone
rclone config                                   # create a remote, e.g. "offsite"
crontab -e
# 04:30 UTC+5 = 23:30 UTC; adjust to the server's clock (`timedatectl`).
30 23 * * * rclone copy /opt/mxik-audit/backups offsite:tasnivo-backups --max-age 48h >> /var/log/mxik-offsite.log 2>&1
```

`rclone copy` never deletes on the remote; set a lifecycle rule there (e.g. keep 90 days).

**Without extra tools**, pull from another machine you control (its own cron, so the VPS holds
no credentials for the backup host):

```bash
rsync -av --ignore-existing deploy@tasnivo.uz:/opt/mxik-audit/backups/ ~/tasnivo-backups/
# or: scp deploy@tasnivo.uz:/opt/mxik-audit/backups/mxik-$(date +%F).dump ~/tasnivo-backups/
```

### Restore drill (monthly)

Restore the newest dump into a throwaway database next to the real one and look at it; nothing
running is touched:

```bash
cd /opt/mxik-audit
docker run -d --name mxik-restore-test -e POSTGRES_PASSWORD=drill -e POSTGRES_USER=mxik -e POSTGRES_DB=mxik \
  --shm-size=1g pgvector/pgvector:pg16
sleep 10
docker exec -i mxik-restore-test pg_restore -U mxik -d mxik --no-owner < "$(ls -t backups/*.dump | head -1)"
docker exec mxik-restore-test psql -U mxik mxik -c 'SELECT count(*) FROM catalog;' -c 'SELECT max("createdAt") FROM catalog;'
docker rm -f mxik-restore-test
```

The counts should match production (`docker exec mxik-audit-db psql -U mxik mxik -c 'SELECT count(*) FROM catalog;'`)
up to the last day's work. Do the same once with a dump fetched back from off-server storage.

### Restoring for real

```bash
docker compose --profile app stop caddy web api worker
docker compose --profile bot stop bot 2>/dev/null
docker exec -i mxik-audit-db pg_restore -U mxik -d mxik --clean --if-exists < backups/mxik-YYYY-MM-DD.dump
docker compose --profile app up -d
```

The api re-applies any migration newer than the dump when it starts. Audits that were running
when the dump was taken resume from their last finished row.

## 10. Local testing of the production routing

`docker compose --profile local up -d caddy-local` serves `infra/routes.caddy` on
http://localhost:8080 without TLS, proxying to the dev servers on the host (`npm run dev` on 3000,
the api on 4000), or set `LOCAL_WEB_UPSTREAM=web:3000` and `LOCAL_API_UPSTREAM=api:4000` (with the
`app` profile) to test the containers. The e2e suite runs against it:
`E2E_BASE_URL=http://localhost:8080 npm run test:e2e` (add `E2E_CHANNEL=msedge` where Playwright's
own Chromium is not installed).
