// The PDF behind a share link, when the link allows it.
import { NextResponse } from 'next/server';
import { baseName, contentDisposition } from '@tasnivo/domain/export-filename';
import { getI18n } from '@/lib/locale';
import { reportPdfData } from '@tasnivo/domain/pdf/report-data';
import { buildReportPdf } from '@tasnivo/domain/pdf/report-pdf';
import { resolveShare } from '@tasnivo/domain/share';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await resolveShare(token);
  if (!share?.includePdf) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const data = await reportPdfData(share.orgId, share.catalogId);
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { locale, ta } = await getI18n();
  const pdf = await buildReportPdf(data, locale, 'client');
  // The UTF-8 name keeps Cyrillic and Uzbek file names; the ASCII fallback cannot break the header.
  const filename = `${baseName(data.filename)}-${ta.importX.exp.suffix.pdfClient}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': contentDisposition('inline', filename),
      'x-robots-tag': 'noindex',
      'cache-control': 'private, no-store',
    },
  });
}
