import { NextResponse } from 'next/server';
import { z } from 'zod';
import { billingConfig } from '@tasnivo/domain/billing/config';
import { catalogPaid } from '@tasnivo/domain/billing/orders';
import { resolveCatalog } from '@tasnivo/domain/catalogs';
import { db } from '@tasnivo/db';
import { demoExportRefusal } from '@/lib/demo-limits';
import { build1cCsv, build1cXlsx, type OneCRow } from '@tasnivo/domain/export-1c';
import { baseName, contentDisposition } from '@tasnivo/domain/export-filename';
import { restrictionDate } from '@tasnivo/core/audit/checks';
import { codeRestrictions, codeUnits, exportItems, exportPackaging, exportUnit } from '@tasnivo/domain/export-rows';
import { getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { buildExport, type ExportRow } from '@tasnivo/domain/spreadsheet';

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
  const demoLimited = await demoExportRefusal(user.orgId);
  if (demoLimited) return demoLimited;
  const mapping = StoredMap.safeParse(catalog.columnMap);
  if (!mapping.success) return NextResponse.json({ error: 'bad mapping' }, { status: 500 });

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
  const build = async (): Promise<{ body: Uint8Array<ArrayBuffer>; type: string; filename: string }> => {
    if (format === '1c' || format === '1c-xlsx') {
      const oneC: OneCRow[] = items.map((item, i) => ({
        name: item.rawName, mxik: rows[i]?.mxik ?? '', unit: rows[i]?.unit ?? '', barcode: item.barcode ?? '', auditStatus: rows[i]?.auditStatus ?? '',
        restricted: rows[i]?.restricted ?? '',
      }));
      if (format === '1c') return { body: new Uint8Array(build1cCsv(oneC, x.oneC)), type: 'text/csv; charset=utf-8', filename: `${base}-${x.suffix.oneC}.csv` };
      return { body: new Uint8Array(await build1cXlsx(oneC, x.oneC)), type: XLSX, filename: `${base}-${x.suffix.oneC}.xlsx` };
    }
    const buffer = await buildExport({
      headers: catalog.headers,
      rows,
      mxikColumn: mapping.data.mxik >= 0 ? mapping.data.mxik : null,
      unitColumn: mapping.data.unit >= 0 ? mapping.data.unit : null,
      labels: { mxik: x.columns.mxik, unit: x.columns.unit, packaging: x.columns.packaging, auditStatus: x.columns.status, restricted: x.columns.restricted },
      sheetName: x.sheet,
    });
    return { body: new Uint8Array(buffer), type: XLSX, filename: `${base}-${x.suffix.xlsx}.xlsx` };
  };
  const file = await build();

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

  return new NextResponse(file.body, {
    headers: {
      'content-type': file.type,
      'content-disposition': contentDisposition('attachment', file.filename),
      'cache-control': 'no-store',
    },
  });
}
