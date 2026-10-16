// The PDF behind a share link, when the link allows it.
import { NextResponse } from 'next/server';
import { reportPdfData } from '@/lib/pdf/report-data';
import { buildReportPdf } from '@/lib/pdf/report-pdf';
import { resolveShare } from '@/lib/share';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await resolveShare(token);
  if (!share?.includePdf) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const data = await reportPdfData(share.orgId, share.catalogId);
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const pdf = await buildReportPdf(data);
  const base = data.filename.replace(/\.(xlsx|csv)$/i, '');
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${encodeURIComponent(base)}-hisobot.pdf"`,
      'x-robots-tag': 'noindex',
      'cache-control': 'private, no-store',
    },
  });
}
