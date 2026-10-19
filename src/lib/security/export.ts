// The account data export: one zip with the org's data as Excel and JSON. Org-scoped; admin only.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { db } from '../db';

const PAGE = 2000;
const MAX_EVENTS = 100_000;

const safeName = (s: string): string => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60) || 'catalog';
const json = (value: unknown): string => JSON.stringify(value, null, 2);

async function catalogSheet(catalogId: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Katalog');
  sheet.addRow(['row', 'name', 'barcode', 'unit', 'current_mxik', 'finding', 'severity', 'suggested_mxik', 'confidence', 'decision', 'chosen_mxik', 'reason']).font = { bold: true };
  let cursor: string | undefined;
  for (;;) {
    const items = await db.catalogItem.findMany({
      where: { catalogId }, orderBy: { id: 'asc' }, take: PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { findings: { select: { type: true, severity: true, suggestedMxik: true, confidence: true, decision: true, chosenMxik: true, reason: true } } },
    });
    if (items.length === 0) break;
    for (const item of items) {
      const base = [item.rowIndex + 1, item.rawName, item.barcode ?? '', item.unit ?? '', item.existingMxik ?? ''];
      if (item.findings.length === 0) sheet.addRow([...base, '', '', '', '', '', '', '']);
      for (const f of item.findings) sheet.addRow([...base, f.type, f.severity, f.suggestedMxik ?? '', f.confidence ?? '', f.decision, f.chosenMxik ?? '', f.reason]);
    }
    cursor = items[items.length - 1]?.id;
    if (items.length < PAGE) break;
  }
  sheet.getColumn(5).numFmt = '@';
  sheet.getColumn(8).numFmt = '@';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function buildAccountExport(orgId: string): Promise<Buffer> {
  const [org, clients, users, catalogs, dictionary, events] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, brandName: true, createdAt: true, rawRetentionDays: true } }),
    db.client.findMany({ where: { orgId }, select: { id: true, name: true, activity: true, createdAt: true } }),
    db.user.findMany({ where: { orgId }, select: { email: true, role: true, createdAt: true, totpEnabledAt: true, assignments: { select: { clientId: true } } } }),
    db.catalog.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true, clientId: true, filename: true, rowCount: true, status: true, createdAt: true } }),
    db.firmMapping.findMany({ where: { orgId }, select: { kind: true, label: true, unit: true, code: true, uses: true, createdAt: true, updatedAt: true } }),
    db.auditEvent.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: MAX_EVENTS, select: { action: true, actorId: true, targetId: true, payload: true, createdAt: true } }),
  ]);

  const zip = new JSZip();
  zip.file('README.txt', 'MXIK Audit account export.\n\norganization.json, team.json, clients.json, dictionary.json, activity.json: the account data.\ncatalogs.json lists every catalogue; catalogs/*.xlsx holds each catalogue with its findings and decisions.\nPassword hashes, API keys, two-factor secrets and recovery codes are never exported.\n');
  zip.file('organization.json', json(org));
  zip.file('team.json', json(users.map((u) => ({ email: u.email, role: u.role, createdAt: u.createdAt, twoFactor: u.totpEnabledAt !== null, clientIds: u.assignments.map((a) => a.clientId) }))));
  zip.file('clients.json', json(clients));
  zip.file('dictionary.json', json(dictionary));
  zip.file('activity.json', json(events));
  zip.file('catalogs.json', json(catalogs));
  for (const [i, c] of catalogs.entries()) {
    zip.file(`catalogs/${String(i + 1).padStart(3, '0')}-${safeName(c.filename.replace(/\.[^.]+$/, ''))}.xlsx`, await catalogSheet(c.id));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
