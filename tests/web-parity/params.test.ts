// URL readers and fixed values the web app keeps as copies (it may not import @tasnivo/domain): each
// must answer what its domain original answers.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WARN_AT as DOMAIN_WARN_AT } from '@tasnivo/domain/billing/limits';
import * as domainDictionary from '@tasnivo/domain/dictionary-review';
import { withQuery as domainWithQuery } from '@tasnivo/domain/query-string';
import * as domainQueue from '@tasnivo/domain/queue';
import { MIN_PASSWORD } from '@tasnivo/domain/security/password-check';
import { DICT_FILTERS, parseDictFilter } from '@/app/(app)/dictionary/dictionary-params';
import { QUEUE_DUE, readQueueFilter, workspaceHref, withQuery } from '@/app/(app)/queue/queue-params';
import { WARN_AT } from '@/app/(app)/settings/plan-meter';
import { MIN_PASSWORD_LENGTH } from '@/app/sign-in/credentials-check';

describe('dictionary URL', () => {
  it('reads the filter as the domain does', () => {
    assert.deepEqual([...DICT_FILTERS], [...domainDictionary.DICT_FILTERS]);
    for (const f of [undefined, '', 'all', 'confirmed', 'unverified', 'reconfirm', 'stale', 'STALE', 'x']) assert.equal(parseDictFilter(f), domainDictionary.parseDictFilter(f));
  });
});

describe('queue URL', () => {
  it('reads filters as the domain does', () => {
    assert.deepEqual([...QUEUE_DUE], [...domainQueue.QUEUE_DUE]);
    const samples = [
      {}, { client: 'c1', type: 'MISMATCH', severity: 'high', flag: 'ask_client', accountant: 'u1', due: 'week' },
      { client: '', type: 'x', severity: 'low', flag: 'resolved', accountant: '', due: 'year' }, { type: 'RESTRICTED', severity: 'medium', due: 'overdue' },
    ];
    for (const p of samples) assert.deepEqual(readQueueFilter(p), domainQueue.readQueueFilter(p));
  });

  it('links rows and keeps filters as the domain does', () => {
    const row = { catalogId: 'cat', rawName: `Sut 1 l & "${'x'.repeat(120)}"`, findingId: 'f1' };
    assert.equal(workspaceHref(row), domainQueue.workspaceHref(row));
    const current = { client: 'c1', type: 'MISMATCH', after: undefined, due: ['week', 'month'] };
    assert.equal(withQuery('/queue', current), domainWithQuery('/queue', current));
    assert.equal(withQuery('/queue', current, { client: null, after: 'z' }), domainWithQuery('/queue', current, { client: null, after: 'z' }));
  });
});

describe('fixed values', () => {
  it('a usage meter warns at the domain threshold', () => {
    assert.equal(WARN_AT, DOMAIN_WARN_AT);
  });

  it('sign-up asks for the server minimum password length', () => {
    assert.equal(MIN_PASSWORD_LENGTH, MIN_PASSWORD);
  });
});
