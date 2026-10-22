// After a classifier import: re-check the latest catalogue of every client
// against the new snapshot. Only rows whose code (the accepted one, else the
// file's) changed are re-checked, and only problems the catalogue does not
// already carry are added — a reviewer's earlier decisions are never undone.
import type { ClassifierChangeKind } from '@prisma/client';
import { auditContext, checkItem, findingData, type AuditContext } from './audit-runner.js';
import { db } from '@tasnivo/db';
import { orgLocale } from './org-locale.js';
import { updateBody, updateTitle, type UpdateCounts } from './notification-text.js';
import { notify } from './notifications.js';

export type ClientRecheck = UpdateCounts & { clientId: string; clientName: string; catalogId: string; affectedRows: number };

/**
 * Prefix that tells a reviewer why a finding appeared after the original audit. Uzbek on purpose:
 * finding.reason is the Uzbek explanation (see the API contract); the Russian UI does not show it.
 * The notification below is rendered in the org's language instead.
 */
const UPDATE_PREFIX = 'Tasniflagich yangilandi: ';

/** Code → kinds of change that matter to an existing row. Added codes cannot break one. */
async function changedCodes(snapshotId: number): Promise<Map<string, Set<ClassifierChangeKind>>> {
  const changes = await db.classifierChange.findMany({
    where: { snapshotId, kind: { in: ['retired', 'unit_changed', 'name_changed'] } },
    select: { code: true, kind: true },
  });
  const byCode = new Map<string, Set<ClassifierChangeKind>>();
  for (const c of changes) {
    const code = c.code.trim();
    byCode.set(code, (byCode.get(code) ?? new Set()).add(c.kind));
  }
  return byCode;
}

type Target = { clientId: string; clientName: string; orgId: string; catalogId: string; filename: string };

/** Each real client's latest audited catalogue. Demo copies and the demo template are left alone. */
async function targets(): Promise<Target[]> {
  const clients = await db.client.findMany({
    where: { org: { kind: { in: ['customer', 'internal'] } } },
    select: {
      id: true, name: true, orgId: true,
      catalogs: { where: { status: 'ready' }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, filename: true } },
    },
  });
  return clients.flatMap((c) => (c.catalogs[0]
    ? [{ clientId: c.id, clientName: c.name, orgId: c.orgId, catalogId: c.catalogs[0].id, filename: c.catalogs[0].filename }]
    : []));
}

async function recheckCatalog(target: Target, snapshotId: number, byCode: Map<string, Set<ClassifierChangeKind>>, ctx: AuditContext): Promise<ClientRecheck> {
  const codes = [...byCode.keys()];
  const items = await db.catalogItem.findMany({
    where: {
      catalogId: target.catalogId,
      OR: [
        { existingMxik: { in: codes } },
        { findings: { some: { decision: 'accepted', chosenMxik: { in: codes } } } },
      ],
    },
    select: {
      id: true, rawName: true, barcode: true, existingMxik: true, unit: true,
      findings: { select: { type: true, decision: true, chosenMxik: true, decidedAt: true } },
    },
  });

  const counted = { retired: new Set<string>(), unit_changed: new Set<string>(), name_changed: new Set<string>() };
  let newFindings = 0;
  let affectedRows = 0;
  for (const item of items) {
    // The code the row carries now: an accepted correction wins over the file's.
    const accepted = item.findings
      .filter((f) => f.decision === 'accepted' && f.chosenMxik)
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0];
    const code = accepted?.chosenMxik ?? item.existingMxik;
    const kinds = code ? byCode.get(code) : undefined;
    if (!code || !kinds) continue;
    affectedRows++;
    for (const kind of kinds) if (kind !== 'added') counted[kind].add(code);

    const { findings, markingRequired } = await checkItem({ ...item, existingMxik: code }, ctx);
    // Skip what the row already carries, pending or dismissed by the reviewer.
    const known = new Set(item.findings.filter((f) => f.decision !== 'accepted').map((f) => f.type));
    const fresh = findings
      .filter((f) => !known.has(f.type))
      .map((f) => ({ ...f, reason: `${UPDATE_PREFIX}${f.reason}` }));
    if (fresh.length > 0) {
      await db.finding.createMany({ data: findingData(item.id, fresh, snapshotId) });
      newFindings += fresh.length;
    }
    if (markingRequired) await db.catalogItem.update({ where: { id: item.id }, data: { markingRequired: true } });
  }

  return {
    clientId: target.clientId,
    clientName: target.clientName,
    catalogId: target.catalogId,
    affectedRows,
    archived: counted.retired.size,
    unitChanged: counted.unit_changed.size,
    nameChanged: counted.name_changed.size,
    newFindings,
  };
}

/**
 * Re-checks every client's latest catalogue against snapshot `snapshotId`,
 * records a "classifier.updated" event per affected client and notifies its
 * org. Safe to re-run: findings already present are not added twice.
 */
export async function recheckAfterUpdate(snapshotId: number, log: (line: string) => void = console.log): Promise<ClientRecheck[]> {
  const snapshot = await db.catalogSnapshot.findUnique({ where: { id: snapshotId }, select: { takenAt: true } });
  if (!snapshot) throw new Error(`no snapshot ${snapshotId}`);
  const byCode = await changedCodes(snapshotId);
  const results: ClientRecheck[] = [];
  if (byCode.size > 0) {
    const contexts = new Map<string, AuditContext>();
    for (const target of await targets()) {
      const ctx = contexts.get(target.orgId) ?? await auditContext(target.orgId);
      contexts.set(target.orgId, ctx);
      const result = await recheckCatalog(target, snapshotId, byCode, ctx);
      if (result.affectedRows === 0) continue;
      results.push(result);
      log(`  ${target.clientName}: ${result.affectedRows} rows affected, ${result.newFindings} new findings`);

      const locale = await orgLocale(target.orgId);
      const title = updateTitle(target.clientName, result, locale);
      await db.auditEvent.create({
        data: {
          orgId: target.orgId, actorId: null, action: 'classifier.updated', targetId: target.catalogId,
          payload: { ...result, snapshotId, summary: title },
        },
      });
      await notify({
        orgId: target.orgId,
        clientId: target.clientId,
        kind: 'classifier.updated',
        title,
        body: updateBody(result, target.filename, snapshot.takenAt, locale),
        href: `/catalogs/${target.catalogId}`,
      });
    }
  }
  await db.catalogSnapshot.update({ where: { id: snapshotId }, data: { recheckedAt: new Date() } });
  return results;
}
