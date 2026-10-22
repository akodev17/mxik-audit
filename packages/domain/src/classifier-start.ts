// Starting a classifier update (scripts/update-classifier.ts) from the app:
// the HTTP trigger and the daily job share this. The update runs detached and
// outlives the request; the advisory lock in the script keeps it single. The
// worker's classifier-update queue runs it attached instead (runClassifierUpdate).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ageInDays, updateDecision, type UpdateDecision } from './classifier-freshness.js';
import { classifierUpdateRunning } from './classifier-lock.js';
import { latestSnapshot } from './classifier-state.js';

export type StartedUpdate = { pid: number | null; log: string };

/** The update script as a child process of this one, its output appended to the update log. */
function spawnUpdate(detached: boolean): { child: ChildProcess; log: string } {
  const log = process.env['CLASSIFIER_UPDATE_LOG'] ?? join('data', 'classifier-update.log');
  mkdirSync(dirname(log), { recursive: true });
  const out = openSync(log, 'a');
  const child = spawn(process.execPath, [join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/update-classifier.ts'], {
    cwd: process.cwd(),
    detached,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  return { child, log };
}

export function startClassifierUpdate(): StartedUpdate {
  const { child, log } = spawnUpdate(true);
  child.unref();
  return { pid: child.pid ?? null, log };
}

export type FinishedUpdate = { pid: number | null; log: string; exitCode: number | null; signal: string | null };

/**
 * Runs an update and resolves when the script exits (a non-zero code included: the script records
 * its own failure in the status file). `onStart` receives the child, so a shutting-down worker can stop it.
 */
export function runClassifierUpdate(onStart?: (child: ChildProcess) => void): Promise<FinishedUpdate> {
  const { child, log } = spawnUpdate(false);
  onStart?.(child);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolve({ pid: child.pid ?? null, log, exitCode, signal }));
  });
}

export type DailyUpdateDeps = {
  snapshot: () => Promise<{ takenAt: Date } | null>;
  running: () => Promise<boolean>;
  /** Spawns the update (the web) or queues it (the worker). */
  start: () => StartedUpdate | Promise<StartedUpdate>;
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
  return { started: true, ageDays: ageDays ?? 0, ...(await deps.start()) };
}
