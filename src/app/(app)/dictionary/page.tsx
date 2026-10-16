import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { canWrite } from '@/lib/access';
import { db } from '@/lib/db';
import { codeDetails } from '@/lib/code-details';
import { t } from '@/lib/i18n';
import { ta } from '@/lib/i18n-app';
import { currentUser } from '@/lib/session';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { DictionaryTable, type DictRow } from './dictionary-table';

export const metadata: Metadata = { title: `${ta.dict.title} — ${t.appName}` };

const PAGE = 100;

export default async function DictionaryPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 80);
  const page = Math.max(0, Number(sp.page) || 0);

  const where = {
    orgId: user.orgId,
    ...(q ? { OR: [{ label: { contains: q, mode: 'insensitive' as const } }, { key: { startsWith: q } }, { code: { startsWith: q } }] } : {}),
  };
  const [total, entries] = await Promise.all([
    db.firmMapping.count({ where }),
    db.firmMapping.findMany({ where, orderBy: [{ uses: 'desc' }, { updatedAt: 'desc' }], skip: page * PAGE, take: PAGE }),
  ]);
  const details = await codeDetails(entries.map((e) => e.code));
  const rows: DictRow[] = entries.map((e) => ({
    id: e.id, kind: e.kind, label: e.label, unit: e.unit, code: e.code, codeName: details.get(e.code)?.name ?? null,
    uses: e.uses, stale: e.staleAt !== null, updated: e.updatedAt.toLocaleDateString('uz-UZ'),
  }));
  const href = (p: number): string => `/dictionary?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <Page title={ta.dict.title} hint={ta.dict.hint} wide>
      <form className="mb-4 max-w-md">
        <input
          name="q" defaultValue={q} placeholder={ta.dict.search} aria-label={ta.dict.search}
          className="h-10 w-full rounded-ctl border border-line-strong bg-base px-3 text-[15px] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </form>
      {rows.length === 0 ? (
        <EmptyState title={ta.dict.empty} hint={ta.dict.emptyHint} />
      ) : (
        <>
          <DictionaryTable rows={rows} canEdit={canWrite(user)} />
          <div className="mt-3 flex items-center gap-4 text-sm text-muted">
            <span>{total.toLocaleString('uz-UZ')}</span>
            {page > 0 ? <Link href={href(page - 1)} className="text-brand hover:underline">←</Link> : null}
            {(page + 1) * PAGE < total ? <Link href={href(page + 1)} className="text-brand hover:underline">→</Link> : null}
          </div>
        </>
      )}
    </Page>
  );
}
