import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ownedClient } from '@/lib/clients';
import { db } from '@/lib/db';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { Page, Section } from '@/ui/page';
import { DeletePurchaseButton } from './delete-button';
import { PurchaseForm } from './purchase-form';

const fmt = (n: number): string => n.toLocaleString('uz-UZ');

export default async function PurchasesPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  const client = await ownedClient(user.orgId, id);
  if (!client) notFound();
  const lists = await db.purchaseList.findMany({
    where: { orgId: user.orgId, clientId: client.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, filename: true, rowCount: true, status: true, createdAt: true },
  });
  const codes = await db.purchaseItem.groupBy({
    by: ['listId'],
    where: { listId: { in: lists.map((l) => l.id) }, mxik: { not: null } },
    _count: { mxik: true },
  });
  const codesBy = new Map(codes.map((c) => [c.listId, c._count.mxik]));

  return (
    <Page title={t.purchasesTitle} hint={t.purchasesHint}>
      <p className="-mt-3 mb-5 text-sm">
        <Link href="/clients" className="text-brand hover:underline">{t.clientsTitle}</Link>
        <span className="mx-1.5 text-muted">/</span>
        <Link href={`/clients/${client.id}`} className="text-brand hover:underline">{client.name}</Link>
      </p>
      <p className="mb-4 text-sm"><a href="/api/purchase-template" className="font-medium text-brand hover:underline">{t.purchasesTemplate}</a></p>

      {!user.demo ? <PurchaseForm clientId={client.id} /> : null}

      <Section title={t.purchasesLists}>
        {lists.length === 0 ? (
          <p className="text-sm text-muted">{t.purchasesNone}</p>
        ) : (
          <ul className="divide-y divide-line rounded-ctl border border-line">
            {lists.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{l.filename}</span>
                  <span className="ml-3 text-xs text-muted">
                    {l.createdAt.toLocaleDateString('uz-UZ')}, {fmt(l.rowCount)} {t.rows}, {t.purchasesCodes}: {fmt(codesBy.get(l.id) ?? 0)}, {t.purchasesStatus[l.status] ?? l.status}
                  </span>
                </span>
                <DeletePurchaseButton listId={l.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
