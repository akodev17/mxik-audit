// The classifier-update and daily queues: what the scheduler (and the daily job) put there.
import { Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { ChildProcess } from 'node:child_process';
import { classifierUpdateRunning } from '@tasnivo/domain/classifier-lock';
import { dailyClassifierUpdate, runClassifierUpdate } from '@tasnivo/domain/classifier-start';
import { latestSnapshot } from '@tasnivo/domain/classifier-state';
import { runDailyJobs } from '@tasnivo/domain/daily';
import { jobs } from '@tasnivo/domain/jobs/dispatcher';
import { QUEUES, type ClassifierUpdateJobData, type DailyJobData } from '@tasnivo/domain/jobs/queues';
import { purgeExpired } from '@tasnivo/domain/purge-expired';
import { reason } from '../logger.js';

/**
 * scripts/update-classifier.ts as a child process, one at a time in this worker; the script's own
 * Postgres advisory lock (727001) keeps it to one across every process. The lock is checked first so
 * a run that would be turned away ends quietly instead of as a failure.
 */
@Processor(QUEUES.classifierUpdate, { concurrency: 1, lockDuration: 300_000 })
export class ClassifierUpdateProcessor extends WorkerHost implements BeforeApplicationShutdown {
  private readonly log = new Logger('ClassifierUpdateProcessor');
  private child: ChildProcess | null = null;

  async process(job: Job<ClassifierUpdateJobData>): Promise<{ exitCode: number | null } | { skipped: string }> {
    const fields = { jobId: job.id, reason: job.data.reason };
    if (await classifierUpdateRunning()) {
      this.log.log({ msg: 'classifier update already running elsewhere; skipped', ...fields });
      return { skipped: 'locked' };
    }
    const started = Date.now();
    const done = await runClassifierUpdate((child) => {
      this.child = child;
      this.log.log({ msg: 'classifier update started', pid: child.pid, ...fields });
    }).finally(() => {
      this.child = null;
    });
    const result = { msg: 'classifier update exited', exitCode: done.exitCode, signal: done.signal, log: done.log, durationMs: Date.now() - started, ...fields };
    // The script records how it ended in the status file /api/health reads; a failure waits for the next run.
    if (done.exitCode !== 0) {
      this.log.error(result);
      throw new Error(`update-classifier exited with ${done.exitCode ?? done.signal}; see ${done.log}`);
    }
    this.log.log(result);
    return { exitCode: done.exitCode };
  }

  /** An update takes an hour; on shutdown it is stopped (its lock goes with its connection) rather than waited for. */
  beforeApplicationShutdown(): void {
    if (this.child && this.child.exitCode === null) {
      this.log.warn({ msg: 'stopping the running classifier update for shutdown', pid: this.child.pid });
      this.child.kill('SIGTERM');
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ClassifierUpdateJobData> | undefined, error: Error): void {
    this.log.error({ msg: 'classifier update job failed', jobId: job?.id, error: reason(error) });
  }
}

/** The daily jobs (06:15) and the purge (03:15), in this process; the classifier update they may start is queued. */
@Processor(QUEUES.daily, { concurrency: 1, lockDuration: 300_000 })
export class DailyProcessor extends WorkerHost {
  private readonly log = new Logger('DailyProcessor');

  async process(job: Job<DailyJobData>): Promise<unknown> {
    const started = Date.now();
    const fields = { jobId: job.id, job: job.data.job };
    if (job.data.job === 'purge') {
      const result = await purgeExpired();
      this.log.log({ msg: 'purge finished', ...result, durationMs: Date.now() - started, ...fields });
      return result;
    }
    const result = await runDailyJobs(new Date(), (now) => dailyClassifierUpdate(now, {
      snapshot: latestSnapshot,
      running: classifierUpdateRunning,
      start: async () => {
        await jobs().enqueueClassifierUpdate('daily');
        return { pid: null, log: `queue:${QUEUES.classifierUpdate}` };
      },
    }));
    this.log.log({ msg: 'daily jobs finished', result, durationMs: Date.now() - started, ...fields });
    return result;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<DailyJobData> | undefined, error: Error): void {
    this.log.error({ msg: 'scheduled job failed', jobId: job?.id, job: job?.data.job, attempt: job?.attemptsMade, error: reason(error) });
  }
}
