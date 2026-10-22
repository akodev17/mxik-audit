// The worker's own settings, read once from the environment (the root .env is loaded first).
// Everything the domain reads (DATABASE_URL, SMTP_URL, TELEGRAM_*, EMBEDDING_*...) it reads itself.
import { z } from 'zod';

const positiveInt = (fallback: number) =>
  z.preprocess((v) => (v === undefined || v === '' ? fallback : Number(v)), z.number().int().positive());

const WorkerEnv = z.object({
  REDIS_URL: z.string().trim().min(1, 'REDIS_URL is required (e.g. redis://localhost:6379)'),
  /** Audits one worker process runs at once. Each holds a DB pool share and, with a local model, CPU. */
  AUDIT_CONCURRENCY: positiveInt(1),
  /** /healthz for the container healthcheck. Not 3000/3001/4000 (web, dev web, api). */
  WORKER_PORT: positiveInt(4100),
  /** How long SIGTERM waits for running jobs before the process exits anyway (an audit resumes from its watermark). */
  WORKER_SHUTDOWN_GRACE_MS: positiveInt(25_000),
  /** BullMQ key prefix; only tests change it. */
  BULL_PREFIX: z.string().trim().min(1).default('bull'),
});

export type WorkerConfig = {
  redisUrl: string;
  auditConcurrency: number;
  port: number;
  shutdownGraceMs: number;
  prefix: string;
};

export function workerConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const parsed = WorkerEnv.safeParse(env);
  if (!parsed.success) {
    throw new Error(`worker configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const e = parsed.data;
  return {
    redisUrl: e.REDIS_URL, auditConcurrency: e.AUDIT_CONCURRENCY, port: e.WORKER_PORT,
    shutdownGraceMs: e.WORKER_SHUTDOWN_GRACE_MS, prefix: e.BULL_PREFIX,
  };
}

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');

/** AUDIT_CONCURRENCY alone: the audit processor's decorator reads it when its module loads. */
export function auditConcurrency(env: Record<string, string | undefined> = process.env): number {
  const parsed = WorkerEnv.shape.AUDIT_CONCURRENCY.safeParse(env['AUDIT_CONCURRENCY']);
  if (!parsed.success) throw new Error(`worker configuration: AUDIT_CONCURRENCY must be a positive integer`);
  return parsed.data;
}
