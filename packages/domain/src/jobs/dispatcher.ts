// Where background work goes. JOBS_MODE=inline (the default) runs it in this
// process, as the app always has; JOBS_MODE=bullmq adds it to the Redis queues
// apps/worker consumes. Domain code calls jobs() and never knows which.
import type { Prisma } from '@prisma/client';
import { BullDispatcher, redisQueues } from './bullmq.js';
import { InlineDispatcher } from './inline.js';
import type { JobActor, MailJobData, TelegramJobData } from './queues.js';

export type JobsMode = 'inline' | 'bullmq';

export interface JobDispatcher {
  readonly mode: JobsMode;
  /**
   * Audits a catalogue already marked "analyzing", from `fromRow` (0 = from scratch). Resolves once the
   * audit is started (inline) or queued (bullmq), never when it is done. A catalogue already running
   * or queued is left alone.
   */
  enqueueAudit(catalogId: string, actor: JobActor, extra?: Prisma.InputJsonObject, fromRow?: number): Promise<void>;
  /** Checks a cheque/sales list already marked "analyzing". Started or queued, like an audit. */
  enqueueDocCheck(listId: string): Promise<void>;
  /** Inline: sent before this resolves (a failure is logged, as sendMail does). bullmq: queued with retries. */
  enqueueMail(mail: MailJobData): Promise<void>;
  /** Inline: delivered before this resolves. bullmq: queued with retries. Failures reject in both. */
  enqueueTelegram(message: TelegramJobData): Promise<void>;
  /** Starts a classifier update (scripts/update-classifier.ts); the advisory lock keeps it to one. */
  enqueueClassifierUpdate(reason?: 'schedule' | 'daily' | 'manual'): Promise<void>;
}

export function jobsMode(env: Record<string, string | undefined> = process.env): JobsMode {
  const raw = env['JOBS_MODE']?.trim().toLowerCase();
  if (!raw || raw === 'inline') return 'inline';
  if (raw === 'bullmq') return 'bullmq';
  throw new Error(`Unknown JOBS_MODE "${raw}". Use inline or bullmq.`);
}

export function redisUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env['REDIS_URL']?.trim();
  if (!url) throw new Error('JOBS_MODE=bullmq needs REDIS_URL (e.g. redis://localhost:6379).');
  return url;
}

export function dispatcherFromEnv(env: Record<string, string | undefined> = process.env): JobDispatcher {
  return jobsMode(env) === 'bullmq' ? new BullDispatcher(redisQueues(redisUrl(env))) : new InlineDispatcher();
}

let current: JobDispatcher | null = null;

/** The process's dispatcher, chosen from the environment on first use. */
export function jobs(): JobDispatcher {
  current ??= dispatcherFromEnv();
  return current;
}

/** Replaces the process's dispatcher (the worker installs one over its own queues; tests a fake). Null = from env again. */
export function setJobs(dispatcher: JobDispatcher | null): void {
  current = dispatcher;
}
