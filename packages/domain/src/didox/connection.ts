// The org's Didox connection (settings tab, admin only) and the sync action "Fetch new incoming
// invoices". The working login path is "paste your token"; ИНН + password login exists behind
// DIDOX_PASSWORD_LOGIN=1 because Didox has not confirmed the endpoint (research note §1 Unknown 4);
// E-IMZO key login is not implemented (it signs with the user's key inside the browser's E-IMZO).
import { z } from 'zod';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { db } from '@tasnivo/db';
import { canWrite, isAdminRole } from '../access.js';
import { uploadTarget } from '../catalog-upload.js';
import { isDemoOrg } from '../demo.js';
import { uploadsOpen } from '../plan.js';
import type { CurrentUser } from '../session.js';
import { defaultDeps, type CheckDeps } from './check.js';
import { DidoxApiError, DidoxClient, didoxBaseUrl, type DidoxAuth } from './client.js';
import { openToken, sealToken } from './seal.js';
import { bytes, importDocument } from './service.js';

type Fail = { ok: false; error: string };

export const passwordLoginEnabled = (env: Record<string, string | undefined> = process.env): boolean => env['DIDOX_PASSWORD_LOGIN'] === '1';

export type ConnectionView = {
  connected: boolean;
  kind: 'token' | 'partner';
  companyTin: string;
  clientId: string | null;
  hasToken: boolean;
  tokenExpiresAt: string | null;
  partnerTokenRef: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  baseUrl: string;
  passwordLogin: boolean;
};

export async function getConnection(user: CurrentUser): Promise<ConnectionView> {
  const c = await db.didoxConnection.findUnique({ where: { orgId: user.orgId } });
  return {
    connected: Boolean(c),
    kind: c?.kind === 'partner' ? 'partner' : 'token',
    companyTin: c?.companyTin ?? '',
    clientId: c?.clientId ?? null,
    hasToken: Boolean(c?.tokenSealed),
    tokenExpiresAt: c?.tokenExpiresAt?.toISOString() ?? null,
    partnerTokenRef: c?.partnerTokenRef ?? null,
    lastSyncAt: c?.lastSyncAt?.toISOString() ?? null,
    lastError: c?.lastError ?? null,
    baseUrl: didoxBaseUrl(),
    passwordLogin: passwordLoginEnabled(),
  };
}

export const SaveConnection = z.object({
  kind: z.enum(['token', 'partner']),
  companyTin: z.string().regex(/^(\d{9}|\d{14})$/),
  /** Empty or absent keeps the stored token. */
  token: z.string().trim().max(4000).optional(),
  tokenExpiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  /** The name of the environment variable that holds the partner token (never the token). */
  partnerTokenRef: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).optional().or(z.literal('')),
  clientId: z.string().max(64).optional().or(z.literal('')),
});

const adminOnly = (user: CurrentUser | null): user is CurrentUser => user !== null && isAdminRole(user);

export async function saveConnection(user: CurrentUser | null, locale: Locale, body: unknown): Promise<{ ok: true } | Fail> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (!adminOnly(user)) return { ok: false, error: e.forbidden };
  if (await isDemoOrg(user.orgId)) return { ok: false, error: e.demo };
  const input = SaveConnection.safeParse(body);
  if (!input.success) return { ok: false, error: e.generic };
  const { kind, companyTin, token, tokenExpiresAt, partnerTokenRef, clientId } = input.data;
  const existing = await db.didoxConnection.findUnique({ where: { orgId: user.orgId }, select: { tokenSealed: true } });
  if (!token && !existing?.tokenSealed) return { ok: false, error: e.token_required };
  if (clientId) {
    const target = await uploadTarget(user, clientId);
    if (!target.ok) return { ok: false, error: e[target.reason] };
  }
  const data = {
    kind, companyTin, clientId: clientId || null,
    ...(token ? { tokenSealed: sealToken(token), lastError: null } : {}),
    tokenExpiresAt: tokenExpiresAt ? new Date(`${tokenExpiresAt}T23:59:59+05:00`) : null,
    partnerTokenRef: kind === 'partner' ? partnerTokenRef || 'DIDOX_PARTNER_TOKEN' : null,
  };
  await db.didoxConnection.upsert({ where: { orgId: user.orgId }, create: { orgId: user.orgId, createdBy: user.userId, ...data }, update: data });
  return { ok: true };
}

export async function removeConnection(user: CurrentUser | null): Promise<boolean> {
  if (!adminOnly(user)) return false;
  const { count } = await db.didoxConnection.deleteMany({ where: { orgId: user.orgId } });
  return count > 0;
}

