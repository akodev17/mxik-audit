import { NextResponse } from 'next/server';
import { catalogScope } from '@/lib/access';
import { db } from '@/lib/db';
import { demoExportRefusal } from '@/lib/demo-limits';
import { baseName, contentDisposition } from '@/lib/export-filename';
import { getI18n } from '@/lib/locale';
import { reportPdfData } from '@/lib/pdf/report-data';
import { reportCsv } from '@/lib/report-csv';
import { currentUser } from '@/lib/session';
import { typeLabels } from '@/ui/labels';

export const dynamic = 'force-dynamic';

/** The report's risky findings with their suggestions and decisions as a CSV file. The same data as the PDF, scoped the same way. */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const catalogId = new URL(request.url).searchParams.get('catalog');
  if (!catalogId) return NextResponse.json({ error: 'no catalog' }, { status: 400 });
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(user) }, select: { id: true, status: true, clientId: true } });
  if (!catalog) return NextResponse.json({ error: 'no catalog' }, { status: 404 });
  if (catalog.status !== 'ready') return NextResponse.json({ error: 'audit not finished' }, { status: 409 });
  const demoLimited = await demoExportRefusal(user.orgId);
  if (demoLimited) return demoLimited;
  const data = await reportPdfData(user.orgId, catalog.id);
  if (!data) return NextResponse.json({ error: 'no catalog' }, { status: 404 });
  const { t, ta } = await getI18n();
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
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': contentDisposition('attachment', `${baseName(data.filename)}-topilmalar.csv`),
      'cache-control': 'private, no-store',
    },
  });
}
