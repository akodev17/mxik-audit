import { getI18n } from '@/lib/locale';
import { notFound, redirect } from 'next/navigation';
import { Notice } from '@/app/(app)/upload/notice';
import { canSeeClient, canWrite } from '@/lib/access';
import { StoredAttrs } from '@/lib/catalog-import';
import { ownedClient } from '@/lib/clients';
import { db } from '@/lib/db';
import { fmtDate, fmtNumber } from '@/lib/format';
import { guessPurchaseMap, PurchaseMapSchema, readListMeta, SAMPLE_ROWS } from '@/lib/purchases';
import { currentUser } from '@/lib/session';
import { StatusChip } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Page, Section } from '@/ui/page';
import { DeleteListButton } from './delete-button';
import { PurchaseForm, PurchaseMapper } from './purchase-form';

/** The mapping of a list left at "columns not chosen", from its stored sample (or its first rows). */
async function resumeData(list: { id: string; headers: string[]; columnMap: unknown; meta: unknown }) {
  const meta = readListMeta(list.meta);
  const rows = meta?.sample ?? (await db.purchaseItem.findMany({ where: { listId: list.id }, orderBy: { rowIndex: 'asc' }, take: SAMPLE_ROWS, select: { attrs: true } }))
    .map((i) => StoredAttrs.safeParse(i.attrs).data?.original ?? []);
  const map = PurchaseMapSchema.safeParse(list.columnMap).data ?? guessPurchaseMap(list.headers);
  return { rows, map, meta };
}

export default async function PurchasesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ map?: string }> }) {
  const { locale, t, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  const sp = await searchParams;
  const client = await ownedClient(user.orgId, id);
  if (!client || !canSeeClient(user, client.id)) notFound();
  const writable = canWrite(user) && !user.demo;

  const lists = await db.purchaseList.findMany({
    where: { orgId: user.orgId, clientId: client.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, filename: true, rowCount: true, status: true, createdAt: true, headers: true, columnMap: true, meta: true },
  });
  const codes = await db.purchaseItem.groupBy({
    by: ['listId'],
    where: { listId: { in: lists.map((l) => l.id) }, mxik: { not: null } },
    _count: { mxik: true },
  });
  const codesBy = new Map(codes.map((c) => [c.listId, c._count.mxik]));
  const resuming = writable ? lists.find((l) => l.id === sp.map && l.status === 'uploaded') : undefined;
  const resume = resuming ? await resumeData(resuming) : null;
  const n = (v: number): string => fmtNumber(locale, v);

  return (
    <Page title={t.purchasesTitle} hint={t.purchasesHint} crumbs={[{ label: t.clientsTitle, href: '/clients' }, { label: client.name, href: `/clients/${client.id}` }]}>
      <p className="mb-4 text-small"><a href="/api/purchase-template" download className="font-medium text-brand-ink hover:underline">{t.purchasesTemplate}</a></p>

      {writable ? <PurchaseForm clientId={client.id} /> : <Notice tone="info">{ta.importX.lists.readOnly}</Notice>}

      {resuming && resume ? (
        <div className="mt-4">
          <PurchaseMapper
            listId={resuming.id} filename={resuming.filename} headers={resuming.headers} rows={resume.rows} map={resume.map}
            notes={resume.meta?.truncated ? <Notice tone="danger">{ta.importX.lists.truncated(resuming.rowCount, resume.meta.totalSeen)}</Notice> : undefined}
          />
        </div>
      ) : null}

      <Section title={t.purchasesLists}>
        {lists.length === 0 ? (
          <EmptyState size="compact" as="h3" title={t.purchasesNone} />
        ) : (
          <ul className="divide-y divide-line rounded-ctl border border-line">
            {lists.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{l.filename}</span>
                  <span className="text-small text-muted">
                    {fmtDate(locale, l.createdAt)} · {n(l.rowCount)} {t.rows} · {t.purchasesCodes}: {n(codesBy.get(l.id) ?? 0)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusChip tone={l.status === 'ready' ? 'good' : 'warn'}>{t.purchasesStatus[l.status] ?? l.status}</StatusChip>
                  {writable && l.status === 'uploaded' ? <ButtonLink href={`/clients/${client.id}/purchases?map=${l.id}`} size="sm">{ta.importX.lists.resume}</ButtonLink> : null}
                  {writable ? <DeleteListButton listId={l.id} kind="purchases" scope={`${client.name} · ${l.filename}`} rows={l.rowCount} /> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
