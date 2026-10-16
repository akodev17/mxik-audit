import Link from 'next/link';
import { billingConfig } from '@/lib/billing/config';
import { catalogPaid } from '@/lib/billing/orders';
import { db } from '@/lib/db';
import { ta } from '@/lib/i18n-app';
import { BillingBox } from './billing-box';
import { ExportActions } from './export-actions';

type Props = {
  orgId: string;
  catalog: { id: string; filename: string; createdAt: Date; rowCount: number };
  client: { id: string; name: string };
};

/** Catalogue name, client, date and classifier version, with the export actions. */
export async function WorkspaceHeader({ orgId, catalog, client }: Props) {
  const [snapshot, paid] = await Promise.all([
    db.catalogSnapshot.findFirst({ orderBy: { id: 'desc' }, select: { id: true, takenAt: true } }),
    billingConfig().requiredForExport ? catalogPaid(orgId, catalog.id) : Promise.resolve(true),
  ]);
  const meta: [string, React.ReactNode][] = [
    [ta.ws.client, <Link key="c" href={`/clients/${client.id}`} className="text-brand hover:underline">{client.name}</Link>],
    [ta.ws.date, catalog.createdAt.toLocaleDateString('uz-UZ')],
    [ta.ws.classifier, snapshot ? `v${snapshot.id}, ${snapshot.takenAt.toLocaleDateString('uz-UZ')}` : '—'],
  ];
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h1 className="truncate text-xl" title={catalog.filename}>{catalog.filename}</h1>
        <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {meta.map(([label, value]) => (
            <div key={label} className="flex gap-1.5"><dt className="text-muted">{label}:</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </div>
      <ExportActions
        catalogId={catalog.id}
        locked={!paid}
        panel={<BillingBox orgId={orgId} catalogId={catalog.id} rowCount={catalog.rowCount} />}
      />
    </header>
  );
}
