// The doc-check queue: one job per cheque/sales list (job id = list id), running the domain's runDocCheck.
import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { db } from '@tasnivo/db';
import { markDocCheckFailed, runDocCheck } from '@tasnivo/domain/docs';
import { QUEUES, type DocCheckJobData } from '@tasnivo/domain/jobs/queues';
import { reason } from '../logger.js';
import { finalAttempt } from './audit-decision.js';

@Processor(QUEUES.docCheck, { concurrency: 1, lockDuration: 120_000 })
export class DocCheckProcessor extends WorkerHost {
  private readonly log = new Logger('DocCheckProcessor');

  async process(job: Job<DocCheckJobData>): Promise<{ status: string } | { skipped: string }> {
    const { listId } = job.data;
    const fields = { listId, jobId: job.id, attempt: job.attemptsMade + 1 };
    const list = await db.docList.findUnique({ where: { id: listId }, select: { status: true } });
    if (list?.status !== 'analyzing') {
      this.log.log({ msg: 'doc check job skipped', reason: list ? 'not-analyzing' : 'missing', ...fields });
      return { skipped: list ? 'not-analyzing' : 'missing' };
    }
    const started = Date.now();
    this.log.log({ msg: 'doc check started', ...fields });
    // A throw is retried (the check starts over: it clears its groups first); the last one marks the list failed.
    await runDocCheck(listId);
    this.log.log({ msg: 'doc check finished', durationMs: Date.now() - started, ...fields });
    return { status: 'ready' };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<DocCheckJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const final = finalAttempt(job);
    this.log.error({ msg: final ? 'doc check failed' : 'doc check failed; will retry', listId: job.data.listId, jobId: job.id, attempt: job.attemptsMade, error: reason(error) });
    if (final) await markDocCheckFailed(job.data.listId, error);
  }
}
