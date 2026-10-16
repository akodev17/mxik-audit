import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { activityPage, CATEGORIES, type Category } from '@/lib/activity';
import { clientScope } from '@/lib/access';
import { db } from '@/lib/db';
import { formatTag, getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { Table, Td, Th } from '@/ui/table';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.log.title} — ${t.appName}` };
}

type Params = { client?: string; user?: string; type?: string; from?: string; to?: string; page?: string };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { locale, t, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const category: Category = CATEGORIES.find((c) => c === sp.type) ?? 'all';
  const page = Math.max(0, Number(sp.page) || 0);

  const [clients, users] = await Promise.all([
    db.client.findMany({ where: { orgId: user.orgId, ...clientScope(user) }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.user.findMany({ where: { orgId: user.orgId }, orderBy: { email: 'asc' }, select: { id: true, email: true } }),
  ]);
  // A client id outside the user's scope is ignored, never trusted.
  const clientId = clients.find((c) => c.id === sp.client)?.id ?? null;
  const { rows, hasMore } = await activityPage(user, { clientId, userId: users.find((u) => u.id === sp.user)?.id ?? null, category, from: sp.from ?? null, to: sp.to ?? null, page });

  const href = (p: number): string => {
    const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v && k !== 'page' ? [[k, v]] : [])));
    q.set('page', String(p));
    return `/activity?${q}`;
  };
  const select = 'h-9 rounded-ctl border border-line-strong bg-base px-2 text-sm';

  return (
    <Page title={ta.log.title} hint={ta.log.hint} wide>
      <form className="mb-5 flex flex-wrap items-end gap-3 text-sm">
        {clients.length > 1 ? (
          <label className="flex flex-col gap-1"><span className="text-xs text-muted">{ta.log.client}</span>
            <select name="client" defaultValue={clientId ?? ''} className={select}><option value="">{ta.log.any}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1"><span className="text-xs text-muted">{ta.log.user}</span>
          <select name="user" defaultValue={sp.user ?? ''} className={select}><option value="">{ta.log.any}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs text-muted">{ta.log.type}</span>
          <select name="type" defaultValue={category} className={select}>{CATEGORIES.map((c) => <option key={c} value={c}>{ta.log.types[c]}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs text-muted">{ta.log.from}</span><input type="date" name="from" defaultValue={sp.from ?? ''} className={select} /></label>
        <label className="flex flex-col gap-1"><span className="text-xs text-muted">{ta.log.to}</span><input type="date" name="to" defaultValue={sp.to ?? ''} className={select} /></label>
        <button type="submit" className="h-9 rounded-ctl bg-brand px-4 font-medium text-white hover:bg-[#1c47d6]">{ta.log.apply}</button>
      </form>

      {rows.length === 0 ? <EmptyState title={ta.log.empty} hint={ta.log.emptyHint} /> : (
        <>
          <Table>
            <thead><tr><Th>{ta.log.when}</Th><Th>{ta.log.what}</Th><Th>{ta.log.user}</Th><Th>{ta.log.client}</Th><Th>{ta.log.file}</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface/60">
                  <Td className="whitespace-nowrap text-muted">{r.at.toLocaleString(formatTag(locale))}</Td>
                  <Td>{ta.activity.actions[r.action] ?? r.action}{r.count !== null && r.count > 1 ? <span className="ml-2 text-muted">({r.count.toLocaleString(formatTag(locale))})</span> : null}</Td>
                  <Td className="text-muted">{r.actor ?? ta.activity.system}</Td>
                  <Td className="text-muted">{r.clientName ?? ''}</Td>
                  <Td className="max-w-xs truncate">{r.catalogId ? <Link href={`/catalogs/${r.catalogId}`} className="text-brand hover:underline" title={r.catalogName ?? undefined}>{r.catalogName}</Link> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex items-center gap-4 text-sm">
            {page > 0 ? <Link href={href(page - 1)} className="text-brand hover:underline">← {ta.log.newer}</Link> : null}
            {hasMore ? <Link href={href(page + 1)} className="text-brand hover:underline">{ta.log.older} →</Link> : null}
          </div>
        </>
      )}
      <span className="sr-only">{t.appName}</span>
    </Page>
  );
}
