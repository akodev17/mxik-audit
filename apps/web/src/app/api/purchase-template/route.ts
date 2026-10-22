// An empty purchase-list template in the requester's language (@tasnivo/domain/catalog-exports).
import { NextResponse } from 'next/server';
import { purchaseTemplate } from '@tasnivo/domain/catalog-exports';
import { fileResponse } from '@/lib/download';
import { getLocale } from '@/lib/locale';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return fileResponse(await purchaseTemplate(await getLocale()));
}
