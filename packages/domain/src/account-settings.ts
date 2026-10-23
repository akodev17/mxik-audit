// Settings of the org and the user that are not security: PDF branding, the Telegram link code,
// API keys, the account export and the saved interface language, plus what the settings pages
// read. Shared by the web app's server actions and the API. The caller has checked who may call
// (an admin of a real org for the writes).
import { z } from 'zod';
import { db } from '@tasnivo/db';
import { parseLocale, type Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { createApiKey, listApiKeys, MAX_ACTIVE_KEYS, type ApiKeyView } from './api/keys.js';
import { apiConfig, monthlyCheckCap, usageThisMonth } from './api/limits.js';
import { planStatus } from './plan.js';
import { deleteAfterDays, RETENTION_CHOICES } from './security/account.js';
import { buildAccountExport } from './security/export.js';
import { qrPath, type QrPath } from './security/qr.js';
import type { CurrentUser } from './session.js';
import { telegramConfig } from './telegram/config.js';
import { createLinkCode, LINK_CODE_TTL_MS } from './telegram/linking.js';

type Actor = Pick<CurrentUser, 'userId' | 'orgId' | 'role'>;

export const LOGO_MAX_BYTES = 300 * 1024;

/** PNG or JPEG by its first bytes, whatever the browser claims. */
export function imageMime(bytes: Uint8Array): string | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export type BrandState = { error?: string; saved?: boolean };

/**
 * Firm name and logo for client PDF reports. `logo` is the uploaded file's bytes (null or empty:
 * keep the current logo); `removeLogo` drops it.
 */
export async function saveBrandingForm(
  user: Pick<Actor, 'orgId'>, input: { brandName: unknown; removeLogo: boolean; logo: Uint8Array | null }, locale: Locale,
): Promise<BrandState> {
  const { t } = i18nFor(locale);
  const name = z.string().max(120).safeParse(input.brandName ?? '');
  if (!name.success) return { error: t.errorGeneric };
  const data: { brandName: string | null; logoData?: Uint8Array<ArrayBuffer> | null; logoMime?: string | null } = {
    brandName: name.data.replace(/\s+/g, ' ').trim() || null,
  };
  if (input.removeLogo) {
    data.logoData = null;
    data.logoMime = null;
  } else if (input.logo && input.logo.length > 0) {
    const mime = imageMime(input.logo);
    if (!mime || input.logo.length > LOGO_MAX_BYTES) return { error: t.brandBadLogo };
    data.logoData = new Uint8Array(input.logo);
    data.logoMime = mime;
  }
  await db.organization.update({ where: { id: user.orgId }, data });
  return { saved: true };
}

/** link and qr: the bot's deep link that sends "/start CODE" by itself, when the bot's username is known. */
export type CodeResult = { ok: true; code: string; minutes: number; link?: string; qr?: QrPath } | { ok: false };

/** A one-time code the user sends to the bot as "/start CODE"; { ok: false } while the bot is off. */
export async function telegramLinkCode(user: Actor): Promise<CodeResult> {
  if (!telegramConfig().enabled) return { ok: false };
  const { code } = await createLinkCode(user);
  const minutes = Math.round(LINK_CODE_TTL_MS / 60_000);
  const bot = telegramConfig().username;
  if (!bot) return { ok: true, code, minutes };
  const link = `https://t.me/${bot}?start=${encodeURIComponent(code)}`;
  return { ok: true, code, minutes, link, qr: qrPath(link) };
}

export type KeyState = { token: string } | { error: 'name' | 'limit' | 'failed' };

/** A new API key; the token is returned once and never stored in clear. The name is 1 to 60 characters after trimming. */
export async function addApiKeyForm(user: Actor, name: unknown): Promise<KeyState> {
  const label = z.string().trim().min(1).max(60).safeParse(name);
  if (!label.success) return { error: 'name' };
  if (await db.apiKey.count({ where: { orgId: user.orgId, revokedAt: null } }) >= MAX_ACTIVE_KEYS) return { error: 'limit' };
  const created = await createApiKey(user, label.data);
  return created ? { token: created.token } : { error: 'failed' };
}

/** The whole account as a zip, recorded in the audit log, with the file name the download gets. */
export async function exportAccount(user: Pick<Actor, 'userId' | 'orgId'>, locale: Locale, now = new Date()): Promise<{ zip: Buffer; filename: string }> {
  const zip = await buildAccountExport(user.orgId, locale);
  await db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'account.exported', payload: {} } });
  return { zip, filename: `mxik-audit-export-${now.toISOString().slice(0, 10)}.zip` };
}

