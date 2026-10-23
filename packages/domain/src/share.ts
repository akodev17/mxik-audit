// Read-only report links. The token is shown once; only its hash is stored.
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { absoluteUrl } from './app-url';
import { canWrite, catalogScope } from './access';
import type { Role } from './session';
import { db } from '@tasnivo/db';
import { orgActive } from './security/org-active';
import { orgHasFeature } from './plan';

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

type Actor = { userId: string; orgId: string; clientIds?: string[] | null; role?: Role };

/** Viewers may read links but never create or revoke them; callers without a role are trusted server code. */
const mayChange = (actor: Actor): boolean => actor.role === undefined || canWrite({ role: actor.role });

export type ShareLinkView = {
  id: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null; views: number; lastViewedAt: Date | null; includePdf: boolean;
};

export async function createShareLink(
  actor: Actor, catalogId: string, input: { days: 7 | 30; includePdf: boolean },
): Promise<{ url: string } | null> {
  if (!mayChange(actor)) return null;
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
  if (!mayChange(actor)) return false;
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

// ── What the share-link actions answer (the web's share actions and the API call these) ─────

/** ShareLinkView with ISO dates, as the browser receives it. */
export type ShareRow = Omit<ShareLinkView, 'createdAt' | 'expiresAt' | 'revokedAt' | 'lastViewedAt'> & {
  createdAt: string; expiresAt: string; revokedAt: string | null; lastViewedAt: string | null;
};

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** `actor` is null when the writer guard did not pass: no links. */
export async function shareRows(actor: Actor | null, catalogId: unknown): Promise<ShareRow[]> {
  const id = z.string().min(1).safeParse(catalogId);
  if (!actor || !mayChange(actor) || !id.success) return [];
  return (await listShareLinks(actor, id.data)).map((l) => ({
    id: l.id, includePdf: l.includePdf, views: l.views,
    createdAt: l.createdAt.toISOString(), expiresAt: l.expiresAt.toISOString(), revokedAt: iso(l.revokedAt), lastViewedAt: iso(l.lastViewedAt),
  }));
}

const CreateInput = z.object({ catalogId: z.string().min(1), days: z.union([z.literal(7), z.literal(30)]), includePdf: z.boolean() });

/** Whether the actor's plan has client links; the API answers 403 plan_feature when it has not. */
export async function shareAllowed(actor: Pick<Actor, 'orgId'>): Promise<boolean> {
  return orgHasFeature(actor.orgId, 'clientLinks');
}

/** A new link for a ready catalogue the actor may see; null for anything else, a plan without client links included. */
export async function shareCreateFor(actor: Actor | null, payload: unknown): Promise<{ url: string } | null> {
  const parsed = CreateInput.safeParse(payload);
  if (!actor || !parsed.success) return null;
  if (!(await shareAllowed(actor))) return null;
  return createShareLink(actor, parsed.data.catalogId, { days: parsed.data.days, includePdf: parsed.data.includePdf });
}

export async function shareRevokeFor(actor: Actor | null, linkId: unknown): Promise<boolean> {
  const id = z.string().min(1).safeParse(linkId);
  return Boolean(actor && id.success && await revokeShareLink(actor, id.data));
}
