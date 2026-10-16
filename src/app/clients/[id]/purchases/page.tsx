import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { ownedClient } from '@/lib/clients';
import { db } from '@/lib/db';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
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
    <>
      <Header email={user.email} current="/clients" demo={user.demo} />
      <Shell demo={user.demo}>
        <p className="text-sm text-ink-faint">
          <Link href="/clients" className="underline">{t.clientsTitle}</Link>
          {' / '}
          <Link href={`/clients/${client.id}`} className="underline">{client.name}</Link>
        </p>
        <h1 className="mt-1 text-2xl">{t.purchasesTitle}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">{t.purchasesHint}</p>
        <p className="mt-2 text-sm"><a href="/api/purchase-template" className="underline">{t.purchasesTemplate}</a></p>

        {!user.demo ? <div className="mt-6"><PurchaseForm clientId={client.id} /></div> : null}

        <section className="mt-8">
          <h2 className="mb-3 text-lg">{t.purchasesLists}</h2>
          {lists.length === 0 ? (
            <p className="text-sm text-ink-soft">{t.purchasesNone}</p>
          ) : (
            <ul className="border border-rule">
              {lists.map((l) => (
                <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-rule px-4 py-2 text-sm last:border-0">
                  <span>
                    {l.filename}
                    <span className="ml-2 text-xs text-ink-faint tnum">
                      {l.createdAt.toLocaleDateString('uz-UZ')} · {fmt(l.rowCount)} {t.rows} · {t.purchasesCodes}: {fmt(codesBy.get(l.id) ?? 0)} · {t.purchasesStatus[l.status] ?? l.status}
                    </span>
                  </span>
                  <DeletePurchaseButton listId={l.id} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </Shell>
    </>
  );
}
