# Deploying Tasnivo on a Linux VPS

Docker runs the app and Postgres (with pgvector); nginx on the host terminates
HTTPS and proxies to the app. Nothing here depends on a particular provider.

## 0. What you need

- A VPS with Ubuntu 22.04 or 24.04, **4 vCPU and 8 GB RAM recommended**
  (Postgres, the vector index build and the ~1 GB local embedding model share
  it; 4 GB is the bare minimum), 30 GB disk. Audit speed scales with the CPUs
  Postgres gets: on 4 it measured 2.4–15 rows/s depending on the products.
- A domain name with an `A` record pointing at the server's IP.
- Outbound HTTPS to `huggingface.co` once, for the embedding model's weights.
- An SSH login with `sudo`.

Expect about 3–4 hours, most of it embedding the 442,719 classifier names once
on the CPU (step 4). Everything else takes 30–45 minutes.

## 1. Prepare the server

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get -y install ca-certificates curl git nginx ufw

# Docker Engine + compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in for this to apply

# Firewall: SSH and web only. Postgres and the app bind to 127.0.0.1 in
# docker-compose.yml, so they are never reachable from outside.
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

## 2. Get the code and configure it

```bash
sudo mkdir -p /opt/mxik-audit && sudo chown "$USER" /opt/mxik-audit
git clone <repository-url> /opt/mxik-audit
cd /opt/mxik-audit
cp .env.example .env
```

Edit `.env` (`nano .env`). Every variable is documented in the file. At minimum:

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD` | a long random string: `openssl rand -hex 24` |
| `SESSION_SECRET` | 64 hex chars: `openssl rand -hex 32` |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain` |
| `NEXT_PUBLIC_DEMO_URL` | `/demo` |
| `NEXT_PUBLIC_TELEGRAM_URL` | your Telegram link, or leave empty to hide it |
| `ANTHROPIC_API_KEY` | optional; without it suggestions stay capped below bulk-accept |
| `EMBEDDING_PROVIDER` | `local` (already set in `.env.example`) |
| `ADMIN_EMAILS` | sign-in emails allowed to open `/admin`, comma-separated |

`DATABASE_URL` in `.env` is ignored inside Docker; compose points the app at
the `db` container itself.

The import scripts write to `./data`, which is mounted into the container. The
container runs as uid 1000:

```bash
sudo chown -R 1000:1000 data
```

## 3. Build and start the database

```bash
docker compose --profile app build          # ~3–5 min
docker compose up -d db
docker compose ps                           # db should become "healthy"
```

## 4. Create the schema and import the classifier

Run once on a fresh server, in this order:

```bash
alias mx='docker compose --profile app run --rm app'

mx npx prisma migrate deploy        # tables and indexes
mx npm run fetch:catalog            # 3 official Excel exports, ~93 MB, ~1 min
mx npm run ingest -- --enrich       # normalize + marking flags, ~10 min
mx npm run load:db                  # ~443k codes into Postgres, ~3 min
mx npm run embed:catalog            # local e5 vectors, both columns, + HNSW indexes, ~3 h on 4 vCPU
mx npm run seed:demo                # the demo catalogue behind /demo, ~1 min
```

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

## 5. Start the app

```bash
docker compose --profile app up -d app
curl -s http://127.0.0.1:3000/api/health    # {"status":"ok","database":true,"classifier":true}
```

Audits run in the background. If the app restarts mid-audit, it resumes the
catalogue from its last finished row on startup.

## 6. nginx and HTTPS

Create `/etc/nginx/sites-available/mxik-audit` (replace `your-domain`):

```nginx
server {
    listen 80;
    server_name your-domain;

    # Catalogue uploads are up to 20 MB.
    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # A large catalogue is audited inside the upload request.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mxik-audit /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo apt-get -y install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain       # adds the 443 server and the redirect
```

Certbot renews automatically. The session cookie is `Secure` in production,
so sign-in only works over HTTPS.

## 7. Scheduled jobs