/**
 * The language switch: any unknown value reads as the default language. Saved as the user's
 * choice when signed in (not for a demo visitor); the caller sets the cookie with the answer.
 */
export async function chooseLocale(value: unknown, user: Pick<CurrentUser, 'userId' | 'demo'> | null): Promise<Locale> {
  const locale = parseLocale(value);
  if (user && !user.demo) await db.user.update({ where: { id: user.userId }, data: { locale } });
  return locale;
}

/** The org's profile, PDF branding (the logo as a data: URL) and data settings, for Settings. */
export async function accountSettings(orgId: string) {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { name: true, brandName: true, logoData: true, logoMime: true, dictAutoAccept: true, rawRetentionDays: true, rawRetentionSince: true },
  });
  return {
    name: org.name,
    brandName: org.brandName,
    logoUrl: org.logoData && org.logoMime ? `data:${org.logoMime};base64,${Buffer.from(org.logoData).toString('base64')}` : null,
    dictAutoAccept: org.dictAutoAccept,
    rawRetentionDays: org.rawRetentionDays,
    rawRetentionSince: org.rawRetentionSince,
    retentionChoices: [...RETENTION_CHOICES],
    closeAfterDays: deleteAfterDays(),
  };
}

/** Emails of the org's members by id, for "linked by" and "created by" columns. */
async function memberEmails(orgId: string): Promise<Map<string, string>> {
  const members = await db.user.findMany({ where: { orgId }, select: { id: true, email: true } });
  return new Map(members.map((m) => [m.id, m.email]));
}

/** The Telegram chats that receive the org's notifications, and whether the bot is configured. */
export async function telegramLinksView(orgId: string) {
  const tg = telegramConfig();
  const [links, emails] = await Promise.all([
    db.telegramLink.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true, username: true, createdAt: true, linkedBy: true } }),
    memberEmails(orgId),
  ]);
  return {
    enabled: tg.enabled,
    bot: tg.username,
    links: links.map((l) => ({ id: l.id, username: l.username, createdAt: l.createdAt, linkedBy: l.linkedBy ? emails.get(l.linkedBy) ?? null : null })),
  };
}

export type ApiKeysView = {
  /** `createdBy`: the creator's e-mail, null when unknown or gone; `creatorRemoved`: made by a member who has left the team. */
  keys: (Omit<ApiKeyView, 'createdBy'> & { createdBy: string | null; creatorRemoved: boolean })[];
  maxActive: number;
  usage: { checks: number; requests: number };
  monthlyCap: number | null;
  ratePerMinute: number;
};

/** The org's API keys with this month's usage and the plan's allowance. */
export async function apiKeysView(orgId: string): Promise<ApiKeysView> {
  const [keys, usage, status, emails] = await Promise.all([listApiKeys(orgId), usageThisMonth(orgId), planStatus(orgId), memberEmails(orgId)]);
  const config = apiConfig();
  return {
    keys: keys.map((k) => ({ ...k, createdBy: k.createdBy ? emails.get(k.createdBy) ?? null : null, creatorRemoved: k.createdBy !== null && !emails.has(k.createdBy) })),
    maxActive: MAX_ACTIVE_KEYS,
    usage,
    monthlyCap: monthlyCheckCap(status, config),
    ratePerMinute: config.ratePerMinute,
  };
}
