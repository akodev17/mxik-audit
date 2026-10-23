'use client';

// The org's counterparties: load a client's list from a 1C «Контрагенты» export (before the first
// statement, so payments match at once), and look them up by name, ИНН or account.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '@/lib/api/browser';
import { queryKey } from '@/lib/api/query';
import { refusalText } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { IconSearch, IconUpload } from '@/ui/icons';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Spinner } from '@/ui/spinner';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { Card, FLUSH_TABLE } from '../../_manage/card';

type Client = { id: string; name: string };

export function CounterpartiesPanel({ clients, initialClient, canImport }: { clients: Client[]; initialClient: string | null; canImport: boolean }) {
  const { ta } = useI18n();
  const s = ta.onecX.settings;
  const toast = useToast();
  const queryClient = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [client, setClient] = useState<string>(initialClient ?? clients[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const input = { page, ...(client ? { client } : {}), ...(q.trim() ? { q: q.trim() } : {}) };
  const list = useQuery({ queryKey: queryKey(api.onec.counterparties, input), queryFn: ({ signal }) => api.onec.counterparties(input, { signal }), placeholderData: keepPreviousData });

  const upload = useMutation({
    mutationFn: (picked: File) => api.onec.importCounterparties({ file: picked, ...(client ? { clientId: client } : {}) }),
    onMutate: () => setError(null),
    onSuccess: async (res) => {
      if (!res.ok) { setError(res.error); return; }
      toast(s.imported(res.created, res.updated, res.skipped));
      await queryClient.invalidateQueries({ queryKey: queryKey(api.onec.counterparties) });
    },
    onError: (e) => setError(refusalText(e, ta.onecX.errors['generic'] ?? '')),
    onSettled: () => { if (file.current) file.current.value = ''; },
  });

  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <Card title={s.counterparties} hint={s.counterpartiesHint} flush={Boolean(data && data.rows.length > 0)}>
      <div className="flex flex-wrap items-end gap-3 p-4 pb-3">
        {clients.length > 0 ? (
          <Select label={s.importClient} size="compact" value={client} wrapperClassName="w-full sm:w-60" onChange={(e) => { setClient(e.target.value); setPage(0); }}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        ) : null}
        <Input
          size="compact" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={s.search} aria-label={s.search}
          leadingIcon={<IconSearch size={14} />} wrapperClassName="w-full sm:w-72"
        />
        {canImport ? (
          <>
            <input ref={file} type="file" accept=".xlsx,.csv" className="sr-only" aria-label={s.importFile}
              onChange={(e) => { const picked = e.target.files?.[0]; if (picked) upload.mutate(picked); }} />
            <Button size="sm" leadingIcon={<IconUpload size={14} />} loading={upload.isPending} onClick={() => file.current?.click()}>
              {upload.isPending ? s.importing : s.importFile}
            </Button>
          </>
        ) : null}
      </div>
      {error ? <div className="px-4 pb-3"><Alert tone="danger">{error}</Alert></div> : null}
      {!data ? <div className="flex items-center gap-2 px-4 pb-4 text-muted"><Spinner size={16} /></div>
        : data.rows.length === 0 ? <div className="px-4 pb-4"><EmptyState size="compact" title={s.emptyCounterparties} /></div>
          : (
            <>
              <Table label={s.counterparties} className={FLUSH_TABLE} density="compact">
                <thead>
                  <tr>
                    <Th>{s.colName}</Th>
                    <Th>{s.colInn}</Th>
                    <Th className="hidden md:table-cell">{s.colAccount}</Th>
                    <Th className="hidden md:table-cell">{s.colMfo}</Th>
                    <Th className="hidden lg:table-cell">{s.colSource}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-surface">
                      <Td className="max-w-[20rem]">
                        <span className="block truncate font-medium" title={r.name}>{r.name}</span>
                        {r.aliases.length > 0 ? <span className="block truncate text-small text-muted" title={r.aliases.join(', ')}>{s.colAliases}: {r.aliases.join(', ')}</span> : null}
                      </Td>
                      <Td className="font-mono text-mono">{r.inn ?? '—'}</Td>
                      <Td className="hidden font-mono text-mono md:table-cell">{r.account ?? '—'}</Td>
                      <Td className="hidden font-mono text-mono md:table-cell">{r.mfo ?? '—'}</Td>
                      <Td className="hidden text-small lg:table-cell">{s.sources[r.source] ?? r.source}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {pages > 1 ? (
                <nav className="flex items-center justify-end gap-2 p-3 text-small" aria-label={ta.onecX.list.page(page + 1, pages)}>
                  <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>{ta.onecX.list.prev}</Button>
                  <span className="tabular-nums text-muted">{ta.onecX.list.page(page + 1, pages)}</span>
                  <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{ta.onecX.list.next}</Button>
                </nav>
              ) : null}
            </>
          )}
    </Card>
  );
}