The times below are Uzbekistan time (UTC+5, no daylight saving). Host cron runs
on the server's clock, which is usually UTC: set the zone once with
`sudo timedatectl set-timezone Asia/Tashkent`, or subtract 5 hours from every
time. The app itself always shows and groups dates in `Asia/Tashkent`, whatever
the server's zone, and the compose scheduler and backup (section 9) keep UTC+5
on their own, so no `TZ` variable is needed in `.env`.

`crontab -e` and add:

```cron
# Erase lead files past LEAD_FILE_RETENTION_DAYS and delete expired demo copies.
15 3 * * * cd /opt/mxik-audit && docker compose --profile app exec -T app npm run purge:expired >> /var/log/mxik-purge.log 2>&1
# Weekly classifier update: download, diff, embed new codes, re-check every
# client's latest catalogue, notify affected orgs (in the app and on Telegram).
0 4 * * 1 cd /opt/mxik-audit && docker compose --profile app exec -T app npm run classifier:update >> /var/log/mxik-classifier.log 2>&1
# Nightly database backup, 14 kept.
45 3 * * * docker exec mxik-audit-db pg_dump -U mxik -Fc mxik > /opt/mxik-audit/backups/mxik-$(date +\%F).dump && find /opt/mxik-audit/backups -name '*.dump' -mtime +14 -delete
```

```bash
mkdir -p /opt/mxik-audit/backups
sudo touch /var/log/mxik-purge.log /var/log/mxik-classifier.log && sudo chown "$USER" /var/log/mxik-purge.log /var/log/mxik-classifier.log
```

The classifier update can also be started over HTTP, e.g. from an external
scheduler, when `CRON_SECRET` (16+ characters) is set in `.env`; without it
the route answers 503. It returns 202 at once and writes its log to
`data/classifier-update.log` inside the container:

```cron
0 4 * * 1 curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/classifier-update
```

Only one update runs at a time (a Postgres advisory lock); a second start exits.

Copy backups off the server too; a backup on the same disk is not a backup.

## 7a. Telegram bot (optional)

1. Create a bot with @BotFather; put the token in `.env` as
   `TELEGRAM_BOT_TOKEN`, a long random `TELEGRAM_WEBHOOK_SECRET`, the bot's
   `TELEGRAM_BOT_USERNAME`, and `APP_URL=https://your-domain`. Restart the app.
2. Point Telegram at the app once: `mx npm run telegram:webhook`
   (`-- --delete` removes it).
3. Users link a chat in the app: Sozlamalar → Telegram → "Ulash kodini olish",
   then send `/start CODE` to the bot. Linked chats can send .xlsx/.csv files
   (20 MB Bot API limit), pick the client, and get the summary when the audit
   finishes; classifier-update notifications go to every linked chat.

Without a public HTTPS URL (development), run the bot with long polling
instead: `npm run telegram:bot` (it removes any webhook first; audits started
from the bot run in that process).

## 7b. Payments (optional)

Click and Payme stay off until their keys are in `.env` (see `.env.example`);
without them no payment button appears and Settings → Tarif says that no
payment provider is configured. Catalogue prices: `src/lib/billing/plans.ts`.
The firm monthly price is `PLAN_FIRM_PRICE` (whole soʻm); while it is unset
the plan is not for sale and Settings says the price is not set. Only admins
see pay buttons; other roles are told that an administrator pays.

- **Click** (SHOP API): in the merchant cabinet set both Prepare URL and
  Complete URL to `https://your-domain/api/payments/click`; put
  `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY` in `.env`.
- **Payme** (Merchant API): set the endpoint to
  `https://your-domain/api/payments/payme`, account field `order_id`; put
  `PAYME_MERCHANT_ID` and `PAYME_KEY`. For the sandbox
  (test.paycom.uz), set `PAYME_TEST_MODE=true` and `PAYME_TEST_KEY`.
- `APP_URL` must be the public https origin (return links after payment).
- `BILLING_REQUIRED_FOR_EXPORT=true` makes the corrected-file download
  require a paid order for that catalogue or an active firm subscription.

A paid order writes `billing.paid` to the audit log; orders and provider
transactions are in the `order` and `payment_transaction` tables.

