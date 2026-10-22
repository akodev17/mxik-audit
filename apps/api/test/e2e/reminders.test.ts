// The reminders module through the real app: a client's schedule (read, save, the actions' form
// messages), open tasks and finishing one; refusals for a viewer, a demo org, another org and a
// member scoped to other clients.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { makeClient } from '@tasnivo/domain/firm-test-fixtures';
import { finishReminderTask, saveClientSchedule } from '@tasnivo/domain/reminder-ops';
import { localDate } from '@tasnivo/domain/reminders';
import { dbSkipReason, dropOrgs } from '@tasnivo/domain/test-fixtures';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, serverOf, startApp } from '../helpers';
import { as, member, orgWithAdmin, shaped, type Member } from './workspace-fixtures';

const skip = await dbSkipReason();
const r = endpoints.reminders;
const words = i18nFor('uz').ta.firmX;

describe('reminders module (e2e)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let admin: Member;
  let viewer: Member;
  let scoped: Member;
  let stranger: Member;
  let demo: Member;
  let clientId: string;
  let otherClientId: string;
  const http = () => request(serverOf(app));
  const get = (path: string, who: Member) => as(http().get(path), who, false);
  const save = (who: Member, body: object, id = clientId) => as(http().put(`/api/clients/${id}/reminder`), who).send(body);

  before(async () => {
    app = await startApp();
    admin = await orgWithAdmin(orgs);
    clientId = await makeClient(admin.orgId, 'Mijoz A');
    otherClientId = await makeClient(admin.orgId, 'Mijoz B');
    viewer = await member(admin.orgId, 'viewer');
    scoped = await member(admin.orgId, 'accountant', [otherClientId]);
    stranger = await orgWithAdmin(orgs);
    demo = await orgWithAdmin(orgs, 'demo');
  });

  after(async () => {
    await app?.close();
    await dropOrgs(orgs);
  });

  it('schedule: null before one is set; 404 for a client out of reach', async () => {
    const none = await get(`/api/clients/${clientId}/reminder`, viewer);
    assert.equal(none.status, 200);
    assert.equal(none.body, null);
    assert.equal((await get(`/api/clients/${clientId}/reminder`, stranger)).status, 404);
    assert.equal((await get(`/api/clients/${clientId}/reminder`, scoped)).status, 404);
  });

  it('save: the actions\' messages for a bad day and a client out of reach; then the schedule reads back', async () => {
    assert.deepEqual((await save(admin, { dayOfMonth: 29, assigneeId: null, enabled: true })).body, { ok: false, error: words.reminders.badDay });
    assert.deepEqual((await save(admin, { dayOfMonth: 2.5, assigneeId: null, enabled: true })).body, { ok: false, error: words.reminders.badDay });
    assert.deepEqual((await save(scoped, { dayOfMonth: 5, assigneeId: null, enabled: true })).body, { ok: false, error: words.errors['not found'] });
    assert.deepEqual((await save(admin, { dayOfMonth: 5, assigneeId: scoped.userId, enabled: true })).body, { ok: false, error: words.reminders.assigneeScope });

    const ok = shaped(r.saveSchedule, (await save(admin, { dayOfMonth: 5, assigneeId: null, enabled: true })).body) as { ok: true; nextDue: string | null };
    assert.equal(ok.ok, true);
    assert.match(ok.nextDue ?? '', /^\d{4}-\d{2}-\d{2}T/);
    const back = shaped(r.schedule, (await get(`/api/clients/${clientId}/reminder`, viewer)).body) as { dayOfMonth: number; clientId: string; enabled: boolean };
    assert.deepEqual([back.clientId, back.dayOfMonth, back.enabled], [clientId, 5, true]);
    assert.ok(!('orgId' in (back as object)), 'only the contract\'s fields');
  });

  it('save is refused for a viewer and a demo org (403), as the action refused them', async () => {
    assert.equal((await save(viewer, { dayOfMonth: 5, assigneeId: null, enabled: true })).status, 403);
    const demoClient = await makeClient(demo.orgId, 'Demo mijoz');
    const refused = await save(demo, { dayOfMonth: 5, assigneeId: null, enabled: true }, demoClient);
    assert.equal(refused.status, 403);
    assert.equal(bodyOf(refused).error.code, 'demo');
    // The domain refuses a demo org on its own too, with the action's message (whatever the guard in front does).
    const demoUser = { userId: demo.userId, orgId: demo.orgId, role: demo.role, clientIds: null };
    assert.deepEqual(await saveClientSchedule(demoUser, demoClient, { dayOfMonth: 5, assigneeId: null, enabled: true }, 'uz'), { ok: false, error: words.errors.forbidden });
    assert.deepEqual(await finishReminderTask(demoUser, 'any-task', 'uz'), { ok: false, error: words.errors.forbidden });
  });

  it('tasks: open checks of visible clients; finishing one, then again', async () => {
    const { period, date } = localDate(new Date());
    const task = await db.reminderTask.create({ data: { orgId: admin.orgId, clientId, period, dueOn: date } });
    const hidden = await db.reminderTask.create({ data: { orgId: admin.orgId, clientId: otherClientId, period, dueOn: date } });
    const all = shaped(r.tasks, (await get('/api/reminders/tasks', viewer)).body) as { id: string; clientName: string }[];
    assert.deepEqual(all.map((t) => t.id).sort(), [task.id, hidden.id].sort());
    const mine = shaped(r.tasks, (await get('/api/reminders/tasks', scoped)).body) as { id: string }[];
    assert.deepEqual(mine.map((t) => t.id), [hidden.id]);
    assert.deepEqual((await get('/api/reminders/tasks', stranger)).body, []);

    const finish = (who: Member, id: string) => as(http().post(`/api/reminders/tasks/${id}/done`), who).send();
    assert.equal((await finish(viewer, task.id)).status, 403);
    assert.deepEqual((await finish(scoped, task.id)).body, { ok: false, error: words.errors['not found'] });
    assert.deepEqual((await finish(admin, task.id)).body, { ok: true });
    assert.deepEqual((await finish(admin, task.id)).body, { ok: false, error: words.reminders.alreadyDone });
    assert.ok((await db.reminderTask.findUniqueOrThrow({ where: { id: task.id } })).doneAt);
  });
});
