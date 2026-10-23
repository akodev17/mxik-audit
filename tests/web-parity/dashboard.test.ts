// The dashboard's work queue, the suggestion labels, the activity day input, the sitemap origin, the
// security headers and the system decision actions: the web app's copies (apps/web/src/lib) against
// their @tasnivo/domain and @tasnivo/core originals.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as coreLabels from '@tasnivo/core/match/confidence-labels';
import { dayInputValue as domainDayInput } from '@tasnivo/domain/activity-dates';
import { appOrigin as domainOrigin } from '@tasnivo/domain/app-url';
import { clientAttention as domainAttention } from '@tasnivo/domain/client-attention';
import type { ClientStats } from '@tasnivo/domain/client-stats';
import { SYSTEM_DECISION_ACTIONS as DOMAIN_SYSTEM } from '@tasnivo/domain/decision-source';
import { contentSecurityPolicy as domainCsp, securityHeaders as domainHeaders } from '@tasnivo/domain/security/headers';
import * as domainQueue from '@tasnivo/domain/work-queue';
import { dayInputValue } from '@/lib/pure/activity-dates';
import { appOrigin } from '@/lib/pure/app-url';
import * as labels from '@/lib/pure/confidence-labels';
import * as queue from '@/lib/pure/work-queue';
import { contentSecurityPolicy, securityHeaders } from '@/lib/security-headers';
import { SYSTEM_DECISION_ACTIONS } from '@/lib/workspace-url';

const client = (id: string, over: Partial<ClientStats> = {}): ClientStats => ({
  id, name: `Mijoz ${id}`, isDefault: false, archivedAt: null, createdAt: new Date('2026-01-01T00:00:00Z'),
  catalogId: `cat-${id}`, catalogName: 'k.xlsx', auditedAt: new Date('2026-10-01T00:00:00Z'), rowCount: 10, previousId: null,
  catalogs: 1, riskyRows: 4, openRows: 0, riskyFindings: 4, pendingFindings: 0, updatePending: 0, overdueTasks: 0, accountants: [],
  ...over,
});

const CLIENTS: ClientStats[] = [
  client('a', { openRows: 3, pendingFindings: 5 }),
  client('b', { overdueTasks: 1 }),
  client('c', { catalogId: null, auditedAt: null, catalogs: 0 }),
  client('d', { catalogId: null, auditedAt: null, catalogs: 2 }),
  client('e', { updatePending: 2, auditedAt: new Date('2026-08-01T00:00:00Z') }),
  client('f', { isDefault: true, catalogId: null, auditedAt: null, catalogs: 0 }),
  client('g'),
  client('h', { openRows: 3, name: 'Aaa', auditedAt: null }),
];
const PENDING = new Map<string, 'failed' | 'analyzing' | 'uploaded'>([['d', 'failed']]);

describe('dashboard work queue', () => {
  it('orders, acts and counts like the domain', () => {
    const mine = queue.workQueue(CLIENTS, new Set(PENDING.keys()));
    const theirs = domainQueue.workQueue(CLIENTS, new Set(PENDING.keys()));
    assert.deepEqual(mine, theirs);
    assert.deepEqual(queue.queueFilterCounts(mine), domainQueue.queueFilterCounts(theirs));
    for (const filter of queue.QUEUE_FILTERS) {
      for (const sort of queue.QUEUE_SORTS) assert.deepEqual(queue.arrangeQueue(mine, filter, sort), domainQueue.arrangeQueue(theirs, filter, sort), `${filter}/${sort}`);
    }
  });

  it('reads the URL and shares out the checks like the domain', () => {
    assert.deepEqual([...queue.QUEUE_FILTERS], [...domainQueue.QUEUE_FILTERS]);
    assert.deepEqual([...queue.QUEUE_SORTS], [...domainQueue.QUEUE_SORTS]);
    for (const p of [{}, { qf: 'open', qs: 'name' }, { qf: 'x', qs: 'audited' }, { qf: 'setup', qs: 3 }]) assert.deepEqual(queue.parseQueueParams(p), domainQueue.parseQueueParams(p));
    const types = [{ type: 'MISSING', findings: 3, rows: 2 }, { type: 'MISMATCH', findings: 1, rows: 1 }];
    assert.deepEqual(queue.issueShares(types), domainQueue.issueShares(types));
    assert.deepEqual(queue.issueShares([]), domainQueue.issueShares([]));
  });

  it('names the same reasons a client needs attention', () => {
    for (const c of CLIENTS) assert.deepEqual(queue.clientAttention(c, PENDING), domainAttention(c, PENDING), c.id);
  });
});

describe('suggestion labels', () => {
  it('use core\'s thresholds and rules', () => {
    assert.deepEqual(labels.CONFIDENCE_LABELS, coreLabels.CONFIDENCE_LABELS);
    for (const score of [1, 0.95, 0.9, 0.89, 0.8, 0.75, 0.74, 0.3, 0]) {
      assert.equal(labels.confidenceLabel(score), coreLabels.confidenceLabel(score), String(score));
      assert.equal(labels.confidenceLabel(score, { barcode: true }), coreLabels.confidenceLabel(score, { barcode: true }));
      for (const stage of [null, undefined, 'barcode', 'dictionary', 'vector', 'rerank'] as const) {
        assert.equal(labels.labelKey(score, stage), coreLabels.labelKey(score, stage), `${score} ${stage}`);
      }
    }
    assert.equal(labels.labelKey(null, 'vector'), coreLabels.labelKey(null, 'vector'));
  });
});

describe('small copies', () => {
  it('the activity day input', () => {
    for (const day of ['2026-10-23', '', '23.10.2026', 'x']) assert.equal(dayInputValue(day), domainDayInput(day));
  });

  it('the sitemap origin', () => {
    for (const env of [{}, { APP_URL: 'https://tasnivo.uz/' }, { NEXT_PUBLIC_SITE_URL: ' http://localhost:3000 ' }, { APP_URL: 'tasnivo.uz' }]) {
      assert.equal(appOrigin(env), domainOrigin(env), JSON.stringify(env));
    }
  });

  it('the page security headers', () => {
    for (const dev of [true, false]) assert.equal(contentSecurityPolicy(dev), domainCsp(dev));
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'development' }]) assert.deepEqual(securityHeaders(env), domainHeaders(env));
  });

  it('the system decision actions', () => {
    assert.deepEqual([...SYSTEM_DECISION_ACTIONS], [...DOMAIN_SYSTEM]);
  });
});
