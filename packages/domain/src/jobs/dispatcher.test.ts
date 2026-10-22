import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { addUnique, BullDispatcher, redisQueues, type JobLike, type QueueLike } from './bullmq.js';
import { dispatcherFromEnv, jobs, jobsMode, setJobs, type JobDispatcher } from './dispatcher.js';
import { InlineDispatcher } from './inline.js';
import { JOB_DEFAULTS, localDay, QUEUES, type QueueName } from './queues.js';

describe('JOBS_MODE', () => {
  it('is inline unless bullmq is asked for', () => {
    assert.equal(jobsMode({}), 'inline');
    assert.equal(jobsMode({ JOBS_MODE: '' }), 'inline');
    assert.equal(jobsMode({ JOBS_MODE: 'inline' }), 'inline');
    assert.equal(jobsMode({ JOBS_MODE: ' BullMQ ' }), 'bullmq');
  });

  it('refuses a mode it does not know, instead of silently running inline', () => {
    assert.throws(() => jobsMode({ JOBS_MODE: 'redis' }), /Unknown JOBS_MODE "redis"/);
  });

  it('builds the inline dispatcher by default and the BullMQ one with a Redis URL', () => {
    assert.ok(dispatcherFromEnv({}) instanceof InlineDispatcher);
    // Nothing connects until the first job is added.
    const bull = dispatcherFromEnv({ JOBS_MODE: 'bullmq', REDIS_URL: 'redis://127.0.0.1:1' });
    assert.ok(bull instanceof BullDispatcher);
    assert.equal(bull.mode, 'bullmq');
  });

  it('needs REDIS_URL for bullmq', () => {
    assert.throws(() => dispatcherFromEnv({ JOBS_MODE: 'bullmq' }), /REDIS_URL/);
  });

  it('keeps one dispatcher per process, replaceable for the worker and tests', () => {
    const fake = { mode: 'inline' } as unknown as JobDispatcher;
    setJobs(fake);
    assert.equal(jobs(), fake);
    setJobs(null);
    assert.notEqual(jobs(), fake);
    assert.equal(jobs(), jobs());
  });
});

