// Read-only report links. The token is shown once; only its hash is stored.
import { createHash, randomBytes } from 'node:crypto';
import { absoluteUrl } from './app-url';
import { catalogScope } from './access';
import { db } from './db';
import { orgActive } from './security/org-active';

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

type Actor = { userId: string; orgId: string; clientIds?: string[] | null };

export type ShareLinkView = {
  id: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null; views: number; lastViewedAt: Date | null; includePdf: boolean;
};

export async function createShareLink(
  actor: Actor, catalogId: string, input: { days: 7 | 30; includePdf: boolean },
): Promise<{ url: string } | null> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, status: 'ready', ...catalogScope(actor) }, select: { id: true } });
  if (!catalog) return null;
  const token = randomBytes(24).toString('base64url');
  const link = await db.shareLink.create({
    data: {
      orgId: actor.orgId, catalogId: catalog.id, tokenHash: hash(token), includePdf: input.includePdf,
      createdBy: actor.userId, expiresAt: new Date(Date.now() + input.days * 86_400_000),
    },
  });
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'share.created', targetId: link.id, payload: { catalogId: catalog.id, days: input.days, includePdf: input.includePdf } } });
  return { url: absoluteUrl(`/r/${token}`) };
}

export async function listShareLinks(actor: Actor, catalogId: string): Promise<ShareLinkView[]> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(actor) }, select: { id: true } });
  if (!catalog) return [];
  return db.shareLink.findMany({
    where: { catalogId: catalog.id, orgId: actor.orgId }, orderBy: { createdAt: 'desc' }, take: 20,
    select: { id: true, createdAt: true, expiresAt: true, revokedAt: true, views: true, lastViewedAt: true, includePdf: true },
  });
}

export async function revokeShareLink(actor: Actor, linkId: string): Promise<boolean> {
  const link = await db.shareLink.findFirst({ where: { id: linkId, orgId: actor.orgId, catalog: catalogScope(actor) }, select: { id: true } });
  if (!link) return false;
  await db.$transaction([
    db.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } }),
    db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'share.revoked', targetId: link.id, payload: {} } }),
  ]);
  return true;
}

export type ResolvedShare = { id: string; orgId: string; catalogId: string; includePdf: boolean };

/** The live link behind a token: not revoked, not expired, its account not closed. Anything else is null. */
export async function resolveShare(token: string, now = new Date()): Promise<ResolvedShare | null> {
  const link = await db.shareLink.findUnique({ where: { tokenHash: hash(token) } });
  if (!link || link.revokedAt || link.expiresAt <= now || !(await orgActive(link.orgId))) return null;
  return { id: link.id, orgId: link.orgId, catalogId: link.catalogId, includePdf: link.includePdf };
}

export async function countView(linkId: string): Promise<void> {
  await db.shareLink.update({ where: { id: linkId }, data: { views: { increment: 1 }, lastViewedAt: new Date() } }).catch(() => undefined);
}
