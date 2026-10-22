import { NextResponse } from 'next/server';
import { catalogExport } from '@tasnivo/domain/catalog-exports';
import { downloadResponse } from '@/lib/download';
import { getLocale } from '@/lib/locale';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The uploaded file with accepted decisions applied (format=xlsx), or the 1C file as CSV
 * (format=1c) or .xlsx (format=1c-xlsx): @tasnivo/domain/catalog-exports, shared with the API.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  return downloadResponse(await catalogExport(user, await getLocale(), url.searchParams.get('catalog'), url.searchParams.get('format')));
}
