// The org's Didox connection (settings tab, admin only) and the sync action "Fetch new incoming
// invoices". Login paths: paste a token (company mode: api-key + user-key on api.didox.uz; partner
// mode: Partner-Authorization from a DIDOX_* variable + the user token on api-partners.didox.uz),
// or ИНН + password behind DIDOX_PASSWORD_LOGIN=1. Tokens live 360 minutes (RESEARCH.md §1.2).
// E-IMZO key login is not implemented (it signs with the user's key inside the browser's E-IMZO).
//
// The sync runs in the background (B8): startSync answers at once, the run pages the list and saves
// its state on the connection after every page (`syncState`), and a status read resumes a run whose
// heartbeat stopped (an API restart). A resumed run starts over from page 1 of the same
// `dateFromUpdated`: the list is newest first and grows while it is read, so a saved page number
// could skip documents, and every document already imported is skipped by id anyway.
import { z } from 'zod';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';
import { canWrite, isAdminRole } from '../access.js';
import { uploadTarget } from '../catalog-upload.js';
import { isDemoOrg } from '../demo.js';
import { uploadsOpen } from '../plan.js';
import type { CurrentUser } from '../session.js';
import { defaultDeps, type CheckDeps } from './check.js';
import { DidoxApiError, DidoxClient, didoxBaseUrl, TOKEN_TTL_MS, type DidoxAuth, type DocumentEntry } from './client.js';
import type { StatedTotals } from './document.js';
import { openToken, sealToken } from './seal.js';
import { bytes, importDocument } from './service.js';
import { STATUS_ISSUES, statusIssues } from './rules.js';
import { readDidoxUpload } from './sources.js';

type Fail = { ok: false; error: string };

export const passwordLoginEnabled = (env: Record<string, string | undefined> = process.env): boolean => env['DIDOX_PASSWORD_LOGIN'] === '1';

/** The background sync as saved on the connection. */
export type SyncState = {
  status: 'running' | 'done' | 'failed';
  dateFromUpdated: string | null;
  /** The last list page read. */
  page: number;
  listed: number; imported: number; skipped: number; refused: number; failed: number;
  /** Up to 50 batches created by this run. */
  batchIds: string[];
  /** Documents that failed (fetch or import error), up to 20, with Didox's words when it gave any. */
  failures: Array<{ id: string; error: string }>;
  startedAt: string; heartbeatAt: string; finishedAt: string | null;
  /** The machine code that stopped the run, and Didox's own words for it. */
  error: string | null;
  detail: string | null;
  startedBy: string;
  clientId: string | null;
};

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
  /** Didox's own words for the last failure, as it sent them (bounded, no token). */
  lastErrorDetail: string | null;
  baseUrl: string;
  passwordLogin: boolean;
  sync: SyncState | null;
};

const readState = (v: Prisma.JsonValue | null | undefined): SyncState | null => (v && typeof v === 'object' && !Array.isArray(v) && 'status' in v ? (v as unknown as SyncState) : null);

export async function getConnection(user: CurrentUser): Promise<ConnectionView> {
  const c = await db.didoxConnection.findUnique({ where: { orgId: user.orgId } });
  const kind = c?.kind === 'partner' ? 'partner' : 'token';
  return {
    connected: Boolean(c),
    kind,
    companyTin: c?.companyTin ?? '',
    clientId: c?.clientId ?? null,
    hasToken: Boolean(c?.tokenSealed),
    tokenExpiresAt: c?.tokenExpiresAt?.toISOString() ?? null,
    partnerTokenRef: c?.partnerTokenRef ?? null,
    lastSyncAt: c?.lastSyncAt?.toISOString() ?? null,
    lastError: c?.lastError ?? null,
    lastErrorDetail: c?.lastErrorDetail ?? null,
    baseUrl: didoxBaseUrl(process.env, kind),
    passwordLogin: passwordLoginEnabled(),
    sync: readState(c?.syncState),
  };
}

/**
 * The partner token may only be read from a variable set aside for it. Any other name
 * (SESSION_SECRET, DATABASE_URL) would be sent to Didox as the partner token (Phase C F2).
 */
export const PARTNER_TOKEN_REF = /^DIDOX_[A-Z0-9_]{1,58}$/;
export const partnerRefAllowed = (name: string): boolean => PARTNER_TOKEN_REF.test(name);

