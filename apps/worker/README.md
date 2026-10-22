# @tasnivo/worker

The background worker (docs/BACKEND_SPLIT_PLAN.md §3.2, Wave 1b): a NestJS standalone application
with no HTTP API. It owns every queue, the scheduled jobs and the stale-audit sweep. The domain code
it runs is unchanged: `runAudit` (audit-jobs.ts), `runDocCheck` (docs.ts), `deliverMail` (mailer.ts),
`deliverTelegram` (telegram/deliver.ts), `purgeExpired`, `runDailyJobs` and
`scripts/update-classifier.ts`.

## How work reaches it

Domain code never calls a runner directly; it calls `jobs()` (packages/domain/src/jobs/dispatcher.ts):

| `JOBS_MODE` | Dispatcher | Where the work runs |
|---|---|---|
| `inline` (default) | `InlineDispatcher` | in the calling process, fire-and-forget, as before the worker. Tests, scripts and the web app until Wave 3. The in-memory `running` sets live only here. |
| `bullmq` | `BullDispatcher` | a job on Redis (`REDIS_URL`), run by this worker |

`startAudit`, `retryAudit`, `resumeStaleAudits`, `applyDocMap`/`restartDocCheck`, `notify` (Telegram
copy), the audit's Telegram reply and the password-reset/sign-up mails all go through it. Other mail
callers still call `sendMail` directly, because they use its "sent" answer (invites, demo access,
verification). Inside the worker, `jobs()` is always a `BullDispatcher` over the worker's own queues,
whatever `JOBS_MODE` says.

## Queues

| Queue | Job id | Concurrency | Attempts | Runs |
|---|---|---|---|---|
| `audit` | catalogue id | `AUDIT_CONCURRENCY` (1) | 3, backoff 30 s | `runAudit(catalogId, watermark, actor, extra)` |
| `doc-check` | list id | 1 | 2, backoff 30 s | `runDocCheck(listId)`; the last failure marks the list `failed` |
| `mail` | – | 4 | 5, backoff 10 s | `deliverMail` (throws on SMTP errors, so it retries) |
| `telegram` | – | 4 | 3, backoff 5 s | `deliverTelegram`: a notification or an audit summary |
| `classifier-update` | `classifier-update-<day>` when scheduled | 1 | 1 | `scripts/update-classifier.ts` as a child process; it takes the advisory lock 727001 itself, and the job ends quietly when the lock is already held |
| `daily` | `daily-<day>`, `purge-<day>` | 1 | 2 | `runDailyJobs` (06:15) or `purgeExpired` (03:15) |

The policies live in `packages/domain/src/jobs/queues.ts` (`JOB_DEFAULTS`), shared by producers and
the worker.

**Audits.** The job id is the catalogue id, so a catalogue is queued at most once across every
process. A finished job is removed before a new one with the same id is added (BullMQ would otherwise
ignore the id). When a job starts, the worker reads the catalogue: it runs only if the catalogue is
still `analyzing`, from its stored watermark (`progressDone`), and not while another process beats a
fresh heartbeat newer than the job (an inline web app, a CLI script). `runAudit` keeps the heartbeat
(`auditHeartbeatAt`, `progressDone`) exactly as before, so the web's progress endpoint and
`resumeStaleAudits` work unchanged. A failure inside the audit marks the catalogue `failed` with
`auditError`, as it always did, and the job completes; attempts only cover failures around it
(database or Redis gone). A worker that dies mid-audit leaves its job stalled; BullMQ hands it back
(lock 120 s, up to 3 stalls) and it resumes from the watermark. The scheduled sweep catches the rest.

**Scheduled jobs**, at the times `scripts/scheduler.mjs` used (Asia/Tashkent, UTC+5): 03:15 purge,
04:00 classifier update, 06:15 daily jobs. Each cron only adds a job whose id names the local day, so
several worker instances still run each once. The daily job's classifier update (when the snapshot is
older than a day) is queued, not spawned. `scripts/scheduler.mjs` is deprecated; do not run both.

**Stale audits.** On boot (`STARTUP_STALE_MS`, 10 s) and every 2 minutes (`STALE_MS`, 120 s) the
worker calls `resumeStaleAudits`, which queues every `analyzing` catalogue without a fresh heartbeat.
Page renders and the progress endpoint still call it too; with `JOBS_MODE=bullmq` they only queue.

