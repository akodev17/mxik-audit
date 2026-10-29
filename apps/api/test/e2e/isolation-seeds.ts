// Seeds for the isolation matrix: one of every org-owned resource the registry's operations name by
// id, per client (ClientSeed) and per org (OrgSeed), written straight to the database on orgs that
// dropOrgs removes. `marks` are the strings (names, file names, e-mails) an answer must never show
// to someone outside the resource's reach. snapshot() fingerprints an org's data, to prove that a
// refused request changed nothing. Import ../setup-env first.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { identifyingBarcode } from '@tasnivo/core/normalize/index';
import { db } from '@tasnivo/db';
import { makeClient, makeClientCatalog } from '@tasnivo/domain/firm-test-fixtures';
import { seedBankBatch, seedInvoiceBatch, seedProductBatch } from '@tasnivo/domain/onec/fixtures/seed';
import { createRecord } from '@tasnivo/domain/security/session-store';
import { liveCodes } from '@tasnivo/domain/test-fixtures';

const tag = (): string => randomBytes(4).toString('hex');
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

export type ClientSeed = {
  clientId: string; catalogId: string; uploadCatalogId: string; failedCatalogId: string; previousCatalogId: string;
  findingId: string; barcodeFindingId: string; flagEventId: string; decisionEventId: string; shareLinkId: string;
  purchaseListId: string; docListId: string; failedDocListId: string; reminderTaskId: string;
  bankBatchId: string; bankRecordId: string; bankRuleId: string; exportId: string;
  didoxBatchId: string; didoxRecordId: string; productId: string; productBatchId: string; productRecordId: string;
  marks: string[];
};

export type OrgSeed = {
  viewId: string; entryId: string; memberId: string; inviteId: string; apiKeyId: string; telegramLinkId: string;
  sessionId: string; bankFormatId: string; orgRuleId: string; notificationId: string; orderId: string;
  marks: string[];
};

let classifier: Promise<{ code: string; barcode: string }> | null = null;
/** A live code, and a barcode that names exactly one classifier product (barcode-name.ts offers its name). */
export function classifierSample(): Promise<{ code: string; barcode: string }> {
  classifier ??= (async () => {
    const [code] = await liveCodes(1);
    const rows = await db.$queryRaw<{ barcode: string }[]>`
      SELECT barcode FROM mxik_code WHERE barcode IS NOT NULL AND "retiredAt" IS NULL AND length(trim("nameUz")) > 0
      GROUP BY barcode HAVING count(*) = 1 LIMIT 50`;
    return { code: code ?? '', barcode: rows.map((r) => r.barcode).find((b) => identifyingBarcode(b) !== null) ?? '' };
  })();
  return classifier;
}

const firstRecord = async (batchId: string): Promise<string> =>
  (await db.importRecord.findFirstOrThrow({ where: { batchId }, orderBy: { rowIndex: 'asc' }, select: { id: true } })).id;