export const SaveConnection = z.object({
  kind: z.enum(['token', 'partner']),
  companyTin: z.string().regex(/^(\d{9}|\d{14})$/),
  /** Empty or absent keeps the stored token. */
  token: z.string().trim().max(4000).optional(),
  /** A date the token stops (end of that day); empty = 360 minutes from now (§1.2). */
  tokenExpiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  /** The name of the environment variable that holds the partner token (never the token): DIDOX_* only. */
  partnerTokenRef: z.string().regex(PARTNER_TOKEN_REF).optional().or(z.literal('')),
  clientId: z.string().max(64).optional().or(z.literal('')),
});

const adminOnly = (user: CurrentUser | null): user is CurrentUser => user !== null && isAdminRole(user);

export async function saveConnection(user: CurrentUser | null, locale: Locale, body: unknown): Promise<{ ok: true } | Fail> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (!adminOnly(user)) return { ok: false, error: e.forbidden };
  if (await isDemoOrg(user.orgId)) return { ok: false, error: e.demo };
  const input = SaveConnection.safeParse(body);
  if (!input.success) return { ok: false, error: input.error.issues.some((i) => i.path[0] === 'partnerTokenRef') ? e.partner_ref : e.generic };
  const { kind, companyTin, token, tokenExpiresAt, partnerTokenRef, clientId } = input.data;
  const existing = await db.didoxConnection.findUnique({ where: { orgId: user.orgId }, select: { tokenSealed: true, tokenExpiresAt: true } });
  if (!token && !existing?.tokenSealed) return { ok: false, error: e.token_required };
  if (clientId) {
    const target = await uploadTarget(user, clientId);
    if (!target.ok) return { ok: false, error: e[target.reason] };
  }
  // A new token without a (future) date lives the documented 360 minutes; a stale date carried over from the old token does not apply to it.
  const typed = tokenExpiresAt ? new Date(`${tokenExpiresAt}T23:59:59+05:00`) : null;
  const expires = typed && (typed.getTime() > Date.now() || !token) ? typed : token ? new Date(Date.now() + TOKEN_TTL_MS) : existing?.tokenExpiresAt ?? null;
  const data = {
    kind, companyTin, clientId: clientId || null,
    ...(token ? { tokenSealed: sealToken(token), lastError: null, lastErrorDetail: null } : {}),
    tokenExpiresAt: expires,
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

type ClientFor = { ok: true; client: DidoxClient; clientId: string | null } | { ok: false; code: 'not_connected' | 'token_required' | 'partner_ref' | 'partner_missing' | 'token_expired' };
type ClientOptions = Partial<ConstructorParameters<typeof DidoxClient>[0]>;

/** A client for the org's stored connection. `options` lets tests inject retries, a fetch, a limiter. */
export async function clientForOrg(orgId: string, env: Record<string, string | undefined> = process.env, options: ClientOptions = {}): Promise<ClientFor> {
  const c = await db.didoxConnection.findUnique({ where: { orgId } });
  if (!c) return { ok: false, code: 'not_connected' };
  const token = openToken(c.tokenSealed);
  if (!token) return { ok: false, code: 'token_required' };
  if (c.tokenExpiresAt && c.tokenExpiresAt.getTime() <= Date.now()) return { ok: false, code: 'token_expired' };
  let auth: DidoxAuth;
  if (c.kind === 'partner') {
    const ref = c.partnerTokenRef ?? 'DIDOX_PARTNER_TOKEN';
    // Checked again here, so a reference stored before the allow-list cannot reach the environment either.
    if (!partnerRefAllowed(ref)) return { ok: false, code: 'partner_ref' };
    const partner = env[ref];
    // The sandbox (testapi3) takes the user token alone (§1.1); production needs the partner token.
    if (!partner && env['DIDOX_SANDBOX'] !== '1') return { ok: false, code: 'partner_missing' };
    auth = partner ? { kind: 'partner', partnerToken: partner, userToken: token } : { kind: 'user', userToken: token };
  } else {
    auth = { kind: 'token', token };
  }
  const kind = c.kind === 'partner' ? 'partner' : 'token';
  return {
    ok: true, clientId: c.clientId,
    client: new DidoxClient({ baseUrl: didoxBaseUrl(env, kind), auth, tokenExpiresAt: c.tokenExpiresAt, orgKey: orgId, log: (line) => console.info(line), ...options }),
  };
}

const didoxMessage = (locale: Locale, error: unknown): string => {
  const e = i18nFor(locale).ta.didoxX.errors;
  return error instanceof DidoxApiError ? e.didox[error.code] ?? e.generic : e.generic;
};

/** What is saved on the connection after a Didox failure: the code and Didox's words. */
const failureOf = (error: unknown): { lastError: string; lastErrorDetail: string | null } => ({
  lastError: error instanceof DidoxApiError ? error.code : 'error',
  lastErrorDetail: error instanceof DidoxApiError ? error.detail : null,
});

/** Reachability (the public measures list) and, with a token, one authorised list call. */
export async function testConnection(user: CurrentUser | null, locale: Locale, options: ClientOptions = {}): Promise<{ ok: true; reachable: boolean; authorized: boolean; measures: number } | Fail> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (!adminOnly(user)) return { ok: false, error: e.forbidden };
  const found = await clientForOrg(user.orgId, process.env, options);
  const publicClient = new DidoxClient({ baseUrl: found.ok ? found.client.baseUrl : didoxBaseUrl(), auth: { kind: 'none' }, orgKey: user.orgId, retries: 0, ...options });
  let measures = 0;
  try {
    measures = (await publicClient.measures()).length;
  } catch (error) {
    return { ok: false, error: didoxMessage(locale, error) };
  }
  if (!found.ok) return found.code === 'token_expired' ? { ok: false, error: e.token_expired } : { ok: true, reachable: true, authorized: false, measures };
  try {
    await found.client.listDocuments({ owner: 0, limit: 1, page: 1 });
    await db.didoxConnection.update({ where: { orgId: user.orgId }, data: { lastError: null, lastErrorDetail: null } });
    return { ok: true, reachable: true, authorized: true, measures };
  } catch (error) {
    await db.didoxConnection.update({ where: { orgId: user.orgId }, data: failureOf(error) });
    return { ok: false, error: didoxMessage(locale, error) };
  }
}