## 7c. Team, email and roles (optional)

Members join through invite links created in Sozlamalar. To also email the link set `SMTP_URL` and `MAIL_FROM`; without them the link is only shown on screen. `APP_URL` makes links absolute (emailed confirmation and password-reset links need it). Roles: admin (everything), accountant (works on assigned clients), viewer (read-only). An accountant or viewer with no assigned clients sees every client of the org.

Removing a member (Sozlamalar → Jamoa) is one transaction, checked first so the last admin can never be removed: their sessions end, the API keys they created are revoked (an `apikey.revoked` event per key; programs using those keys get 401), the Telegram chats they linked are unlinked and their pending invites are deleted; `team.removed` records the counts. The API key list shows who created each key.

Address confirmation and invites:

- An invite created **with** an email address confirms that address when it is accepted (the admin chose it).
- An invite created **without** one lets the person type any address. With SMTP on, a confirmation link is mailed on join; until it is opened the member cannot sign in again with the password. Without SMTP the address stays unconfirmed, and once you configure SMTP the member is asked to confirm it at the next sign-in ("Tasdiqlash havolasini qayta yuborish" on the sign-in page sends a new link; it needs the right email and password, and answers the same either way).
- Members who joined through an emailed invite before this version were never marked confirmed. Before turning SMTP on, confirm them once:

```bash
docker exec -it mxik-audit-db psql -U mxik mxik -c "UPDATE \"user\" u SET \"emailVerifiedAt\" = now() FROM invite i WHERE u.\"emailVerifiedAt\" IS NULL AND i.\"usedAt\" IS NOT NULL AND i.\"orgId\" = u.\"orgId\" AND lower(i.email) = u.email;"
```

With SMTP on, signing up with an address that already has an account answers "check your email" exactly like a new signup; the owner gets either a "someone tried to sign up" note (confirmed account) or a link to confirm and choose a password (unconfirmed account), so the sign-up page never reveals which addresses are registered and nobody can pre-register someone else's address with a password they know.

## 7d. Signup, trial and plan limits

/sign-up opens a 14-day trial organisation. With SMTP configured (7c) the address must be confirmed by email before first sign-in; without SMTP it signs in at once. Limits (clients, rows per month, seats) come from `PLAN_TRIAL_*` / `PLAN_FIRM_*` in .env (see .env.example) and are placeholders until you set them. At 80% the app warns, at 100% (or after the trial) uploads, new clients and invites are refused while everything stays readable; upgrade goes through the existing Click/Payme flow (7b), and the firm plan is not for sale until `PLAN_FIRM_PRICE` is set.

An upload waits at the column-mapping step as an uncommitted preview, and its rows count against the monthly allowance only once the mapping is confirmed. Previews are limited on their own: a user's new upload deletes their earlier open preview, an upload is refused (with a message) when the org's open preview rows from the last 24 hours would exceed the plan's monthly row limit (200,000 when the plan has none; `PREVIEW_ROWS_UNCAPPED` in `src/lib/plan.ts`), and the daily job (7e) deletes previews left for 48 hours. Each deletion writes `catalog.upload_discarded` with `reason` `replaced` or `expired` (the latter without an actor). These numbers are not `.env` settings.

"Telegram orqali kirish" appears when TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME are set and the bot domain is registered with BotFather (/setdomain); it has not been tested against a live bot. How Telegram sign-in decides who you are is in 7g.

## 7e. Daily jobs (monthly reminders)

Once a day call the daily route (same `CRON_SECRET` as the classifier update):

```cron
15 6 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/daily
```

It creates the monthly-check tasks that are due (per client: Sozlamalar of the client page), tells the accountant responsible on Telegram when the bot is configured, deletes upload previews left uncommitted for 48 hours (7d) and runs the retention jobs listed in 7g. Dates use Uzbekistan time (UTC+5).

## 7f. Public API

