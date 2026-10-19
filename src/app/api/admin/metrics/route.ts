// CSV export of the accuracy metrics. Platform admins only; anyone else gets a 404.
import { NextResponse } from 'next/server';
import { accuracyCsv, DIMENSIONS, reasonsCsv, type Dimension } from '@/lib/accuracy';
import { isPlatformAdmin } from '@/lib/admin';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || !(await isPlatformAdmin(user.userId))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const by = new URL(request.url).searchParams.get('by') ?? 'stage';
  const body = by === 'reasons' ? await reasonsCsv() : DIMENSIONS.includes(by as Dimension) ? await accuracyCsv(by as Dimension) : null;
  if (body === null) return NextResponse.json({ error: 'bad dimension' }, { status: 400 });
  return new NextResponse(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="accuracy-${by}.csv"` } });
}
