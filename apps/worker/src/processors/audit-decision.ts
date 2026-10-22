// Whether an audit job should run when the worker picks it up. Pure, so it is tested without Redis.
import { STARTUP_STALE_MS } from '@tasnivo/domain/audit-jobs';

export type AuditCatalogState = { status: string; progressDone: number; auditHeartbeatAt: Date | null };

export type AuditDecision =
  | { run: true; fromRow: number }
  | { run: false; reason: 'missing' | 'not-analyzing' | 'running-elsewhere' };

/**
 * A job runs only for a catalogue still "analyzing", from its stored watermark: 0 after startAudit,
 * the last fully audited row after a crash, whatever row the job was queued with. A heartbeat that
 * is fresh and newer than the job means another process (an inline web app, a CLI script, a stalled
 * worker that is still alive) is auditing it; the job then ends, and the resume sweep queues it again
 * should that process die.
 */
export function decideAudit(catalog: AuditCatalogState | null, queuedAt: number, now = Date.now()): AuditDecision {
  if (!catalog) return { run: false, reason: 'missing' };
  if (catalog.status !== 'analyzing') return { run: false, reason: 'not-analyzing' };
  const beat = catalog.auditHeartbeatAt?.getTime() ?? 0;
  if (beat > queuedAt && now - beat < STARTUP_STALE_MS) return { run: false, reason: 'running-elsewhere' };
  return { run: true, fromRow: catalog.progressDone };
}

/** BullMQ has counted the attempt that just failed: true when no retry follows. */
export function finalAttempt(job: { attemptsMade: number; opts: { attempts?: number } }): boolean {
  return job.attemptsMade >= (job.opts.attempts ?? 1);
}