type ClientFor = { ok: true; client: DidoxClient; clientId: string | null } | { ok: false; code: 'not_connected' | 'token_required' | 'partner_missing' };

/** A client for the org's stored connection. `options` lets tests inject retries, a fetch, a limiter. */
export async function clientForOrg(orgId: string, env: Record<string, string | undefined> = process.env, options: Partial<ConstructorParameters<typeof DidoxClient>[0]> = {}): Promise<ClientFor> {
  const c = await db.didoxConnection.findUnique({ where: { orgId } });
  if (!c) return { ok: false, code: 'not_connected' };
  const token = openToken(c.tokenSealed);
  if (!token) return { ok: false, code: 'token_required' };
  let auth: DidoxAuth;
  if (c.kind === 'partner') {
    const partner = env[c.partnerTokenRef ?? 'DIDOX_PARTNER_TOKEN'];
    if (!partner) return { ok: false, code: 'partner_missing' };
    auth = { kind: 'partner', partnerToken: partner, userToken: token };
  } else {
    auth = { kind: 'token', token };
  }
  return { ok: true, clientId: c.clientId, client: new DidoxClient({ baseUrl: didoxBaseUrl(env), auth, orgKey: orgId, log: (line) => console.info(line), ...options }) };
}

const didoxMessage = (locale: Locale, error: unknown): string => {
  const e = i18nFor(locale).ta.didoxX.errors;
  return error instanceof DidoxApiError ? e.didox[error.code] ?? e.generic : e.generic;
};

/** Reachability (the public measures list) and, with a token, one authorised list call. */
export async function testConnection(user: CurrentUser | null, locale: Locale, options: Partial<ConstructorParameters<typeof DidoxClient>[0]> = {}): Promise<{ ok: true; reachable: boolean; authorized: boolean; measures: number } | Fail> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (!adminOnly(user)) return { ok: false, error: e.forbidden };
  const found = await clientForOrg(user.orgId, process.env, options);
  const publicClient = new DidoxClient({ baseUrl: didoxBaseUrl(), auth: { kind: 'none' }, orgKey: user.orgId, retries: 0, ...options });
  let measures = 0;
  try {
    measures = (await publicClient.measures()).length;
  } catch (error) {
    return { ok: false, error: didoxMessage(locale, error) };
  }
  if (!found.ok) return { ok: true, reachable: true, authorized: false, measures };
  try {
    await found.client.listDocuments({ owner: 0, limit: 1, page: 1 });
    await db.didoxConnection.update({ where: { orgId: user.orgId }, data: { lastError: null } });
    return { ok: true, reachable: true, authorized: true, measures };
  } catch (error) {
    await db.didoxConnection.update({ where: { orgId: user.orgId }, data: { lastError: error instanceof DidoxApiError ? error.code : 'error' } });
    return { ok: false, error: didoxMessage(locale, error) };
  }
}

/** ИНН + password → token (stored sealed; the password is not kept). Off unless DIDOX_PASSWORD_LOGIN=1. */
export async function passwordLogin(user: CurrentUser | null, locale: Locale, body: unknown, options: Partial<ConstructorParameters<typeof DidoxClient>[0]> = {}): Promise<{ ok: true } | Fail> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (!adminOnly(user)) return { ok: false, error: e.forbidden };
  if (!passwordLoginEnabled()) return { ok: false, error: e.password_disabled };
  const input = z.object({ companyTin: z.string().regex(/^(\d{9}|\d{14})$/), password: z.string().min(1).max(200) }).safeParse(body);
  if (!input.success) return { ok: false, error: e.generic };
  try {
    const client = new DidoxClient({ baseUrl: didoxBaseUrl(), auth: { kind: 'none' }, orgKey: user.orgId, retries: 0, ...options });
    const { token } = await client.loginWithPassword(input.data.companyTin, input.data.password, locale === 'uz' ? 'uz' : 'ru');
    const data = { kind: 'token', companyTin: input.data.companyTin, tokenSealed: sealToken(token), lastError: null };
    await db.didoxConnection.upsert({ where: { orgId: user.orgId }, create: { orgId: user.orgId, createdBy: user.userId, ...data }, update: data });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: didoxMessage(locale, error) };
  }
}

// ── Sync ───────────────────────────────────────────────────────────────────────────────────

export type SyncResult = { ok: true; listed: number; imported: number; skipped: number; refused: number; failed: number; batchIds: string[] } | Fail;

