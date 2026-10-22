import { getI18n } from '@/lib/locale';
import { Notice } from '@/app/(app)/upload/notice';
import { canWrite } from '@tasnivo/domain/access';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { StatusChip } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Page, Section } from '@/ui/page';
import { DeleteListButton } from './delete-button';
import { PurchaseForm, PurchaseMapper } from './purchase-form';

export default async function PurchasesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ map?: string }> }) {
  const { locale, t, ta } = await getI18n();
  const { id } = await params;
  const sp = await searchParams;
  const api = serverApi();
  // Each list carries its mapping (stored or guessed) and first rows, so "columns not chosen" resumes from it.
  const [user, { client, lists }] = await Promise.all([pageData(api.auth.me()), pageData(api.imports.purchases({ clientId: id }))]);
  const writable = canWrite(user) && !user.demo;

  const resuming = writable ? lists.find((l) => l.id === sp.map && l.status === 'uploaded') : undefined;
  const n = (v: number): string => fmtNumber(locale, v);

  return (
    <Page title={t.purchasesTitle} hint={t.purchasesHint} crumbs={[{ label: t.clientsTitle, href: '/clients' }, { label: client.name, href: `/clients/${client.id}` }]}>
      <p className="mb-4 text-small"><a href="/api/purchase-template" download className="font-medium text-brand-ink hover:underline">{t.purchasesTemplate}</a></p>

      {writable ? <PurchaseForm clientId={client.id} /> : <Notice tone="info">{ta.importX.lists.readOnly}</Notice>}

      {resuming ? (
        <div className="mt-4">
          <PurchaseMapper
            listId={resuming.id} filename={resuming.filename} headers={resuming.headers} rows={resuming.sample} map={resuming.map}
            notes={resuming.truncated ? <Notice tone="danger">{ta.importX.lists.truncated(resuming.rowCount, resuming.totalSeen ?? resuming.rowCount)}</Notice> : undefined}
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
                    {fmtDate(locale, l.createdAt)} · {n(l.rowCount)} {t.rows} · {t.purchasesCodes}: {n(l.codes)}
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
