// Linking a Telegram chat to an org with a one-time code from the web app.
// A link is an org-wide admin feature: only an admin issues a code or unlinks a chat,
// and a link (or code) stops working once the admin behind it is gone or demoted.
import { randomInt } from 'node:crypto';
import { isOrgAdmin } from '../actor-role.js';
import { db } from '../db.js';
import { orgActive } from '../security/org-active.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 15 * 60_000;

type Actor = { orgId: string; userId: string };

function newCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/** A fresh one-time code for this org; earlier unused codes stay valid until they expire. Admins only: throws otherwise. */
export async function createLinkCode(actor: Actor, now = new Date()): Promise<{ code: string; expiresAt: Date }> {
  if (!(await isOrgAdmin(actor.orgId, actor.userId))) throw new Error('telegram link code: admin only');
  const code = newCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  await db.telegramLinkCode.create({ data: { code, orgId: actor.orgId, userId: actor.userId, expiresAt } });
  return { code, expiresAt };
}

export type LinkOutcome = { ok: true; orgName: string } | { ok: false; reason: 'invalid' | 'demo' };

/** Consumes a code and links the chat. A chat already linked moves to the new org. */
export async function consumeLinkCode(rawCode: string, chatId: string, username: string | null, now = new Date()): Promise<LinkOutcome> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) return { ok: false, reason: 'invalid' };
  return db.$transaction(async (tx) => {
    const claimed = await tx.telegramLinkCode.updateMany({
      where: { code, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return { ok: false, reason: 'invalid' } as const;
    const row = await tx.telegramLinkCode.findUniqueOrThrow({ where: { code } });
    const org = await tx.organization.findUnique({ where: { id: row.orgId }, select: { name: true, kind: true, deletedAt: true } });
    if (!org) return { ok: false, reason: 'invalid' } as const;
    if (org.kind === 'demo' || org.kind === 'demo_template') return { ok: false, reason: 'demo' } as const;
    // A code issued before the account was closed, or by someone no longer its admin, links nothing.
    if (org.deletedAt || !(await isOrgAdmin(row.orgId, row.userId, tx))) return { ok: false, reason: 'invalid' } as const;
    await tx.telegramLink.upsert({
      where: { chatId },
      create: { orgId: row.orgId, chatId, username, linkedBy: row.userId },
      update: { orgId: row.orgId, username, linkedBy: row.userId },
    });
    await tx.auditEvent.create({
      data: { orgId: row.orgId, actorId: row.userId, action: 'telegram.linked', payload: { username } },
    });
    return { ok: true, orgName: org.name } as const;
  });
}

/**
 * The chat's link, or null (the bot then treats the chat as unlinked) when there is none,
 * its account is closed, or whoever linked it is no longer an admin of that org.
 */
export async function linkForChat(chatId: string): Promise<{ orgId: string; linkedBy: string } | null> {
  const link = await db.telegramLink.findUnique({ where: { chatId }, select: { orgId: true, linkedBy: true } });
  if (!link?.linkedBy || !(await orgActive(link.orgId))) return null;
  return (await isOrgAdmin(link.orgId, link.linkedBy)) ? { orgId: link.orgId, linkedBy: link.linkedBy } : null;
}

export async function listLinks(orgId: string) {
  return db.telegramLink.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true, username: true, createdAt: true } });
}

/** Unlinks one of the org's chats; another org's link id, or a non-admin, does nothing. */
export async function unlink(actor: Actor, linkId: string): Promise<boolean> {
  if (!(await isOrgAdmin(actor.orgId, actor.userId))) return false;
  const removed = await db.telegramLink.deleteMany({ where: { id: linkId, orgId: actor.orgId } });
  if (removed.count === 0) return false;
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'telegram.unlinked', payload: {} } });
  return true;
}
