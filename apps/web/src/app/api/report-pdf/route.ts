// Report PDF of one of the org's audited catalogues: internal (with who decided)
// or client-facing (?audience=client). ?download=1 sends it as an attachment.
import { NextResponse } from 'next/server';
import { catalogReportPdf } from '@tasnivo/domain/catalog-exports';
import { downloadResponse } from '@/lib/download';
import { getLocale } from '@/lib/locale';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  return downloadResponse(await catalogReportPdf(user, await getLocale(), url.searchParams.get('catalog'), {
    audience: url.searchParams.get('audience') === 'client' ? 'client' : 'internal',
    download: url.searchParams.get('download') === '1',
  }));
}
