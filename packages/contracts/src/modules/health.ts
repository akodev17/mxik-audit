// Liveness for the load balancer and uptime checks: never cached, 503 when audits cannot run.
import { z } from 'zod';
import { defineModule, endpoint } from '../endpoint';

/** classifier-health.ts classifierHealth(). */
export const ClassifierHealth = z.object({
  loaded: z.boolean(),
  takenAt: z.string().nullable(),
  ageDays: z.number().nullable(),
  codeCount: z.number().int().nullable(),
  stale: z.boolean(),
  lastUpdate: z.object({ outcome: z.enum(['success', 'failed']), at: z.string(), message: z.string().nullable() }).nullable(),
  /** The restricted-code list: codes loaded (0 = audits do not check RESTRICTED) and the newest import; null when unread. */
  restricted: z.object({ codes: z.number().int(), importedAt: z.string().nullable() }).nullable(),
});

export const health = defineModule('health', {
  get: endpoint({
    method: 'GET', path: '/api/health', auth: 'public',
    summary: 'Database reachable and classifier loaded (200), otherwise 503 with the same body',
    responds: 'json',
    response: z.object({ status: z.enum(['ok', 'unavailable']), database: z.boolean(), classifier: ClassifierHealth }),
    alsoStatus: [503],
    replaces: ['route:GET /api/health'],
  }),
});
