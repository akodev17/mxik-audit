// Inside the worker every domain call to jobs() goes to the queues, whatever JOBS_MODE says: a
// notification raised by an audit becomes a telegram job, the daily job queues the classifier update,
// and resumeStaleAudits queues audits instead of running them in a second place.
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { BullDispatcher } from '@tasnivo/domain/jobs/bullmq';
import { setJobs } from '@tasnivo/domain/jobs/dispatcher';
import { QUEUES, type QueueName } from '@tasnivo/domain/jobs/queues';

@Injectable()
export class WorkerJobs implements OnModuleDestroy {
  readonly dispatcher: BullDispatcher;
  readonly queues: Record<QueueName, Queue>;

  constructor(
    @InjectQueue(QUEUES.audit) audit: Queue,
    @InjectQueue(QUEUES.docCheck) docCheck: Queue,
    @InjectQueue(QUEUES.mail) mail: Queue,
    @InjectQueue(QUEUES.telegram) telegram: Queue,
    @InjectQueue(QUEUES.classifierUpdate) classifierUpdate: Queue,
    @InjectQueue(QUEUES.daily) daily: Queue,
  ) {
    this.queues = { audit, 'doc-check': docCheck, mail, telegram, 'classifier-update': classifierUpdate, daily };
    // BullModule owns and closes these queues; the dispatcher only adds to them.
    this.dispatcher = new BullDispatcher({ queue: (name) => this.queues[name] });
    setJobs(this.dispatcher);
  }

  onModuleDestroy(): void {
    setJobs(null);
  }
}