Admins create keys in Settings → Integratsiyalar (shown once, only a hash is stored). Endpoints: `POST /api/v1/check`, `GET /api/v1/catalogs` (paged with `limit` and `cursor`), `POST /api/v1/catalogs`, `GET /api/v1/catalogs/:id/report`; spec at `/api/v1/openapi.json`, docs at `/api-docs`. Every response to a valid key carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`. Both POST endpoints accept `Idempotency-Key`: a repeat with the same key under the same API key within 24 hours returns the first successful response (`Idempotent-Replayed: true`); rows live in `api_idempotency` and the daily job (7e) prunes them.
Limits are config, not decisions: `API_RATE_PER_MINUTE` (kept in memory per process, so it resets on restart and is per instance), `API_CHECKS_PER_MONTH_TRIAL` / `_FIRM` and `API_CHECK_MAX_ITEMS`. Uploaded rows count against the plan's monthly row limit like uploads in the app. Set `APP_URL` so the OpenAPI document names the public origin.

## 7g. Security and data control

- **Two-factor sign-in** (authenticator app, 6-digit TOTP, set up by scanning a QR code) and one-time recovery codes are per user, in Settings. The TOTP secret is stored encrypted, and recovery codes (80 bits each) as an HMAC, both with keys derived from `SESSION_SECRET`: if you rotate `SESSION_SECRET`, two-factor secrets and recovery codes stop working and those users need an operator to turn two-factor off (`UPDATE "user" SET "totpSecret" = NULL, "totpEnabledAt" = NULL, "totpLastStep" = NULL WHERE email = '...'`) before they set it up again. Recovery codes issued before this version keep working until regenerated. Five wrong codes end a pending sign-in (the password is asked again); ten wrong codes per user per hour block further tries for that hour.
- **Active sessions** are recorded in the database; a user can end any of their sessions in Settings. A session not seen for 7 days (the cookie lifetime) is dead. Cookies without a session record (issued before session records existed) are no longer accepted: those users sign in once more. Demo visitors are the only sessions without a record.
- **Rate limits** live in the `auth_attempt` table, so they survive restarts and apply across instances: 5 password attempts per email per 15 minutes (then a cooldown message; the right password clears the count), 30 sign-in attempts per client address per 15 minutes, 3 password-reset and 3 confirmation-resend mails per address per hour (10 per client address), 8 signups per client address per hour. The client address is `X-Real-IP` (nginx sets it from `$remote_addr`, section 6), else the **rightmost** `X-Forwarded-For` hop, never the leftmost (the client writes that one). Keep the app port bound to 127.0.0.1 behind nginx; if another proxy sits in front of nginx, configure nginx's `real_ip` module so `$remote_addr` is the visitor. Stored keys are HMACs, not raw emails or addresses. The daily job (7e) deletes attempts older than a day.
- **Passwords**: Settings → Xavfsizlik changes the password (the current one is required; every other session of the user ends; `security.password_changed` in the audit log). "Parolni unutdingizmi?" on the sign-in page mails a reset link (1 hour, single use, only the newest link works; using it sets the password, confirms the address and ends every session of the user; `security.password_reset`). The page answers the same whether or not the address has an account. **Without SMTP no link can be sent**; the page says an administrator has to set the password, and the operator does it on the server:

```bash
mx npm run password:set -- user@example.com                   # prints a new random password once
echo 'new-password' | docker compose --profile app run --rm -T app npm run password:set -- user@example.com --stdin
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
- **HTTP headers** on every route (`src/lib/security/headers.ts`): Content-Security-Policy (`default-src 'self'`, `frame-ancestors 'none'`, scripts from the site and `https://telegram.org` for the login widget, its iframe from `https://oauth.telegram.org`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (no camera, microphone, geolocation), `X-Frame-Options: DENY`, and in production `Strict-Transport-Security: max-age=31536000`. `script-src` keeps `'unsafe-inline'` because Next.js bootstraps pages with inline scripts; per-request nonces would need middleware and a verified production build, which is future work. `'unsafe-eval'` and the hot-reload websocket are allowed only in development. The app sends these itself: do not add them again in nginx (with two `Content-Security-Policy` headers the browser enforces both, so everything must pass each one and pages can break).
- **Landing-page lead form** accepts files up to 5 MB, and an .xlsx that would inflate past 100 MB (or has more than 5,000 entries) is refused before it is parsed.
- **Account data export** (admin, Settings): a zip with team, clients, dictionary, activity log and one Excel file per catalogue. Passwords, API keys and two-factor secrets are never included.
- **Closing an account**: the admin confirms with the password; nobody can sign in except an admin, who may restore the account. After `ACCOUNT_DELETE_AFTER_DAYS` (default 30) the daily job (section 7e) erases the organisation and everything under it, including its log entries.
- **Raw-file retention**: each org chooses 7, 30 (default) or 90 days, or "keep". The daily job blanks the uploaded cells that are not in a mapped column (names, codes, units, prices are kept, so reports and exports keep working). It is never retroactive: only uploads created at or after the org's `organization."rawRetentionSince"` are blanked, once older than the window. That date is when the org was created, and for orgs that existed before retention shipped, the moment its migration ran; uploads from before it are never touched, and an org whose `rawRetentionSince` is NULL is skipped entirely. Settings → Maʼlumotlar shows the date. Changing the window does not move it; to apply retention to an org's older uploads (only on that org's written request) set it earlier by hand, e.g. `UPDATE organization SET "rawRetentionSince" = '2026-01-01' WHERE id = '...';`.

## 8. Operating it

| Task | Command |
|---|---|
| Health | `curl -s http://127.0.0.1:3000/api/health` |
| App logs | `docker compose --profile app logs -f app` |
| Erase a lead's file on request | `mx npm run lead:delete -- --list`, then `mx npm run lead:delete -- <leadId>` (`--all` also removes the contact) |
| Rebuild the demo | `mx npm run seed:demo` |
| Which LLM/embedding setup is active | `mx npm run check:providers` |
| Traction metrics | `https://your-domain/admin`, signed in as a platform admin (7g) |
| Set a user's password (no SMTP) | `mx npm run password:set -- user@example.com` (7g) |

### Updating to a new version

```bash
cd /opt/mxik-audit
git pull
docker compose --profile app build
docker compose --profile app run --rm app npx prisma migrate deploy
docker compose --profile app up -d app
```

Never run `prisma migrate dev` against this database; see README "Migrations".

### Codes restricted in EHF

The RESTRICTED check reads table `restricted_code`, loaded from the official
list of generalized construction codes (perechen.xlsx: header "МХИК коди" on
row 4, data from row 5; announced in tasnif.soliq.uz news 5063). Load it once,
and again whenever a further stage of the list is published:

```bash
mx npm run load:restricted -- /path/perechen.xlsx                      # from 2026-07-01
mx npm run load:restricted -- /path/next-stage.xlsx --from YYYY-MM-DD --source <news url>
```

It upserts and prints how many codes were added, updated and found in the
classifier. Audits started afterwards use the list; earlier audits keep their
findings.

### Refreshing the classifier

The portal regenerates its export on every request. To pick up new codes:

```bash
mx npm run classifier:update                    # what the weekly cron runs
mx npm run classifier:update -- --dry-run       # download and show the diff, write nothing
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

`npm run embed:catalog` is only needed to switch embedding models: it
re-embeds every code (~2.7 h on 4 vCPU) and the vector stage stays off until it
finishes. Run it off-hours.

### Restoring a backup

```bash
docker compose --profile app stop app
docker exec -i mxik-audit-db pg_restore -U mxik -d mxik --clean --if-exists < backups/mxik-YYYY-MM-DD.dump
docker compose --profile app start app
```

## 9. Everything in Docker

`docker compose --profile app up -d --build` runs the whole stack as containers:
`db`, `app` (applies pending migrations, then serves on 127.0.0.1:3000),
`scheduler` (purge at 03:15, classifier update on Mondays 04:00, the daily jobs
of 7e at 06:15, all UTC+5; replaces the crontab in section 7 and the daily route call
in 7e, which needs `CRON_SECRET`) and `backup` (nightly `pg_dump` at 03:45 into
`./backups`, 14 kept). Add `--profile bot` for the Telegram long-polling bot.
Copy `./backups` off the server as well.
