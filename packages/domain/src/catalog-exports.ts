// The downloads of a catalogue (corrected xlsx / 1C file, report CSV, report PDF, diff CSV), the
// share link's PDF and the blank list templates. The web's route handlers and the API's controllers
// both call these: each answers the file with its headers, or the refusal (status, code, message)
// the old route answered. Every catalogue is scoped like the routes: another org's or another
// client's catalogue is the same 404 as a missing one.
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { restrictionDate } from '@tasnivo/core/audit/checks';
import { db } from '@tasnivo/db';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { typeLabels } from '@tasnivo/i18n/type-labels';
import { catalogScope } from './access.js';
import { billingConfig } from './billing/config.js';
import { catalogPaid } from './billing/orders.js';
import { resolveCatalog } from './catalogs.js';
import { isDemoOrg } from './demo.js';
import { demoMaxExports } from './demo-config.js';
import { diffCsv } from './diff-csv.js';
import type { DocKind } from './docs.js';
import { build1cCsv, build1cXlsx, type OneCRow } from './export-1c.js';
import { baseName, contentDisposition } from './export-filename.js';
import { codeRestrictions, codeUnits, exportItems, exportPackaging, exportUnit } from './export-rows.js';
import { reportPdfData } from './pdf/report-data.js';
import { buildReportPdf, type PdfAudience } from './pdf/report-pdf.js';
import { reportCsv } from './report-csv.js';
import { hit } from './security/rate-limit.js';
import type { CurrentUser } from './session.js';
import { resolveShare } from './share.js';
import { buildExport, type ExportRow } from './spreadsheet.js';
import { versionDiff } from './versions.js';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const CSV_TYPE = 'text/csv; charset=utf-8';
export const PDF_TYPE = 'application/pdf';

/** A file ready to send: the bytes and every response header the old route set. */
export type FileOut = { body: Uint8Array | string; headers: Record<string, string> };
/** A refusal: the status and the old route's message (the API adds a code for the error envelope). */
export type Refusal = { status: number; code: string; message: string };
export type Download = { ok: true; file: FileOut } | ({ ok: false } & Refusal);

type Viewer = Pick<CurrentUser, 'userId' | 'orgId' | 'clientIds'>;

const refuse = (status: number, code: string, message: string): Download => ({ ok: false, status, code, message });
const NO_CATALOG = refuse(404, 'not_found', 'no catalog');
const NOT_FINISHED = refuse(409, 'audit_not_finished', 'audit not finished');

const file = (body: Uint8Array | string, type: string, disposition: string, cache = 'no-store', extra: Record<string, string> = {}): Download =>
  ({ ok: true, file: { body, headers: { 'content-type': type, 'content-disposition': disposition, 'cache-control': cache, ...extra } } });

/**
 * Whether this demo has used up its downloads (each call counts one). A demo shows synthetic data
 * only, but downloads are capped per demo org so it cannot be used to pull files in bulk. Any
 * other org: false. Reads the org's kind from the database, not from the cookie.
 */
export async function demoExportRefused(orgId: string): Promise<boolean> {
  if (!(await isDemoOrg(orgId))) return false;
  const verdict = await hit({ kind: 'demo_export', limit: demoMaxExports(), windowMs: 24 * 3_600_000 }, orgId);
  return !verdict.allowed;
}

const DEMO_LIMIT = refuse(429, 'demo_limit', 'demo download limit reached');

