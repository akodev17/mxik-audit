// Report PDF of one of the org's audited catalogues: internal (with who decided)
// or client-facing (?audience=client). ?download=1 sends it as an attachment.
import { NextResponse } from 'next/server';
import { catalogScope } from '@/lib/access';
import { db } from '@/lib/db';
import { baseName, contentDisposition } from '@/lib/export-filename';
import { getI18n } from '@/lib/locale';
import { reportPdfData } from '@/lib/pdf/report-data';
import { buildReportPdf, type PdfAudience } from '@/lib/pdf/report-pdf';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const catalogId = url.searchParams.get('catalog');
  if (!catalogId) return NextResponse.json({ error: 'no catalog' }, { status: 400 });
  const audience: PdfAudience = url.searchParams.get('audience') === 'client' ? 'client' : 'internal';

  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(user) }, select: { id: true, status: true, clientId: true } });
  // Another org's catalogue is the same 404 as a missing one.
  if (!catalog) return NextResponse.json({ error: 'no catalog' }, { status: 404 });
  if (catalog.status !== 'ready') return NextResponse.json({ error: 'audit not finished' }, { status: 409 });
  const data = await reportPdfData(user.orgId, catalogId);
  if (!data) return NextResponse.json({ error: 'no catalog' }, { status: 404 });
  const { locale, ta } = await getI18n();
  const pdf = await buildReportPdf(data, locale, audience);

  await db.auditEvent.create({
    data: {
      orgId: user.orgId, actorId: user.userId, action: 'catalog.pdf_exported', targetId: catalogId,
      payload: { catalogId, clientId: catalog.clientId, rows: data.rows.length, audience },
    },
  });
  const suffix = audience === 'client' ? ta.importX.exp.suffix.pdfClient : ta.importX.exp.suffix.pdf;
  const kind = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': contentDisposition(kind, `${baseName(data.filename)}-${suffix}.pdf`),
      'cache-control': 'no-store',
    },
  });
}