/** ИНН + password → token (stored sealed, valid 360 minutes; the password is not kept). Off unless DIDOX_PASSWORD_LOGIN=1. */
export async function passwordLogin(user: CurrentUser | null, locale: Locale, body: unknown, options: ClientOptions = {}): Promise<{ ok: true } | Fail> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (!adminOnly(user)) return { ok: false, error: e.forbidden };
  if (!passwordLoginEnabled()) return { ok: false, error: e.password_disabled };
  const input = z.object({ companyTin: z.string().regex(/^(\d{9}|\d{14})$/), password: z.string().min(1).max(200) }).safeParse(body);
  if (!input.success) return { ok: false, error: e.generic };
  try {
    const client = new DidoxClient({ baseUrl: didoxBaseUrl(), auth: { kind: 'none' }, orgKey: user.orgId, retries: 0, ...options });
    const { token } = await client.loginWithPassword(input.data.companyTin, input.data.password, locale === 'uz' ? 'uz' : 'ru');
    const data = { kind: 'token', companyTin: input.data.companyTin, tokenSealed: sealToken(token), tokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS), lastError: null, lastErrorDetail: null };
    await db.didoxConnection.upsert({ where: { orgId: user.orgId }, create: { orgId: user.orgId, createdBy: user.userId, ...data }, update: data });
    return { ok: true };
  } catch (error) {
    // 422 "Incorrect login", 423 blocked, 429 "try in XX minutes": Didox's sentence follows ours.
    const detail = error instanceof DidoxApiError && error.detail ? ` ${i18nFor(locale).ta.didoxX.sync.didoxSaid}: ${error.detail}` : '';
    return { ok: false, error: `${didoxMessage(locale, error)}${detail}` };
  }
}

// ── Sync ───────────────────────────────────────────────────────────────────────────────────

export type SyncResult = { ok: true; listed: number; imported: number; skipped: number; refused: number; failed: number; batchIds: string[] } | Fail;

/** The doctypes a sync fetches: ЭСФ, pharm ЭСФ, hybrid ЭСФ (§1.4). */
export const SYNC_DOCTYPES = '002,008,023';
/** A running sync whose heartbeat is older than this is taken over by the next status read. */
export const SYNC_STALL_MS = 90_000;
/** Errors that stop the whole run; any other error fails one document and the run goes on. */
const FATAL = new Set(['unauthorized', 'forbidden', 'locked', 'token_expired', 'rate_limited', 'network', 'timeout']);

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

