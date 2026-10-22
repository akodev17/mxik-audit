import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import { bulkApply, bulkPreview, undoFlags } from './bulk.js';
import { codeRequestText } from './code-request.js';
import { addComment, listComments, setFlag } from './comments.js';
import { db } from '@tasnivo/db';
import { bulkAccept, recordDecision, recordGroupDecision, splitFromGroup, sureBandPreview, undoDecision, undoLast } from './decisions.js';
import { editMapping, learn, removeMapping } from './dictionary.js';
import { acceptDictionaryButton } from './dictionary-button.js';
import { applyBarcodeName } from './barcode-name.js';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { rowDetail } from './row-detail.js';
import { recordWrongSuggestion } from './suggestion-feedback.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from './test-fixtures.js';
import { listViews, removeView, saveView, setDefaultView } from './views.js';
import { workspaceChipCounts, workspaceCount, workspacePageIds, workspaceSummary } from './workspace.js';
import { readFilter } from './workspace-filter.js';

const skip = await dbSkipReason();

type FindingSpec = {
  type?: 'MISSING' | 'NOT_FOUND' | 'MISMATCH' | 'UNIT_CONFLICT' | 'NOT_PURCHASED' | 'PRIVILEGE_CODE';
  severity?: 'high' | 'medium' | 'info';
  suggestedMxik?: string | null;
  confidence?: number | null;
  evidence?: Prisma.InputJsonValue;
  decision?: 'pending' | 'accepted' | 'rejected';
  chosenMxik?: string | null;
  decisionSource?: string | null;
  flag?: string | null;
};
type RowSpec = { rawName?: string; existingMxik?: string | null; unit?: string | null; barcode?: string | null; findings: FindingSpec[] };

const tag = (): string => randomBytes(3).toString('hex');

async function catalogWith(orgId: string, rows: RowSpec[]): Promise<{ catalogId: string; items: { id: string; findings: string[] }[] }> {
  const catalog = await db.catalog.create({
    data: { orgId, filename: 'review.xlsx', rowCount: rows.length, status: 'ready', headers: ['name'], columnMap: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 } },
  });
  const items: { id: string; findings: string[] }[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const item = await db.catalogItem.create({
      data: {
        catalogId: catalog.id, rowIndex, rawName: row.rawName ?? `Tovar ${rowIndex} ${tag()}`, normalizedName: '',
        existingMxik: row.existingMxik ?? null, unit: row.unit ?? null, barcode: row.barcode ?? null, attrs: { original: [] },
      },
    });
    const findings: string[] = [];
    for (const f of row.findings) {
      const created = await db.finding.create({
        data: {
          itemId: item.id, type: f.type ?? 'MISSING', severity: f.severity ?? 'high', suggestedMxik: f.suggestedMxik ?? null,
          confidence: f.confidence ?? null, alternatives: [], reason: 'test', evidence: f.evidence,
          decision: f.decision ?? 'pending', chosenMxik: f.chosenMxik ?? null, decisionSource: f.decisionSource ?? null, flag: f.flag ?? null,
          decidedAt: f.decision && f.decision !== 'pending' ? new Date() : null,
        },
      });
      findings.push(created.id);
    }
    items.push({ id: item.id, findings });
  }
  return { catalogId: catalog.id, items };
}

async function secondUser(orgId: string, role: 'admin' | 'accountant' | 'viewer' = 'accountant'): Promise<TestActor & { email: string }> {
  const email = `test-${tag()}@test.local`;
  const user = await db.user.create({ data: { orgId, email, passwordHash: 'x', role } });
  return { orgId, userId: user.id, email };
}

const ids = (c: { items: { findings: string[] }[] }): string[] => c.items.flatMap((i) => i.findings);
const decisionOf = async (id: string) => (await db.finding.findUnique({ where: { id } }))?.decision;

