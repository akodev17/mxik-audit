import { Module, type DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { JOB_DEFAULTS, QUEUES } from '@tasnivo/domain/jobs/queues';
import { WORKER_CONFIG, type WorkerConfig } from './config.js';
import { AuditProcessor } from './processors/audit.processor.js';
import { MailProcessor, TelegramProcessor } from './processors/delivery.processors.js';
import { DocCheckProcessor } from './processors/doc-check.processor.js';
import { ClassifierUpdateProcessor, DailyProcessor } from './processors/scheduled.processors.js';
import { AuditContextService } from './services/audit-context.service.js';
import { HealthService } from './services/health.service.js';
import { SchedulerService } from './services/scheduler.service.js';
import { WorkerJobs } from './services/worker-jobs.service.js';

@Module({})
export class WorkerModule {
  /** `schedule: false` leaves out the crons and the stale-audit sweep (tests that drive the queues themselves). */
  static register(config: WorkerConfig, options: { schedule?: boolean } = {}): DynamicModule {
    const schedule = options.schedule ?? true;
    return {
      module: WorkerModule,
      imports: [
        // Workers need maxRetriesPerRequest: null (BullMQ's rule for blocking connections).
        BullModule.forRoot({ connection: { url: config.redisUrl, maxRetriesPerRequest: null }, prefix: config.prefix }),
        BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name, defaultJobOptions: JOB_DEFAULTS[name] }))),
        ...(schedule ? [ScheduleModule.forRoot()] : []),
      ],
      providers: [
        { provide: WORKER_CONFIG, useValue: config },
        WorkerJobs,
        AuditContextService,
        HealthService,
        ...(schedule ? [SchedulerService] : []),
        AuditProcessor,
        DocCheckProcessor,
        MailProcessor,
        TelegramProcessor,
        ClassifierUpdateProcessor,
        DailyProcessor,
      ],
    };
  }
}
