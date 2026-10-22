// The public demo (request a link by e-mail, open it) and the landing page's lead form.
// Public and rate-limited; a filled honeypot field is answered as a success and nothing is stored.
import { z } from 'zod';
import { LIMITS, Redirect } from '../common';
import { defineModule, endpoint } from '../endpoint';

/** demo-access-fields.ts DEMO_LIMITS. */
export const DEMO_LIMITS = { name: 100, company: 150, email: 200 } as const;
/** lead-guard.ts LEAD_LIMITS. */
export const LEAD_LIMITS = { contact: 120, company: 200, note: 2000, filename: 200 } as const;
/** lead-guard.ts HONEYPOT_FIELD: a field people never see. */
export const HONEYPOT_FIELD = 'website';

/** actions/demo.ts DemoState. */
export const DemoState = z.object({ error: z.string().optional(), sentTo: z.string().optional(), field: z.literal('email').optional() });

/** actions/lead.ts LeadState. */
export const LeadState = z.object({
  ok: z.literal(true).optional(),
  error: z.string().optional(),
  field: z.enum(['contact', 'file']).optional(),
  /** What was typed, returned so a failed submit does not wipe it. */
  contact: z.string().optional(),
});

/** Long values are cut by the handler (field(form, name, max)), not refused. */
const Text = z.string().max(1000);

export const demo = defineModule('demo', {
  config: endpoint({
    method: 'GET', path: '/api/demo/config', auth: 'public',
    summary: 'How long a demo link and a demo session last',
    responds: 'json', response: z.object({ linkMinutes: z.number().int(), idleMinutes: z.number().int(), ttlHours: z.number().int() }),
    replaces: ['page:demo'],
    provisional: 'demo/page.tsx and demo/verify read demo-config.ts directly',
  }),
  request: endpoint({
    method: 'POST', path: '/api/demo/request', auth: 'public',
    summary: 'Ask for demo access: a single-use link is e-mailed',
    body: z.object({ name: Text, company: Text, email: Text, useCase: Text.optional(), [HONEYPOT_FIELD]: Text.optional() }),
    responds: 'json', response: DemoState,
    replaces: ['action:demo.ts#requestDemo'],
  }),
  peek: endpoint({
    method: 'GET', path: '/api/demo/links/{token}', auth: 'public',
    summary: 'Whose demo link this is, before it is used; null for a used or expired one',
    params: z.object({ token: z.string() }),
    responds: 'json', response: z.object({ name: z.string() }).nullable(),
    replaces: ['page:demo/verify/[token]'],
  }),
  open: endpoint({
    method: 'POST', path: '/api/demo/open', auth: 'public',
    summary: 'Use a demo link: signs in to a fresh demo org and lands on its sample catalogue',
    body: z.object({ token: z.string().max(200) }),
    responds: 'json', response: z.union([Redirect, DemoState]),
    replaces: ['action:demo.ts#openDemo'],
  }),
  lead: endpoint({
    method: 'POST', path: '/api/lead', auth: 'public',
    summary: 'Landing page lead form: a contact and an optional sample file',
    multipart: {
      fields: z.object({ contact: z.string().max(4000), company: z.string().max(4000).optional(), note: z.string().max(8000).optional(), [HONEYPOT_FIELD]: z.string().max(4000).optional() }),
      files: { file: { required: false, maxBytes: LIMITS.leadBytes, extensions: LIMITS.leadExtensions, description: 'A sample catalogue, .xlsx or .csv.' } },
    },
    responds: 'json', response: LeadState,
    replaces: ['action:lead.ts#submitLead'],
    notes: 'Validation messages (too long, too big, wrong type) come back as { error, field }, not 400/413. Five requests per IP per ten minutes.',
  }),
});