/** The list entry's header totals (§1.3: `total_sum` is not the document total, so it is not read). */
export function listTotalsOf(entry: DocumentEntry): StatedTotals | null {
  const raw = entry.raw;
  const v = (key: string): string | null => (typeof raw[key] === 'number' || typeof raw[key] === 'string' ? String(raw[key]) : null);
  const totals = { amount: v('total_delivery_sum'), vat: v('total_vat_sum'), withVat: v('total_delivery_sum_with_vat') };
  return totals.amount || totals.withVat ? totals : null;
}

/** Pages of 100 one sync reads at most: a bound on a run, not on an org (100 000 documents). */
const SYNC_MAX_PAGES = 1_000;

type SyncOptions = { client?: ClientOptions; deps?: CheckDeps; maxPages?: number; env?: Record<string, string | undefined> };

const SyncBody = z.object({
  /** `yyyy-mm-dd`: documents updated on or after (Didox's dateFromUpdated). */
  dateFromUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  /** The earlier name. */
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
});

type Gate = { ok: true; user: CurrentUser; client: DidoxClient; clientId: string | null; dateFromUpdated: string | null } | Fail;

/** Who may sync, into which client, with which client object. */
async function syncGate(user: CurrentUser | null, locale: Locale, body: unknown, options: SyncOptions): Promise<Gate> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (user === null || !canWrite(user)) return { ok: false, error: e.forbidden };
  if (await isDemoOrg(user.orgId)) return { ok: false, error: e.demo };
  if (!(await uploadsOpen(user.orgId)).ok) return { ok: false, error: i18nFor(locale).ta.msg.gate.expired };
  const input = SyncBody.safeParse(body ?? {});
  if (!input.success) return { ok: false, error: e.generic };
  const found = await clientForOrg(user.orgId, options.env ?? process.env, options.client);
  if (!found.ok) return { ok: false, error: e[found.code] };
  // A scoped accountant syncs only into a client they may work on.
  if (user.clientIds != null && (!found.clientId || !user.clientIds.includes(found.clientId))) return { ok: false, error: e.client };
  return { ok: true, user, client: found.client, clientId: found.clientId, dateFromUpdated: input.data.dateFromUpdated || input.data.dateFrom || null };
}

const nowIso = (): string => new Date().toISOString();
const json = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;
/** Runs of this process, so a status read does not take over a run that is alive here. */
const runningHere = new Set<string>();

async function saveState(orgId: string, state: SyncState, extra: Prisma.DidoxConnectionUpdateInput = {}): Promise<void> {
  await db.didoxConnection.update({ where: { orgId }, data: { syncState: json({ ...state, heartbeatAt: nowIso() }), ...extra } });
}

/**
 * An invoice imported earlier whose status Didox now gives otherwise (rejected, cancelled, annulled after a
 * correction): its stored status and status issue follow, so a void one can no longer be exported (planExport
 * refuses a batch with a document error). Review 30 Oct: the sync skipped every id it had seen, status and all.
 */
async function followStatus(batch: { id: string; meta: Prisma.JsonValue }, entry: DocumentEntry): Promise<void> {
  const meta = (batch.meta ?? {}) as { didoxStatus?: string | null; didox?: { issues?: unknown; docType?: string | null; statusComment?: string | null } };
  if (!entry.status || meta.didoxStatus === entry.status) return;
  const kept = (Array.isArray(meta.didox?.issues) ? meta.didox.issues as { code?: string }[] : []).filter((i) => !STATUS_ISSUES.has(i.code ?? ''));
  const issues = [...kept, ...statusIssues(meta.didox?.docType ?? entry.doctype ?? null, entry.status, meta.didox?.statusComment ?? '')];
  await db.importBatch.update({ where: { id: batch.id }, data: { meta: json({ ...meta, didoxStatus: entry.status, didox: { ...meta.didox, issues } }) } });
}

/** The print form: from the document's archive ZIP (§1.3 row 17), else from /file/true. */
async function printForm(client: DidoxClient, id: string): Promise<Buffer | null> {
  try {
    const zip = await client.getArchive(id);
    if (zip) {
      const read = await readDidoxUpload(zip, `${id}.zip`);
      const pdf = read.kind === 'documents' ? read.documents.find((d) => d.pdf)?.pdf ?? null : null;
      if (pdf) return pdf;
    }
  } catch { /* no archive on this host: the print form below */ }
  return client.getDocumentPdf(id).catch(() => null);
}

