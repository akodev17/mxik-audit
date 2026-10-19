# Deploying MXIK Audit on a Linux VPS

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
mx npm run embed:catalog            # local e5 vectors + HNSW index, ~2.7 h on 4 vCPU
mx npm run seed:demo                # the demo catalogue behind /demo, ~1 min
```

`embed:catalog` first downloads the model (~470 MB) into `./data/models`, which
persists across rebuilds. It is resumable: if the session drops, run the same
command again and it continues from `data/embed-checkpoint.json`. Run it inside
`tmux` or `screen` so a dropped SSH session does not stop it.

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
without them no payment button appears. Prices: `src/lib/billing/plans.ts`
(the firm monthly plan is hidden until its price is set there).

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

Members join through invite links created in Sozlamalar. To also email the link set `SMTP_URL` and `MAIL_FROM`; without them the link is only shown on screen. `APP_URL` makes links absolute. Roles: admin (everything), accountant (works on assigned clients), viewer (read-only). An accountant or viewer with no assigned clients sees every client of the org.

## 7d. Signup, trial and plan limits

/sign-up opens a 14-day trial organisation. With SMTP configured (7c) the address must be confirmed by email before first sign-in; without SMTP it signs in at once. Limits (clients, rows per month, seats) come from `PLAN_TRIAL_*` / `PLAN_FIRM_*` in .env (see .env.example) and are placeholders until you set them. At 80% the app warns, at 100% (or after the trial) uploads, new clients and invites are refused while everything stays readable; upgrade goes through the existing Click/Payme flow (7b), and the firm plan stays hidden until its price is set in src/lib/billing/plans.ts. "Telegram orqali kirish" appears when TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME are set and the bot domain is registered with BotFather (/setdomain); it has not been tested against a live bot.

## 7e. Daily jobs (monthly reminders)

Once a day call the daily route (same `CRON_SECRET` as the classifier update):

```cron
15 6 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/daily
```

It creates the monthly-check tasks that are due (per client: Sozlamalar of the client page), tells the accountant responsible on Telegram when the bot is configured, and runs the retention jobs listed in 7g. Dates use Uzbekistan time (UTC+5).

## 7f. Public API

Admins create keys in Settings (shown once, only a hash is stored). Endpoints: `POST /api/v1/check`, `POST /api/v1/catalogs`, `GET /api/v1/catalogs/:id/report`; spec at `/api/v1/openapi.json`, docs at `/api-docs`.
Limits are config, not decisions: `API_RATE_PER_MINUTE` (kept in memory per process, so it resets on restart and is per instance), `API_CHECKS_PER_MONTH_TRIAL` / `_FIRM` and `API_CHECK_MAX_ITEMS`. Uploaded rows count against the plan's monthly row limit like uploads in the app. Set `APP_URL` so the OpenAPI document names the public origin.

## 7g. Security and data control

- **Two-factor sign-in** (authenticator app, 6-digit TOTP) and one-time recovery codes are per user, in Settings. The TOTP secret is stored encrypted with a key derived from `SESSION_SECRET`: if you rotate `SESSION_SECRET`, users with two-factor can only sign in with a recovery code and must set it up again.
- **Active sessions** are recorded in the database; a user can end any of their sessions in Settings. Cookies issued before this version have no session record and stay valid until they expire (7 days).
- **Account data export** (admin, Settings): a zip with team, clients, dictionary, activity log and one Excel file per catalogue. Passwords, API keys and two-factor secrets are never included.
- **Closing an account**: the admin confirms with the password; nobody can sign in except an admin, who may restore the account. After `ACCOUNT_DELETE_AFTER_DAYS` (default 30) the daily job (section 7e) erases the organisation and everything under it, including its log entries.
- **Raw-file retention**: each org chooses 7, 30 (default) or 90 days, or "keep". The daily job blanks the uploaded cells that are not in a mapped column (names, codes, units, prices are kept, so reports and exports keep working). Existing orgs get the 30-day default when this version is deployed, so the first daily run after deploying cleans their older uploads.

## 8. Operating it

| Task | Command |
|---|---|
| Health | `curl -s http://127.0.0.1:3000/api/health` |
| App logs | `docker compose --profile app logs -f app` |
| Erase a lead's file on request | `mx npm run lead:delete -- --list`, then `mx npm run lead:delete -- <leadId>` (`--all` also removes the contact) |
| Rebuild the demo | `mx npm run seed:demo` |
| Which LLM/embedding setup is active | `mx npm run check:providers` |
| Traction metrics | `https://your-domain/admin`, signed in as an `ADMIN_EMAILS` address |

### Updating to a new version

```bash
cd /opt/mxik-audit
git pull
docker compose --profile app build
docker compose --profile app run --rm app npx prisma migrate deploy
docker compose --profile app up -d app
```

Never run `prisma migrate dev` against this database; see README "Migrations".

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
`scheduler` (purge at 03:15, classifier update on Mondays 04:00, daily reminders
at 06:15, all UTC+5; replaces the crontab in section 7 and the daily route call
in 7e, which needs `CRON_SECRET`) and `backup` (nightly `pg_dump` at 03:45 into
`./backups`, 14 kept). Add `--profile bot` for the Telegram long-polling bot.
Copy `./backups` off the server as well.
