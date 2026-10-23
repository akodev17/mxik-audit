// The BullMQ queues apps/worker consumes and BullDispatcher fills: names, job
// payloads and retry policy, in one place so producer and consumer agree.
import type { Prisma } from '@prisma/client';

export const QUEUES = {
  audit: 'audit',
  docCheck: 'doc-check',
  mail: 'mail',
  telegram: 'telegram',
  classifierUpdate: 'classifier-update',
  daily: 'daily',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Who started an audit; null for a resumed one or an API upload. Same shape as audit-jobs' AuditActor. */
export type JobActor = { orgId: string; userId: string } | null;

/**
 * One catalogue's audit; the job id is the catalogue id, so it is never queued twice.
 * `fromRow` is informational: the worker resumes from the catalogue's stored watermark.
 */
export type AuditJobData = { catalogId: string; actor: JobActor; extra: Prisma.InputJsonObject; fromRow: number };
/** One cheque/sales list's check; the job id is the list id. */
export type DocCheckJobData = { listId: string };
export type MailJobData = { to: string; subject: string; text: string };
/** A notification for the org's linked chats, or the audit summary for the chat a catalogue came from. */
export type TelegramJobData = { kind: 'notification'; notificationId: string } | { kind: 'audit-summary'; catalogId: string };
export type ClassifierUpdateJobData = { reason: 'schedule' | 'daily' | 'manual' };
/** `job` picks what the daily queue runs: the 06:15 jobs or the 03:15 purge. */
export type DailyJobData = { job: 'daily' | 'purge' };

/** BullMQ's KeepJobs: how many finished jobs, or for how many seconds, are kept. */
type Keep = boolean | { age: number; count?: number } | { count: number };
/** The subset of BullMQ's JobsOptions used here, so this module needs no bullmq import. */
export type JobDefaults = {
  attempts: number;
  backoff?: { type: 'exponential' | 'fixed'; delay: number };
  removeOnComplete: Keep;
  removeOnFail: Keep;
};

const DAY_S = 24 * 3600;

/**
 * Retry policy per queue. An audit or doc check that fails inside the domain marks itself failed and
 * completes; attempts cover infrastructure failures around it (database or Redis gone) and stalls.
 * Finished audit and doc-check jobs are removed before a new one with the same id is added.
 */
export const JOB_DEFAULTS: Record<QueueName, JobDefaults> = {
  audit: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: { age: 7 * DAY_S } },
  'doc-check': { attempts: 2, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: { age: 7 * DAY_S } },
  // A mail carries sign-in secrets (reset and confirmation links, codes): nothing sent stays in Redis, a failed one only a day.
  mail: { attempts: 5, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true, removeOnFail: { age: DAY_S } },
  telegram: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: { count: 1000 }, removeOnFail: { age: 7 * DAY_S } },
  // The update is an hour of downloads and loads; a failure is recorded in its status file and waits for the next day.
  'classifier-update': { attempts: 1, removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } },
  // Kept two days: a scheduled job's id names its day, so a second worker firing the same cron adds nothing.
  daily: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 }, removeOnComplete: { age: 2 * DAY_S }, removeOnFail: { age: 7 * DAY_S } },
};

/** The local (UTC+5) date, as the id suffix of a scheduled job. BullMQ ids may not contain ":". */
export function localDay(now = new Date()): string {
  return new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}