/**
 * One sync run to its end: pages GET /v2/documents (owner 0 = incoming, ЭСФ doctypes, updated since
 * `dateFromUpdated`), skips ids already imported (a batch with that externalRef) or already cached
 * (a document refused before), imports each new one with its list totals and print form, and saves
 * the state after every page. A document that fails is counted in `failed` and the run goes on; an
 * auth, rate or network failure stops the run and is saved on the connection with Didox's words.
 */
async function runSync(orgId: string, actorId: string, client: DidoxClient, clientId: string | null, state: SyncState, options: SyncOptions): Promise<SyncState> {
  runningHere.add(orgId);
  const deps = options.deps ?? defaultDeps;
  try {
    const measures = await measuresMap(client);
    // Didox's restricted ИКПУ lists feed the rules once per run (V9), when the deps run rules at all.
    const lists = deps.rules ? await client.restrictedLists().catch(() => null) : null;
    const runDeps: CheckDeps = deps.rules && lists ? { ...deps, rules: { ...deps.rules, lists: () => Promise.resolve(lists) } } : deps;
    const maxPages = options.maxPages ?? SYNC_MAX_PAGES;
    let pages = 0;
    let lastFull = false;
    for await (const page of client.listAll({ owner: 0, doctype: SYNC_DOCTYPES, dateFromUpdated: state.dateFromUpdated ?? undefined, limit: 100 }, maxPages)) {
      pages++;
      lastFull = page.length >= 100;
      state.listed += page.length;
      state.page = page.page ?? state.page + 1;
      const ids = page.map((p) => p.id);
      const [batches, cached] = await Promise.all([
        db.importBatch.findMany({ where: { orgId, kind: 'didox_invoice', externalRef: { in: ids } }, select: { id: true, externalRef: true, meta: true } }),
        db.didoxDocument.findMany({ where: { orgId, didoxId: { in: ids } }, select: { didoxId: true } }),
      ]);
      const seen = new Set([...batches.map((b) => b.externalRef), ...cached.map((c) => c.didoxId)]);
      const imported = new Map(batches.map((b) => [b.externalRef, b]));
      for (const entry of page) {
        if (seen.has(entry.id)) {
          state.skipped++;
          const batch = imported.get(entry.id);
          if (batch) await followStatus(batch, entry);
          continue;
        }
        try {
          const doc = await client.getDocument(entry.id, 0);
          const imported = await importDocument(orgId, actorId, {
            json: doc, source: 'didox_api', clientId, didoxId: entry.id, didoxStatus: entry.status, docType: entry.doctype, measures, listTotals: listTotalsOf(entry),
          }, runDeps);
          if (imported.ok) {
            state.imported++;
            if (state.batchIds.length < 50) state.batchIds.push(imported.batchId);
            const pdf = await printForm(client, entry.id);
            if (pdf) await db.didoxDocument.update({ where: { orgId_didoxId: { orgId, didoxId: entry.id } }, data: { pdf: bytes(pdf) } });
          } else {
            // Refused (not an invoice, a duplicate under another id, unreadable): cached so the next sync skips it.
            state.refused++;
            await db.didoxDocument.upsert({
              where: { orgId_didoxId: { orgId, didoxId: entry.id } },
              create: { orgId, didoxId: entry.id, source: 'didox_api', docType: entry.doctype, status: entry.status, json: json(doc ?? {}) },
              update: { status: entry.status },
            });
          }
        } catch (error) {
          if (error instanceof DidoxApiError && FATAL.has(error.code)) throw error;
          state.failed++;
          if (state.failures.length < 20) state.failures.push({ id: entry.id, error: error instanceof DidoxApiError ? `${error.code}${error.detail ? `: ${error.detail}` : ''}`.slice(0, 300) : 'error' });
        }
      }
      await saveState(orgId, state);
    }
    // The page limit ended the run with documents left: said on the run, never a quiet "done" (review 30 Oct, R-D6).
    if (pages >= maxPages && lastFull) state.failures.push({ id: '(list)', error: `list_truncated: stopped after ${pages} pages of 100 (one run's limit); older documents were not read, sync a shorter date range` });
    const done: SyncState = { ...state, status: 'done', finishedAt: nowIso(), error: null, detail: null };
    await saveState(orgId, done, { lastError: null, lastErrorDetail: null, lastSyncAt: new Date() });
    return done;
  } catch (error) {
    const failure = failureOf(error);
    const failed: SyncState = { ...state, status: 'failed', finishedAt: nowIso(), error: failure.lastError, detail: failure.lastErrorDetail };
    await saveState(orgId, failed, { ...failure, lastSyncAt: new Date() }).catch(() => undefined);
    if (!(error instanceof DidoxApiError)) throw error;
    return failed;
  } finally {
    runningHere.delete(orgId);
  }
}

