// Background audits. An upload returns as soon as its rows are stored; the
// audit then runs in this server process and records its progress on the
// catalogue, so the report can show it. If the process dies mid-audit, the
// next server start (src/instrumentation.ts) or a stale heartbeat resumes it
// from the last fully audited row.
import type { Prisma } from '@prisma/client';
import { HEARTBEAT_MS } from './audit-heartbeat.js';
import { auditCatalog } from './audit-runner.js';
import { catalogScope } from './access.js';
import { isOrgWriter } from './actor-role.js';
import { db } from '@tasnivo/db';
import { isDemoOrg } from './demo.js';
import { acceptDictionaryMatches } from './dictionary-accept.js';
import { auditReadyText } from './notification-text.js';
import { notify } from './notifications.js';
import { orgLocale } from './org-locale.js';
import { runPrivilegeCheck } from './privileges.js';
import { completeFor } from './reminders.js';
import { carryOver, linkPrevious } from './versions.js';
import { runPurchaseCheck } from './purchases.js';

/** Without a heartbeat for this long, an "analyzing" catalogue is presumed orphaned. */
export const STALE_MS = 120_000;
/**
 * On server start, missing a few beats is enough: the old process is gone. Not
 * 0, because a CLI script (seed, perf) may be auditing in another process.
 */
export const STARTUP_STALE_MS = 5 * HEARTBEAT_MS;

const running = new Set<string>();

/** The org's setting, not the uploader, accepts these: recorded as the system with source dictionary_auto. */
async function autoAcceptDictionary(catalogId: string, actor: AuditActor): Promise<void> {
  const catalog = await db.catalog.findUnique({ where: { id: catalogId }, select: { orgId: true, org: { select: { dictAutoAccept: true } } } });
  if (!catalog?.org.dictAutoAccept) return;
  await acceptDictionaryMatches({ orgId: catalog.orgId, userId: actor?.userId ?? null }, catalogId, 'auto');
}

export type AuditActor = { orgId: string; userId: string } | null;

/** Marks the catalogue as analyzing and starts its audit without waiting for it. */
export async function startAudit(catalogId: string, actor: AuditActor, extra: Prisma.InputJsonObject = {}): Promise<void> {
  await linkPrevious(catalogId);
  await db.catalog.update({
    where: { id: catalogId },
    data: { status: 'analyzing', progressDone: 0, auditStartedAt: new Date(), auditHeartbeatAt: new Date(), auditError: null },
  });
  launch(catalogId, 0, actor, extra);
}

function launch(catalogId: string, fromRow: number, actor: AuditActor, extra: Prisma.InputJsonObject): void {
  if (running.has(catalogId)) return;
  running.add(catalogId);
  void run(catalogId, fromRow, actor, extra).finally(() => running.delete(catalogId));
}

async function run(catalogId: string, fromRow: number, actor: AuditActor, extra: Prisma.InputJsonObject): Promise<void> {
  const started = Date.now();
  try {
    // Rows at or past the resume point may have half-written findings.
    if (fromRow > 0) await db.finding.deleteMany({ where: { item: { catalogId, rowIndex: { gte: fromRow } } } });

    // auditCatalog keeps the heartbeat and watermark current while it runs.
    const outcome = await auditCatalog(catalogId, { fromRow });
    // Sales against the client's purchases, when it has any.
    await runPurchaseCheck(catalogId);
    // Privilege-linked codes, from the classifier's own privilege column.
    await runPrivilegeCheck(catalogId);
    // Decisions on rows that did not change since the client's last version carry over.
    await carryOver(catalogId, actor?.userId ?? null);
    // Dictionary matches are accepted for the org when it chose so.
    await autoAcceptDictionary(catalogId, actor);

    const catalog = await db.catalog.update({
      where: { id: catalogId },
      data: { status: 'ready', progressDone: await db.catalogItem.count({ where: { catalogId } }), auditHeartbeatAt: new Date() },
      select: { orgId: true, rowCount: true, clientId: true, filename: true, auditStartedAt: true, client: { select: { name: true } } },
    });
    // A catalogue audited for the client settles its open monthly checks.
    if (catalog.clientId) await completeFor(catalog.clientId);
    await db.auditEvent.create({
      data: {
        orgId: catalog.orgId, actorId: actor?.userId ?? null, action: 'catalog.audited', targetId: catalogId,
        payload: {
          itemsAudited: catalog.rowCount,
          findingsCreated: await db.finding.count({ where: { item: { catalogId } } }),
          degraded: outcome.degraded,
          degradedReasons: outcome.degradedReasons,
          degradedCodes: outcome.pipelineMeta.degradedReasons,
          llm: outcome.llm,
          durationMs: Date.now() - started,
          resumedFromRow: fromRow,
          ...extra,
        },
      },
    });
    await notifyReady(catalogId, catalog, actor);
  } catch (error) {
    // Logged here once, with the stack; the page shows only its localized message.
    console.error(`[audit ${catalogId}] failed`, error);
    await db.catalog.update({
      where: { id: catalogId },
      data: { status: 'failed', auditError: error instanceof Error ? error.message.slice(0, 500) : 'failed' },
    }).catch(() => undefined);
  }
  await replyToTelegram(catalogId);
}