/** An in-memory queue: jobs by id with a settable state, as much of BullMQ's as addUnique reads. */
class FakeQueue implements QueueLike {
  added: { name: string; data: unknown; jobId: string | undefined }[] = [];
  states = new Map<string, string>();
  removed: string[] = [];
  add(name: string, data: unknown, opts?: { jobId?: string }): Promise<unknown> {
    this.added.push({ name, data, jobId: opts?.jobId });
    if (opts?.jobId) this.states.set(opts.jobId, 'waiting');
    return Promise.resolve({});
  }
  getJob(jobId: string): Promise<JobLike | undefined> {
    const state = this.states.get(jobId);
    if (!state) return Promise.resolve(undefined);
    return Promise.resolve({
      getState: () => Promise.resolve(state),
      remove: () => {
        this.removed.push(jobId);
        this.states.delete(jobId);
        return Promise.resolve();
      },
    });
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

function fakeDispatcher(): { dispatcher: BullDispatcher; queues: Map<QueueName, FakeQueue> } {
  const queues = new Map<QueueName, FakeQueue>();
  const dispatcher = new BullDispatcher({
    queue: (name) => {
      const q = queues.get(name) ?? new FakeQueue();
      queues.set(name, q);
      return q;
    },
  });
  return { dispatcher, queues };
}

describe('BullDispatcher', () => {
  it('queues an audit under the catalogue id, with who started it and from which row', async () => {
    const { dispatcher, queues } = fakeDispatcher();
    await dispatcher.enqueueAudit('cat1', { orgId: 'o', userId: 'u' }, { via: 'api' }, 0);
    assert.deepEqual(queues.get(QUEUES.audit)?.added, [
      { name: 'audit', data: { catalogId: 'cat1', actor: { orgId: 'o', userId: 'u' }, extra: { via: 'api' }, fromRow: 0 }, jobId: 'cat1' },
    ]);
  });

  it('never queues a catalogue twice while its job is waiting or running', async () => {
    const { dispatcher, queues } = fakeDispatcher();
    await dispatcher.enqueueAudit('cat1', null);
    queues.get(QUEUES.audit)?.states.set('cat1', 'active');
    await dispatcher.enqueueAudit('cat1', null, { resumed: true }, 40);
    assert.equal(queues.get(QUEUES.audit)?.added.length, 1);
  });

  it('replaces a finished job of the same catalogue, so it can be audited again', async () => {
    const { dispatcher, queues } = fakeDispatcher();
    await dispatcher.enqueueAudit('cat1', null);
    const audit = queues.get(QUEUES.audit);
    audit?.states.set('cat1', 'failed');
    await dispatcher.enqueueAudit('cat1', null, { retried: true });
    assert.deepEqual(audit?.removed, ['cat1']);
    assert.equal(audit?.added.length, 2);
  });

  it('queues a doc check under the list id', async () => {
    const { dispatcher, queues } = fakeDispatcher();
    await dispatcher.enqueueDocCheck('list1');
    await dispatcher.enqueueDocCheck('list1');
    assert.deepEqual(queues.get(QUEUES.docCheck)?.added, [{ name: 'doc-check', data: { listId: 'list1' }, jobId: 'list1' }]);
  });

  it('queues mail, Telegram messages and classifier updates without ids, every time', async () => {
    const { dispatcher, queues } = fakeDispatcher();
    const mail = { to: 'a@b.uz', subject: 's', text: 't' };
    await dispatcher.enqueueMail(mail);
    await dispatcher.enqueueMail(mail);
    await dispatcher.enqueueTelegram({ kind: 'notification', notificationId: 'n1' });
    await dispatcher.enqueueTelegram({ kind: 'audit-summary', catalogId: 'c1' });
    await dispatcher.enqueueClassifierUpdate();
    assert.equal(queues.get(QUEUES.mail)?.added.length, 2);
    assert.deepEqual(queues.get(QUEUES.telegram)?.added.map((a) => a.name), ['notification', 'audit-summary']);
    assert.deepEqual(queues.get(QUEUES.classifierUpdate)?.added, [{ name: 'classifier-update', data: { reason: 'manual' }, jobId: undefined }]);
  });

  it('addUnique reports whether it added', async () => {
    const q = new FakeQueue();
    assert.equal(await addUnique(q, 'audit', {}, 'x'), true);
    assert.equal(await addUnique(q, 'audit', {}, 'x'), false);
    q.states.set('x', 'completed');
    assert.equal(await addUnique(q, 'audit', {}, 'x'), true);
  });
});

describe('queue settings', () => {
  it('scheduled job ids name the local (UTC+5) day', () => {
    assert.equal(localDay(new Date('2026-10-22T18:59:00Z')), '2026-10-22');
    assert.equal(localDay(new Date('2026-10-22T19:00:00Z')), '2026-10-23');
  });

  it('every queue has a retry policy', () => {
    for (const name of Object.values(QUEUES)) assert.ok(JOB_DEFAULTS[name].attempts >= 1, name);
  });
});

// A real Redis, when one answers: TEST_REDIS_URL, else REDIS_URL, else localhost. Skipped otherwise.
const REDIS = process.env['TEST_REDIS_URL'] ?? process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
async function redisSkipReason(): Promise<string | false> {
  const probe = new Redis(REDIS, { lazyConnect: true, connectTimeout: 500, maxRetriesPerRequest: 0, retryStrategy: () => null });
  probe.on('error', () => undefined);
  try {
    await probe.connect();
    await probe.ping();
    return false;
  } catch {
    return `no Redis at ${REDIS}`;
  } finally {
    probe.disconnect();
  }
}
const noRedis = await redisSkipReason();

describe('BullDispatcher on a real Redis', { skip: noRedis }, () => {
  // A key prefix of its own, so the test never touches a running worker's queues.
  const prefix = `tasnivo-test-${process.pid}-${Date.now()}`;
  const source = redisQueues(REDIS, { prefix });
  const dispatcher = new BullDispatcher(source);
  let admin: Redis;

  before(() => {
    admin = new Redis(REDIS);
  });
  after(async () => {
    const keys = await admin.keys(`${prefix}:*`);
    if (keys.length > 0) await admin.del(...keys);
    await dispatcher.close();
    admin.disconnect();
  });

  it('adds one waiting audit job per catalogue, with the queue retry policy', async () => {
    await dispatcher.enqueueAudit('catR', { orgId: 'o', userId: 'u' }, {}, 0);
    await dispatcher.enqueueAudit('catR', null, { resumed: true }, 5);
    const queue = (await source.queue(QUEUES.audit)) as unknown as Queue;
    assert.equal(await queue.getWaitingCount(), 1);
    const job = await queue.getJob('catR');
    assert.deepEqual(job?.data, { catalogId: 'catR', actor: { orgId: 'o', userId: 'u' }, extra: {}, fromRow: 0 });
    assert.equal(job?.opts.attempts, JOB_DEFAULTS.audit.attempts);
  });

  it('queues mail with its retry policy', async () => {
    await dispatcher.enqueueMail({ to: 'a@b.uz', subject: 's', text: 't' });
    const queue = (await source.queue(QUEUES.mail)) as unknown as Queue;
    const [job] = await queue.getWaiting();
    assert.deepEqual(job?.data, { to: 'a@b.uz', subject: 's', text: 't' });
    assert.equal(job?.opts.attempts, JOB_DEFAULTS.mail.attempts);
  });
});
