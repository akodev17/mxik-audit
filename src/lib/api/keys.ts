// Public API keys. The token is shown once; only its hash is stored.
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db';
import { orgActive } from '../security/org-active';

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');
const TOKEN_PREFIX = 'mxk_';
export const MAX_ACTIVE_KEYS = 10;
const TOUCH_EVERY_MS = 60_000;

type Actor = { userId: string; orgId: string };

export type ApiKeyView = {
  id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null; checksThisMonth: number;
  /** User id of the member who made the key (the user may since have been removed). */
  createdBy: string | null;
};

export const monthKey = (now = new Date()): string => now.toISOString().slice(0, 7);

export async function createApiKey(actor: Actor, name: string): Promise<{ token: string } | null> {
  const label = name.trim().slice(0, 60);
  if (!label) return null;
  const active = await db.apiKey.count({ where: { orgId: actor.orgId, revokedAt: null } });
  if (active >= MAX_ACTIVE_KEYS) return null;
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
  const key = await db.apiKey.create({ data: { orgId: actor.orgId, name: label, prefix: token.slice(0, 10), tokenHash: hash(token), createdBy: actor.userId } });
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'apikey.created', targetId: key.id, payload: { name: label } } });
  return { token };
}

export async function listApiKeys(orgId: string): Promise<ApiKeyView[]> {
  const keys = await db.apiKey.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 50 });
  const usage = await db.apiUsage.findMany({ where: { orgId, month: monthKey() }, select: { keyId: true, checks: true } });
  const checks = new Map(usage.map((u) => [u.keyId, u.checks]));
  return keys.map((k) => ({
    id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt,
    checksThisMonth: checks.get(k.id) ?? 0, createdBy: k.createdBy,
  }));
}

export async function revokeApiKey(actor: Actor, keyId: string): Promise<boolean> {
  const done = await db.apiKey.updateMany({ where: { id: keyId, orgId: actor.orgId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (done.count === 0) return false;
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'apikey.revoked', targetId: keyId, payload: {} } });
  return true;
}

export type ApiCaller = { keyId: string; orgId: string };

/** Resolves "Authorization: Bearer <token>" to a live key of an open account; null for anything else. */
export async function authenticate(header: string | null): Promise<ApiCaller | null> {
  const token = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
  if (!token?.startsWith(TOKEN_PREFIX)) return null;
  const key = await db.apiKey.findUnique({ where: { tokenHash: hash(token) }, select: { id: true, orgId: true, revokedAt: true, lastUsedAt: true } });
  if (!key || key.revokedAt || !(await orgActive(key.orgId))) return null;
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  }
  return { keyId: key.id, orgId: key.orgId };
}
