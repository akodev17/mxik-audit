// What scripts/scheduler.mjs did, at the same Uzbekistan (UTC+5, no DST) times, plus the stale-audit
// sweep that page renders used to trigger. Each cron only adds a job whose id names the local day, so
// several worker instances firing the same cron still run it once.
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { resumeStaleAudits, STALE_MS, STARTUP_STALE_MS } from '@tasnivo/domain/audit-jobs';
import { localDay, type ClassifierUpdateJobData, type DailyJobData } from '@tasnivo/domain/jobs/queues';
import { reason } from '../logger.js';
import { WorkerJobs } from './worker-jobs.service.js';

const TZ = 'Asia/Tashkent';
export const RESUME_EVERY_MS = 120_000;

@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  private readonly log = new Logger('SchedulerService');

  constructor(@Inject(WorkerJobs) private readonly jobs: WorkerJobs) {}

  /** 03:15: lead files, expired demo orgs, old demo requests (was `npm run purge:expired`). */
  @Cron('15 3 * * *', { name: 'purge', timeZone: TZ })
  async purge(): Promise<void> {
    await this.schedule('daily', 'purge', { job: 'purge' } satisfies DailyJobData);
  }

  /** 04:00: the classifier update (was `npm run classifier:update`). */
  @Cron('0 4 * * *', { name: 'classifier-update', timeZone: TZ })
  async classifierUpdate(): Promise<void> {
    await this.schedule('classifier-update', 'classifier-update', { reason: 'schedule' } satisfies ClassifierUpdateJobData);
  }

  /** 06:15: reminders and retention (was POST /api/cron/daily; now in the worker, no HTTP). */
  @Cron('15 6 * * *', { name: 'daily', timeZone: TZ })
  async daily(): Promise<void> {
    await this.schedule('daily', 'daily', { job: 'daily' } satisfies DailyJobData);
  }

  /** On boot, a few missed beats are enough: whatever ran those audits is gone. */
  async onApplicationBootstrap(): Promise<void> {
    await this.resume(STARTUP_STALE_MS, 'boot');
  }

  @Interval('resume-stale-audits', RESUME_EVERY_MS)
  async sweep(): Promise<void> {
    await this.resume(STALE_MS, 'sweep');
  }

  private async resume(staleMs: number, trigger: 'boot' | 'sweep'): Promise<void> {
    try {
      const queued = await resumeStaleAudits(staleMs);
      if (queued > 0 || trigger === 'boot') this.log.log({ msg: 'stale audits handed to the audit queue', trigger, count: queued });
    } catch (error) {
      this.log.error({ msg: 'stale-audit sweep failed', trigger, error: reason(error) });
    }
  }

  private async schedule(queue: 'daily' | 'classifier-update', name: string, data: object): Promise<void> {
    // BullMQ ids may not contain ":"; one job per name per local day.
    const jobId = `${name}-${localDay()}`;
    try {
      await this.jobs.queues[queue].add(name, data, { jobId });
      this.log.log({ msg: 'scheduled job queued', queue, jobId });
    } catch (error) {
      this.log.error({ msg: 'could not queue a scheduled job', queue, jobId, error: reason(error) });
    }
  }
}
