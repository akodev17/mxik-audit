// Authorization and tenant isolation, proved against the library functions the
// server actions and routes call. Runs against the dev database; skips when it
// is not there. Everything hangs off orgs made here, and dropOrgs removes it.
//
// Cast: org A has an admin, a second and third admin (for the demotion cases),
// an accountant scoped to client A, an accountant scoped to client B, an
// unscoped viewer and a viewer scoped to client D only. Org B has its own admin
// and client. Every mutation is tried as the viewer, as the scoped accountant
// on client B, and as org B with org A's ids.
//
// Three kinds of test:
//   - plain `it`: the guard exists and must hold;
//   - `it(..., { todo })`: the library has no role check of its own and relies
//     on the server action's writer()/admin() guard (a defense-in-depth gap
//     against the contract in write-access.ts, not reachable from the UI today);
//   - plain `it` that fails today: a real hole, kept failing on purpose.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { BANDS } from '../core/match/score.js';
import { activityPage } from './activity.js';
import { switchableClient } from './active-client.js';
import { authenticate, createApiKey, revokeApiKey } from './api/keys.js';
import { purchaseOf } from './billing/availability.js';
import { billingConfig } from './billing/config.js';
import { bulkApply, bulkPreview, undoFlags } from './bulk.js';
import { deleteCatalog, resolveCatalog } from './catalogs.js';
import { archiveClient, deleteClient, renameClient, restoreClient, setClientAccountants } from './client-lifecycle.js';
import { createClient } from './clients.js';
import { codeRequestText } from './code-request.js';
import { addComment, listComments, setFlag } from './comments.js';
import { dashboard } from './dashboard.js';
import { db } from './db.js';
import {
  bulkAccept, decisionHistory, recordDecision, recordGroupDecision, splitFromGroup, sureBandPreview, undoDecision, undoLast,
} from './decisions.js';
import { isDemoOrg } from './demo.js';
import { editMapping, removeMapping } from './dictionary.js';
import { acceptDictionaryButton } from './dictionary-button.js';
import { applyDocMap, deleteDocList, restartDocCheck, storeDocList } from './docs.js';
import { makeClient, makeClientCatalog, makePerson, type Person } from './firm-test-fixtures.js';
import { appDict } from './i18n-app.js';
import { listNotifications, markRead, unreadCount } from './notifications.js';
import { reportPdfData } from './pdf/report-data.js';
import { applyPurchaseMap, deletePurchaseList, setClientActivity, storePurchaseList } from './purchases.js';
import { queuePage, readQueueFilter } from './queue.js';
import { markDone, setSchedule } from './reminders.js';
import { rowDetail } from './row-detail.js';
import { search } from './search.js';
import type { Role } from './session.js';
import { createShareLink, listShareLinks, resolveShare, revokeShareLink } from './share.js';
import { parseUpload } from './spreadsheet.js';
import { recordWrongSuggestion } from './suggestion-feedback.js';
import { changeMember, ownedClientIds, removeTeamMember, revokeTeamInvite } from './team-members.js';
import { consumeLinkCode, createLinkCode, linkForChat, unlink } from './telegram/linking.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg } from './test-fixtures.js';
import { discardUpload, uploadPreview } from './upload-preview.js';
import { uploadProgress } from './upload-progress.js';
import { listViews, removeView, saveView, setDefaultView } from './views.js';
import type { ViewParams } from './view-params.js';

const skip = await dbSkipReason();

type Who = { userId: string; orgId: string; role: Role; clientIds: string[] | null };
const who = (p: Person): Who => ({ userId: p.userId, orgId: p.orgId, role: p.role, clientIds: p.clientIds });


const VIEW: ViewParams = { type: null, q: '', pending: true, comments: false, sort: 'risk', density: 'comfortable', grouped: false };

