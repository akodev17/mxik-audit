import { NextResponse, type NextRequest } from 'next/server';
import { catalogScope } from '@/lib/access';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { decodeCursor, readFilter, workspacePageIds } from '@/lib/workspace';
import { gridRows } from '@/lib/workspace-rows';

const PAGE = 120;

/** One page of workspace rows for a catalogue of the signed-in org. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const catalog = await db.catalog.findFirst({ where: { id, ...catalogScope(user) }, select: { id: true } });
  if (!catalog) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const q = request.nextUrl.searchParams;
  const filter = readFilter({ type: q.get('type'), q: q.get('q'), pending: q.get('pending'), comments: q.get('comments'), sort: q.get('sort') });
  const { ids, next } = await workspacePageIds(catalog.id, filter, decodeCursor(q.get('cursor')), PAGE);
  const rows = await gridRows(user.orgId, catalog.id, ids);
  return NextResponse.json({ rows, next });
}
