// Read-only report links: the token in the path is the credential (only its hash is stored).
// Links are created and revoked under catalogs.
import { z } from 'zod';
import { defineModule, endpoint } from '../endpoint';
import { ReportData } from './catalogs';

const TokenPath = z.object({ token: z.string().min(1).max(200) });

export const share = defineModule('share', {
  view: endpoint({
    method: 'GET', path: '/api/share/{token}', auth: 'shareToken',
    summary: 'What the share page shows: the client-facing report; counts one view',
    params: TokenPath,
    responds: 'json', response: z.object({ report: ReportData, includePdf: z.boolean() }),
    replaces: ['page:r/[token]'],
    notes: '404 for an unknown, expired or revoked token. decidedBy is always null here.',
  }),
  pdf: endpoint({
    method: 'GET', path: '/api/share/{token}/pdf', auth: 'shareToken',
    summary: 'The client-facing PDF behind a share link, when the link allows it',
    params: TokenPath,
    responds: 'file', file: { contentTypes: ['application/pdf'], disposition: 'inline' },
    replaces: ['route:GET /r/[token]/pdf'],
    notes: 'Old URL /r/<token>/pdf; X-Robots-Tag: noindex, Cache-Control: private, no-store.',
  }),
});
