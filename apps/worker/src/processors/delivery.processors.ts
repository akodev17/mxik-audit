// Outbound messages: the mail and telegram queues. Both retry with backoff (queues.ts); a message
// that still fails is logged and kept in the failed set for a week.
import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES, type MailJobData, type TelegramJobData } from '@tasnivo/domain/jobs/queues';
import { deliverMail } from '@tasnivo/domain/mailer';
import { deliverTelegram } from '@tasnivo/domain/telegram/deliver';
import { reason } from '../logger.js';
import { finalAttempt } from './audit-decision.js';

@Processor(QUEUES.mail, { concurrency: 4 })
export class MailProcessor extends WorkerHost {
  private readonly log = new Logger('MailProcessor');

  async process(job: Job<MailJobData>): Promise<{ sent: boolean }> {
    // Throws on an SMTP failure, so the queue retries; false when SMTP is not configured.
    const sent = await deliverMail(job.data);
    // The address stays out of the log; the job id finds it in Redis.
    this.log.log({ msg: sent ? 'mail sent' : 'mail not configured; dropped', jobId: job.id, subject: job.data.subject });
    return { sent };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<MailJobData> | undefined, error: Error): void {
    if (!job) return;
    this.log.error({ msg: finalAttempt(job) ? 'mail failed' : 'mail failed; will retry', jobId: job.id, attempt: job.attemptsMade, error: reason(error) });
  }
}

@Processor(QUEUES.telegram, { concurrency: 4 })
export class TelegramProcessor extends WorkerHost {
  private readonly log = new Logger('TelegramProcessor');

  async process(job: Job<TelegramJobData>): Promise<void> {
    await deliverTelegram(job.data);
    // deliverTelegram is a no-op without a bot token; either way the job is done.
    this.log.log({ msg: 'telegram job done', jobId: job.id, ...job.data });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<TelegramJobData> | undefined, error: Error): void {
    if (!job) return;
    this.log.error({ msg: finalAttempt(job) ? 'telegram failed' : 'telegram failed; will retry', jobId: job.id, attempt: job.attemptsMade, ...job.data, error: reason(error) });
  }
}
