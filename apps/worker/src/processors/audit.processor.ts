// The audit queue: one job per catalogue (job id = catalogue id). The domain's runAudit does the
// work and keeps the heartbeat, so the web's progress endpoint and resumeStaleAudits see it as before.
import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { db } from '@tasnivo/db';
import { runAudit } from '@tasnivo/domain/audit-jobs';
import { QUEUES, type AuditJobData } from '@tasnivo/domain/jobs/queues';
import { auditConcurrency } from '../config.js';
import { reason } from '../logger.js';
import { decideAudit, finalAttempt } from './audit-decision.js';

/**
 * A long audit renews its lock while it runs; a lock lost to a busy event loop must not hand the job
 * to a second worker too eagerly. A catalogue that keeps killing its worker fails after three stalls.
 */
const AUDIT_LOCK_MS = 120_000;

@Processor(QUEUES.audit, { concurrency: auditConcurrency(), lockDuration: AUDIT_LOCK_MS, maxStalledCount: 3 })
export class AuditProcessor extends WorkerHost {
  private readonly log = new Logger('AuditProcessor');
  /** Catalogues this process is auditing: a stalled copy of a job never runs next to its original. */
  private readonly active = new Set<string>();

  async process(job: Job<AuditJobData>): Promise<{ status: string } | { skipped: string }> {
    const { catalogId, actor, extra } = job.data;
    const fields = { catalogId, jobId: job.id, attempt: job.attemptsMade + 1 };
    if (this.active.has(catalogId)) {
      this.log.warn({ msg: 'audit already running in this worker; job skipped', ...fields });
      return { skipped: 'running-here' };
    }
    const catalog = await db.catalog.findUnique({ where: { id: catalogId }, select: { status: true, progressDone: true, auditHeartbeatAt: true } });
    const decision = decideAudit(catalog, job.timestamp);
    if (!decision.run) {
      this.log.log({ msg: 'audit job skipped', reason: decision.reason, ...fields });
      return { skipped: decision.reason };
    }

    this.active.add(catalogId);
    const started = Date.now();
    this.log.log({ msg: 'audit started', fromRow: decision.fromRow, ...fields });
    try {
      // Never throws: a failure inside marks the catalogue "failed" with its message, as inline.
      await runAudit(catalogId, decision.fromRow, actor, extra);
    } finally {
      this.active.delete(catalogId);
    }
    const after = await db.catalog.findUnique({ where: { id: catalogId }, select: { status: true, auditError: true } });
    const status = after?.status ?? 'missing';
    this.log.log({ msg: 'audit finished', status, durationMs: Date.now() - started, ...(after?.auditError ? { error: after.auditError } : {}), ...fields });
    return { status };
  }

  /** Only failures around runAudit get here (database or Redis gone, repeated stalls). */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<AuditJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const { catalogId } = job.data;
    const final = finalAttempt(job);
    this.log.error({ msg: final ? 'audit job failed' : 'audit job failed; will retry', catalogId, jobId: job.id, attempt: job.attemptsMade, error: reason(error) });
    if (!final) return;
    // The same record runAudit leaves on a failure, unless the catalogue has moved on meanwhile.
    await db.catalog.updateMany({
      where: { id: catalogId, status: 'analyzing' },
      data: { status: 'failed', auditError: error.message.slice(0, 500) },
    }).catch((e: unknown) => this.log.error({ msg: 'could not mark the catalogue failed', catalogId, error: reason(e) }));
  }
}
