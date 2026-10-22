// What the daily cron runs. Each job is independent: one failing never stops the others.
import { pruneIdempotency } from './api/idempotency';
import { dailyClassifierUpdate } from './classifier-start';
import { jobs } from './jobs/dispatcher';
import { localDay } from './jobs/queues';
import { sweepExpiredPreviews } from './preview-sweep';
import { runReminders } from './reminders';
import { purgeDeletedAccounts, purgeRawFiles } from './security/account';
import { pruneAttempts } from './security/rate-limit';

export type DailyResult = Record<string, unknown>;

async function attempt<T>(job: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await job();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runDailyJobs(now = new Date(), classifierUpdate: typeof dailyClassifierUpdate = dailyClassifierUpdate): Promise<DailyResult> {
  return {
    reminders: await attempt(() => runReminders(now)),
    rawFiles: await attempt(() => purgeRawFiles(now)),
    expiredPreviews: await attempt(() => sweepExpiredPreviews(now)),
    deletedAccounts: await attempt(() => purgeDeletedAccounts(now)),
    authAttempts: await attempt(() => pruneAttempts(now)),
    apiIdempotency: await attempt(() => pruneIdempotency(now)),
    classifierUpdate: await attempt(() => classifierUpdate(now)),
  };
}

/**
 * POST /api/cron/daily. With the worker (JOBS_MODE=bullmq) the jobs are queued for it under the
 * day's id, unless that job is still pending, and the answer says so; otherwise they run here and
 * their report is the answer, as the web route always did.
 */
export async function triggerDailyJobs(now = new Date()): Promise<DailyResult> {
  const dispatcher = jobs();
  if (dispatcher.mode !== 'bullmq') return runDailyJobs(now);
  const jobId = `daily-${localDay(now)}`;
  const added = await dispatcher.enqueueDaily({ job: 'daily' }, jobId);
  return { queued: true, jobId, added };
}
