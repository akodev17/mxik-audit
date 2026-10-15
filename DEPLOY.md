# Deploying MXIK Audit on a Linux VPS

Docker runs the app and Postgres (with pgvector); nginx on the host terminates
HTTPS and proxies to the app. Nothing here depends on a particular provider.

## 0. What you need

- A VPS with Ubuntu 22.04 or 24.04, **4 GB RAM minimum** (the classifier import
  and the vector index build are the heavy parts), 2+ vCPU, 30 GB disk.
- A domain name with an `A` record pointing at the server's IP.
- An SSH login with `sudo`.

Expect about 30–45 minutes, most of it waiting for the classifier import.

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
mx npm run embed:catalog            # vectors + HNSW indexes, ~25 min
mx npm run seed:demo                # the demo catalogue behind /demo, ~1 min
```

`ingest -- --enrich` calls the public tasnif.soliq.uz API for every code; if
that is unreachable from the server, run `mx npm run ingest` (without
`--enrich`) and the marking flag stays unknown.

## 5. Start the app

```bash
docker compose --profile app up -d app
curl -s http://127.0.0.1:3000/api/health    # {"status":"ok","database":true,"classifier":true}
```

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
# Nightly database backup, 14 kept.
45 3 * * * docker exec mxik-audit-db pg_dump -U mxik -Fc mxik > /opt/mxik-audit/backups/mxik-$(date +\%F).dump && find /opt/mxik-audit/backups -name '*.dump' -mtime +14 -delete
```

```bash
mkdir -p /opt/mxik-audit/backups
sudo touch /var/log/mxik-purge.log && sudo chown "$USER" /var/log/mxik-purge.log
```

Copy backups off the server too; a backup on the same disk is not a backup.

## 8. Operating it

| Task | Command |
|---|---|
| Health | `curl -s http://127.0.0.1:3000/api/health` |
| App logs | `docker compose --profile app logs -f app` |
| Erase a lead's file on request | `mx npm run lead:delete -- --list`, then `mx npm run lead:delete -- <leadId>` (`--all` also removes the contact) |
| Rebuild the demo | `mx npm run seed:demo` |
| Which LLM/embedding setup is active | `mx npm run check:providers` |

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
mx npm run fetch:catalog && mx npm run ingest -- --enrich && mx npm run load:db && mx npm run embed:catalog
```

`load:db` records a snapshot and marks codes that disappeared as retired, so
catalogues still using them are reported as not found.

### Restoring a backup

```bash
docker compose --profile app stop app
docker exec -i mxik-audit-db pg_restore -U mxik -d mxik --clean --if-exists < backups/mxik-YYYY-MM-DD.dump
docker compose --profile app start app
```
