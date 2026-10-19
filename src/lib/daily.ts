// What the daily cron runs. Each job is independent: one failing never stops the others.
import { pruneIdempotency } from './api/idempotency';
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

export async function runDailyJobs(now = new Date()): Promise<DailyResult> {
  return {
    reminders: await attempt(() => runReminders(now)),
    rawFiles: await attempt(() => purgeRawFiles(now)),
    deletedAccounts: await attempt(() => purgeDeletedAccounts(now)),
    authAttempts: await attempt(() => pruneAttempts(now)),
    apiIdempotency: await attempt(() => pruneIdempotency(now)),
  };
}
