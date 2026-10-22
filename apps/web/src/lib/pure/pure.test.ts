// The web-local copies in this folder must behave like their @tasnivo/domain and @tasnivo/core
// originals: a change on one side fails here until both agree.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canWrite as domainCanWrite, isAdminRole as domainIsAdmin } from '@tasnivo/domain/access';
import type { ActivityRow } from '@tasnivo/domain/activity';
import { DECISION_EVENTS as DOMAIN_DECISION_EVENTS, GROUP_WINDOW_MS as DOMAIN_WINDOW, groupDecisions as domainGroup } from '@tasnivo/domain/activity-groups';
import * as domainKpi from '@tasnivo/domain/client-kpi';
import { USE_CASES } from '@tasnivo/domain/demo-access-fields';
import { withQuery as domainWithQuery } from '@tasnivo/domain/query-string';
import { agoText as domainAgo, daysSince as domainDays } from '@tasnivo/domain/relative-day';
import * as domainReminders from '@tasnivo/domain/reminder-dates';
import { MIN_TEXT } from '@tasnivo/domain/search-query';
import type { LabelKey as CoreLabelKey } from '@tasnivo/core/match/confidence-labels';
import { taUz } from '@tasnivo/i18n/i18n-app';
import { canWrite, isAdminRole } from './access';
import { DECISION_EVENTS, GROUP_WINDOW_MS, groupDecisions } from './activity-groups';
import * as kpi from './client-kpi';
import { DEMO_USE_CASES, LABEL_KEYS, MIN_SEARCH_TEXT, type LabelKey } from './constants';
import { withQuery } from './query-string';
import { agoText, daysSince } from './relative-day';
import * as reminders from './reminder-dates';

// The local label union is exactly core's (checked by the compiler, both ways).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameLabels: Same<LabelKey, CoreLabelKey> = true;

describe('web-local pure helpers equal their originals', () => {
  it('constants', () => {
    assert.ok(sameLabels);
    assert.equal(MIN_SEARCH_TEXT, MIN_TEXT);
    assert.deepEqual(DEMO_USE_CASES, USE_CASES);
    assert.deepEqual([...LABEL_KEYS].sort(), ['barcode', 'check', 'dictionary', 'likely', 'sure']);
    assert.deepEqual(DECISION_EVENTS, DOMAIN_DECISION_EVENTS);
    assert.equal(GROUP_WINDOW_MS, DOMAIN_WINDOW);
  });

  it('access', () => {
    for (const role of ['admin', 'accountant', 'viewer'] as const) {
      assert.equal(canWrite({ role }), domainCanWrite({ role }), role);
      assert.equal(isAdminRole({ role }), domainIsAdmin({ role }), role);
    }
  });

  it('withQuery', () => {
    const cases: [string, Record<string, string | string[] | undefined>, Record<string, string | null>][] = [
      ['/clients', { filter: 'stale', q: 'sut', page: '2' }, { page: null }],
      ['/clients', { filter: undefined, sort: ['name', 'open'] }, { filter: 'archived' }],
      ['/clients', {}, {}],
    ];
    for (const [path, current, change] of cases) assert.equal(withQuery(path, current, change), domainWithQuery(path, current, change));
  });

  it('relative days', () => {
    const now = new Date('2026-10-23T03:00:00Z');
    for (const ago of [0, 1, 5, 59, 60, 400]) {
      const then = new Date(now.getTime() - ago * 86_400_000);
      assert.equal(daysSince(then, now), domainDays(then, now));
      assert.equal(daysSince(then.toISOString(), now), domainDays(then, now), 'an ISO string reads like the date');
      assert.equal(agoText(taUz.firmX.ago, ago), domainAgo(taUz.firmX.ago, ago));
    }
  });

  it('reminder dates', () => {
    for (const now of [new Date('2026-10-23T03:00:00Z'), new Date('2026-12-31T20:00:00Z')]) {
      for (const dayOfMonth of [1, 15, 28]) {
        for (const lastPeriod of [null, '2026-10', '2026-12']) {
          const s = { dayOfMonth, enabled: true, lastPeriod };
          assert.deepEqual(reminders.nextReminderDate(s, now), domainReminders.nextReminderDate(s, now));
          assert.equal(reminders.skipsThisMonth(s, lastPeriod, now), domainReminders.skipsThisMonth(s, lastPeriod, now));
        }
      }
      assert.equal(reminders.nextReminderDate({ dayOfMonth: 5, enabled: false, lastPeriod: null }, now), null);
    }
  });

  it('client KPIs', () => {
    const w = taUz.firmX.progress;
    for (const [risky, open, pending] of [[0, 0, 0], [10, 3, 3], [10, 3, 7], [3, 0, 0]] as const) {
      assert.deepEqual(kpi.rowProgress({ riskyRows: risky, openRows: open }), domainKpi.rowProgress({ riskyRows: risky, openRows: open }));
      assert.equal(kpi.openRowsHint('uz', w, open, pending), domainKpi.openRowsHint('uz', w, open, pending));
    }
    assert.equal(kpi.reviewedShare('ru', w, { done: 2, total: 3 }), domainKpi.reviewedShare('ru', w, { done: 2, total: 3 }));
  });

  it('decision groups', () => {
    const at = (min: number) => new Date(Date.UTC(2026, 9, 23, 10, min));
    const row = (action: string, min: number, extra: Partial<ActivityRow> = {}) =>
      ({ id: `${action}-${min}`, action, actorId: 'u1', catalogId: 'c1', at: at(min), count: null, ...extra }) as unknown as ActivityRow;
    const rows = [row('finding.accepted', 50), row('finding.rejected', 45, { count: 3 }), row('catalog.uploaded', 40), row('finding.accepted', 5), row('finding.accepted', 1, { actorId: 'u2' })];
    assert.deepEqual(groupDecisions(rows), domainGroup(rows));
  });
});