describe('backend authorization and tenant isolation (database)', { skip }, () => {
  const tag = randomBytes(4).toString('hex');
  const orgs: string[] = [];
  let codes: string[] = [];

  // Org A
  let admin: Who;
  let admin2: Who; // creates an API key, then is demoted
  let admin3: Who; // links a Telegram chat, then is demoted
  let acct: Who; // accountant scoped to client A
  let acctB: Who; // accountant scoped to client B
  let viewer: Who; // viewer, every client
  let viewerD: Who; // viewer scoped to client D only
  let clientA = '';
  let clientB = '';
  let clientD = '';
  let catA = '';
  let catB = '';
  let fA: string[] = [];
  let fB: string[] = [];
  // Org B
  let other: Who;
  let clientC = '';
  let catC = '';

  const row = (n: number, side: 'A' | 'B') => ({ name: `authz${side}${tag} mahsulot ${n}`, findings: [{}] });

  before(async () => {
    codes = await liveCodes(3);
    const a = await makeOrg();
    const b = await makeOrg();
    orgs.push(a.orgId, b.orgId);
    admin = { userId: a.userId, orgId: a.orgId, role: 'admin', clientIds: null };
    other = { userId: b.userId, orgId: b.orgId, role: 'admin', clientIds: null };

    clientA = await makeClient(a.orgId, `authz-client-A-${tag}`);
    clientB = await makeClient(a.orgId, `authz-client-B-${tag}`);
    clientD = await makeClient(a.orgId, `authz-client-D-${tag}`);
    clientC = await makeClient(b.orgId, `authz-client-C-${tag}`);

    acct = who(await makePerson(a.orgId, 'accountant', [clientA]));
    acctB = who(await makePerson(a.orgId, 'accountant', [clientB]));
    viewer = who(await makePerson(a.orgId, 'viewer'));
    viewerD = who(await makePerson(a.orgId, 'viewer', [clientD]));
    admin2 = who(await makePerson(a.orgId, 'admin'));
    admin3 = who(await makePerson(a.orgId, 'admin'));

    const ca = await makeClientCatalog(a.orgId, clientA, Array.from({ length: 10 }, (_, i) => row(i, 'A')), { filename: `authzA${tag}.xlsx` });
    const cb = await makeClientCatalog(a.orgId, clientB, Array.from({ length: 10 }, (_, i) => row(i, 'B')), { filename: `authzB${tag}.xlsx` });
    const cc = await makeClientCatalog(b.orgId, clientC, Array.from({ length: 4 }, (_, i) => row(i, 'A')), { filename: `authzC${tag}.xlsx` });
    catA = ca.catalogId;
    catB = cb.catalogId;
    catC = cc.catalogId;
    fA = ca.findingIds.map((ids) => ids[0] ?? '');
    fB = cb.findingIds.map((ids) => ids[0] ?? '');
    // Rows 4 (feedback) and 6 (dictionary) carry a suggestion.
    await db.finding.updateMany({ where: { id: { in: [fA[4] ?? '', fB[4] ?? '', fB[6] ?? ''] } }, data: { suggestedMxik: codes[0] ?? null, confidence: 0.95 } });
  });

  after(async () => {
    await db.telegramLinkCode.deleteMany({ where: { orgId: { in: orgs } } });
    await dropOrgs(orgs);
  });

  const decisionOf = async (id: string | undefined) => (await db.finding.findUniqueOrThrow({ where: { id: id ?? '' }, select: { decision: true } })).decision;
  const flagOf = async (id: string | undefined) => (await db.finding.findUniqueOrThrow({ where: { id: id ?? '' }, select: { flag: true } })).flag;

  // ---------------------------------------------------------------- decisions

  it('recordDecision: viewer, scoped accountant on client B and another org are refused', async () => {
    const v = await recordDecision(viewer, { findingId: fA[0] ?? '', decision: 'rejected' });
    assert.equal(v.ok, false);
    assert.equal(!v.ok && v.code, 'forbidden');
    const s = await recordDecision(acct, { findingId: fB[0] ?? '', decision: 'rejected' });
    assert.equal(!s.ok && s.code, 'not_found');
    const o = await recordDecision(other, { findingId: fA[0] ?? '', decision: 'rejected' });
    assert.equal(!o.ok && o.code, 'not_found');
    assert.equal(await decisionOf(fA[0]), 'pending');
    assert.equal(await decisionOf(fB[0]), 'pending');
    // Positive control: the scoped accountant decides on their own client.
    const mine = await recordDecision(acct, { findingId: fA[0] ?? '', decision: 'rejected' });
    assert.equal(mine.ok, true);
  });

  it('undoDecision / undoLast: refused for a viewer, another org, and the scoped accountant on client B', async () => {
    const onB = await recordDecision(admin, { findingId: fB[0] ?? '', decision: 'rejected' });
    assert.ok(onB.ok);
    const eventB = onB.ok ? onB.eventId : '';
    assert.equal((await undoDecision(viewer, eventB)).ok, false);
    assert.equal((await undoDecision(other, eventB)).ok, false);
    assert.equal((await undoDecision(acct, eventB)).ok, false);
    assert.equal((await undoDecision(acct, eventB, fB[0])).ok, false);
    assert.equal(await decisionOf(fB[0]), 'rejected');
    assert.equal((await undoLast(viewer, catA)).ok, false);
    assert.equal((await undoLast(other, catA)).ok, false);
    assert.equal(await decisionOf(fA[0]), 'rejected');
    // Positive control: the accountant undoes their own decision.
    assert.equal((await undoLast(acct, catA)).ok, true);
    assert.equal(await decisionOf(fA[0]), 'pending');
  });

  it('decisionHistory: a scoped accountant gets no history of client B', async () => {
    const history = await decisionHistory(acct, catB);
    assert.deepEqual(history.map((h) => h.productName), []);
  });

  it('recordGroupDecision: refused for a viewer; ids of client B or another org are dropped', async () => {
    assert.equal((await recordGroupDecision(viewer, { findingIds: [fA[1] ?? ''], decision: 'rejected' })).ok, false);
    assert.equal((await recordGroupDecision(acct, { findingIds: [fB[1] ?? ''], decision: 'rejected' })).ok, false);
    assert.equal((await recordGroupDecision(other, { findingIds: [fA[1] ?? ''], decision: 'rejected' })).ok, false);
    const mixed = await recordGroupDecision(acct, { findingIds: [fA[1] ?? '', fB[1] ?? ''], decision: 'rejected' });
    assert.ok(mixed.ok);
    assert.deepEqual(mixed.ok ? mixed.ids : null, [fA[1]]);
    assert.equal(await decisionOf(fB[1]), 'pending');
  });

  it('splitFromGroup: refused for a viewer, client B and another org', async () => {
    assert.equal((await splitFromGroup(viewer, fA[2] ?? '')).ok, false);
    assert.equal((await splitFromGroup(acct, fB[2] ?? '')).ok, false);
    assert.equal((await splitFromGroup(other, fA[2] ?? '')).ok, false);
    const rows = await db.finding.findMany({ where: { id: { in: [fA[2] ?? '', fB[2] ?? ''] } }, select: { groupSplit: true } });
    assert.ok(rows.every((r) => !r.groupSplit));
  });

  it('bulkAccept / sureBandPreview / acceptDictionaryButton: refused for a viewer, client B and another org', async () => {
    assert.equal((await bulkAccept(viewer, { catalogId: catA, minConfidence: BANDS.high })).ok, false);
    assert.equal((await bulkAccept(acct, { catalogId: catB, minConfidence: BANDS.high })).ok, false);
    assert.equal((await bulkAccept(other, { catalogId: catA, minConfidence: BANDS.high })).ok, false);
    assert.equal((await bulkAccept(admin, { catalogId: catA, minConfidence: 0.1 })).ok, false, 'threshold below the high band');
    assert.equal((await sureBandPreview(acct, catB, null)).ok, false);
    assert.equal((await sureBandPreview(other, catA, null)).ok, false);
    assert.equal((await acceptDictionaryButton(viewer, catA)).ok, false);
    assert.equal((await acceptDictionaryButton(acct, catB)).ok, false);
    assert.equal((await acceptDictionaryButton(other, catA)).ok, false);
    assert.equal(await decisionOf(fB[4]), 'pending');
  });

  // --------------------------------------------------------------------- bulk

  it('bulkApply / bulkPreview: refused for a viewer, client B and another org; foreign ids in a selection are ignored', async () => {
    const flag = { kind: 'flag', flag: 'ask_client' } as const;
    assert.equal((await bulkApply(viewer, catA, { ids: [fA[5] ?? ''] }, flag)).ok, false);
    assert.equal((await bulkApply(viewer, catA, { ids: [fA[8] ?? ''] }, { kind: 'reject' })).ok, false);
    assert.equal((await bulkApply(acct, catB, { ids: [fB[5] ?? ''] }, flag)).ok, false);
    assert.equal((await bulkApply(other, catA, { ids: [fA[5] ?? ''] }, flag)).ok, false);
    assert.equal((await bulkPreview(acct, catB, { ids: [fB[5] ?? ''] }, flag)).ok, false);
    assert.equal((await bulkPreview(other, catA, { ids: [fA[5] ?? ''] }, flag)).ok, false);
    assert.equal(await flagOf(fA[5]), null);
    assert.equal(await decisionOf(fA[8]), 'pending');

    // Smuggling client B's row into a selection on client A's catalogue.
    const mixed = await bulkApply(acct, catA, { ids: [fA[5] ?? '', fB[5] ?? ''] }, flag);
    assert.ok(mixed.ok);
    assert.deepEqual(mixed.ok ? mixed.ids : null, [fA[5]]);
    assert.equal(await flagOf(fB[5]), null);
    const rejected = await bulkApply(acct, catA, { ids: [fA[8] ?? '', fB[8] ?? ''] }, { kind: 'reject' });
    assert.deepEqual(rejected.ok ? rejected.ids : null, [fA[8]]);
    assert.equal(await decisionOf(fB[8]), 'pending');
  });

  it('undoFlags: refused for a viewer and another org; the scoped accountant cannot undo a flag event on client B', async () => {
    const onB = await bulkApply(admin, catB, { ids: [fB[5] ?? ''] }, { kind: 'flag', flag: 'resolved' });
    assert.ok(onB.ok && onB.eventId);
    const eventB = onB.ok ? onB.eventId ?? '' : '';
    assert.equal((await undoFlags(viewer, eventB)).ok, false);
    assert.equal((await undoFlags(other, eventB)).ok, false);
    assert.equal((await undoFlags(acct, eventB)).ok, false);
    assert.equal(await flagOf(fB[5]), 'resolved');
  });

  // ----------------------------------------------------------------- comments

  it('comments and flags: refused for a viewer, client B and another org; client B notes stay hidden', async () => {
    assert.equal(await addComment(viewer, fA[3] ?? '', 'viewer note'), false);
    assert.equal(await addComment(acct, fB[3] ?? '', 'cross-client note'), false);
    assert.equal(await addComment(other, fA[3] ?? '', 'cross-org note'), false);
    assert.equal(await setFlag(viewer, fA[3] ?? '', 'ask_client'), false);
    assert.equal(await setFlag(acct, fB[3] ?? '', 'ask_client'), false);
    assert.equal(await setFlag(other, fA[3] ?? '', 'ask_client'), false);
    assert.equal(await db.findingComment.count({ where: { findingId: { in: [fA[3] ?? '', fB[3] ?? ''] } } }), 0);
    assert.equal(await flagOf(fA[3]), null);
    assert.equal(await flagOf(fB[3]), null);

    assert.equal(await addComment(admin, fB[3] ?? '', 'internal note on client B'), true);
    assert.deepEqual(await listComments(acct, fB[3] ?? ''), []);
    assert.deepEqual(await listComments(other, fB[3] ?? ''), []);
    assert.equal((await listComments(viewer, fB[3] ?? '')).length, 1, 'an unscoped viewer may read');
  });

  it('wrong-suggestion feedback: refused for a viewer, client B and another org', async () => {
    assert.equal(await recordWrongSuggestion(viewer, { findingId: fA[4] ?? '', reason: 'other' }), false);
    assert.equal(await recordWrongSuggestion(acct, { findingId: fB[4] ?? '', reason: 'other' }), false);
    assert.equal(await recordWrongSuggestion(other, { findingId: fA[4] ?? '', reason: 'other' }), false);
    assert.equal(await db.suggestionFeedback.count({ where: { findingId: { in: [fA[4] ?? '', fB[4] ?? ''] } } }), 0);
  });

  it('row detail and the new-code request draft: nothing for client B or another org', async () => {
    const ta = appDict('uz');
    assert.equal(await rowDetail(acct, fB[7] ?? '', ta, 'uz'), null);
    assert.equal(await rowDetail(other, fA[7] ?? '', ta, 'uz'), null);
    assert.notEqual(await rowDetail(acct, fA[7] ?? '', ta, 'uz'), null);
    assert.equal(await codeRequestText(acct, fB[7] ?? ''), null);
    assert.equal(await codeRequestText(other, fA[7] ?? ''), null);
  });

  // -------------------------------------------------------------- dictionary

  it('firm dictionary: refused for a viewer and another org', async () => {
    const accepted = await recordDecision(admin, { findingId: fB[6] ?? '', decision: 'accepted', chosenMxik: codes[0] ?? null });
    assert.ok(accepted.ok);
    const entry = await db.firmMapping.findFirstOrThrow({ where: { orgId: admin.orgId, code: codes[0] ?? '' }, select: { id: true } });
    assert.equal((await editMapping(viewer, entry.id, codes[1] ?? '')).ok, false);
    assert.equal((await editMapping(other, entry.id, codes[1] ?? '')).ok, false);
    assert.equal((await removeMapping(viewer, entry.id)).ok, false);
    assert.equal((await removeMapping(other, entry.id)).ok, false);
    assert.equal((await db.firmMapping.findUniqueOrThrow({ where: { id: entry.id } })).code, codes[0]);
  });

  // HOLE (kept failing): the firm dictionary has no client dimension, so an accountant scoped to
  // client A can rewrite or delete an entry learned from client B's catalogue, which then drives
  // suggestions (and dictionary auto-accept) on client B's next audits.
  it('firm dictionary: an accountant scoped to client A cannot rewrite an entry learned from client B', async () => {
    const entry = await db.firmMapping.findFirstOrThrow({ where: { orgId: admin.orgId, code: codes[0] ?? '' }, select: { id: true } });
    const edit = await editMapping(acct, entry.id, codes[1] ?? '');
    const remove = await removeMapping(acct, entry.id);
    assert.equal(edit.ok, false, 'scoped accountant rewrote a client-B dictionary entry');
    assert.equal(remove.ok, false, 'scoped accountant deleted a client-B dictionary entry');
  });

  // -------------------------------------------------------------------- views

  it('saved views: viewers cannot save; nobody touches another user\'s view', async () => {
    assert.equal(await saveView(viewer, 'viewer view', VIEW, false), false);
    assert.equal(await saveView(admin, `admin view ${tag}`, VIEW, false), true);
    const mine = (await listViews(admin)).find((v) => v.name === `admin view ${tag}`);
    assert.ok(mine);
    const id = mine?.id ?? '';
    assert.equal((await listViews(acct)).some((v) => v.id === id), false);
    assert.equal(await removeView(acct, id), false);
    assert.equal(await removeView(other, id), false);
    await setDefaultView(acct, id);
    await setDefaultView(other, id);
    assert.equal((await db.savedView.findUniqueOrThrow({ where: { id } })).isDefault, false);
    assert.equal(await removeView(viewer, id), false);
  });

  // -------------------------------------------------------------- share links

  it('share links: create/list/revoke refused for client B and another org; resolve honours revoke and expiry', async () => {
    assert.equal(await createShareLink(acct, catB, { days: 7, includePdf: true }), null);
    assert.equal(await createShareLink(other, catA, { days: 7, includePdf: true }), null);
    const made = await createShareLink(admin, catB, { days: 7, includePdf: true });
    assert.ok(made);
    const token = made?.url.split('/r/')[1] ?? '';
    const resolved = await resolveShare(token);
    assert.equal(resolved?.orgId, admin.orgId);
    assert.equal(resolved?.catalogId, catB);
    const link = await db.shareLink.findFirstOrThrow({ where: { catalogId: catB }, select: { id: true } });

    assert.deepEqual(await listShareLinks(acct, catB), []);
    assert.deepEqual(await listShareLinks(other, catB), []);
    assert.equal(await revokeShareLink(acct, link.id), false);
    assert.equal(await revokeShareLink(other, link.id), false);
    assert.notEqual(await resolveShare(token), null);

    assert.equal(await revokeShareLink(admin, link.id), true);
    assert.equal(await resolveShare(token), null);
    assert.equal(await resolveShare('not-a-token'), null);

    const second = await createShareLink(admin, catA, { days: 7, includePdf: false });
    const secondToken = second?.url.split('/r/')[1] ?? '';
    await db.shareLink.updateMany({ where: { catalogId: catA }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await resolveShare(secondToken), null);
  });

  it('share links: a viewer cannot create one', async () => {
    assert.equal(await createShareLink(viewer, catA, { days: 30, includePdf: true }), null);
  });

  it('share links: a viewer cannot revoke one', async () => {
    const made = await createShareLink(admin, catA, { days: 7, includePdf: false });
    const id = (await db.shareLink.findFirstOrThrow({ where: { catalogId: catA, revokedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true } })).id;
    assert.ok(made);
    assert.equal(await revokeShareLink(viewer, id), false);
  });

  // ------------------------------------------------------- export data loaders

  it('export, PDF and progress loaders: nothing for client B or another org', async () => {
    assert.equal(await resolveCatalog(admin.orgId, catB, null, acct.clientIds), null);
    assert.equal(await resolveCatalog(other.orgId, catA, null, null), null);
    assert.notEqual(await resolveCatalog(admin.orgId, catA, null, acct.clientIds), null);
    assert.equal(await reportPdfData(other.orgId, catA), null);
    assert.equal(await uploadProgress(acct, catB), null);
    assert.equal(await uploadProgress(other, catA), null);
    assert.notEqual(await uploadProgress(acct, catA), null);
  });

  // ---------------------------------------------------------- catalogue delete

  it('catalogue delete and upload discard: refused for client B and another org', async () => {
    assert.equal((await deleteCatalog(acct, catB)).ok, false);
    assert.equal((await deleteCatalog(other, catA)).ok, false);
    assert.equal(await db.catalog.count({ where: { id: { in: [catA, catB] } } }), 2);

    const open = await makeClientCatalog(admin.orgId, clientB, [row(90, 'B')], { status: 'uploaded' });
    assert.equal(await uploadPreview(acct, open.catalogId), null);
    assert.equal(await discardUpload({ ...acct }, open.catalogId), false);
    assert.equal(await discardUpload({ ...other }, open.catalogId), false);
    assert.equal(await db.catalog.count({ where: { id: open.catalogId } }), 1);
  });

  it('catalogue delete: a viewer cannot delete a catalogue', async () => {
    const spare = await makeClientCatalog(admin.orgId, clientA, [row(91, 'A')], { createdAt: new Date(2000, 0, 1) });
    const result = await deleteCatalog(viewer, spare.catalogId);
    assert.equal(result.ok, false);
  });

  it('upload discard: a viewer cannot discard someone\'s upload', async () => {
    const open = await makeClientCatalog(admin.orgId, clientA, [row(92, 'A')], { status: 'uploaded' });
    assert.equal(await discardUpload({ ...viewer }, open.catalogId), false);
  });

  // ----------------------------------------------------------- client lifecycle

  it('client lifecycle: non-admins are refused, another org gets not found, nothing changes', async () => {
    const asRole = (w: Who) => ({ orgId: w.orgId, userId: w.userId, role: w.role });
    for (const actor of [asRole(acct), asRole(viewer)]) {
      assert.deepEqual(await renameClient(actor, clientA, 'renamed'), { ok: false, error: 'forbidden' });
      assert.equal((await archiveClient(actor, clientA)).ok, false);
      assert.equal((await restoreClient(actor, clientA)).ok, false);
      assert.equal((await deleteClient(actor, clientA, `authz-client-A-${tag}`)).ok, false);
      assert.equal((await setClientAccountants(actor, clientA, [])).ok, false);
    }
    const foreign = asRole(other);
    assert.deepEqual(await renameClient(foreign, clientA, 'renamed'), { ok: false, error: 'not found' });
    assert.equal((await archiveClient(foreign, clientA)).ok, false);
    assert.equal((await deleteClient(foreign, clientA, `authz-client-A-${tag}`)).ok, false);
    assert.equal((await setClientAccountants(foreign, clientA, [])).ok, false);
    const a = await db.client.findUniqueOrThrow({ where: { id: clientA }, select: { name: true, archivedAt: true } });
    assert.equal(a.name, `authz-client-A-${tag}`);
    assert.equal(a.archivedAt, null);

    assert.equal((await createClient({ ...viewer, role: 'viewer' }, 'viewer client')).ok, false);
    assert.equal(await switchableClient(acct, clientB), null);
    assert.equal(await switchableClient(other, clientA), null);
  });

  it('client lifecycle: no change may silently widen a scoped member to every client', async () => {
    // Deleting viewerD's only client would leave them with no assignments = every client.
    const del = await deleteClient({ ...admin }, clientD, `authz-client-D-${tag}`);
    assert.equal(del.ok, false);
    assert.equal(await db.client.count({ where: { id: clientD } }), 1);
    assert.equal(await db.clientAssignment.count({ where: { userId: viewerD.userId, clientId: clientD } }), 1);
    // Unassigning acct from their only client would do the same.
    const unassign = await setClientAccountants({ ...admin }, clientA, []);
    assert.deepEqual(unassign, { ok: false, error: 'last' });
    assert.equal(await db.clientAssignment.count({ where: { userId: acct.userId, clientId: clientA } }), 1);
  });

  // ---------------------------------------------------------------- purchases

  it('purchase lists: store/apply/delete/activity refused for client B and another org', async () => {
    const parsed = await parseUpload(Buffer.from(`Tovar,MXIK\nGuruch,${codes[0]}\n`), 'kirim.csv');
    const sB = await storePurchaseList(acct, { clientId: clientB, filename: 'b.csv', parsed });
    assert.equal(sB.ok, false);
    const sO = await storePurchaseList(other, { clientId: clientA, filename: 'a.csv', parsed });
    assert.equal(sO.ok, false);
    const mine = await storePurchaseList(admin, { clientId: clientB, filename: 'admin-b.csv', parsed });
    assert.ok(mine.ok);
    const listB = mine.ok ? mine.listId : '';
    const map = { name: 0, mxik: 1, unit: -1 };
    assert.equal((await applyPurchaseMap(acct, listB, map)).ok, false);
    assert.equal((await applyPurchaseMap(other, listB, map)).ok, false);
    assert.equal(await deletePurchaseList(acct, listB), false);
    assert.equal(await deletePurchaseList(other, listB), false);
    assert.equal(await db.purchaseList.count({ where: { id: listB, status: 'uploaded' } }), 1);
    assert.equal(await setClientActivity(acct, clientB, 'savdo'), false);
    assert.equal(await setClientActivity(other, clientA, 'savdo'), false);
    assert.equal(await db.purchaseList.count({ where: { orgId: admin.orgId, clientId: clientB } }), 1);
  });

  it('purchase lists: a viewer cannot upload one', async () => {
    const parsed = await parseUpload(Buffer.from(`Tovar,MXIK\nGuruch,${codes[0]}\n`), 'kirim.csv');
    assert.equal((await storePurchaseList(viewer, { clientId: clientA, filename: 'viewer.csv', parsed })).ok, false);
  });

  it('purchase lists: a viewer cannot delete one', async () => {
    const parsed = await parseUpload(Buffer.from(`Tovar,MXIK\nGuruch,${codes[0]}\n`), 'kirim.csv');
    const made = await storePurchaseList(admin, { clientId: clientA, filename: 'admin-a.csv', parsed });
    assert.equal(await deletePurchaseList(viewer, made.ok ? made.listId : ''), false);
  });

  it('client activity: a viewer cannot change it', async () => {
    assert.equal(await setClientActivity(viewer, clientA, 'ishlab_chiqarish'), false);
  });

  // --------------------------------------------------------------------- docs

  it('cheque/sales lists: store/apply/restart/delete refused for client B and another org', async () => {
    const parsed = await parseUpload(Buffer.from(`Tovar,MXIK\nGuruch,${codes[0]}\n`), 'cheklar.csv');
    assert.equal(await storeDocList(acct, { clientId: clientB, kind: 'cheques', filename: 'b.csv', parsed }), null);
    assert.equal(await storeDocList(other, { clientId: clientA, kind: 'cheques', filename: 'a.csv', parsed }), null);
    const mine = await storeDocList(admin, { clientId: clientB, kind: 'cheques', filename: 'admin-b.csv', parsed });
    assert.ok(mine);
    const listB = mine?.listId ?? '';
    const map = { name: 0, mxik: 1, unit: -1, quantity: -1, amount: -1, date: -1 };
    assert.equal(await applyDocMap(acct, listB, map), false);
    assert.equal(await applyDocMap(other, listB, map), false);
    assert.equal(await restartDocCheck(acct, listB), false);
    assert.equal(await deleteDocList(acct, listB), false);
    assert.equal(await deleteDocList(other, listB), false);
    assert.equal(await db.docList.count({ where: { id: listB, status: 'uploaded' } }), 1);
  });

  it('cheque/sales lists: a viewer cannot upload one', async () => {
    const parsed = await parseUpload(Buffer.from(`Tovar,MXIK\nGuruch,${codes[0]}\n`), 'cheklar.csv');
    assert.equal(await storeDocList(viewer, { clientId: clientA, kind: 'sales', filename: 'viewer.csv', parsed }), null);
  });

  it('cheque/sales lists: a viewer cannot delete one', async () => {
    const parsed = await parseUpload(Buffer.from(`Tovar,MXIK\nGuruch,${codes[0]}\n`), 'cheklar.csv');
    const made = await storeDocList(admin, { clientId: clientA, kind: 'sales', filename: 'admin-a.csv', parsed });
    assert.equal(await deleteDocList(viewer, made?.listId ?? ''), false);
  });

  // ---------------------------------------------------------------- reminders

  it('reminders: schedule and mark-done refused for client B and another org; assignee must see the client', async () => {
    const input = { dayOfMonth: 5, assigneeId: null, enabled: true };
    assert.deepEqual(await setSchedule(acct, clientB, input), { ok: false, error: 'not found' });
    assert.deepEqual(await setSchedule(other, clientA, input), { ok: false, error: 'not found' });
    assert.deepEqual(await setSchedule(admin, clientB, { ...input, assigneeId: acct.userId }), { ok: false, error: 'assignee scope' });
    assert.deepEqual(await setSchedule(admin, clientB, { ...input, assigneeId: viewer.userId }), { ok: false, error: 'bad assignee' });
    assert.deepEqual(await setSchedule(admin, clientB, { ...input, assigneeId: other.userId }), { ok: false, error: 'bad assignee' });
    const task = await db.reminderTask.create({ data: { orgId: admin.orgId, clientId: clientB, period: '2099-01', dueOn: new Date(Date.UTC(2099, 0, 5)) } });
    assert.equal((await markDone(acct, task.id)).ok, false);
    assert.equal((await markDone(other, task.id)).ok, false);
    assert.equal((await db.reminderTask.findUniqueOrThrow({ where: { id: task.id } })).doneAt, null);
  });

  it('reminders: a viewer cannot mark a monthly check done', async () => {
    const task = await db.reminderTask.create({ data: { orgId: admin.orgId, clientId: clientA, period: '2099-02', dueOn: new Date(Date.UTC(2099, 1, 5)) } });
    assert.equal((await markDone(viewer, task.id)).ok, false);
  });

  it('reminders: a viewer cannot change a schedule', async () => {
    assert.equal((await setSchedule(viewer, clientA, { dayOfMonth: 9, assigneeId: null, enabled: false })).ok, false);
  });

  // ------------------------------------------------------------- team members

  it('team members and invites: another org\'s ids are not found and nothing changes', async () => {
    assert.deepEqual(await changeMember(other, { userId: acct.userId, role: 'admin', access: 'all', clientIds: [] }), { ok: false, reason: 'not_found' });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: acct.userId } })).role, 'accountant');
    assert.deepEqual(await removeTeamMember(other, viewer.userId), { ok: false, reason: 'not_found' });
    assert.equal(await db.user.count({ where: { id: viewer.userId } }), 1);
    const invite = await db.invite.create({
      data: { orgId: admin.orgId, tokenHash: randomBytes(16).toString('hex'), email: null, role: 'viewer', clientIds: [], createdBy: admin.userId, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    assert.deepEqual(await revokeTeamInvite(other, invite.id), { ok: false, reason: 'not_found' });
    assert.equal(await db.invite.count({ where: { id: invite.id } }), 1);
    // Another org's client can never be attached to a member or an invite.
    assert.deepEqual(await ownedClientIds(admin.orgId, [clientC]), []);
    const scoped = await changeMember(admin, { userId: viewer.userId, role: 'viewer', access: 'selected', clientIds: [clientC] });
    assert.deepEqual(scoped, { ok: false, reason: 'no_clients' });
  });

  it('team members: a non-admin cannot change a member', async () => {
    const target = await makePerson(admin.orgId, 'viewer');
    const result = await changeMember(viewer, { userId: target.userId, role: 'accountant', access: 'all', clientIds: [] });
    assert.equal(result.ok, false);
  });

  // ----------------------------------------------------------------- API keys

  it('API keys: another org cannot revoke a key; a revoked key stops authenticating', async () => {
    const created = await createApiKey(admin, `authz-${tag}`);
    assert.ok(created);
    const token = created?.token ?? '';
    const key = await db.apiKey.findFirstOrThrow({ where: { orgId: admin.orgId, name: `authz-${tag}` }, select: { id: true } });
    assert.equal(await revokeApiKey(other, key.id), false);
    assert.equal((await authenticate(`Bearer ${token}`))?.orgId, admin.orgId);
    assert.equal(await authenticate('Bearer mxk_not-a-real-key'), null);
    assert.equal(await authenticate(null), null);
    assert.equal(await revokeApiKey(admin, key.id), true);
    assert.equal(await authenticate(`Bearer ${token}`), null);
  });

  it('API keys: a non-admin cannot create one', async () => {
    // Compared as a boolean so a created token never reaches the test output.
    assert.equal((await createApiKey(viewer, 'viewer key')) === null, true, 'a viewer created an API key');
  });

  // Removing a member revokes the keys they made ("a key outliving its
  // creator would keep their access"), and so does demoting them; otherwise a demoted admin keeps an
  // org-wide key: every client's catalogues and findings, and uploads into any client.
  it('API keys: demoting the admin who made a key revokes it', async () => {
    const created = await createApiKey(admin2, `authz-demote-${tag}`);
    assert.ok(created);
    const demoted = await changeMember(admin, { userId: admin2.userId, role: 'viewer', access: 'all', clientIds: [] });
    assert.equal(demoted.ok, true);
    const caller = await authenticate(`Bearer ${created?.token ?? ''}`);
    assert.equal(caller === null, true, 'the key of a member demoted to viewer still authenticates with org-wide access');
  });

  // --------------------------------------------------------- Telegram linking

  it('Telegram: another org cannot unlink a chat; a demo org can never link one', async () => {
    const chatId = `-100${Date.now()}${randomBytes(2).readUInt16BE(0)}`;
    const { code } = await createLinkCode(admin);
    assert.equal((await consumeLinkCode(code, chatId, null)).ok, true);
    const link = await db.telegramLink.findUniqueOrThrow({ where: { chatId }, select: { id: true } });
    assert.equal(await unlink(other, link.id), false);
    assert.notEqual(await linkForChat(chatId), null);
    assert.equal(await unlink(admin, link.id), true);
    assert.equal(await linkForChat(chatId), null);

    const demo = await makeOrg('demo', new Date(Date.now() + 3_600_000));
    orgs.push(demo.orgId);
    assert.equal(await isDemoOrg(demo.orgId), true);
    const demoCode = await createLinkCode(demo);
    assert.deepEqual(await consumeLinkCode(demoCode.code, `${chatId}9`, null), { ok: false, reason: 'demo' });
    // No payment can start for a demo org either.
    const plan = { id: 'catalog_500', price: 700_000, kind: 'catalog' as const, maxRows: 500 };
    const config = billingConfig({ CLICK_SERVICE_ID: 's', CLICK_MERCHANT_ID: 'm', CLICK_SECRET_KEY: 'k' });
    assert.equal(purchaseOf({ plan, config, admin: true, demo: false }).kind, 'available');
    assert.equal(purchaseOf({ plan, config, admin: true, demo: true }).kind, 'demo');
  });

  // A chat linked by an admin would keep receiving every client's notifications
  // and uploading into any client after that admin is demoted, so demotion unlinks it.
  it('Telegram: demoting the admin who linked a chat unlinks it', async () => {
    const chatId = `-200${Date.now()}${randomBytes(2).readUInt16BE(0)}`;
    const { code } = await createLinkCode(admin3);
    assert.equal((await consumeLinkCode(code, chatId, null)).ok, true);
    const demoted = await changeMember(admin, { userId: admin3.userId, role: 'accountant', access: 'selected', clientIds: [clientA] });
    assert.equal(demoted.ok, true);
    assert.equal((await linkForChat(chatId)) === null, true, 'the chat linked by a now-scoped accountant is still linked to the whole org');
  });

  // ------------------------------------------------------------ notifications

  it('notifications: client B and other-org notices are invisible and cannot be marked read', async () => {
    const mk = (orgId: string, clientId: string | null, title: string) =>
      db.notification.create({ data: { orgId, clientId, kind: 'test', title, body: 'x' }, select: { id: true } });
    const orgWide = await mk(admin.orgId, null, `org ${tag}`);
    const onA = await mk(admin.orgId, clientA, `A ${tag}`);
    const onB = await mk(admin.orgId, clientB, `B ${tag}`);
    const foreign = await mk(other.orgId, clientC, `C ${tag}`);
    const seen = new Set((await listNotifications(acct, { pageSize: 50 })).items.map((n) => n.id));
    assert.ok(seen.has(orgWide.id));
    assert.ok(seen.has(onA.id));
    assert.equal(seen.has(onB.id), false);
    assert.equal(seen.has(foreign.id), false);
    assert.equal(await markRead(acct, [onB.id, foreign.id]), 0);
    assert.equal(await markRead(other, [orgWide.id, onA.id]), 0);
    assert.equal(await db.notificationRead.count({ where: { notificationId: { in: [onB.id, foreign.id, orgWide.id, onA.id] } } }), 0);
    const before = await unreadCount(acct);
    assert.equal(await markRead(acct, [onA.id]), 1);
    assert.equal(await unreadCount(acct), before - 1);
  });

  // ------------------------------------------------------------------- search

  it('search: the scoped accountant finds only client A; another org finds nothing', async () => {
    const mine = await search(acct, `authz`, 'uz');
    assert.ok(mine.clients.length > 0);
    assert.ok(mine.clients.every((c) => c.id !== clientB && c.id !== clientC));
    assert.ok(mine.catalogs.every((c) => c.id !== catB && c.id !== catC));
    const products = await search(acct, `authzB${tag}`, 'uz');
    assert.deepEqual(products.products, []);
    assert.deepEqual(products.catalogs, []);
    const ownProducts = await search(acct, `authzA${tag}`, 'uz');
    assert.ok(ownProducts.products.length > 0);
    assert.ok(ownProducts.products.every((p) => p.href.includes(catA)));
    const foreign = await search(other, `authz-client-A-${tag}`, 'uz');
    assert.deepEqual(foreign.clients, []);
    const foreignProducts = await search(other, `authzB${tag}`, 'uz');
    assert.deepEqual(foreignProducts.products, []);
  });

  // -------------------------------------------------------------------- queue

  it('queue: the scoped accountant sees only client A, whatever the client or accountant filter', async () => {
    const all = await queuePage(acct, readQueueFilter({}), null);
    assert.ok(all.rows.length > 0);
    assert.ok(all.rows.every((r) => r.clientId === clientA));
    assert.ok(all.byClient.every((c) => c.clientId === clientA));
    const asB = await queuePage(acct, readQueueFilter({ client: clientB }), null);
    assert.deepEqual(asB.rows, []);
    const viaPeer = await queuePage(acct, readQueueFilter({ accountant: acctB.userId }), null);
    assert.ok(viaPeer.rows.every((r) => r.clientId === clientA));
    const foreign = await queuePage(other, readQueueFilter({ client: clientA }), null);
    assert.deepEqual(foreign.rows, []);
    assert.ok((await queuePage(other, readQueueFilter({}), null)).rows.every((r) => r.clientId === clientC));
  });

  // ---------------------------------------------------------------- dashboard

  it('dashboard: scoped to the user; the accountant filter and workload are admin-only', async () => {
    const mine = await dashboard(acct, null);
    assert.ok(mine.clients.every((c) => c.id === clientA));
    const peer = await dashboard(acct, acctB.userId);
    assert.ok(peer.clients.every((c) => c.id === clientA));
    assert.equal(peer.workload, null);
    assert.deepEqual(peer.accountants, []);
    const foreign = await dashboard(other, null);
    assert.ok(foreign.clients.every((c) => c.id === clientC));
  });

  // ----------------------------------------------------------------- activity

  it('activity log: no client B events for the scoped accountant, no org A events for another org', async () => {
    const filter = { clientId: null, userId: null, category: 'all' as const, from: null, to: null, page: 0 };
    const mine = await activityPage(acct, filter, { pageSize: 200 });
    assert.ok(mine.rows.length > 0);
    assert.ok(mine.rows.every((r) => r.clientId !== clientB && r.catalogId !== catB));
    const asB = await activityPage(acct, { ...filter, clientId: clientB }, { pageSize: 200 });
    assert.deepEqual(asB.rows, []);
    const foreign = await activityPage({ ...other }, filter, { pageSize: 200 });
    assert.ok(foreign.rows.every((r) => r.catalogId !== catA && r.catalogId !== catB && r.clientId !== clientA && r.clientId !== clientB));
    const viewerRows = await activityPage(viewer, filter, { pageSize: 200 });
    // Org-level events (team, API keys, billing) are admin-only unless the viewer did them.
    assert.ok(viewerRows.rows.every((r) => r.actorId === viewer.userId || (!r.action.startsWith('apikey.') && !r.action.startsWith('team.'))));
  });
});
