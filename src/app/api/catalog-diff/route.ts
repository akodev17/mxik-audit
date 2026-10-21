import { NextResponse } from 'next/server';
import { resolveCatalog } from '@/lib/catalogs';
import { diffCsv } from '@/lib/diff-csv';
import { baseName, contentDisposition } from '@/lib/export-filename';
import { getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { versionDiff } from '@/lib/versions';

export const dynamic = 'force-dynamic';

/**
 * The comparison of a catalogue with its previous version (or with `with`, another earlier catalogue of
 * the same client) as a CSV file: every changed row, not just the first page shown on screen. Another
 * organisation's or another client's catalogue is the same 404 as a missing one.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ta } = await getI18n();
  const url = new URL(request.url);
  const id = url.searchParams.get('catalog');
  const catalog = id ? await resolveCatalog(user.orgId, id, null, user.clientIds) : null;
  if (!catalog) return NextResponse.json({ error: 'no catalog' }, { status: 404 });
  if (catalog.status !== 'ready') return NextResponse.json({ error: 'audit not finished' }, { status: 409 });
  const against = url.searchParams.get('with') || undefined;
  const diff = await versionDiff(user.orgId, catalog.id, against, { limit: Number.MAX_SAFE_INTEGER, offset: 0 });
  if (!diff) return NextResponse.json({ error: 'nothing to compare' }, { status: 404 });
  const d = ta.importX.diff;
  const csv = diffCsv(diff, { ...d.csv, notes: d.notes });
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': contentDisposition('attachment', `${baseName(catalog.filename)}-farq.csv`),
      'cache-control': 'private, no-store',
    },
  });
}
