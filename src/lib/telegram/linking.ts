// Linking a Telegram chat to an org with a one-time code from the web app.
import { randomInt } from 'node:crypto';
import { db } from '../db.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 15 * 60_000;

function newCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/** A fresh one-time code for this org; earlier unused codes stay valid until they expire. */
export async function createLinkCode(actor: { orgId: string; userId: string }, now = new Date()): Promise<{ code: string; expiresAt: Date }> {
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
    const org = await tx.organization.findUniqueOrThrow({ where: { id: row.orgId }, select: { name: true, kind: true } });
    if (org.kind === 'demo' || org.kind === 'demo_template') return { ok: false, reason: 'demo' } as const;
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

export async function linkForChat(chatId: string) {
  return db.telegramLink.findUnique({ where: { chatId }, select: { orgId: true, linkedBy: true } });
}

export async function listLinks(orgId: string) {
  return db.telegramLink.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true, username: true, createdAt: true } });
}

/** Unlinks one of the org's chats; another org's link id does nothing. */
export async function unlink(actor: { orgId: string; userId: string }, linkId: string): Promise<boolean> {
  const removed = await db.telegramLink.deleteMany({ where: { id: linkId, orgId: actor.orgId } });
  if (removed.count === 0) return false;
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'telegram.unlinked', payload: {} } });
  return true;
}
