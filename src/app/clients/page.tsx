import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { listClients, type AuditPoint } from '@/lib/clients';
import { isDemoOrg } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { NewClientForm } from './client-forms';

export const metadata: Metadata = { title: `${t.clientsTitle} — ${t.appName}` };

const fmt = (n: number): string => n.toLocaleString('uz-UZ');

/** Risky rows per audit, oldest first; the latest is emphasised. */
function Trend({ points }: { points: AuditPoint[] }) {
  if (points.length === 0) return <span className="text-ink-faint">{t.clientsNever}</span>;
  return (
    <span className="tnum">
      {points.map((p, i) => (
        <span key={p.catalogId}>
          {i > 0 ? <span className="px-1 text-ink-faint">→</span> : null}
          <span title={`${p.createdAt.toLocaleDateString('uz-UZ')} · ${fmt(p.rowCount)} ${t.rows}`} className={i === points.length - 1 ? 'font-medium text-ink' : 'text-ink-soft'}>
            {fmt(p.riskyRows)}
          </span>
        </span>
      ))}
    </span>
  );
}

export default async function ClientsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const [clients, demo] = await Promise.all([listClients(user.orgId), isDemoOrg(user.orgId)]);

  return (
    <>
      <Header email={user.email} current="/clients" demo={user.demo} />
      <Shell demo={user.demo}>
        <h1 className="text-2xl">{t.clientsTitle}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">{t.clientsHint}</p>

        <div className="mt-6 overflow-x-auto border border-rule">
          <table className="min-w-full text-sm">
            <thead className="bg-paper-tint">
              <tr className="text-left">
                <th className="border-b border-rule px-3 py-2 font-medium">{t.clientsName}</th>
                <th className="border-b border-rule px-3 py-2 font-medium">{t.clientsLastAudit}</th>
                <th className="border-b border-rule px-3 py-2 font-medium">{t.clientsTrend}</th>
                <th className="border-b border-rule px-3 py-2 text-right font-medium">{t.clientsMarking}</th>
                <th className="border-b border-rule px-3 py-2 font-medium">{t.clientsLastNotice}</th>
                <th className="border-b border-rule px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-rule align-top last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/clients/${c.id}`} className="font-medium underline">{c.name}</Link>
                    {c.isDefault ? <span className="ml-2 text-xs text-ink-faint">{t.clientsDefault}</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tnum text-ink-soft">
                    {c.lastAuditAt ? c.lastAuditAt.toLocaleDateString('uz-UZ') : t.clientsNever}
                  </td>
                  <td className="px-3 py-2"><Trend points={c.trend} /></td>
                  <td className="px-3 py-2 text-right tnum">{fmt(c.markingRows)}</td>
                  <td className="max-w-xs px-3 py-2 text-ink-soft">
                    {c.lastNotification
                      ? <span title={c.lastNotification.createdAt.toLocaleString('uz-UZ')}>{c.lastNotification.title}</span>
                      : <span className="text-ink-faint">{t.clientsNever}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/clients/${c.id}`} className="whitespace-nowrap underline">{t.clientsOpen}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!demo ? (
          <section className="mt-8">
            <h2 className="mb-3 text-lg">{t.clientsAdd}</h2>
            <NewClientForm />
          </section>
        ) : null}
      </Shell>
    </>
  );
}
