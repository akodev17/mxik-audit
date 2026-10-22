import { NextResponse } from 'next/server';
import { catalogReportCsv } from '@tasnivo/domain/catalog-exports';
import { downloadResponse } from '@/lib/download';
import { getLocale } from '@/lib/locale';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** The report's risky findings with their suggestions and decisions as a CSV file (@tasnivo/domain/catalog-exports). */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return downloadResponse(await catalogReportCsv(user, await getLocale(), new URL(request.url).searchParams.get('catalog')));
}