const StoredMap = z.object({ mxik: z.number(), unit: z.number() });
export const EXPORT_FORMATS = ['xlsx', '1c', '1c-xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Rebuilds the uploaded file with accepted decisions applied (format=xlsx), or
 * the 1C file as CSV (format=1c) or .xlsx (format=1c-xlsx). Rows with a risky
 * finding still pending are marked partly reviewed or not reviewed, never clean;
 * rejected and undecided rows keep the code they came in with.
 */
export async function catalogExport(user: Viewer, locale: Locale, catalogId: string | null, requestedFormat: string | null): Promise<Download> {
  const x = i18nFor(locale).ta.importX.exp;
  const format: ExportFormat = EXPORT_FORMATS.find((f) => f === requestedFormat) ?? 'xlsx';
  // Any catalogue the user may see; another org's id is the same 404 as a missing one.
  const catalog = catalogId ? await resolveCatalog(user.orgId, catalogId, null, user.clientIds) : null;
  if (!catalog) return NO_CATALOG;
  // An unaudited catalogue would export every row as clean.
  if (catalog.status !== 'ready') return NOT_FINISHED;
  // Only when the operator turned payment on for exports.
  if (billingConfig().requiredForExport && !(await catalogPaid(user.orgId, catalog.id))) return refuse(402, 'payment_required', 'payment required');
  if (await demoExportRefused(user.orgId)) return DEMO_LIMIT;
  const mapping = StoredMap.safeParse(catalog.columnMap);
  if (!mapping.success) return refuse(500, 'bad_mapping', 'bad mapping');

  const items = await exportItems(catalog.id);
  const accepted = [...new Set(items.flatMap((i) => (i.effective.acceptedCode ? [i.effective.acceptedCode] : [])))];
  const [units, restrictions] = await Promise.all([
    codeUnits(accepted),
    codeRestrictions(items.flatMap((i) => (i.effective.code ? [i.effective.code] : []))),
  ]);
  // Judged on the code the file leaves with: an accepted detailed code clears it.
  const restrictedText = (code: string | null): string => {
    const from = code ? restrictions.get(code) : undefined;
    return from ? x.restrictedFrom(restrictionDate(from)) : '';
  };
  const rows: ExportRow[] = items.map((item) => ({
    original: item.original,
    mxik: item.effective.code ?? '',
    unit: exportUnit(item, units),
    packaging: exportPackaging(item, units),
    auditStatus: x.status[item.effective.review],
    restricted: restrictedText(item.effective.code),
  }));

  const base = baseName(catalog.filename);
  const build = async (): Promise<{ body: Uint8Array; type: string; filename: string }> => {
    if (format === '1c' || format === '1c-xlsx') {
      const oneC: OneCRow[] = items.map((item, i) => ({
        name: item.rawName, mxik: rows[i]?.mxik ?? '', unit: rows[i]?.unit ?? '', barcode: item.barcode ?? '', auditStatus: rows[i]?.auditStatus ?? '',
        restricted: rows[i]?.restricted ?? '',
      }));
      if (format === '1c') return { body: new Uint8Array(build1cCsv(oneC, x.oneC)), type: CSV_TYPE, filename: `${base}-${x.suffix.oneC}.csv` };
      return { body: new Uint8Array(await build1cXlsx(oneC, x.oneC)), type: XLSX_TYPE, filename: `${base}-${x.suffix.oneC}.xlsx` };
    }
    const buffer = await buildExport({
      headers: catalog.headers,
      rows,
      mxikColumn: mapping.data.mxik >= 0 ? mapping.data.mxik : null,
      unitColumn: mapping.data.unit >= 0 ? mapping.data.unit : null,
      labels: { mxik: x.columns.mxik, unit: x.columns.unit, packaging: x.columns.packaging, auditStatus: x.columns.status, restricted: x.columns.restricted },
      sheetName: x.sheet,
    });
    return { body: new Uint8Array(buffer), type: XLSX_TYPE, filename: `${base}-${x.suffix.xlsx}.xlsx` };
  };
  const built = await build();

  // Logged only once the file exists: a failed build is not an export.
  const count = (review: string): number => items.filter((i) => i.effective.review === review).length;
  await db.auditEvent.create({
    data: {
      orgId: user.orgId, actorId: user.userId, action: 'catalog.exported', targetId: catalog.id,
      payload: {
        catalogId: catalog.id, clientId: catalog.clientId, format, rows: rows.length,
        acceptedCodes: accepted.length, partialRows: count('partial'), pendingRows: count('pending'),
      },
    },
  });
  return file(built.body, built.type, contentDisposition('attachment', built.filename));
}

/**
 * The comparison of a catalogue with its previous version (or with `with`, another earlier catalogue of
 * the same client) as a CSV file: every changed row, not just the first page shown on screen.
 */
export async function catalogDiffCsv(user: Viewer, locale: Locale, catalogId: string | null, against: string | null): Promise<Download> {
  const catalog = catalogId ? await resolveCatalog(user.orgId, catalogId, null, user.clientIds) : null;
  if (!catalog) return NO_CATALOG;
  if (catalog.status !== 'ready') return NOT_FINISHED;
  if (await demoExportRefused(user.orgId)) return DEMO_LIMIT;
  const diff = await versionDiff(user.orgId, catalog.id, against || undefined, { limit: Number.MAX_SAFE_INTEGER, offset: 0 });
  if (!diff) return refuse(404, 'nothing_to_compare', 'nothing to compare');
  const d = i18nFor(locale).ta.importX.diff;
  const csv = diffCsv(diff, { ...d.csv, notes: d.notes });
  return file(csv, CSV_TYPE, contentDisposition('attachment', `${baseName(catalog.filename)}-farq.csv`), 'private, no-store');
}

/** The catalogue for the report downloads: in scope and audited. */
async function reportCatalog(user: Viewer, catalogId: string | null): Promise<{ ok: true; id: string; clientId: string | null } | { ok: false; refusal: Download }> {
  if (!catalogId) return { ok: false, refusal: refuse(400, 'invalid_request', 'no catalog') };
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(user) }, select: { id: true, status: true, clientId: true } });
  if (!catalog) return { ok: false, refusal: NO_CATALOG };
  if (catalog.status !== 'ready') return { ok: false, refusal: NOT_FINISHED };
  if (await demoExportRefused(user.orgId)) return { ok: false, refusal: DEMO_LIMIT };
  return { ok: true, id: catalog.id, clientId: catalog.clientId };
}

