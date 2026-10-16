import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { dashboard, recentActivity, type ClientCard } from '@/lib/dashboard';
import { formatTag, getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { isAdminRole } from '@/lib/access';
import { Badge } from '@/ui/badge';
import { EmptyState } from '@/ui/empty-state';
import { Page, Section } from '@/ui/page';
import { Table, Td, Th } from '@/ui/table';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.dash.title} — ${t.appName}` };
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-ctl border border-line px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 text-2xl font-bold ${tone ?? ''}`}>{value}</dd>
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface"><span className="block h-full rounded-full bg-good" style={{ width: `${pct}%` }} /></span>
      <span className="text-xs text-muted">{pct}%</span>
    </span>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ accountant?: string }> }) {
  const { locale, t, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const admin = isAdminRole(user);
  const [data, activity] = await Promise.all([dashboard(user, admin ? sp.accountant ?? null : null), recentActivity(user.orgId)]);
  const fmt = (n: number): string => n.toLocaleString(formatTag(locale));
  const reasonText = (r: ClientCard['reasons'][number]): string => {
    const d = ta.dash.reasons;
    return r.kind === 'update' ? d.update(r.count) : r.kind === 'unreviewed' ? d.unreviewed(r.count) : r.kind === 'overdue' ? d.overdue : d.empty;
  };
  const needing = data.cards.filter((c) => c.reasons.length > 0);
  const pct = data.totals.riskyFindings === 0 ? 100 : Math.round((data.totals.reviewed / data.totals.riskyFindings) * 100);

  return (
    <Page title={ta.dash.title} hint={ta.dash.hint} wide>
      {admin && data.accountants.length > 1 ? (
        <form className="mb-5 flex items-center gap-2 text-sm">
          <label htmlFor="acc" className="font-medium">{ta.dash.filterAccountant}:</label>
          <select id="acc" name="accountant" defaultValue={sp.accountant ?? ''} className="h-9 rounded-ctl border border-line-strong bg-base px-2">
            <option value="">{ta.dash.allAccountants}</option>
            {data.accountants.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>
          <button type="submit" className="h-9 rounded-ctl border border-line-strong px-3 font-medium hover:bg-surface">OK</button>
        </form>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={ta.dash.clients} value={fmt(data.totals.clients)} />
        <Stat label={ta.dash.riskyRows} value={fmt(data.totals.riskyRows)} tone={data.totals.riskyRows > 0 ? 'text-danger' : 'text-good'} />
        <Stat label={ta.dash.progress} value={`${pct}%`} />
        <Stat label={ta.dash.attention} value={fmt(data.totals.attention)} tone={data.totals.attention > 0 ? 'text-warn-ink' : 'text-good'} />
      </dl>

      <Section title={ta.dash.attentionTitle}>
        {needing.length === 0 ? <p className="text-sm text-muted">{ta.dash.nothing}</p> : (
          <ul className="divide-y divide-line rounded-ctl border border-line">
            {needing.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <Link href={c.catalogId ? `/catalogs/${c.catalogId}` : `/clients/${c.id}`} className="font-medium hover:text-brand">{c.name}</Link>
                  <span className="mt-1 flex flex-wrap gap-1.5">{c.reasons.map((r) => <Badge key={r.kind} tone={r.kind === 'update' || r.kind === 'overdue' ? 'danger' : 'warn'}>{reasonText(r)}</Badge>)}</span>
                </span>
                <Link href={c.catalogId ? `/catalogs/${c.catalogId}` : `/clients/${c.id}`} className="text-brand hover:underline">{ta.dash.open}</Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={ta.dash.allClients}>
        {data.cards.length === 0 ? <EmptyState title={ta.clients.emptyTitle} hint={ta.clients.emptyHint} /> : (
          <Table>
            <thead>
              <tr><Th>{ta.dash.colClient}</Th><Th>{ta.dash.colCatalog}</Th><Th className="text-right">{ta.dash.colRisky}</Th><Th>{ta.dash.colProgress}</Th><Th>{ta.dash.colAccountant}</Th></tr>
            </thead>
            <tbody>
              {data.cards.map((c) => (
                <tr key={c.id} className="hover:bg-surface/60">
                  <Td className="font-medium"><Link href={`/clients/${c.id}`} className="hover:text-brand">{c.name}</Link></Td>
                  <Td className="text-muted">{c.catalogId ? <Link href={`/catalogs/${c.catalogId}`} className="hover:text-brand">{c.catalogDate?.toLocaleDateString(formatTag(locale))}</Link> : ta.dash.noCatalog}</Td>
                  <Td className={`text-right font-medium ${c.riskyRows > 0 ? 'text-danger' : ''}`}>{fmt(c.riskyRows)}</Td>
                  <Td><Progress done={c.reviewed} total={c.riskyFindings} /></Td>
                  <Td className="max-w-[220px] truncate text-muted" title={c.accountants.join(', ')}>{c.accountants.join(', ')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title={ta.dash.recent}>
        {activity.length === 0 ? <p className="text-sm text-muted">{ta.dash.recentEmpty}</p> : (
          <ul className="divide-y divide-line rounded-ctl border border-line text-sm">
            {activity.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                <span>{ta.activity.actions[e.action] ?? e.action}<span className="ml-2 text-muted">{e.actor ?? ta.activity.system}</span></span>
                <span className="text-xs text-muted">{e.at.toLocaleString(formatTag(locale))}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <span className="sr-only">{t.appName}</span>
    </Page>
  );
}
