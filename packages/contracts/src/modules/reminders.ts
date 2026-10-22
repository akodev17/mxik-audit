// Monthly check reminders: a client's schedule and the open tasks it produces.
import { z } from 'zod';
import { Fail, IsoDateTime, ShortId } from '../common';
import { defineModule, endpoint } from '../endpoint';

/** reminders.ts getSchedule(). */
export const ReminderSchedule = z.object({
  clientId: z.string(),
  dayOfMonth: z.number().int(),
  assigneeId: z.string().nullable(),
  enabled: z.boolean(),
  lastPeriod: z.string().nullable(),
  updatedAt: IsoDateTime,
});

/** reminders.ts OpenTask. */
export const ReminderTask = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  period: z.string(),
  dueOn: IsoDateTime,
  overdue: z.boolean(),
});

/** actions/reminders.ts ReminderResult. */
const ReminderResult = z.union([z.object({ ok: z.literal(true), nextDue: IsoDateTime.nullable().optional() }), Fail]);

export const reminders = defineModule('reminders', {
  schedule: endpoint({
    method: 'GET', path: '/api/clients/{clientId}/reminder', auth: 'session', role: 'any',
    summary: 'A client\'s monthly check schedule; null when none was set',
    params: z.object({ clientId: ShortId }),
    responds: 'json', response: ReminderSchedule.nullable(),
    replaces: ['page:(app)/clients/[id]#schedule'],
  }),
  saveSchedule: endpoint({
    method: 'PUT', path: '/api/clients/{clientId}/reminder', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Day of month (1–28), assignee and on/off of a client\'s monthly check',
    params: z.object({ clientId: ShortId }),
    body: z.object({ dayOfMonth: z.number(), assigneeId: z.string().min(1).nullable(), enabled: z.boolean() }),
    responds: 'json', response: ReminderResult,
    replaces: ['action:reminders.ts#saveSchedule'],
    notes: 'The day is not range-checked here: setSchedule answers "bad day" for anything but 1–28, shown as { ok: false, error }, as before.',
  }),
  tasks: endpoint({
    method: 'GET', path: '/api/reminders/tasks', auth: 'session', role: 'any',
    summary: 'Open monthly checks of the clients the user may see',
    responds: 'json', response: z.array(ReminderTask),
    replaces: ['page:(app)/dashboard#tasks'],
  }),
  finishTask: endpoint({
    method: 'POST', path: '/api/reminders/tasks/{taskId}/done', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Mark a monthly check done by hand',
    params: z.object({ taskId: ShortId }),
    responds: 'json', response: ReminderResult,
    replaces: ['action:reminders.ts#finishTask'],
  }),
});