**Embeddings.** `AuditContextService` installs a shared embedder source in audit-runner: one provider
per configuration (`sharedEmbeddingProvider` in packages/core/src/embed/index.ts), and one instance
per name when readiness substitutes the stored vectors' local model. A local model (e5-small, 470 MB)
then loads once per process instead of once per audit (38 rows: 48 s for the first audit, 19 s for the
next). The inline path keeps building a provider per call. The classifier pg pool is audit-runner's
one pool per process; the worker ends it on shutdown.

## Environment

The root `.env` is read (the worker always runs with the repository root as its working directory;
`src/root.ts` changes to it when started elsewhere). Besides what the domain reads (`DATABASE_URL`,
`SMTP_URL`/`MAIL_FROM`, `TELEGRAM_*`, `EMBEDDING_PROVIDER`, `LOCAL_MODEL_DIR`, `ANTHROPIC_API_KEY`,
`CLASSIFIER_UPDATE_LOG`, `CLASSIFIER_UPDATE_STATUS`…):

| Variable | Default | |
|---|---|---|
| `REDIS_URL` | – (required) | e.g. `redis://redis:6379` |
| `AUDIT_CONCURRENCY` | `1` | audits per worker process; each runs 8 rows at a time on the shared pool (max 8) |
| `WORKER_PORT` | `4100` | `/healthz` |
| `WORKER_SHUTDOWN_GRACE_MS` | `25000` | how long SIGTERM waits for running jobs |
| `JOBS_MODE` | `inline` | for the *producers* (web, api, bot, scripts): `bullmq` sends work to this worker |

No `DATA_DIR` was introduced: `data/` (models, classifier status file and log) stays relative to the
repository root, as everywhere else. In Docker that is `/app/data`, the shared volume.

## Running it

From the repository root:

```bash
docker run --rm -d --name tasnivo-redis -p 127.0.0.1:6379:6379 redis:7-alpine
REDIS_URL=redis://127.0.0.1:6379 npm run dev:worker     # tsx watch
npm run build:worker                                     # esbuild -> apps/worker/dist/main.js
REDIS_URL=redis://127.0.0.1:6379 npm run start:worker   # node apps/worker/dist/main.js
```

`build:worker` bundles the `@tasnivo/*` packages (TypeScript source) into one ESM file and leaves every
other package in `node_modules`, so the image needs the installed `node_modules` and
`npx prisma generate`, as the web image does. tsx and esbuild compile legacy decorators without
decorator metadata, so every constructor dependency is named with `@Inject(...)`/`@InjectQueue(...)`.

End-to-end check against a running worker: `npm run worker:smoke -- --copy-from <catalogId>` copies
that catalogue's rows into a scratch org, queues its audit and follows it to `ready`; the original is
not touched and the scratch org is deleted afterwards (`--keep` keeps it).

Logs are JSON lines (`t`, `level`, `ctx`, `msg`, plus `catalogId`/`listId`/`jobId`/`attempt`); the
domain's own `console.warn` lines (degraded audit, reranker off) stay plain text.

## Healthcheck and shutdown (for W1d)

`GET http://localhost:${WORKER_PORT}/healthz` answers 200 with
`{"status":"ok","redis":"up","db":"up","embedders":[…],"uptimeS":…}` when Redis and Postgres answer,
and 503 when either is down or the worker is shutting down. For compose:

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "fetch('http://localhost:4100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
  interval: 30s
  timeout: 5s
  start_period: 30s
```

On SIGTERM/SIGINT the worker stops taking jobs, waits for the running ones up to
`WORKER_SHUTDOWN_GRACE_MS`, then closes the queues, workers, the classifier pool and Prisma and exits 0.
A running classifier update is stopped rather than waited for. Give the container a
`stop_grace_period` a little above the grace (e.g. `30s`). An audit still running when the grace runs
out is not marked failed: the process exits, the job stalls, and the next worker resumes it from its
watermark. The worker must be the container's main process (`CMD ["npm", "run", "start:worker"]` or
`node apps/worker/dist/main.js`; npm forwards the signal) and runs from `/app`.

Tests: `apps/worker/src/*.test.ts` (in the root `npm test`); `worker.test.ts` needs the database and a
Redis (`TEST_REDIS_URL`, else `REDIS_URL`, else localhost:6379) and is skipped without them.
