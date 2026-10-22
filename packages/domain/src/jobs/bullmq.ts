// JOBS_MODE=bullmq: background work becomes a job on a Redis queue, which
// apps/worker processes. Audits and doc checks use their own id as the job id,
// so a catalogue or list is queued at most once, whichever process asks.
import type { Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { JobDispatcher } from './dispatcher.js';
import {
  JOB_DEFAULTS, QUEUES, type AuditJobData, type ClassifierUpdateJobData, type DocCheckJobData, type JobActor,
  type MailJobData, type QueueName, type TelegramJobData,
} from './queues.js';

/** The part of a BullMQ Job this module touches. */
export type JobLike = { getState(): Promise<string>; remove(): Promise<void> };
/** The part of a BullMQ Queue this module touches, so tests can pass a fake. */
export type QueueLike = {
  add(name: string, data: unknown, opts?: { jobId?: string }): Promise<unknown>;
  getJob(jobId: string): Promise<JobLike | undefined | null>;
  close(): Promise<void>;
};
export type QueueSource = {
  queue(name: QueueName): QueueLike | Promise<QueueLike>;
  close?(): Promise<void>;
};

/** States in which a job with this id still stands for pending work. */
const PENDING = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

/**
 * Adds a job under `jobId` unless one is still pending. A finished job (kept for inspection) is removed
 * first, since BullMQ would otherwise silently refuse the id. Returns whether a job was added.
 */
export async function addUnique(queue: QueueLike, name: string, data: unknown, jobId: string): Promise<boolean> {
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (PENDING.has(state)) return false;
    await existing.remove().catch(() => undefined);
  }
  await queue.add(name, data, { jobId });
  return true;
}

export class BullDispatcher implements JobDispatcher {
  readonly mode = 'bullmq' as const;

  constructor(private readonly source: QueueSource) {}

  private queue(name: QueueName): Promise<QueueLike> {
    return Promise.resolve(this.source.queue(name));
  }

  async enqueueAudit(catalogId: string, actor: JobActor, extra: Prisma.InputJsonObject = {}, fromRow = 0): Promise<void> {
    const data: AuditJobData = { catalogId, actor, extra, fromRow };
    await addUnique(await this.queue(QUEUES.audit), 'audit', data, catalogId);
  }

  async enqueueDocCheck(listId: string): Promise<void> {
    const data: DocCheckJobData = { listId };
    await addUnique(await this.queue(QUEUES.docCheck), 'doc-check', data, listId);
  }

  async enqueueMail(mail: MailJobData): Promise<void> {
    await (await this.queue(QUEUES.mail)).add('mail', mail);
  }

  async enqueueTelegram(message: TelegramJobData): Promise<void> {
    await (await this.queue(QUEUES.telegram)).add(message.kind, message);
  }

  async enqueueClassifierUpdate(reason: ClassifierUpdateJobData['reason'] = 'manual'): Promise<void> {
    const data: ClassifierUpdateJobData = { reason };
    await (await this.queue(QUEUES.classifierUpdate)).add('classifier-update', data);
  }

  /** Closes the queues and their connection (scripts and tests; the worker closes its own). */
  async close(): Promise<void> {
    await this.source.close?.();
  }
}

/**
 * Producer-side queues on one Redis connection, created on first use. bullmq and ioredis load only
 * then, so the inline mode never pulls them in. `prefix` (BullMQ's key prefix, default "bull") is for tests.
 */
export function redisQueues(url: string, options: { prefix?: string } = {}): QueueSource {
  const queues = new Map<QueueName, Promise<QueueLike>>();
  let connection: Promise<Redis> | null = null;
  const connect = async (): Promise<Redis> => {
    const { Redis: Client } = await import('ioredis');
    return new Client(url, { maxRetriesPerRequest: 3 });
  };
  return {
    queue(name) {
      let made = queues.get(name);
      if (!made) {
        made = (async () => {
          const { Queue } = await import('bullmq');
          connection ??= connect();
          return new Queue(name, {
            connection: await connection, defaultJobOptions: JOB_DEFAULTS[name], ...(options.prefix ? { prefix: options.prefix } : {}),
          });
        })();
        queues.set(name, made);
      }
      return made;
    },
    async close() {
      await Promise.all([...queues.values()].map(async (q) => (await q).close()));
      queues.clear();
      if (connection) await (await connection).quit().catch(() => undefined);
      connection = null;
    },
  };
}
