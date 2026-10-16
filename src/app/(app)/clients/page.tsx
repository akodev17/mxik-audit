import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listClients } from '@/lib/clients';
import { isDemoOrg } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { ta } from '@/lib/i18n-app';
import { currentUser } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { Sparkline } from '@/ui/sparkline';
import { Table, Td, Th } from '@/ui/table';
import { NewClientForm } from './client-forms';

export const metadata: Metadata = { title: `${t.clientsTitle} — ${t.appName}` };

const fmt = (n: number): string => n.toLocaleString('uz-UZ');

export default async function ClientsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const [clients, demo] = await Promise.all([listClients(user.orgId, user.clientIds), isDemoOrg(user.orgId)]);

  return (
    <Page title={t.clientsTitle} hint={t.clientsHint} wide>
      {clients.length === 0 ? (
        <EmptyState title={ta.clients.emptyTitle} hint={ta.clients.emptyHint} action={demo ? null : <NewClientForm />} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t.clientsName}</Th>
              <Th>{t.clientsLastAudit}</Th>
              <Th>{t.clientsTrend}</Th>
              <Th className="text-right">{t.clientsMarking}</Th>
              <Th>{t.clientsLastNotice}</Th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const risky = c.trend.map((p) => p.riskyRows);
              return (
                <tr key={c.id} className="hover:bg-surface/60">
                  <Td>
                    <Link href={`/clients/${c.id}`} className="font-medium hover:text-brand">{c.name}</Link>
                    {c.isDefault ? <Badge className="ml-2">{t.clientsDefault}</Badge> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{c.lastAuditAt ? c.lastAuditAt.toLocaleDateString('uz-UZ') : t.clientsNever}</Td>
                  <Td>
                    {risky.length === 0 ? <span className="text-muted">{t.clientsNever}</span> : (
                      <span className="flex items-center gap-3" title={c.trend.map((p) => `${p.createdAt.toLocaleDateString('uz-UZ')}: ${fmt(p.riskyRows)}`).join('; ')}>
                        <Sparkline values={risky} />
                        <span className="font-medium">{fmt(risky[risky.length - 1] ?? 0)}</span>
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">{fmt(c.markingRows)}</Td>
                  <Td className="max-w-xs truncate text-muted" title={c.lastNotification?.createdAt.toLocaleString('uz-UZ')}>
                    {c.lastNotification ? c.lastNotification.title : t.clientsNever}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {!demo && clients.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg">{t.clientsAdd}</h2>
          <NewClientForm />
        </section>
      ) : null}
    </Page>
  );
}