describe('workspace review (database)', { skip }, () => {
  let a: TestActor & { email: string };
  let b: TestActor;
  let codes: string[] = [];

  before(async () => {
    codes = await liveCodes(4);
    const org = await makeOrg();
    const user = await db.user.findUniqueOrThrow({ where: { id: org.userId } });
    a = { ...org, email: user.email };
    b = await makeOrg();
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('sorts riskiest first by severity rank, not alphabetically, and the cursor walks the same order', async () => {
    const [x = ''] = codes;
    const c = await catalogWith(a.orgId, [
      { findings: [{ severity: 'info', suggestedMxik: x, confidence: 0.5 }] },
      { findings: [{ severity: 'high', suggestedMxik: x, confidence: 0.9 }] },
      { findings: [{ severity: 'medium', suggestedMxik: x, confidence: 0.1 }] },
      { findings: [{ severity: 'high', suggestedMxik: x, confidence: 0.2 }] },
      { findings: [{ severity: 'medium', suggestedMxik: x, confidence: null }] },
    ]);
    const f = ids(c);
    const expected = [f[3], f[1], f[4], f[2], f[0]];
    const filter = readFilter({ type: 'MISSING' });
    assert.deepEqual((await workspacePageIds(c.catalogId, filter, null, 100)).ids, expected);

    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const { decodeCursor } = await import('./workspace.js');
      const page = await workspacePageIds(c.catalogId, filter, decodeCursor(cursor), 2);
      walked.push(...page.ids);
      cursor = page.next;
    } while (cursor);
    assert.deepEqual(walked, expected);
    assert.equal(await workspaceCount(c.catalogId, readFilter({})), 4, 'the default view leaves informational findings out');
  });

  it('filters by investigation flag and by decision state', async () => {
    const [x = ''] = codes;
    const c = await catalogWith(a.orgId, [
      { findings: [{ suggestedMxik: x, flag: 'ask_client' }] },
      { findings: [{ suggestedMxik: x, flag: 'resolved', decision: 'accepted', chosenMxik: x, decisionSource: 'manual' }] },
      { findings: [{ suggestedMxik: x, decision: 'rejected', decisionSource: 'manual' }] },
      { findings: [{ suggestedMxik: x, decision: 'accepted', chosenMxik: x, decisionSource: 'carry_over' }] },
      { findings: [{ suggestedMxik: x, decision: 'accepted', chosenMxik: x, decisionSource: 'dictionary_auto' }] },
    ]);
    const n = (p: Record<string, string>) => workspaceCount(c.catalogId, readFilter(p));
    assert.equal(await n({ dec: 'all', flag: 'ask_client' }), 1);
    assert.equal(await n({ dec: 'all', flag: 'resolved' }), 1);
    assert.equal(await n({ dec: 'all', flag: 'none' }), 3);
    assert.equal(await n({}), 1);
    assert.equal(await n({ dec: 'accepted' }), 3);
    assert.equal(await n({ dec: 'rejected' }), 1);
    assert.equal(await n({ dec: 'carried' }), 1);
    assert.equal(await n({ dec: 'auto' }), 2);
  });

  it('counts each type chip as its list shows it under the decision filter, and searches barcodes', async () => {
    const [x = ''] = codes;
    const barcode = `478${Date.now() % 1_000_000_000}`.slice(0, 13);
    const c = await catalogWith(a.orgId, [
      { findings: [{ type: 'MISSING', suggestedMxik: x }] },
      { findings: [{ type: 'MISSING', suggestedMxik: x, decision: 'accepted', chosenMxik: x, decisionSource: 'manual' }] },
      { barcode, findings: [{ type: 'NOT_FOUND', suggestedMxik: x }, { type: 'PRIVILEGE_CODE', severity: 'info' }] },
    ]);
    const pending = await workspaceChipCounts(c.catalogId, readFilter({}));
    assert.equal(pending.all, await workspaceCount(c.catalogId, readFilter({})));
    assert.equal(pending.byType['MISSING'], await workspaceCount(c.catalogId, readFilter({ type: 'MISSING' })));
    assert.deepEqual([pending.all, pending.byType['MISSING'], pending.byType['PRIVILEGE_CODE']], [2, 1, 1]);
    const all = await workspaceChipCounts(c.catalogId, readFilter({ dec: 'all' }));
    assert.deepEqual([all.all, all.byType['MISSING']], [3, 2]);
    assert.equal(await workspaceCount(c.catalogId, readFilter({ q: barcode })), 1, 'a barcode finds its row');
  });

  it('row detail marks only the missing levels of an unknown code and explains from data', async () => {
    const [x = ''] = codes;
    let unknown = `${x.slice(0, 11)}999999`;
    if (await db.mxikCode.findFirst({ where: { code: unknown } })) unknown = `${x.slice(0, 11)}999998`;
    const c = await catalogWith(a.orgId, [{ existingMxik: unknown, findings: [{ type: 'NOT_FOUND', suggestedMxik: x, confidence: 0.8 }] }]);
    const detail = await rowDetail(a, c.items[0]?.findings[0] ?? '', appDict('ru'), 'ru');
    assert.ok(detail);
    assert.equal(detail.current?.state, 'unknown');
    assert.deepEqual(detail.current?.blocks.map((b) => b.missing), [false, false, false, false, true]);
    assert.ok(detail.current?.blocks.slice(0, 4).every((b) => b.name !== null), 'the levels that exist keep their names');
    assert.equal(detail.facts.code, unknown);
    assert.equal(detail.facts.afterUpdate, false);
  });

  it('keeps one accepted code per row: a sibling with another code blocks, bulk skips it', async () => {
    const [own = '', other = ''] = codes;
    const row: RowSpec = { existingMxik: own, findings: [{ type: 'MISMATCH', severity: 'medium', suggestedMxik: other, confidence: 0.8 }, { type: 'UNIT_CONFLICT', severity: 'medium', suggestedMxik: own }] };
    const c = await catalogWith(a.orgId, [row, row]);
    const [mismatch = '', unit = ''] = c.items[0]?.findings ?? [];

    const fixUnit = await recordDecision(a, { findingId: unit, decision: 'accepted' });
    assert.ok(fixUnit.ok);
    assert.equal((await db.finding.findUnique({ where: { id: unit } }))?.chosenMxik, own, 'confirming keeps the current code');
    const blocked = await recordDecision(a, { findingId: mismatch, decision: 'accepted' });
    assert.equal(blocked.ok, false);
    assert.ok(!blocked.ok && blocked.code === 'sibling_conflict' && blocked.sibling.chosenMxik === own);
    assert.equal(await decisionOf(mismatch), 'pending');
    assert.ok((await recordDecision(a, { findingId: mismatch, decision: 'rejected' })).ok, 'rejecting never conflicts');

    const both = c.items[1]?.findings ?? [];
    const bulk = await bulkApply(a, c.catalogId, { ids: both }, { kind: 'accept' });
    assert.ok(bulk.ok);
    assert.equal(bulk.count, 0);
    assert.equal(bulk.skipped.conflict, 2, 'two different codes for one row in one batch are both skipped');
  });

  it('returns a typed conflict naming who decided when someone was first', async () => {
    const [x = ''] = codes;
    const c = await catalogWith(a.orgId, [{ findings: [{ suggestedMxik: x, confidence: 0.8 }] }]);
    const [id = ''] = ids(c);
    const colleague = await secondUser(a.orgId);
    assert.ok((await recordDecision(a, { findingId: id, decision: 'accepted' })).ok);
    const late = await recordDecision({ ...colleague, role: 'accountant' }, { findingId: id, decision: 'rejected' });
    assert.ok(!late.ok && late.code === 'already_decided');
    assert.ok(!late.ok && late.code === 'already_decided' && late.decidedBy === a.email && late.decision === 'accepted' && late.chosenMxik === x && late.decidedAt !== null);
  });

  it('undo-last reverts only the caller\'s own manual decisions', async () => {
    const [x = ''] = codes;
    const c = await catalogWith(a.orgId, [0, 1, 2].map(() => ({ findings: [{ suggestedMxik: x, confidence: 0.8 }] })));
    const [mine = '', theirs = '', bulkRow = ''] = ids(c);
    const colleague = await secondUser(a.orgId);
    assert.ok((await recordDecision(a, { findingId: mine, decision: 'accepted' })).ok);
    assert.ok((await recordDecision(colleague, { findingId: theirs, decision: 'accepted' })).ok);

    const undone = await undoLast(a, c.catalogId);
    assert.ok(undone.ok);
    assert.deepEqual(undone.findingIds, [mine]);
    assert.equal(undone.row?.findingId, mine);
    assert.equal(await decisionOf(theirs), 'accepted', 'a colleague\'s later decision is not touched');

    assert.ok((await bulkApply(a, c.catalogId, { ids: [bulkRow] }, { kind: 'accept' })).ok);
    assert.equal((await undoLast(a, c.catalogId)).ok, false, 'bulk actions are undone from their own control');
    assert.equal(await decisionOf(bulkRow), 'accepted');
  });

  it('undo takes back what the decision taught the firm dictionary', async () => {
    const [x = '', z = ''] = codes;
    const fresh = { rawName: `Lugʻat yangi ${tag()}`, unit: 'kg' };
    const c1 = await catalogWith(a.orgId, [{ ...fresh, findings: [{ suggestedMxik: x, confidence: 0.8 }] }]);
    const d1 = await recordDecision(a, { findingId: ids(c1)[0] ?? '', decision: 'accepted' });
    assert.ok(d1.ok);
    const learned = await db.firmMapping.findFirst({ where: { orgId: a.orgId, kind: 'name', code: x, label: { contains: 'yangi' } }, orderBy: { updatedAt: 'desc' } });
    assert.equal(learned?.uses, 1);
    assert.ok((await undoDecision(a, d1.eventId)).ok);
    assert.equal(await db.firmMapping.count({ where: { id: learned?.id } }), 0, 'an entry the decision created is removed');

    const known = { rawName: `Lugʻat eski ${tag()}`, unit: 'kg' };
    await learn(a.orgId, a.userId, [{ ...known, barcode: null, code: z }], 'manual');
    await learn(a.orgId, a.userId, [{ ...known, barcode: null, code: z }], 'manual');
    const before = await db.firmMapping.findFirstOrThrow({ where: { orgId: a.orgId, kind: 'name', code: z, label: { contains: 'eski' } } });
    const c2 = await catalogWith(a.orgId, [{ ...known, findings: [{ suggestedMxik: x, confidence: 0.8 }] }]);
    const d2 = await recordDecision(a, { findingId: ids(c2)[0] ?? '', decision: 'accepted' });
    assert.ok(d2.ok);
    assert.equal((await db.firmMapping.findUnique({ where: { id: before.id } }))?.code, x);
    assert.ok((await undoDecision(a, d2.eventId)).ok);
    const restored = await db.firmMapping.findUnique({ where: { id: before.id } });
    assert.deepEqual(
      { code: restored?.code, uses: restored?.uses, confirmations: restored?.confirmations, source: restored?.source },
      { code: z, uses: before.uses, confirmations: before.confirmations, source: before.source },
    );
  });

  it('bulk on a filter: the dry run counts pending rows, the action records the ids it changed, flags undo', async () => {
    const [x = ''] = codes;
    const c = await catalogWith(a.orgId, [
      { findings: [{ suggestedMxik: x, confidence: 0.8 }] },
      { findings: [{ suggestedMxik: x, confidence: 0.8, flag: 'resolved' }] },
      { findings: [{ suggestedMxik: x, confidence: 0.8 }] },
      { findings: [{ suggestedMxik: x, decision: 'accepted', chosenMxik: x, decisionSource: 'manual' }] },
      { findings: [{ severity: 'info', suggestedMxik: x }] },
    ]);
    const f = ids(c);
    const all = readFilter({});
    const dry = await bulkPreview(a, c.catalogId, { filter: all }, { kind: 'accept' });
    assert.ok(dry.ok && dry.willTouch === 3 && !dry.capped);
    const none = await bulkPreview(a, c.catalogId, { filter: readFilter({ dec: 'accepted' }) }, { kind: 'reject' });
    assert.ok(none.ok && none.willTouch === 0);

    const flagged = await bulkApply(a, c.catalogId, { filter: readFilter({ dec: 'all' }) }, { kind: 'flag', flag: 'ask_client' });
    assert.ok(flagged.ok && flagged.count === 4 && flagged.eventId);
    const restored = await undoFlags(a, flagged.eventId);
    assert.ok(restored.ok);
    assert.equal((await db.finding.findUnique({ where: { id: f[1] } }))?.flag, 'resolved', 'the previous flag comes back');
    assert.equal((await db.finding.findUnique({ where: { id: f[0] } }))?.flag, null);

    const done = await bulkApply(a, c.catalogId, { filter: all }, { kind: 'accept' });
    assert.ok(done.ok && done.eventId);
    assert.deepEqual([...done.ids].sort(), [f[0], f[1], f[2]].sort());
    const event = await db.auditEvent.findUniqueOrThrow({ where: { id: done.eventId } });
    const recorded = ((event.payload as { findings: { id: string }[] }).findings).map((r) => r.id).sort();
    assert.deepEqual(recorded, [...done.ids].sort());
    assert.equal((await db.finding.findUnique({ where: { id: f[0] } }))?.decisionSource, 'bulk');
  });

  it('accept-all-high counts what it would take, honours a filter scope and undoes as one event', async () => {
    const [x = ''] = codes;
    const c = await catalogWith(a.orgId, [
      { findings: [{ suggestedMxik: x, confidence: 0.95 }] },
      { findings: [{ type: 'NOT_FOUND', suggestedMxik: x, confidence: 0.97 }] },
      { findings: [{ suggestedMxik: x, confidence: 0.96, evidence: { stage: 'dictionary' } }] },
      { findings: [{ suggestedMxik: x, confidence: 0.96, evidence: { stage: 'rerank', rerankNone: true } }] },
      { findings: [{ suggestedMxik: x, confidence: 0.6 }] },
    ]);
    const preview = await sureBandPreview(a, c.catalogId, null);
    assert.ok(preview.ok && preview.total === 2 && preview.byType['MISSING'] === 1 && preview.byType['NOT_FOUND'] === 1);
    assert.equal((await workspaceSummary(c.catalogId, 5)).surePending, 2);

    const scoped = await bulkAccept(a, { catalogId: c.catalogId, minConfidence: 0.9, filter: readFilter({ type: 'NOT_FOUND' }) });
    assert.ok(scoped.ok && scoped.count === 1);
    const rest = await bulkAccept(a, { catalogId: c.catalogId, minConfidence: 0.9 });
    assert.ok(rest.ok && rest.count === 1 && rest.eventId);
    assert.ok((await undoDecision(a, rest.eventId)).ok);
    assert.equal(await decisionOf(ids(c)[0] ?? ''), 'pending');
  });

  it('refuses a viewer in every review, bulk, comment, view, feedback and dictionary action', async () => {
    const [x = ''] = codes;
    const c = await catalogWith(a.orgId, [{ findings: [{ suggestedMxik: x, confidence: 0.95, evidence: { stage: 'dictionary' } }] }, { findings: [{ suggestedMxik: x, confidence: 0.95 }] }]);
    const [id = '', other = ''] = ids(c);
    const decided = await recordDecision(a, { findingId: other, decision: 'accepted' });
    assert.ok(decided.ok);
    const viewerUser = await secondUser(a.orgId, 'viewer');
    const viewer = { ...viewerUser, role: 'viewer' as const };
    const view = await db.savedView.create({ data: { orgId: a.orgId, userId: viewer.userId, name: 'v', params: {} } });
    const entry = await db.firmMapping.create({ data: { orgId: a.orgId, kind: 'name', key: `viewer-${tag()}`, label: 'x', code: x } });

    const refused = await Promise.all([
      recordDecision(viewer, { findingId: id, decision: 'accepted' }).then((r) => r.ok),
      recordGroupDecision(viewer, { findingIds: [id], decision: 'accepted' }).then((r) => r.ok),
      bulkAccept(viewer, { catalogId: c.catalogId, minConfidence: 0.9 }).then((r) => r.ok),
      undoDecision(viewer, decided.eventId).then((r) => r.ok),
      undoLast(viewer, c.catalogId).then((r) => r.ok),
      splitFromGroup(viewer, id).then((r) => r.ok),
      bulkApply(viewer, c.catalogId, { ids: [id] }, { kind: 'reject' }).then((r) => r.ok),
      bulkApply(viewer, c.catalogId, { ids: [id] }, { kind: 'flag', flag: 'ask_client' }).then((r) => r.ok),
      undoFlags(viewer, decided.eventId).then((r) => r.ok),
      addComment(viewer, id, 'note'),
      setFlag(viewer, id, 'ask_client'),
      saveView(viewer, 'mine', { type: null, q: '', pending: true, comments: false, sort: 'risk', density: 'compact', grouped: false }, false),
      removeView(viewer, view.id),
      setDefaultView(viewer, view.id),
      recordWrongSuggestion(viewer, { findingId: id, reason: 'other' }),
      editMapping(viewer, entry.id, x).then((r) => r.ok),
      removeMapping(viewer, entry.id).then((r) => r.ok),
      acceptDictionaryButton(viewer, c.catalogId).then((r) => r.ok),
      applyBarcodeName(viewer, id),
    ]);
    assert.deepEqual(refused, refused.map(() => false));
    const after = await db.finding.findUniqueOrThrow({ where: { id } });
    assert.deepEqual({ decision: after.decision, flag: after.flag }, { decision: 'pending', flag: null });
    assert.equal(await decisionOf(other), 'accepted');
    assert.equal(await db.findingComment.count({ where: { findingId: id } }), 0);
    assert.equal(await db.savedView.count({ where: { id: view.id } }), 1);
    assert.equal(await db.firmMapping.count({ where: { id: entry.id } }), 1);
  });

  it('refuses another org (and a client-scoped accountant) for row detail, comments, views and the code request', async () => {
    const [x = ''] = codes;
    const c = await catalogWith(a.orgId, [{ findings: [{ suggestedMxik: null }] }]);
    const [id = ''] = ids(c);
    const ta = appDict('uz');
    assert.ok(await rowDetail(a, id, ta));
    assert.equal(await rowDetail(b, id, ta), null);
    assert.ok(await codeRequestText(a, id));
    assert.equal(await codeRequestText(b, id), null);
    const scoped = { ...a, clientIds: ['not-this-client'] };
    assert.equal(await codeRequestText(scoped, id), null, 'an accountant outside the catalogue\'s client gets nothing');
    assert.equal(await rowDetail(scoped, id, ta), null);

    assert.ok(await addComment(a, id, 'ichki izoh'));
    assert.deepEqual(await listComments(b, id), []);
    assert.equal(await addComment(b, id, 'begona'), false);
    assert.equal(await setFlag(b, id, 'resolved'), false);
    assert.equal((await db.finding.findUnique({ where: { id } }))?.flag, null);

    assert.ok(await saveView(a, 'Mening', { type: null, q: x.slice(0, 3), pending: true, comments: false, sort: 'risk', density: 'compact', grouped: false }, true));
    const mine = (await listViews(a)).find((v) => v.name === 'Mening');
    assert.ok(mine);
    assert.equal(await removeView(b, mine.id), false);
    await setDefaultView(b, mine.id);
    assert.equal((await listViews(b)).some((v) => v.id === mine.id), false);
    assert.equal((await db.savedView.findUnique({ where: { id: mine.id } }))?.isDefault, true);
  });
});
