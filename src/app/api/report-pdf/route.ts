// Client-ready PDF of one of the org's audited catalogues.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { reportPdfData } from '@/lib/pdf/report-data';
import { buildReportPdf } from '@/lib/pdf/report-pdf';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const catalogId = new URL(request.url).searchParams.get('catalog');
  if (!catalogId) return NextResponse.json({ error: 'no catalog' }, { status: 400 });

  // Another org's catalogue is the same 404 as a missing or unfinished one.
  const data = await reportPdfData(user.orgId, catalogId);
  if (!data) return NextResponse.json({ error: 'no catalog' }, { status: 404 });
  const pdf = await buildReportPdf(data);

  await db.auditEvent.create({
    data: {
      orgId: user.orgId, actorId: user.userId, action: 'catalog.pdf_exported', targetId: catalogId,
      payload: { catalogId, rows: data.rows.length },
    },
  });
  const base = data.filename.replace(/\.(xlsx|csv)$/i, '');
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${encodeURIComponent(base)}-mxik-hisobot.pdf"`,
      'cache-control': 'no-store',
    },
  });
}
