// What the daily cron runs. Each job is independent: one failing never stops the others.
import { runReminders } from './reminders';

export type DailyResult = Record<string, unknown>;

async function attempt<T>(job: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await job();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runDailyJobs(now = new Date()): Promise<DailyResult> {
  return { reminders: await attempt(() => runReminders(now)) };
}
