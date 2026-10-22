import { NextResponse } from 'next/server';
import { catalogDiffCsv } from '@tasnivo/domain/catalog-exports';
import { downloadResponse } from '@/lib/download';
import { getLocale } from '@/lib/locale';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The comparison of a catalogue with its previous version (or with `with`) as a CSV file: every
 * changed row (@tasnivo/domain/catalog-exports, shared with the API).
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  return downloadResponse(await catalogDiffCsv(user, await getLocale(), url.searchParams.get('catalog'), url.searchParams.get('with')));
}
