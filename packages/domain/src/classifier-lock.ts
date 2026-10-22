// The Postgres advisory lock that keeps classifier updates to one at a time.
// scripts/update-classifier.ts takes it for the whole run; the daily route only
// looks at it (pg_locks), so a running update is seen without touching it.
import { db } from '@tasnivo/db';

export const CLASSIFIER_LOCK_KEY = 727_001;

/** What the script's pg connection offers; kept minimal so any pg client fits. */
export type LockConnection = { query<R extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<{ rows: R[] }> };

/** Takes the lock on this session; false when another update holds it. */
export async function acquireClassifierLock(conn: LockConnection): Promise<boolean> {
  const { rows } = await conn.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [CLASSIFIER_LOCK_KEY]);
  return rows[0]?.ok === true;
}

export async function releaseClassifierLock(conn: LockConnection): Promise<void> {
  await conn.query('SELECT pg_advisory_unlock($1)', [CLASSIFIER_LOCK_KEY]);
}

/** Whether some session holds the lock right now (a key below 2^32 sits in objid with classid 0). */
export async function classifierUpdateRunning(): Promise<boolean> {
  const rows = await db.$queryRaw<{ held: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND granted AND classid = 0 AND objid = ${CLASSIFIER_LOCK_KEY} AND objsubid = 1
    ) AS held`;
  return rows[0]?.held === true;
}