/**
 * Tells the person who started the audit (or, for a resumed one, everyone who may see the client) that
 * it is done. Once per run: a resumed audit keeps its start time, so it keeps its key. Never fails the audit.
 */
async function notifyReady(
  catalogId: string,
  catalog: { orgId: string; clientId: string | null; filename: string; auditStartedAt: Date | null; client: { name: string } | null },
  actor: AuditActor,
): Promise<void> {
  try {
    if (!catalog.clientId || await isDemoOrg(catalog.orgId)) return;
    const [locale, open] = await Promise.all([
      orgLocale(catalog.orgId),
      db.finding.count({ where: { item: { catalogId }, decision: 'pending' } }),
    ]);
    const text = auditReadyText({ clientName: catalog.client?.name ?? '', filename: catalog.filename, open }, locale);
    await notify({
      orgId: catalog.orgId, clientId: catalog.clientId, userId: actor?.userId ?? null, kind: 'catalog.ready', ...text,
      href: `/catalogs/${catalogId}`, dedupeKey: `catalog.ready:${catalogId}:${catalog.auditStartedAt?.getTime() ?? 0}`, external: false,
    });
  } catch (error) {
    console.warn(`[audit ${catalogId}] notification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A catalogue that came through the bot gets its summary (or failure) back there. */
async function replyToTelegram(catalogId: string): Promise<void> {
  try {
    const { sendAuditSummary } = await import('./telegram/deliver.js');
    await sendAuditSummary(catalogId);
  } catch (error) {
    console.warn(`[audit ${catalogId}] telegram reply failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Resumes audits that no live worker is running: every "analyzing" catalogue
 * whose heartbeat is older than `staleMs` (STARTUP_STALE_MS on server start).
 * Optionally limited to one catalogue.
 */
export async function resumeStaleAudits(staleMs = STALE_MS, catalogId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const stale = await db.catalog.findMany({
    where: {
      status: 'analyzing',
      ...(catalogId ? { id: catalogId } : {}),
      OR: [{ auditHeartbeatAt: null }, { auditHeartbeatAt: { lt: cutoff } }],
    },
    select: { id: true, progressDone: true },
  });
  for (const c of stale) launch(c.id, c.progressDone, null, { resumed: true });
  return stale.filter((c) => running.has(c.id)).length;
}

export function isAuditRunning(catalogId: string): boolean {
  return running.has(catalogId);
}

/** Restarts a failed audit from scratch, for a writer (not a viewer) who may see the catalogue. */
export async function retryAudit(actor: { orgId: string; userId: string; clientIds?: string[] | null }, catalogId: string): Promise<boolean> {
  if (!(await isOrgWriter(actor.orgId, actor.userId))) return false;
  const catalog = await db.catalog.findFirst({
    where: { id: catalogId, ...catalogScope(actor), status: 'failed' },
    select: { id: true },
  });
  if (!catalog) return false;
  await db.finding.deleteMany({ where: { item: { catalogId } } });
  await startAudit(catalogId, actor, { retried: true });
  return true;
}
