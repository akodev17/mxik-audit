// Expiry reminders (plan D9): at 7, 3 and 1 days before the trial or the paid period ends and on the
// day, one in-app notice per org and threshold and one e-mail per admin; demo, internal and closed
// orgs and orgs already paid past the date get none, and running the job again sends nothing twice.
// `now` is in 2031 so that no other org of the shared development database falls in the window.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { OrgKind } from '@prisma/client';
import { db } from '@tasnivo/db';
import { fmtDate } from '@tasnivo/i18n/format';
import { setJobs, type JobDispatcher } from '../jobs/dispatcher';
import type { MailJobData } from '../jobs/queues';
import { dbSkipReason, dropOrgs, makeOrg } from '../test-fixtures';
import { accessEnd, daysUntil, owedThreshold, sendExpiryReminders } from './expiry-reminders';

const skip = await dbSkipReason();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 09:00 in Tashkent on 10 March 2031. */
const NOW = new Date('2031-03-10T04:00:00Z');
const at = (days: number, hourUtc = 7): Date => new Date(Date.UTC(2031, 2, 10 + days, hourUtc));

describe('expiry reminder dates', () => {
  it('counts Tashkent calendar days, 0 on the last day', () => {
    assert.equal(daysUntil(at(7), NOW), 7);
    assert.equal(daysUntil(new Date('2031-03-10T18:59:00Z'), NOW), 0);
    // 00:30 in Tashkent on 11 March is already the next day.
    assert.equal(daysUntil(new Date('2031-03-10T19:30:00Z'), NOW), 1);
    assert.equal(daysUntil(new Date('2031-03-09T20:00:00Z'), NOW), 0);
  });

  it('a run owes today\'s threshold, or the last one passed on a day in between', () => {
    assert.deepEqual([8, 7, 6, 4, 3, 2, 1, 0, -1].map(owedThreshold), [null, 7, 7, 7, 3, 3, 1, 0, null]);
  });

  it('the later of the trial and the paid period closes access', () => {
    assert.deepEqual(accessEnd({ trialEndsAt: at(3), subscriptionUntil: null }), { kind: 'trial', end: at(3) });
    assert.deepEqual(accessEnd({ trialEndsAt: at(3), subscriptionUntil: at(40) }), { kind: 'subscription', end: at(40) });
    assert.deepEqual(accessEnd({ trialEndsAt: at(20), subscriptionUntil: at(3) }), { kind: 'trial', end: at(20) });
    assert.equal(accessEnd({ trialEndsAt: null, subscriptionUntil: null }), null);
  });
});

