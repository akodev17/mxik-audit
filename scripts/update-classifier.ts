// Classifier update, end to end: download the latest export (the Gate 0
// method), normalize it with the marking flag, load it as a new snapshot with
// its diff, embed the codes it added, then re-check every client's latest
// catalogue and notify the orgs whose rows were affected.
//
//   npm run classifier:update                    full run
//   npm run classifier:update -- --skip-fetch    reuse data/classifier_*.xlsx
//   npm run classifier:update -- --dry-run       download + diff only, write nothing; prints the
//                                                snapshot age before and the counts after
//   npm run classifier:update -- --recheck 7     only re-check against snapshot 7
//
// One run at a time (Postgres advisory lock, src/lib/classifier-lock.ts). Also started by
// POST /api/cron/classifier-update (CRON_SECRET) and, when the snapshot is more than a day
// old, by the daily cron; see DEPLOY.md. How a run ended is recorded in
// data/classifier-update-status.json (src/lib/classifier-status.ts) for /api/health and the
// stale-classifier banner; dry runs and runs refused by the lock record nothing.
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Pool } from 'pg';
import { ageInDays } from '@tasnivo/domain/classifier-freshness';
import { acquireClassifierLock, releaseClassifierLock } from '@tasnivo/domain/classifier-lock';
import { recheckAfterUpdate } from '@tasnivo/domain/classifier-recheck';
import { latestSnapshot } from '@tasnivo/domain/classifier-state';
import { writeUpdateStatus } from '@tasnivo/domain/classifier-status';
import { db } from '@tasnivo/db';
import { embedMissing } from './lib/embed-missing.js';
import { loadClassifier } from './lib/load-classifier.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const recheckOnly = args.includes('--recheck') ? Number(args[args.indexOf('--recheck') + 1]) : null;

const log = (line: string): void => console.log(`[${new Date().toISOString()}] ${line}`);

/** Runs another script of this repo with the same Node and tsx, inheriting output. */
function runScript(script: string, scriptArgs: string[] = []): void {
  const tsx = join('node_modules', 'tsx', 'dist', 'cli.mjs');
  const result = spawnSync(process.execPath, [tsx, script, ...scriptArgs], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${script} exited with ${result.status ?? result.signal}`);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
const lock = await pool.connect();
let exitCode = 0;
let holdsLock = false;
try {
  holdsLock = await acquireClassifierLock(lock);
  if (!holdsLock) throw new Error('another classifier update is running');

  const before = await latestSnapshot();
  log(before
    ? `snapshot before: #${before.id} taken ${before.takenAt.toISOString().slice(0, 10)}, ${ageInDays(before.takenAt, new Date())} day(s) old, ${before.codeCount.toLocaleString()} codes`
    : 'snapshot before: none');

  let snapshotId = recheckOnly;
  if (snapshotId === null) {
    if (!flag('--skip-fetch')) {
      log('downloading the classifier export');
      runScript('scripts/fetch-catalog.ts');
    }
    log('normalizing (with the marking flag)');
    runScript('scripts/ingest-catalog.ts', flag('--skip-enrich') ? [] : ['--enrich']);

    log('loading as a new snapshot');
    const loaded = await loadClassifier({ databaseUrl: DATABASE_URL, source: 'data/mxik.ndjson', dryRun: flag('--dry-run'), log });
    if (loaded.snapshotId === null) {
      const d = loaded.diff;
      log(`dry run: after an update the copy would hold ${loaded.rows.toLocaleString()} codes (live now ${loaded.previousLive.toLocaleString()}): +${d.added} added, -${d.retired} retired, ${d.unitChanged} unit changed, ${d.nameChanged} name changed`);
      log('dry run finished; nothing written');
    } else {
      snapshotId = loaded.snapshotId;
      const embedded = await embedMissing(pool, log);
      log(embedded.skippedReason ? `embedding skipped: ${embedded.skippedReason}` : `embedded ${embedded.embedded} new codes`);
      // The privilege reference changes with the classifier; a failure here is not fatal.
      try {
        runScript('scripts/fetch-privileges.ts');
      } catch (error) {
        log(`privilege reference not refreshed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (snapshotId !== null && Number.isFinite(snapshotId)) {
    log(`re-checking client catalogues against snapshot #${snapshotId}`);
    const results = await recheckAfterUpdate(snapshotId, log);
    log(`done: ${results.length} client(s) affected`);
  }
  if (!flag('--dry-run')) writeUpdateStatus('success', null);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`FAILED: ${message}`);
  // A run the lock turned away is not a failed update; the one holding the lock will record its own end.
  if (holdsLock && !flag('--dry-run')) writeUpdateStatus('failed', message);
  exitCode = 1;
} finally {
  if (holdsLock) await releaseClassifierLock(lock).catch(() => undefined);
  lock.release();
  await pool.end();
  await db.$disconnect();
}
// The audit runner's shared pool keeps the event loop alive; leave explicitly.
process.exit(exitCode);
