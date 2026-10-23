// Bank statements (Agent 2, docs/TASNIVO_AI_PLAN_2026-10-23.md): the upload wizard for writers, the
// statements of the org (or of one client: ?client=), and the saved layouts and operation rules.
import type { Metadata } from 'next';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { canWrite } from '@/lib/pure/access';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { Select } from '@/ui/select';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../_manage/card';
import { FILTER_FIELD, FilterBar } from '../queue/filter-bar';
import { BankSettings } from './bank-settings';
import { STATUS_TONE } from './bank-pure';
import { BankUpload } from './upload/bank-upload';
import { RemoveStatementButton } from './remove-statement';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.bankX.title} — ${t.appName}` };
}

export default async function BankPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { locale, ta } = await getI18n();
  const b = ta.bankX;
  const sp = await searchParams;
  const api = serverApi();
  const [user, { statements, clients, client }, { formats }, { rules }] = await Promise.all([
    pageData(api.auth.me()),
    pageData(api.bank.list(sp.client ? { client: sp.client } : {})),
    pageData(api.bank.formats()),
    pageData(api.bank.rules()),
  ]);
  const writable = canWrite(user) && !user.demo;
  const n = (v: number): string => fmtNumber(locale, v);
  const period = (from: string | null, to: string | null): string => (from ? (to && to !== from ? `${fmtDate(locale, from)} — ${fmtDate(locale, to)}` : fmtDate(locale, from)) : '—');

  return (
    <Page title={b.title} hint={b.hint} wide>
      <div className="space-y-6">
        {writable ? <BankUpload clients={clients} defaultClient={client} ownBooks={user.clientIds === null} /> : null}

        {clients.length > 1 ? (
          <FilterBar action="/bank" reset={client ? '/bank' : null} compact fieldsClassName="grid-cols-1 sm:w-72">
            <Select label={b.list.client} name="client" defaultValue={client ?? 'all'} wrapperClassName={FILTER_FIELD}>
              <option value="all">{ta.firmX.catalogs.allClients}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FilterBar>
        ) : null}

        <Card title={b.list.title} flush={statements.length > 0}>
          {statements.length === 0 ? (
            <EmptyState size="compact" as="h3" title={b.list.empty} hint={writable ? b.list.emptyHint : undefined} />
          ) : (
            <Table label={b.list.title} className={FLUSH_TABLE}>
              <thead>
                <tr>
                  <Th>{b.list.file}</Th>
                  <Th>{b.list.client}</Th>
                  <Th>{b.list.period}</Th>
                  <Th>{b.list.account}</Th>
                  <Th numeric>{b.list.lines}</Th>
                  <Th numeric>{b.list.attention}</Th>
                  <Th>{b.list.status}</Th>
                  <Th><span className="sr-only">{ta.mgX.actions}</span></Th>
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => {
                  const tone = STATUS_TONE[s.status] ?? 'neutral';
                  const attention = (s.counts?.unresolved ?? 0) + (s.counts?.suspicious ?? 0);
                  return (
                    <tr key={s.id} className="hover:bg-surface">
                      <Td className="max-w-xs">
                        <a href={`/bank/${s.id}`} className="block truncate font-medium text-fg hover:underline" title={s.filename ?? ''}>{s.filename ?? s.id}</a>
                        <span className="block text-small text-muted">{fmtDate(locale, s.createdAt)}{s.bankName ? ` · ${s.bankName}` : ''}</span>
                      </Td>
                      <Td className="whitespace-nowrap text-muted">{s.clientName ?? b.list.ownBooks}</Td>
                      <Td className="whitespace-nowrap">{period(s.periodFrom, s.periodTo)}</Td>
                      <Td className="whitespace-nowrap font-mono text-small">{s.account ?? '—'}</Td>
                      <Td numeric>{s.counts ? n(s.counts.total) : '—'}</Td>
                      <Td numeric className={attention > 0 ? 'font-semibold text-warn-ink' : 'text-muted'}>{s.counts ? n(attention) : '—'}</Td>
                      <Td><StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{ta.accountingX.status[s.status]}</StatusChip></Td>
                      <Td>
                        <span className="flex justify-end gap-2">
                          <ButtonLink href={`/bank/${s.id}`} size="sm">{b.list.open}</ButtonLink>
                          {writable && (s.counts?.exported ?? 0) === 0 && s.exports.length === 0 ? <RemoveStatementButton batchId={s.id} filename={s.filename ?? s.id} lines={s.counts?.total ?? 0} /> : null}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <BankSettings formats={formats} rules={rules} writable={writable} />
      </div>
    </Page>
  );
}