describe('expiry reminders (database)', { skip }, () => {
  const orgs: string[] = [];
  const mails: MailJobData[] = [];
  const fake = {
    mode: 'inline',
    enqueueMail: (mail: MailJobData) => {
      mails.push(mail);
      return Promise.resolve();
    },
    enqueueAudit: () => Promise.resolve(),
    enqueueDocCheck: () => Promise.resolve(),
    enqueueTelegram: () => Promise.reject(new Error('expiry reminders must not go to Telegram')),
    enqueueClassifierUpdate: () => Promise.resolve(),
    enqueueDaily: () => Promise.resolve(false),
  } satisfies JobDispatcher;

  /** An org with its first admin's address made deliverable (the fixtures' .local is a reserved one). */
  const org = async (dates: { trialEndsAt?: Date; subscriptionUntil?: Date }, kind: OrgKind = 'customer', extra: { deletedAt?: Date; locale?: string } = {}) => {
    const o = await makeOrg(kind);
    orgs.push(o.orgId);
    const email = `expiry-${randomBytes(5).toString('hex')}@example.com`;
    await db.organization.update({ where: { id: o.orgId }, data: { trialEndsAt: dates.trialEndsAt ?? null, subscriptionUntil: dates.subscriptionUntil ?? null, deletedAt: extra.deletedAt ?? null } });
    await db.user.update({ where: { id: o.userId }, data: { email, locale: extra.locale ?? null } });
    return { ...o, email };
  };
  const notices = (orgId: string) => db.notification.findMany({ where: { orgId, kind: 'billing.expiring' }, orderBy: { createdAt: 'asc' } });
  const mailsTo = (email: string) => mails.filter((m) => m.to === email);

  let week: Awaited<ReturnType<typeof org>>;
  let three: Awaited<ReturnType<typeof org>>;
  let tomorrow: Awaited<ReturnType<typeof org>>;
  let today: Awaited<ReturnType<typeof org>>;
  let fresh: Awaited<ReturnType<typeof org>>;
  const silent: Awaited<ReturnType<typeof org>>[] = [];

  before(async () => {
    setJobs(fake);
    week = await org({ trialEndsAt: at(7) }, 'customer', { locale: 'ru' });
    three = await org({ trialEndsAt: at(3) });
    tomorrow = await org({ subscriptionUntil: at(1), trialEndsAt: at(-30) });
    today = await org({ subscriptionUntil: new Date('2031-03-10T15:00:00Z') });
    fresh = await org({ trialEndsAt: at(5) });
    silent.push(
      await org({ trialEndsAt: at(3), subscriptionUntil: at(40) }), // paid beyond the trial
      await org({ trialEndsAt: at(20), subscriptionUntil: at(3) }), // the trial runs longer than the payment
      await org({ trialEndsAt: at(3) }, 'demo'),
      await org({ trialEndsAt: at(3) }, 'internal'),
      await org({ trialEndsAt: at(3) }, 'customer', { deletedAt: NOW }), // closed, waiting for deletion
    );
    // A second admin with a Telegram placeholder address and an accountant: neither is mailed.
    await db.user.create({ data: { orgId: three.orgId, email: `tg-${randomBytes(4).toString('hex')}@telegram.invalid`, passwordHash: 'x', role: 'admin' } });
    await db.user.create({ data: { orgId: three.orgId, email: `acc-${randomBytes(4).toString('hex')}@example.com`, passwordHash: 'x', role: 'accountant' } });
  });
  after(async () => {
    setJobs(null);
    await dropOrgs(orgs);
  });

  it('one notice per due org and one e-mail per admin; nothing for the others', async () => {
    await sendExpiryReminders(NOW);
    for (const [o, days] of [[week, 7], [three, 3], [tomorrow, 1], [today, 0]] as const) {
      const rows = await notices(o.orgId);
      assert.equal(rows.length, 1, `${days} days`);
      assert.equal(rows[0]!.href, '/settings?tab=plan');
      assert.equal(rows[0]!.userId, null);
      assert.equal(rows[0]!.telegramSentAt, null);
      assert.match(rows[0]!.dedupeKey ?? '', new RegExp(`^billing\\.expiring:(trial|subscription):2031-03-\\d\\d:${days}$`));
      assert.equal(mailsTo(o.email).length, 1, `${days} days mail`);
    }
    assert.equal(mails.filter((m) => m.to.endsWith('@telegram.invalid') || m.to.startsWith('acc-')).length, 0);
    for (const o of silent) {
      assert.equal((await notices(o.orgId)).length, 0, o.orgId);
      assert.equal(mailsTo(o.email).length, 0, o.email);
    }
    // 5 days left and the 7-day reminder never sent: it goes out now, worded with the days actually left.
    const caught = await notices(fresh.orgId);
    assert.deepEqual(caught.map((n) => n.dedupeKey), ['billing.expiring:trial:2031-03-15:7']);
    assert.equal(caught[0]!.title, 'Sinov muddati 5 kundan keyin tugaydi');
    assert.equal(mailsTo(fresh.email).length, 1);

    // The words: the trial or the subscription, the days, the end date and the plan link, in each reader's language.
    const [ruMail] = mailsTo(week.email);
    assert.equal(ruMail!.subject, 'Tasnivo: Пробный период закончится через 7 дней');
    assert.match(ruMail!.text, /settings\?tab=plan/);
    assert.equal(mailsTo(three.email)[0]!.subject, 'Tasnivo: Sinov muddati 3 kundan keyin tugaydi');
    assert.equal(mailsTo(tomorrow.email)[0]!.subject, 'Tasnivo: Obuna ertaga tugaydi');
    assert.equal(mailsTo(today.email)[0]!.subject, 'Tasnivo: Obuna bugun tugaydi');
    const text = (await notices(three.orgId))[0]!.text as Record<string, { title: string; body: string }>;
    assert.equal(text['uz']!.title, 'Sinov muddati 3 kundan keyin tugaydi');
    assert.equal(text['ru']!.title, 'Пробный период закончится через 3 дня');
    assert.ok(text['uz']!.body.includes(`(${fmtDate('uz', at(3))})`), text['uz']!.body);
    assert.ok(text['ru']!.body.includes(`(${fmtDate('ru', at(3))})`), text['ru']!.body);
  });

  it('running again the same day, or later that day, sends nothing twice', async () => {
    const before = mails.length;
    await sendExpiryReminders(NOW);
    await sendExpiryReminders(new Date(NOW.getTime() + 6 * HOUR));
    assert.equal(mails.length, before);
    for (const o of [week, three, tomorrow, today, fresh]) assert.equal((await notices(o.orgId)).length, 1);
  });

  it('the next threshold sends again; days in between and the day after the end send nothing', async () => {
    const run = async (days: number) => {
      const start = mails.length;
      await sendExpiryReminders(new Date(NOW.getTime() + days * DAY));
      return mails.slice(start);
    };
    assert.deepEqual((await run(1)).filter((m) => [week.email, three.email].includes(m.to)), []);
    // 12 March: the trial of `three` has 1 day left.
    assert.deepEqual((await run(2)).map((m) => m.to).filter((to) => to === three.email), [three.email]);
    // 14 March: `week` has 3 days left; `three` ended yesterday.
    const day4 = await run(4);
    assert.deepEqual(day4.map((m) => m.to).filter((to) => [week.email, three.email].includes(to)), [week.email]);
    assert.equal((await notices(week.orgId)).length, 2);
    assert.equal((await notices(three.orgId)).length, 2);
  });

  it('a renewal moves the end date, so its reminders start afresh', async () => {
    await db.organization.update({ where: { id: today.orgId }, data: { subscriptionUntil: new Date('2031-03-17T15:00:00Z') } });
    await sendExpiryReminders(NOW);
    const rows = await notices(today.orgId);
    assert.equal(rows.length, 2);
    assert.match(rows[1]!.dedupeKey ?? '', /^billing\.expiring:subscription:2031-03-17:7$/);
  });

  describe('a day the job missed', () => {
    /** 09:00 in Tashkent on 10 June 2031, far from the March orgs above; every org here ends on 17 June. */
    const JUNE = new Date('2031-06-10T04:00:00Z');
    const END = new Date('2031-06-17T07:00:00Z');
    const onDay = (day: number, hours = 0): Date => new Date(JUNE.getTime() + day * DAY + hours * HOUR);
    const keys = async (orgId: string) => (await notices(orgId)).map((n) => n.dedupeKey);

    it('the 3-day reminder skipped on its day goes out once on day 2, worded "2 days"; again that day, nothing', async () => {
      const late = await org({ subscriptionUntil: END });
      await sendExpiryReminders(onDay(0)); // 7 days left
      // 14 June (3 days left): the job did not run. 15 June: 2 days left.
      await sendExpiryReminders(onDay(5));
      assert.deepEqual(await keys(late.orgId), ['billing.expiring:subscription:2031-06-17:7', 'billing.expiring:subscription:2031-06-17:3']);
      const caught = (await notices(late.orgId))[1]!;
      assert.equal(caught.title, 'Obuna 2 kundan keyin tugaydi');
      assert.deepEqual(mailsTo(late.email).map((m) => m.subject), ['Tasnivo: Obuna 7 kundan keyin tugaydi', 'Tasnivo: Obuna 2 kundan keyin tugaydi']);

      await sendExpiryReminders(onDay(5));
      await sendExpiryReminders(onDay(5, 8));
      assert.equal((await notices(late.orgId)).length, 2);
      assert.equal(mailsTo(late.email).length, 2);
      // The next real threshold still goes out on its day.
      await sendExpiryReminders(onDay(6));
      assert.equal((await keys(late.orgId)).at(-1), 'billing.expiring:subscription:2031-06-17:1');
    });

    it('with two thresholds missed, only the one nearer the end is sent, once per run', async () => {
      const both = await org({ trialEndsAt: END });
      // First run on 15 June: neither the 7-day nor the 3-day reminder went out.
      const run = await sendExpiryReminders(onDay(5));
      assert.ok(run.notified >= 1);
      assert.deepEqual(await keys(both.orgId), ['billing.expiring:trial:2031-06-17:3']);
      assert.equal(mailsTo(both.email).length, 1);
    });

    it('an org that renewed meanwhile gets nothing for its old period', async () => {
      const renewed = await org({ subscriptionUntil: END });
      await sendExpiryReminders(onDay(0));
      assert.deepEqual(await keys(renewed.orgId), ['billing.expiring:subscription:2031-06-17:7']);
      // Paid for another month before the missed day was caught up.
      await db.organization.update({ where: { id: renewed.orgId }, data: { subscriptionUntil: new Date('2031-07-17T07:00:00Z') } });
      await sendExpiryReminders(onDay(5));
      await sendExpiryReminders(onDay(6));
      await sendExpiryReminders(onDay(7));
      assert.deepEqual(await keys(renewed.orgId), ['billing.expiring:subscription:2031-06-17:7']);
      assert.equal(mailsTo(renewed.email).length, 1);
    });
  });
});