/** The report's risky findings with their suggestions and decisions as a CSV file. The same data as the PDF, scoped the same way. */
export async function catalogReportCsv(user: Viewer, locale: Locale, catalogId: string | null): Promise<Download> {
  const catalog = await reportCatalog(user, catalogId);
  if (!catalog.ok) return catalog.refusal;
  const data = await reportPdfData(user.orgId, catalog.id);
  if (!data) return NO_CATALOG;
  const { t, ta } = i18nFor(locale);
  const r = ta.importX.report;
  const csv = reportCsv(data.rows, {
    columns: r.csvColumns,
    decisions: { pending: r.pendingWord, accepted: ta.importX.diff.decisions.accepted, rejected: ta.importX.diff.decisions.rejected },
    types: typeLabels(t),
    sources: ta.matchX.decisionSource,
  });
  await db.auditEvent.create({
    data: { orgId: user.orgId, actorId: user.userId, action: 'catalog.report_csv_exported', targetId: catalog.id, payload: { catalogId: catalog.id, clientId: catalog.clientId, rows: data.rows.length } },
  });
  return file(csv, CSV_TYPE, contentDisposition('attachment', `${baseName(data.filename)}-topilmalar.csv`), 'private, no-store');
}

/** Report PDF: internal (with who decided) or client-facing; inline unless `download`. */
export async function catalogReportPdf(
  user: Viewer, locale: Locale, catalogId: string | null, options: { audience: PdfAudience; download: boolean },
): Promise<Download> {
  const catalog = await reportCatalog(user, catalogId);
  if (!catalog.ok) return catalog.refusal;
  const data = await reportPdfData(user.orgId, catalog.id);
  if (!data) return NO_CATALOG;
  const pdf = await buildReportPdf(data, locale, options.audience);
  await db.auditEvent.create({
    data: {
      orgId: user.orgId, actorId: user.userId, action: 'catalog.pdf_exported', targetId: catalog.id,
      payload: { catalogId: catalog.id, clientId: catalog.clientId, rows: data.rows.length, audience: options.audience },
    },
  });
  const x = i18nFor(locale).ta.importX.exp;
  const suffix = options.audience === 'client' ? x.suffix.pdfClient : x.suffix.pdf;
  return file(new Uint8Array(pdf), PDF_TYPE, contentDisposition(options.download ? 'attachment' : 'inline', `${baseName(data.filename)}-${suffix}.pdf`));
}

/** The client-facing PDF behind a share link, when the link allows it. No session: the token is the credential. */
export async function sharePdf(token: string, locale: Locale): Promise<Download> {
  const share = await resolveShare(token);
  if (!share?.includePdf) return refuse(404, 'not_found', 'not found');
  const data = await reportPdfData(share.orgId, share.catalogId);
  if (!data) return refuse(404, 'not_found', 'not found');
  const pdf = await buildReportPdf(data, locale, 'client');
  // The UTF-8 name keeps Cyrillic and Uzbek file names; the ASCII fallback cannot break the header.
  const filename = `${baseName(data.filename)}-${i18nFor(locale).ta.importX.exp.suffix.pdfClient}.pdf`;
  return file(new Uint8Array(pdf), PDF_TYPE, contentDisposition('inline', filename), 'private, no-store', { 'x-robots-tag': 'noindex' });
}

/** A blank cheque or sales template. Headers only: the upload flow maps whatever columns the user's file really has. */
export async function docTemplate(locale: Locale, kind: DocKind): Promise<FileOut> {
  const template = i18nFor(locale).ta.importX.templates[kind];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(template.sheet);
  sheet.addRow([...template.headers]).font = { bold: true };
  sheet.columns.forEach((c) => { c.width = 26; });
  // Codes must stay text, or Excel shows 1.7E+16 and drops leading zeros.
  sheet.getColumn(2).numFmt = '@';
  const buffer = await workbook.xlsx.writeBuffer();
  return { body: new Uint8Array(buffer), headers: { 'content-type': XLSX_TYPE, 'content-disposition': contentDisposition('attachment', template.file), 'cache-control': 'no-store' } };
}

/** An empty purchase-list template in the requester's language. Any other layout works too: the columns are chosen after upload. */
export async function purchaseTemplate(locale: Locale): Promise<FileOut> {
  const template = i18nFor(locale).ta.importX.templates.purchases;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(template.sheet);
  sheet.addRow([...template.headers]);
  sheet.getRow(1).font = { bold: true };
  // 17-digit codes must stay text, or Excel shows 1.7E+16.
  sheet.getColumn(2).numFmt = '@';
  sheet.columns.forEach((c) => { c.width = 22; });
  const buffer = await workbook.xlsx.writeBuffer();
  return { body: new Uint8Array(buffer), headers: { 'content-type': XLSX_TYPE, 'content-disposition': contentDisposition('attachment', template.file), 'cache-control': 'no-store' } };
}
