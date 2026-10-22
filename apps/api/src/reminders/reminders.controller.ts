// Monthly check reminders: a client's schedule and the open tasks it produces. Thin: the domain
// (reminder-ops) checks the client scope and answers the actions' messages.
import { Body, Controller, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { endpoints } from '@tasnivo/contracts';
import { finishReminderTask, saveClientSchedule, scheduleFor } from '@tasnivo/domain/reminder-ops';
import { openTasks } from '@tasnivo/domain/reminders';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import type { z, ZodTypeAny } from 'zod';
import { Route } from '../http/route';
import { CurrentUser, Locale } from '../http/decorators';
import { ApiError } from '../http/errors';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const e = endpoints.reminders;
type In<S extends ZodTypeAny> = z.output<S>;
const pipe = <S extends ZodTypeAny>(schema: S) => new ZodValidationPipe(schema);

@Controller()
@ApiTags('reminders')
export class RemindersController {
  /** A client the user may not see is the same 404 as a missing one (the client page's notFound()). */
  @Route(e.schedule)
  async schedule(@CurrentUser() user: User, @Param(pipe(e.schedule.params)) p: In<typeof e.schedule.params>) {
    const schedule = await scheduleFor(user, p.clientId);
    if (schedule === undefined) throw new ApiError(404, 'not_found', 'Not found.');
    return schedule;
  }

  @Route(e.saveSchedule)
  saveSchedule(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(pipe(e.saveSchedule.params)) p: In<typeof e.saveSchedule.params>, @Body(pipe(e.saveSchedule.body)) body: In<typeof e.saveSchedule.body>,
  ) {
    return saveClientSchedule(user, p.clientId, body, locale);
  }

  @Route(e.tasks)
  tasks(@CurrentUser() user: User) {
    return openTasks(user.orgId, user.clientIds);
  }

  @Route(e.finishTask)
  async finishTask(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(pipe(e.finishTask.params)) p: In<typeof e.finishTask.params>) {
    const result = await finishReminderTask(user, p.taskId, locale);
    return result.ok ? { ok: true as const } : result;
  }
}
