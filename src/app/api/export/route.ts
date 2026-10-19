import { NextResponse } from 'next/server';
import { z } from 'zod';
import { billingConfig } from '@/lib/billing/config';
import { catalogPaid } from '@/lib/billing/orders';
import { resolveCatalog } from '@/lib/catalogs';
import { db } from '@/lib/db';
import { build1cCsv, build1cXlsx, type OneCRow } from '@/lib/export-1c';
import { baseName, contentDisposition } from '@/lib/export-filename';
import { codeUnits, exportItems, exportPackaging, exportUnit } from '@/lib/export-rows';
import { getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { buildExport, type ExportRow } from '@/lib/spreadsheet';

export const dynamic = 'force-dynamic';

const StoredMap = z.object({ mxik: z.number(), unit: z.number() });
const FORMATS = ['xlsx', '1c', '1c-xlsx'] as const;
type Format = (typeof FORMATS)[number];

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Rebuilds the uploaded file with accepted decisions applied (format=xlsx), or
 * the 1C file as CSV (format=1c) or .xlsx (format=1c-xlsx). Rows with a risky
 * finding still pending are marked partly reviewed or not reviewed, never clean;
 * rejected and undecided rows keep the code they came in with.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ta } = await getI18n();
  const x = ta.importX.exp;

  // Any catalogue the user may see; another org's id is the same 404 as a missing one.
  const url = new URL(request.url);
  const requested = url.searchParams.get('catalog');
  const format: Format = FORMATS.find((f) => f === url.searchParams.get('format')) ?? 'xlsx';
  const catalog = requested ? await resolveCatalog(user.orgId, requested, null, user.clientIds) : null;
  if (!catalog) return NextResponse.json({ error: 'no catalog' }, { status: 404 });
  // An unaudited catalogue would export every row as clean.
  if (catalog.status !== 'ready') return NextResponse.json({ error: 'audit not finished' }, { status: 409 });
  // Only when the operator turned payment on for exports.
  if (billingConfig().requiredForExport && !(await catalogPaid(user.orgId, catalog.id))) {
    return NextResponse.json({ error: 'payment required' }, { status: 402 });
  }
  const mapping = StoredMap.safeParse(catalog.columnMap);
  if (!mapping.success) return NextResponse.json({ error: 'bad mapping' }, { status: 500 });

  const items = await exportItems(catalog.id);
  const accepted = [...new Set(items.flatMap((i) => (i.effective.acceptedCode ? [i.effective.acceptedCode] : [])))];
  const units = await codeUnits(accepted);
  const rows: ExportRow[] = items.map((item) => ({
    original: item.original,
    mxik: item.effective.code ?? '',
    unit: exportUnit(item, units),
    packaging: exportPackaging(item, units),
    auditStatus: x.status[item.effective.review],
  }));

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

  const base = baseName(catalog.filename);
  const headers = (type: string, filename: string): HeadersInit => ({
    'content-type': type,
    'content-disposition': contentDisposition('attachment', filename),
    'cache-control': 'no-store',
  });

  if (format === '1c' || format === '1c-xlsx') {
    const oneC: OneCRow[] = items.map((item, i) => ({
      name: item.rawName, mxik: rows[i]?.mxik ?? '', unit: rows[i]?.unit ?? '', barcode: item.barcode ?? '', auditStatus: rows[i]?.auditStatus ?? '',
    }));
    if (format === '1c') {
      return new NextResponse(new Uint8Array(build1cCsv(oneC, x.oneC)), { headers: headers('text/csv; charset=utf-8', `${base}-${x.suffix.oneC}.csv`) });
    }
    return new NextResponse(new Uint8Array(await build1cXlsx(oneC, x.oneC)), { headers: headers(XLSX, `${base}-${x.suffix.oneC}.xlsx`) });
  }

  const buffer = await buildExport({
    headers: catalog.headers,
    rows,
    mxikColumn: mapping.data.mxik >= 0 ? mapping.data.mxik : null,
    unitColumn: mapping.data.unit >= 0 ? mapping.data.unit : null,
    labels: { mxik: x.columns.mxik, unit: x.columns.unit, packaging: x.columns.packaging, auditStatus: x.columns.status },
    sheetName: x.sheet,
  });
  return new NextResponse(new Uint8Array(buffer), { headers: headers(XLSX, `${base}-${x.suffix.xlsx}.xlsx`) });
}
