// A blank template for the cheque list and the sales export (@tasnivo/domain/catalog-exports).
import { NextResponse } from 'next/server';
import { docTemplate } from '@tasnivo/domain/catalog-exports';
import { fileResponse } from '@/lib/download';
import { getLocale } from '@/lib/locale';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const kind = new URL(request.url).searchParams.get('kind') === 'sales' ? 'sales' : 'cheques';
  return fileResponse(await docTemplate(await getLocale(), kind));
}
