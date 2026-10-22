// Jobs started by an external cron with "Authorization: Bearer $CRON_SECRET" (CronGuard: 503 while
// the secret is unset or short, 401 for a wrong one). Under JOBS_MODE=bullmq they are only queued
// for the worker; otherwise they run as the web routes ran them. The API never spawns the
// classifier update itself while a worker queue exists.
import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { endpoints } from '@tasnivo/contracts';
import { triggerClassifierUpdate } from '@tasnivo/domain/classifier-start';
import { triggerDailyJobs } from '@tasnivo/domain/daily';
import { CronGuard } from '../auth-core/cron.guard';
import { Route } from '../http/route';
import { SkipCsrf } from '../http/decorators';

const e = endpoints.cron;

@ApiTags('cron')
@Controller()
@SkipCsrf()
@UseGuards(CronGuard)
@ApiBearerAuth()
export class CronController {
  /** runDailyJobs()'s report, or { queued, jobId, added } when the worker runs it. */
  @Route(e.daily)
  daily() {
    return triggerDailyJobs();
  }

  /** 202 { started: true, pid, log }; pid is null and log names the queue when the worker runs it. */
  @Route(e.classifierUpdate)
  async classifierUpdate() {
    const started = await triggerClassifierUpdate();
    return { started: true, pid: started.pid, log: started.log };
  }
}
