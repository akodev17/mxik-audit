// A representative request and answer per module: valid samples parse back to themselves,
// and the cases the old actions refused are refused.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ZodTypeAny } from 'zod';
import { checkResultOut } from '@tasnivo/domain/api/check';
import { catalogOut, findingOut, reportOut, uploadOut } from '@tasnivo/domain/api/serialize';
import { endpoints as E } from './registry';

const AT = '2026-10-22T08:30:00.000Z';

function roundTrip(schema: ZodTypeAny | undefined, value: unknown, label: string): void {
  assert.ok(schema, label);
  const parsed = schema.safeParse(value);
  assert.ok(parsed.success, `${label}: ${parsed.success ? '' : parsed.error.message}`);
  assert.deepEqual(parsed.data, value, label);
}

const refused = (schema: ZodTypeAny | undefined, value: unknown, label: string): void => {
  assert.ok(schema, label);
  assert.equal(schema.safeParse(value).success, false, label);
};

const skipped = { archived: 0, conflict: 1, noCode: 0, confirmOnly: 2 };

describe('round trips', () => {
  it('auth', () => {
    roundTrip(E.auth.signIn.body, { email: 'a@b.uz', password: 'x', next: '/catalogs' }, 'signIn body');
    roundTrip(E.auth.signIn.response, { redirect: '/dashboard' }, 'signIn redirect');
    roundTrip(E.auth.signIn.response, { error: 'Email yoki parol notoʻgʻri', unverified: true }, 'signIn state');
    roundTrip(E.auth.me.response, { userId: 'u1', orgId: 'o1', email: 'a@b.uz', demo: false, clientId: null, role: 'accountant', clientIds: ['c1'] }, 'me');
    roundTrip(E.auth.twoFactorStart.response, { secret: 'S', uri: 'otpauth://totp/x', qr: { size: 29, path: 'M0 0h1v1H0z' } }, '2fa start');
    roundTrip(E.auth.twoFactorStart.response, null, '2fa start refused');
    roundTrip(E.auth.sessions.response, [{ id: 's1', userAgent: null, device: 'Chrome, Windows', current: true, createdAt: AT, lastSeenAt: AT }], 'sessions');
    refused(E.auth.twoFactorFinish.body, { code: '123' }, 'a code shorter than 6');
    refused(E.auth.me.response, { userId: 'u1', orgId: 'o1', email: 'a@b.uz', demo: false, clientId: null, role: 'owner', clientIds: null }, 'unknown role');
  });

  it('account', () => {
    roundTrip(E.account.createApiKey.response, { token: 'mxk_abc' }, 'key token');
    roundTrip(E.account.createApiKey.response, { error: 'limit' }, 'key refused');
    roundTrip(E.account.apiKeys.response, {
      keys: [{ id: 'k1', name: '1C', prefix: 'mxk_ab12', createdAt: AT, lastUsedAt: null, revokedAt: null, checksThisMonth: 12, createdBy: 'a@b.uz', creatorRemoved: false }],
      maxActive: 10, usage: { checks: 12, requests: 40 }, monthlyCap: 500, ratePerMinute: 60,
    }, 'api keys');
    roundTrip(E.account.setTheme.response, { ok: false, error: 'invalid' }, 'theme refused');
    roundTrip(E.account.setRetention.body, { days: null }, 'retention off');
    refused(E.account.setLocale.body, { locale: 'en' }, 'unknown locale');
    roundTrip(E.account.saveBranding.multipart.fields, { brandName: 'Hisob Pro', removeLogo: 'on' }, 'branding fields');
  });

  it('clients', () => {
    roundTrip(E.clients.create.response, { ok: true, clientId: 'c1' }, 'create');
    roundTrip(E.clients.remove.response, { ok: false, error: 'Avval…', blockers: [{ kind: 'invite', email: null }] }, 'delete blocked');
    roundTrip(E.clients.switchActive.response, { ok: true, client: { id: 'c1', name: 'Mijoz' } }, 'switch');
    roundTrip(E.clients.list.query, { q: 'sut', filter: 'attention', sort: 'open', page: 1 }, 'list query');
    assert.deepEqual(E.clients.list.query.parse({}), { page: 0 }, 'page defaults to 0');
    refused(E.clients.setAccountants.body, { userIds: Array.from({ length: 501 }, (_, i) => `u${i}`) }, 'more than 500 users');
  });

  it('catalogs', () => {
    const preview = {
      catalogId: 'c1', filename: 'k.xlsx', client: { id: 'cl1', name: 'Mijoz' }, headers: ['Nomi', 'MXIK'], sample: [['Sut', '']], rows: 120,
      parse: { format: 'xlsx', encoding: null, delimiter: null, headerRow: 2, skippedAbove: 1, emptyRowsSkipped: 0, totalSeen: 121, truncated: false, lineJumps: [[4, 9]] },
      mapping: { name: 0, barcode: -1, mxik: 1, unit: -1, price: -1, sales: -1, tnved: -1 }, remembered: 'client',
      fields: { name: 'remembered', barcode: 'none', mxik: 'guess', unit: 'none', price: 'none', sales: 'none', tnved: 'none' },
      diagnostics: null, previous: { id: 'c0', filename: 'k-old.xlsx', createdAt: AT, rowCount: 118 },
    };
    roundTrip(E.catalogs.previewUpload.response, { ok: true, preview }, 'preview');
    roundTrip(E.catalogs.previewUpload.response, { ok: false, error: 'Fayl juda katta' }, 'preview refused');
    roundTrip(E.catalogs.commit.response, { ok: false, error: 'Allaqachon', committed: true }, 'commit already');
    roundTrip(E.catalogs.diagnose.response, {
      ok: true, issues: [{ kind: 'duplicate', fields: ['name', 'unit'], column: 0 }],
      diagnostics: { rows: 3, importable: 2, noName: { count: 1, sample: [3] }, duplicates: { count: 0, sample: [], groups: 0 }, noCode: { count: 0, sample: [] }, badCodes: { count: 0, sample: [] }, lostZero: { count: 0, sample: [] }, ambiguousAmounts: { count: 0, sample: [] }, badTnved: { count: 0, sample: [] }, tnvedZero: { count: 0, sample: [] } },
    }, 'diagnose');
    roundTrip(E.catalogs.progress.response, { status: 'analyzing', done: 40, total: 120, etaSeconds: 30 }, 'progress');
    roundTrip(E.catalogs.progress.response, { status: 'ready', summary: { rows: 120, riskyRows: 9, byType: [{ type: 'MISSING', count: 4 }], carried: 2, previousId: null, notRead: 0, dropped: 1 } }, 'progress ready');
    refused(E.catalogs.progress.response, { status: 'analyzing' }, 'progress without counts');
    refused(E.catalogs.diagnose.body, { mapping: { name: -1, barcode: -1, mxik: -1, unit: -1, price: -1 } }, 'no name column');
    roundTrip(E.catalogs.createShareLink.body, { days: 30, includePdf: true }, 'share body');
    refused(E.catalogs.createShareLink.body, { days: 14, includePdf: true }, 'share for 14 days');
  });

  it('workspace', () => {
    roundTrip(E.workspace.decide.response, { ok: true, eventId: 'e1' }, 'decide');
    roundTrip(E.workspace.decide.response, {
      ok: false, code: 'already_decided', error: 'x', decision: 'accepted', chosenMxik: null, decidedBy: 'a@b.uz', decidedAt: AT, decisionSource: 'manual', decisionEventId: 'e0',
    }, 'decide conflict');
    roundTrip(E.workspace.bulkApply.body, { target: { filter: { type: 'MISSING', q: null } }, action: { kind: 'assign', code: '01234567890123456' } }, 'bulk assign');
    refused(E.workspace.bulkApply.body, { target: { ids: [] }, action: { kind: 'accept' } }, 'bulk without rows');
    refused(E.workspace.bulkApply.body, { target: { ids: ['f1'] }, action: { kind: 'assign', code: '123' } }, 'bulk with a short code');
    roundTrip(E.workspace.acceptSure.body, { minConfidence: 0.95, filter: null }, 'sure');
    refused(E.workspace.acceptSure.body, { minConfidence: 0.5 }, 'below the high band');
    roundTrip(E.workspace.undo.body, { lastInCatalog: 'c1' }, 'undo last');
    roundTrip(E.workspace.bulkUndoFlags.response, { ok: true, findingIds: ['f1'], flags: { f1: null } }, 'undo flags');
    roundTrip(E.workspace.lookupCodes.response, [{ code: '01234567890123456', name: 'Sut', path: 'A → B', isBase: true, unit: null }], 'lookup');
    roundTrip(E.workspace.rows.query, { cursor: '', type: 'MARKING', dec: 'all' }, 'rows query');
    assert.deepEqual(E.workspace.rows.query.parse({}), { cursor: '' }, 'cursor defaults to the first page');
  });

  it('dictionary, imports, team, reminders', () => {
    roundTrip(E.dictionary.acceptForCatalog.response, { ok: true, count: 3, eventId: null, ids: ['f1', 'f2', 'f3'], skipped }, 'dictionary accept');
    roundTrip(E.dictionary.update.response, { ok: false, error: '17 ta raqam' }, 'dictionary update');
    roundTrip(E.imports.uploadPurchases.response, { ok: true, preview: { listId: 'l1', filename: 'kirim.xlsx', headers: ['A'], rows: [['x']], totalRows: 1, totalSeen: 1, truncated: false, map: { name: 0, mxik: 1, unit: -1 } } }, 'purchases preview');
    roundTrip(E.imports.applyPurchases.response, { ok: true, codes: 42 }, 'purchases apply');
    roundTrip(E.imports.uploadDoc.multipart.fields, { kind: 'cheques' }, 'doc kind');
    refused(E.imports.uploadDoc.multipart.fields, { kind: 'invoices' }, 'unknown doc kind');
    roundTrip(E.team.invite.response, { fieldErrors: { email: 'Bu manzil band' } }, 'invite field error');
    roundTrip(E.team.invite.response, { url: 'https://tasnivo.uz/invite/t', email: null, emailed: false }, 'invite link');
    roundTrip(E.team.join.response, { redirect: '/catalogs' }, 'join');
    roundTrip(E.reminders.saveSchedule.response, { ok: true, nextDue: AT }, 'schedule saved');
    roundTrip(E.reminders.tasks.response, [{ id: 't1', clientId: 'c1', clientName: 'Mijoz', period: '2026-10', dueOn: AT, overdue: false }], 'tasks');
  });

  it('notifications, billing, demo', () => {
    roundTrip(E.notifications.preview.response, { ok: true, items: [{ id: 'n1', kind: 'review.assigned', title: 'T', body: 'B', href: '/catalogs/c1', createdAt: AT, unread: true, client: null }], unread: 1, total: 1 }, 'bell');
    roundTrip(E.notifications.preview.response, { ok: false, error: 'auth' }, 'bell refused');
    roundTrip(E.notifications.search.response, { ok: true, results: { query: 'sut', clients: [], catalogs: [{ id: 'c1', filename: 'k.xlsx', clientName: null, createdAt: AT, status: 'ready', href: '/catalogs/c1' }], products: [], codes: [] } }, 'search');
    roundTrip(E.billing.checkout.body, { planId: 'catalog', catalogId: null, provider: 'payme' }, 'checkout');
    refused(E.billing.checkout.body, { planId: 'catalog', catalogId: null, provider: 'paypal' }, 'unknown provider');
    roundTrip(E.billing.plan.response.shape.purchase, { kind: 'available', price: 99000, providers: ['click'] }, 'purchase');
    roundTrip(E.demo.request.response, { error: 'x', field: 'email' }, 'demo refused');
    roundTrip(E.demo.open.response, { redirect: '/catalogs/c1' }, 'demo open');
    roundTrip(E.demo.lead.response, { ok: true }, 'lead');
    roundTrip(E.demo.lead.response, { error: 'Fayl juda katta (5 MB dan oshmasligi kerak).', field: 'file', contact: '+998' }, 'lead refused');
  });

  it('public API v1: the serializers\' output parses with the contract', () => {
    const catalog = { id: 'c1', filename: 'k.xlsx', clientId: 'cl1', createdAt: new Date(AT), status: 'ready', rowCount: 3, progressDone: 3 };
    const finding = {
      id: 'f1', type: 'RESTRICTED', severity: 'high', suggestedMxik: '01234567890123456', confidence: 0.91, reason: 'r', decision: 'pending', chosenMxik: null, decisionSource: null,
      restrictedFrom: new Date('2026-11-01T00:00:00Z'), item: { rowIndex: 0, rawName: 'Sut', barcode: null, unit: 'dona', existingMxik: null },
    };
    roundTrip(E.publicApi.listCatalogs.response, { catalogs: [catalogOut(catalog)], nextCursor: null }, 'catalog list');
    roundTrip(E.publicApi.report.response, reportOut({ catalog, summary: { RESTRICTED: 1 }, findings: [findingOut(finding)], nextCursor: 'f1' }), 'report');
    roundTrip(E.publicApi.report.response, reportOut({ catalog: { ...catalog, status: 'failed' }, summary: null, findings: [], nextCursor: null }), 'failed report');
    roundTrip(E.publicApi.uploadCatalog.response, uploadOut({ id: 'c1', rows: 3, clientId: 'cl1' }), 'upload');
    const result = checkResultOut('Sut', { markingRequired: true, findings: [{ type: 'MISSING', severity: 'high', suggestedMxik: null, confidence: null, reason: 'r', alternatives: [{ code: 'x', name: 'y', confidence: 0.4 }] }] });
    roundTrip(E.publicApi.check.response, { results: [result] }, 'check');
    assert.ok(E.publicApi.check.body.safeParse({ name: 'Sut' }).success);
    assert.ok(E.publicApi.check.body.safeParse({ items: [{ name: 'Sut' }, { name: 'Non', barcode: '4780000000001' }] }).success);
    refused(E.publicApi.check.body, { items: [] }, 'no items');
    refused(E.publicApi.check.body, { name: '' }, 'empty name');
  });

  it('admin, share, cron, health', () => {
    roundTrip(E.admin.pipeline.response, [{ label: 'Embedder', value: 'e5-small', ok: true }], 'pipeline');
    roundTrip(E.admin.accuracy.query, { by: 'week' }, 'accuracy query');
    assert.deepEqual(E.admin.accuracy.query.parse({}), { by: 'stage' });
    roundTrip(E.cron.classifierUpdate.response, { started: true, pid: null, log: 'data/classifier-update.log' }, 'classifier');
    roundTrip(E.health.get.response, { status: 'ok', database: true, classifier: { loaded: true, takenAt: AT, ageDays: 2, codeCount: 210000, stale: false, lastUpdate: { outcome: 'failed', at: AT, message: 'timeout' } } }, 'health');
    refused(E.share.view.params, { token: '' }, 'empty share token');
  });
});