const MEASURES_TTL = 24 * 3600_000;
let measuresCache: { at: number; map: Map<string, string> } | null = null;

async function measuresMap(client: DidoxClient): Promise<Map<string, string>> {
  if (measuresCache && Date.now() - measuresCache.at < MEASURES_TTL) return measuresCache.map;
  try {
    const map = new Map((await client.measures()).map((m) => [m.measureId, m.name]));
    measuresCache = { at: Date.now(), map };
    return map;
  } catch {
    return measuresCache?.map ?? new Map();
  }
}

/**
 * "Fetch new incoming invoices": pages GET /v1/documents (owner 0 = incoming, doctype 002),
 * skips ids already imported (a batch with that externalRef) or already cached (a document refused
 * before, such as a non-invoice), caches each new document's JSON and PDF in didox_document and
 * creates one batch per invoice. Stops at the first Didox error and records it on the connection.
 */
export async function syncIncoming(
  user: CurrentUser | null, locale: Locale, body: unknown,
  options: { client?: Partial<ConstructorParameters<typeof DidoxClient>[0]>; deps?: CheckDeps; maxPages?: number } = {},
): Promise<SyncResult> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (user === null || !canWrite(user)) return { ok: false, error: e.forbidden };
  if (await isDemoOrg(user.orgId)) return { ok: false, error: e.demo };
  if (!(await uploadsOpen(user.orgId)).ok) return { ok: false, error: e.expired };
  const input = z.object({ dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).safeParse(body ?? {});
  if (!input.success) return { ok: false, error: e.generic };
  const found = await clientForOrg(user.orgId, process.env, options.client);
  if (!found.ok) return { ok: false, error: e[found.code] };
  const { client } = found;
  // A scoped accountant syncs only into a client they may work on.
  if (user.clientIds != null && (!found.clientId || !user.clientIds.includes(found.clientId))) return { ok: false, error: e.client };

  const result = { listed: 0, imported: 0, skipped: 0, refused: 0, failed: 0, batchIds: [] as string[] };
  try {
    const measures = await measuresMap(client);
    for await (const page of client.listAll({ owner: 0, doctype: '002', dateFrom: input.data.dateFrom, limit: 100 }, options.maxPages ?? 50)) {
      result.listed += page.length;
      const ids = page.map((p) => p.id);
      const [batches, cached] = await Promise.all([
        db.importBatch.findMany({ where: { orgId: user.orgId, kind: 'didox_invoice', externalRef: { in: ids } }, select: { externalRef: true } }),
        db.didoxDocument.findMany({ where: { orgId: user.orgId, didoxId: { in: ids } }, select: { didoxId: true } }),
      ]);
      const seen = new Set([...batches.map((b) => b.externalRef), ...cached.map((c) => c.didoxId)]);
      for (const entry of page) {
        if (seen.has(entry.id)) { result.skipped++; continue; }
        const doc = await client.getDocument(entry.id);
        const imported = await importDocument(user.orgId, user.userId, {
          json: doc, source: 'didox_api', clientId: found.clientId, didoxId: entry.id, didoxStatus: entry.status, docType: entry.doctype, measures,
        }, options.deps ?? defaultDeps);
        if (imported.ok) {
          result.imported++;
          result.batchIds.push(imported.batchId);
          const pdf = await client.getDocumentPdf(entry.id).catch(() => null);
          if (pdf) await db.didoxDocument.update({ where: { orgId_didoxId: { orgId: user.orgId, didoxId: entry.id } }, data: { pdf: bytes(pdf) } });
        } else {
          // Refused (not an invoice, a duplicate under another id, unreadable): cached so the next sync skips it.
          result.refused++;
          await db.didoxDocument.upsert({
            where: { orgId_didoxId: { orgId: user.orgId, didoxId: entry.id } },
            create: { orgId: user.orgId, didoxId: entry.id, source: 'didox_api', docType: entry.doctype, status: entry.status, json: doc ?? {} },
            update: { status: entry.status },
          });
        }
      }
    }
  } catch (error) {
    await db.didoxConnection.update({ where: { orgId: user.orgId }, data: { lastError: error instanceof DidoxApiError ? error.code : 'error', lastSyncAt: new Date() } });
    if (!(error instanceof DidoxApiError)) throw error;
    return { ok: false, error: didoxMessage(locale, error) };
  }
  await db.didoxConnection.update({ where: { orgId: user.orgId }, data: { lastError: null, lastSyncAt: new Date() } });
  return { ok: true, ...result };
}
