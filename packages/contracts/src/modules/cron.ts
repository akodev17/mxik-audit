// Jobs started from outside (`Authorization: Bearer $CRON_SECRET`, timing-safe; 503 while the
// secret is unset or shorter than 16 characters). In the split these only enqueue (W1b).
import { z } from 'zod';
import { defineModule, endpoint } from '../endpoint';

export const cron = defineModule('cron', {
  daily: endpoint({
    method: 'POST', path: '/api/cron/daily', auth: 'cron',
    summary: 'Daily jobs: monthly check reminders, retention, purges',
    responds: 'json', response: z.record(z.unknown()),
    replaces: ['route:POST /api/cron/daily'],
    notes: 'Answers runDailyJobs()\'s report today; once the worker runs it, the answer may become { queued: true }.',
  }),
  classifierUpdate: endpoint({
    method: 'POST', path: '/api/cron/classifier-update', auth: 'cron',
    summary: 'Start a classifier update in the background',
    responds: 'json', response: z.object({ started: z.literal(true), pid: z.number().int().nullable(), log: z.string() }), status: 202,
    replaces: ['route:POST /api/cron/classifier-update'],
    notes: 'Today it spawns scripts/update-classifier.ts; on the worker it enqueues classifier-update (pid becomes null).',
  }),
});
