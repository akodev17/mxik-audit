// The upload wizard polls this while a committed catalogue is audited.
import { NextResponse } from 'next/server';
import { catalogProgress } from '@tasnivo/domain/catalog-pages';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const catalogId = new URL(request.url).searchParams.get('catalog');
  if (!catalogId) return NextResponse.json({ error: 'no catalog' }, { status: 400 });
  // Picks up an audit whose worker died (server restart), as the workspace does.
  const progress = await catalogProgress(user, catalogId);
  // Another org's catalogue is the same 404 as a missing one.
  if (!progress) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(progress, { headers: { 'cache-control': 'no-store' } });
}
