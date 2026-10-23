// The ids of one org's records (the seed user's by default), for the tenant-isolation probe.
import { db } from '@tasnivo/db';
const email = process.argv[2] ?? 'buxgalter@demo.uz';
const u = await db.user.findUnique({ where: { email }, select: { id: true, orgId: true, emailVerifiedAt: true } });
if (!u) { console.log(JSON.stringify({ missing: email })); process.exit(0); }
const orgId = u.orgId;
const id = async (p: Promise<{ id: string } | null>) => (await p)?.id ?? null;
const sel = { select: { id: true } } as const;
const catalogId = await id(db.catalog.findFirst({ where: { orgId, status: 'ready' }, ...sel, orderBy: { createdAt: 'desc' } }));
const out = {
  userId: u.id, orgId, verified: Boolean(u.emailVerifiedAt), catalogId,
  clientId: await id(db.client.findFirst({ where: { orgId }, ...sel })),
  findingId: await id(db.finding.findFirst({ where: { item: { catalogId: catalogId ?? '' } }, ...sel })),
  shareLinkId: await id(db.shareLink.findFirst({ where: { orgId }, ...sel })),
  apiKeyId: await id(db.apiKey.findFirst({ where: { orgId }, ...sel })),
  notificationId: await id(db.notification.findFirst({ where: { orgId }, ...sel })),
  mappingId: await id(db.firmMapping.findFirst({ where: { orgId }, ...sel })),
  docListId: await id(db.docList.findFirst({ where: { orgId }, ...sel })),
  purchaseListId: await id(db.purchaseList.findFirst({ where: { orgId }, ...sel })),
  viewId: await id(db.savedView.findFirst({ where: { orgId }, ...sel })),
  inviteId: await id(db.invite.findFirst({ where: { orgId }, ...sel })),
  taskId: await id(db.reminderTask.findFirst({ where: { orgId }, ...sel })),
  telegramLinkId: await id(db.telegramLink.findFirst({ where: { orgId }, ...sel })),
  eventId: await id(db.auditEvent.findFirst({ where: { orgId }, ...sel })),
  sessionId: await id(db.userSession.findFirst({ where: { userId: u.id, revokedAt: null }, ...sel })),
  importBatchId: await id(db.importBatch.findFirst({ where: { orgId }, ...sel })),
};
console.log(JSON.stringify(out));
await db.$disconnect();