const freshState = (user: CurrentUser, clientId: string | null, dateFromUpdated: string | null): SyncState => ({
  status: 'running', dateFromUpdated, page: 0, listed: 0, imported: 0, skipped: 0, refused: 0, failed: 0, batchIds: [], failures: [],
  startedAt: nowIso(), heartbeatAt: nowIso(), finishedAt: null, error: null, detail: null, startedBy: user.userId, clientId,
});

/** The run to its end, in the request (tests, scripts). The UI uses startSync. */
export async function syncIncoming(user: CurrentUser | null, locale: Locale, body: unknown, options: SyncOptions = {}): Promise<SyncResult> {
  const gate = await syncGate(user, locale, body, options);
  if (!gate.ok) return gate;
  const state = freshState(gate.user, gate.clientId, gate.dateFromUpdated);
  await saveState(gate.user.orgId, state);
  const end = await runSync(gate.user.orgId, gate.user.userId, gate.client, gate.clientId, state, options);
  if (end.status === 'failed') return { ok: false, error: didoxMessage(locale, new DidoxApiError((end.error ?? 'client') as DidoxApiError['code'], null, '')) };
  const { listed, imported, skipped, refused, failed, batchIds } = end;
  return { ok: true, listed, imported, skipped, refused, failed, batchIds };
}

const stalled = (state: SyncState | null): boolean => state?.status === 'running' && Date.now() - Date.parse(state.heartbeatAt) > SYNC_STALL_MS;

/** "Fetch new incoming invoices": starts the run in the background and answers its first state. */
export async function startSync(user: CurrentUser | null, locale: Locale, body: unknown, options: SyncOptions = {}): Promise<{ ok: true; state: SyncState } | Fail> {
  const gate = await syncGate(user, locale, body, options);
  if (!gate.ok) return gate;
  const orgId = gate.user.orgId;
  const current = readState((await db.didoxConnection.findUnique({ where: { orgId }, select: { syncState: true } }))?.syncState);
  if (current?.status === 'running' && (runningHere.has(orgId) || !stalled(current))) return { ok: false, error: i18nFor(locale).ta.didoxX.errors.sync_running };
  const state = freshState(gate.user, gate.clientId, gate.dateFromUpdated);
  await saveState(orgId, state);
  void runSync(orgId, gate.user.userId, gate.client, gate.clientId, { ...state }, options).catch((error: unknown) => console.error('didox sync', error instanceof Error ? error.message : 'error'));
  return { ok: true, state };
}

/**
 * The sync's state for the list page; resumes a run that stopped without finishing (its heartbeat is
 * older than SYNC_STALL_MS and it is not running in this process), from page 1 of the same date.
 */
export async function syncStatus(user: CurrentUser, options: SyncOptions = {}): Promise<SyncState | null> {
  const c = await db.didoxConnection.findUnique({ where: { orgId: user.orgId }, select: { syncState: true } });
  const state = readState(c?.syncState);
  if (!state || !stalled(state) || runningHere.has(user.orgId)) return state;
  const found = await clientForOrg(user.orgId, options.env ?? process.env, options.client);
  if (!found.ok) {
    const failed: SyncState = { ...state, status: 'failed', finishedAt: nowIso(), error: found.code, detail: null };
    await saveState(user.orgId, failed);
    return failed;
  }
  const resumed: SyncState = { ...state, page: 0, heartbeatAt: nowIso() };
  await saveState(user.orgId, resumed);
  void runSync(user.orgId, state.startedBy, found.client, state.clientId, resumed, options).catch((error: unknown) => console.error('didox sync', error instanceof Error ? error.message : 'error'));
  return resumed;
}
