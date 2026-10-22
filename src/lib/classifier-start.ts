// Starting a classifier update (scripts/update-classifier.ts) from the app:
// the HTTP trigger and the daily job share this. The update runs detached and
// outlives the request; the advisory lock in the script keeps it single.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ageInDays, updateDecision, type UpdateDecision } from './classifier-freshness.js';
import { classifierUpdateRunning } from './classifier-lock.js';
import { latestSnapshot } from './classifier-state.js';

export type StartedUpdate = { pid: number | null; log: string };

export function startClassifierUpdate(): StartedUpdate {
  const log = process.env['CLASSIFIER_UPDATE_LOG'] ?? join('data', 'classifier-update.log');
  mkdirSync(dirname(log), { recursive: true });
  const out = openSync(log, 'a');
  const child = spawn(process.execPath, [join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/update-classifier.ts'], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();
  return { pid: child.pid ?? null, log };
}

export type DailyUpdateDeps = {
  snapshot: () => Promise<{ takenAt: Date } | null>;
  running: () => Promise<boolean>;
  start: () => StartedUpdate;
};

export type DailyUpdateResult =
  | ({ started: true; ageDays: number } & StartedUpdate)
  | { started: false; reason: Exclude<UpdateDecision, { run: true }>['reason']; ageDays: number | null };

/** The daily job's part: update when the snapshot is older than a day and none is running. */
export async function dailyClassifierUpdate(
  now = new Date(),
  deps: DailyUpdateDeps = { snapshot: latestSnapshot, running: classifierUpdateRunning, start: startClassifierUpdate },
): Promise<DailyUpdateResult> {
  const snapshot = await deps.snapshot();
  const ageDays = snapshot ? ageInDays(snapshot.takenAt, now) : null;
  // Only look at the lock when the age says an update is due.
  const due = updateDecision(snapshot, false, now);
  if (!due.run) return { started: false, reason: due.reason, ageDays };
  const decision = updateDecision(snapshot, await deps.running(), now);
  if (!decision.run) return { started: false, reason: decision.reason, ageDays };
  return { started: true, ageDays: ageDays ?? 0, ...deps.start() };
}