/** A client with a ready catalogue and one of every client-bound resource. */
export async function seedClient(orgId: string, createdBy: string, label: string): Promise<ClientSeed> {
  const t = tag();
  const name = `${label} mijoz ${t}`;
  const clientId = await makeClient(orgId, name);
  const filename = `${label}-katalog-${t}.xlsx`;
  const rowName = `${label} mahsulot ${t}`;
  const { code, barcode } = await classifierSample();
  // Row 0 carries a suggestion, row 1 a decision, row 2 only a barcode (a name to offer).
  const rows = [
    { name: rowName, findings: [{ severity: 'high' as const }] }, { name: `${rowName} 2`, findings: [{ severity: 'medium' as const }] },
    { name: '12', findings: [{ severity: 'high' as const }] },
  ];
  // An earlier version (for the diff), the current one, an upload still in preview, and a failed audit (for retry).
  const previous = await makeClientCatalog(orgId, clientId, rows, { filename, createdAt: new Date(Date.now() - 86_400_000) });
  const { catalogId, findingIds } = await makeClientCatalog(orgId, clientId, rows, { filename, previousId: previous.catalogId });
  const upload = await makeClientCatalog(orgId, clientId, rows, { filename, status: 'uploaded' });
  const failed = await makeClientCatalog(orgId, clientId, rows, { filename });
  await db.catalog.update({ where: { id: failed.catalogId }, data: { status: 'failed', auditError: 'test' } });
  const findingId = findingIds[0]?.[0] ?? '';
  const decidedId = findingIds[1]?.[0] ?? '';
  const barcodeFindingId = findingIds[2]?.[0] ?? '';
  await db.finding.update({ where: { id: findingId }, data: { suggestedMxik: code, confidence: 0.6 } });
  await db.catalogItem.updateMany({ where: { catalogId, rowIndex: 2 }, data: { barcode } });
  // A bulk flag event (bulk.ts flagMany) the undo can put back, and a decision the undo can take back.
  const flagEventId = randomUUID();
  await db.finding.update({ where: { id: findingId }, data: { flag: 'ask_client' } });
  await db.auditEvent.create({
    data: { id: flagEventId, orgId, actorId: createdBy, action: 'finding.flagged', targetId: catalogId, payload: { flag: 'ask_client', findings: [{ id: findingId, previous: null }] } },
  });
  const decisionEventId = randomUUID();
  await db.auditEvent.create({ data: { id: decisionEventId, orgId, actorId: createdBy, action: 'finding.rejected', targetId: decidedId, payload: { catalogId, findingId: decidedId } } });
  await db.finding.update({ where: { id: decidedId }, data: { decision: 'rejected', decidedBy: createdBy, decidedAt: new Date(), decisionEventId } });
  const comment = `${label} izoh ${t}`;
  await db.findingComment.create({ data: { orgId, findingId, userId: createdBy, body: comment } });
  await db.reviewAssignment.create({ data: { orgId, clientId, catalogId, assigneeId: createdBy, createdBy, note: `${label} tekshiruv ${t}` } });
  const share = await db.shareLink.create({ data: { orgId, catalogId, tokenHash: sha(randomUUID()), createdBy, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
  const map = { name: 0, barcode: -1, mxik: 1, unit: -1, price: -1, sales: -1, tnved: -1 };
  const purchases = await db.purchaseList.create({
    data: { orgId, clientId, filename: `${label}-xarid-${t}.xlsx`, rowCount: 1, status: 'ready', headers: ['Nomi', 'MXIK'], columnMap: map },
  });
  await db.purchaseItem.create({ data: { listId: purchases.id, rowIndex: 0, name: rowName, mxik: null, attrs: {} } });
  const docs = await db.docList.create({
    data: { orgId, clientId, kind: 'sales', filename: `${label}-sotuv-${t}.xlsx`, rowCount: 1, headers: ['Nomi'], columnMap: { name: 0 }, status: 'uploaded', progressDone: 0, progressTotal: 0 },
  });
  await db.docItem.create({ data: { listId: docs.id, rowIndex: 0, name: rowName, attrs: {} } });
  const failedDocs = await db.docList.create({
    data: { orgId, clientId, kind: 'sales', filename: `${label}-sotuv-${t}.xlsx`, rowCount: 1, headers: ['Nomi'], columnMap: { name: 0, mxik: 0, unit: -1, quantity: -1, amount: -1, date: -1 }, status: 'failed', progressDone: 0, progressTotal: 0 },
  });
  await db.counterparty.create({ data: { orgId, clientId, name: `${label} kontragent ${t}`, normalizedName: `${label} kontragent ${t}`.toLowerCase(), inn: '301234567', source: 'manual' } });
  const task = await db.reminderTask.create({ data: { orgId, clientId, period: '2026-10', dueOn: new Date('2026-10-28') } });

  const seed = { orgId, clientId, createdBy, filename: `${label}-bank-${t}.txt` };
  const bankBatchId = await seedBankBatch(seed);
  const exportRow = await db.oneCExport.create({
    data: { batchId: bankBatchId, format: 'bank_exchange_1_02', filename: `${label}-1c-${t}.txt`, recordCount: 1, file: Buffer.from('1CClientBankExchange'), contentType: 'text/plain', createdBy },
  });
  const rule = await db.bankRule.create({ data: { orgId, clientId, kind: 'purpose_contains', value: `${label}-qoida-${t}`, operation: 'other_out', createdBy } });
  const didoxBatchId = await seedInvoiceBatch({ orgId, clientId, createdBy, filename: `${label}-didox-${t}.xlsx` });
  await db.didoxDocument.create({ data: { orgId, didoxId: `doc-${t}-${label}`, source: 'upload', json: {}, pdf: Buffer.from('%PDF-1.4\n%%EOF\n'), batchId: didoxBatchId } });
  const product = await db.product.create({
    data: { orgId, clientId, name: `${label} tovar ${t}`, normalizedName: `${label} tovar ${t}`.toLowerCase(), source: 'manual', createdBy },
  });
  const productBatchId = await seedProductBatch({ orgId, clientId, createdBy, filename: `${label}-tovarlar-${t}.xlsx` });
  return {
    clientId, catalogId, uploadCatalogId: upload.catalogId, failedCatalogId: failed.catalogId, previousCatalogId: previous.catalogId,
    findingId, barcodeFindingId, flagEventId, decisionEventId, shareLinkId: share.id, purchaseListId: purchases.id, docListId: docs.id,
    failedDocListId: failedDocs.id, reminderTaskId: task.id,
    bankBatchId, bankRecordId: await firstRecord(bankBatchId), bankRuleId: rule.id, exportId: exportRow.id,
    didoxBatchId, didoxRecordId: await firstRecord(didoxBatchId), productId: product.id, productBatchId, productRecordId: await firstRecord(productBatchId),
    marks: [name, filename, rowName, comment, `${label} tekshiruv ${t}`, `${label} kontragent ${t}`, `${label}-xarid-${t}`, `${label}-sotuv-${t}`, `${label}-bank-${t}`, `${label}-1c-${t}`, `${label}-qoida-${t}`, `${label}-didox-${t}`, `${label} tovar ${t}`, `${label}-tovarlar-${t}`],
  };
}

/** One of every org-level resource; `owner` is the admin whose session and view they are. */
export async function seedOrg(orgId: string, owner: { userId: string }, label: string): Promise<OrgSeed> {
  const t = tag();
  const params = { type: null, q: '', pending: false, comments: false, sort: 'risk', density: 'comfortable', grouped: false };
  const view = await db.savedView.create({ data: { orgId, userId: owner.userId, name: `${label} koʻrinish ${t}`, params } });
  const [code] = await liveCodes(1);
  const entry = await db.firmMapping.create({ data: { orgId, kind: 'name', key: `${label} lugʻat ${t}`, label: `${label} lugʻat ${t}`, code: code ?? '', confirmations: 1, createdBy: owner.userId } });
  const memberEmail = `test-${label.toLowerCase()}-a-${t}@test.local`;
  const member = await db.user.create({ data: { orgId, email: memberEmail, passwordHash: 'x', role: 'accountant', emailVerifiedAt: new Date() } });
  const inviteEmail = `test-${label.toLowerCase()}-i-${t}@test.local`;
  const invite = await db.invite.create({ data: { orgId, tokenHash: sha(randomUUID()), email: inviteEmail, role: 'viewer', clientIds: [], createdBy: owner.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
  const key = await db.apiKey.create({ data: { orgId, name: `${label} kalit ${t}`, prefix: `mxk_${t}`.slice(0, 10), tokenHash: sha(randomUUID()), createdBy: owner.userId } });
  const link = await db.telegramLink.create({ data: { orgId, chatId: `-100${Date.now()}${Math.floor(Math.random() * 1000)}`, username: `${label}_tg_${t}`, linkedBy: owner.userId } });
  const sessionId = await createRecord(owner.userId, orgId, `${label}-browser-${t}`);
  const format = await db.bankFormat.create({ data: { orgId, name: `${label} format ${t}`, headerSignature: `${label}-${t}`, columnMap: {}, conventions: {}, createdBy: owner.userId } });
  const orgRule = await db.bankRule.create({ data: { orgId, clientId: null, kind: 'purpose_contains', value: `${label}-umumiy-${t}`, operation: 'other_out', createdBy: owner.userId } });
  const note = await db.notification.create({ data: { orgId, kind: 'catalog.ready', title: `${label} xabar ${t}`, body: `${label} xabar matni ${t}` } });
  const order = await db.order.create({ data: { orgId, orgName: `${label} MChJ ${t}`, planId: 'firm_monthly', amount: 1_800_000, provider: 'click', status: 'paid', paidAt: new Date() } });
  return {
    viewId: view.id, entryId: entry.id, memberId: member.id, inviteId: invite.id, apiKeyId: key.id, telegramLinkId: link.id, sessionId,
    bankFormatId: format.id, orgRuleId: orgRule.id, notificationId: note.id, orderId: order.id,
    marks: [view.name, entry.label, memberEmail, inviteEmail, key.name, `${label}_tg_${t}`, format.name, `${label}-umumiy-${t}`, note.title, `${label} MChJ ${t}`],
  };
}

/** Every id of a seed: none of them may appear in an answer to someone who cannot open it. */
export const seedIds = (seed: ClientSeed | OrgSeed): string[] =>
  Object.entries(seed).flatMap(([k, v]) => (k !== 'marks' && typeof v === 'string' ? [v] : []));

/**
 * One hash of everything an org owns that a request could change (sessions only by their end, since
 * reading them moves lastSeenAt). Equal before and after a refused request = it changed nothing.
 */
export async function snapshot(orgId: string): Promise<string> {
  const rows = await db.$queryRaw<{ h: string }[]>`
    SELECT md5(concat_ws('|',
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM client t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM catalog t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(f::text, ',' ORDER BY f.id) FROM finding f JOIN catalog_item i ON i.id = f."itemId" JOIN catalog c ON c.id = i."catalogId" WHERE c."orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM finding_comment t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM share_link t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM saved_view t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM firm_mapping t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM suggestion_feedback t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(concat_ws(':', u.id, u.role, u."orgId", u.email), ',' ORDER BY u.id) FROM "user" u WHERE "orgId" = ${orgId}),
      (SELECT string_agg(concat_ws(':', a."userId", a."clientId"), ',' ORDER BY a."userId", a."clientId") FROM client_assignment a JOIN "user" u ON u.id = a."userId" WHERE u."orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM invite t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(concat_ws(':', t.id, t."revokedAt"), ',' ORDER BY t.id) FROM api_key t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM telegram_link t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(concat_ws(':', t.id, t."revokedAt"), ',' ORDER BY t.id) FROM user_session t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM import_batch t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(r::text, ',' ORDER BY r.id) FROM import_record r JOIN import_batch b ON b.id = r."batchId" WHERE b."orgId" = ${orgId}),
      (SELECT string_agg(concat_ws(':', e.id, e."recordCount"), ',' ORDER BY e.id) FROM onec_export e JOIN import_batch b ON b.id = e."batchId" WHERE b."orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM bank_rule t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM bank_format t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM product t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM purchase_list t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM doc_list t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM reminder_task t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t."clientId") FROM client_schedule t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM review_assignment t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM notification t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(concat_ws(':', r."userId", r."notificationId"), ',' ORDER BY r."userId", r."notificationId") FROM notification_read r JOIN notification n ON n.id = r."notificationId" WHERE n."orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM organization t WHERE id = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM "order" t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM counterparty t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM didox_connection t WHERE "orgId" = ${orgId}),
      (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM onec_connection t WHERE "orgId" = ${orgId}),
      (SELECT count(*)::text FROM audit_event WHERE "orgId" = ${orgId})
    )) AS h`;
  return rows[0]?.h ?? '';
}
