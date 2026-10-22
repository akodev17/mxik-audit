// JOBS_MODE=inline: background work runs in this process, fire-and-forget, as
// it did before the worker existed. Tests, CLI scripts and the web app (until
// it is rewired onto the API) use this. The `running` sets are per process, so
// two processes may each start the same audit; only the heartbeat (see
// resumeStaleAudits) keeps them apart. The bullmq mode has no such gap.
import type { Prisma } from '@prisma/client';
import type { JobDispatcher } from './dispatcher.js';
import type { JobActor, MailJobData, TelegramJobData } from './queues.js';

export class InlineDispatcher implements JobDispatcher {
  readonly mode = 'inline' as const;
  private readonly audits = new Set<string>();
  private readonly docChecks = new Set<string>();

  enqueueAudit(catalogId: string, actor: JobActor, extra: Prisma.InputJsonObject = {}, fromRow = 0): Promise<void> {
    if (this.audits.has(catalogId)) return Promise.resolve();
    this.audits.add(catalogId);
    // Loaded lazily: audit-jobs reaches this module through jobs().
    void import('../audit-jobs.js')
      .then(({ runAudit }) => runAudit(catalogId, fromRow, actor, extra))
      .catch((error: unknown) => console.error(`[audit ${catalogId}] could not start`, error))
      .finally(() => this.audits.delete(catalogId));
    return Promise.resolve();
  }

  enqueueDocCheck(listId: string): Promise<void> {
    if (this.docChecks.has(listId)) return Promise.resolve();
    this.docChecks.add(listId);
    void import('../docs.js')
      .then(({ runDocCheck, markDocCheckFailed }) => runDocCheck(listId).catch((error: unknown) => markDocCheckFailed(listId, error)))
      .catch((error: unknown) => console.error(`[doc check ${listId}] could not start`, error))
      .finally(() => this.docChecks.delete(listId));
    return Promise.resolve();
  }

  async enqueueMail(mail: MailJobData): Promise<void> {
    const { sendMail } = await import('../mailer.js');
    await sendMail(mail);
  }

  async enqueueTelegram(message: TelegramJobData): Promise<void> {
    // The bot library loads only when something is sent.
    const { deliverTelegram } = await import('../telegram/deliver.js');
    await deliverTelegram(message);
  }

  async enqueueClassifierUpdate(): Promise<void> {
    const { startClassifierUpdate } = await import('../classifier-start.js');
    startClassifierUpdate();
  }

  /** An audit this process is running. */
  auditRunning(catalogId: string): boolean {
    return this.audits.has(catalogId);
  }

  /** A doc check this process is running. */
  docCheckRunning(listId: string): boolean {
    return this.docChecks.has(listId);
  }
}
