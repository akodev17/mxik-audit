import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { listCatalogs } from '@/lib/catalogs';
import { clientHistory, ownedClient } from '@/lib/clients';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { RememberClient } from '../client-forms';

const fmt = (n: number): string => n.toLocaleString('uz-UZ');

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  // Another org's client id is the same 404 as a missing one.
  const client = await ownedClient(user.orgId, id);
  if (!client) notFound();

  const [catalogs, history] = await Promise.all([
    listCatalogs(user.orgId, client.id),
    clientHistory(user.orgId, client.id),
  ]);
  const latest = catalogs[0]?.id ?? null;

  return (
    <>
      <Header email={user.email} current="/clients" catalogId={latest} demo={user.demo} />
      <Shell demo={user.demo}>
        <RememberClient clientId={client.id} />
        <p className="text-sm text-ink-faint"><Link href="/clients" className="underline">{t.clientsTitle}</Link></p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl">{client.name}</h1>
          {!user.demo ? (
            <Link href={`/upload?client=${client.id}`} className="bg-ink px-4 py-2 text-sm text-paper">{t.clientUpload}</Link>
          ) : null}
        </div>

        <section className="mt-8">
          <h2 className="mb-3 text-lg">{t.clientCatalogs}</h2>
          {catalogs.length === 0 ? (
            <p className="text-sm text-ink-soft">{t.clientNoCatalogs}</p>
          ) : (
            <div className="overflow-x-auto border border-rule">
              <table className="min-w-full text-sm">
                <thead className="bg-paper-tint">
                  <tr className="text-left">
                    <th className="border-b border-rule px-3 py-2 font-medium">{t.catalogsFile}</th>
                    <th className="border-b border-rule px-3 py-2 font-medium">{t.catalogsDate}</th>
                    <th className="border-b border-rule px-3 py-2 text-right font-medium">{t.catalogsRows}</th>
                    <th className="border-b border-rule px-3 py-2 text-right font-medium">{t.catalogsRisky}</th>
                    <th className="border-b border-rule px-3 py-2 font-medium">{t.catalogsStatus}</th>
                    <th className="border-b border-rule px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {catalogs.map((c) => (
                    <tr key={c.id} className="border-b border-rule align-top last:border-0">
                      <td className="max-w-xs break-words px-3 py-2">{c.filename}</td>
                      <td className="whitespace-nowrap px-3 py-2 tnum text-ink-soft">{c.createdAt.toLocaleString('uz-UZ')}</td>
                      <td className="px-3 py-2 text-right tnum">{fmt(c.rowCount)}</td>
                      <td className="px-3 py-2 text-right tnum">{fmt(c.riskyRows)}</td>
                      <td className="px-3 py-2 text-ink-soft">{t.catalogStatus[c.status as keyof typeof t.catalogStatus] ?? c.status}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                          <Link href={`/report?catalog=${c.id}`} className="whitespace-nowrap underline">{t.navReport}</Link>
                          <Link href={`/review?catalog=${c.id}`} className="whitespace-nowrap underline">{t.navReview}</Link>
                          <Link href={`/export?catalog=${c.id}`} className="whitespace-nowrap underline">{t.navExport}</Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-lg">{t.clientHistory}</h2>
          {history.length === 0 ? (
            <p className="text-sm text-ink-soft">{t.clientHistoryEmpty}</p>
          ) : (
            <ol className="border border-rule">
              {history.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-rule px-4 py-2 text-sm last:border-0">
                  <span>
                    {t.historyAction[e.action] ?? e.action}
                    {typeof e.payload['filename'] === 'string' ? <span className="ml-2 text-ink-faint">{e.payload['filename']}</span> : null}
                    {typeof e.payload['summary'] === 'string' ? <span className="ml-2 text-ink-soft">{e.payload['summary']}</span> : null}
                  </span>
                  <span className="tnum text-xs text-ink-faint">{e.createdAt.toLocaleString('uz-UZ')}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </Shell>
    </>
  );
}
