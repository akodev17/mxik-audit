import Link from 'next/link';
import { getI18n } from '@/lib/locale';
import { IconX } from '@/ui/icons';
import { typeLabels } from '@/ui/labels';
import { readQueueFilter, withQuery } from './queue-params';

type Params = Record<string, string | undefined>;

type Props = {
  params: Params;
  clients: { id: string; name: string }[];
  accountants: { id: string; email: string }[];
};

/** Every filter the queue is under, as a chip whose cross is a link to the same queue without it. */
export async function ActiveQueueFilters({ params, clients, accountants }: Props) {
  const { t, ta } = await getI18n();
  const q = ta.firmX.queue;
  const u = ta.wsUi.queue;
  const f = readQueueFilter(params);
  const chips: { key: string; label: string }[] = [];
  if (f.clientId) chips.push({ key: 'client', label: `${q.client}: ${clients.find((c) => c.id === f.clientId)?.name ?? '—'}` });
  if (f.type) chips.push({ key: 'type', label: `${q.type}: ${typeLabels(t)[f.type] ?? f.type}` });
  if (f.severity) chips.push({ key: 'severity', label: `${q.severity}: ${f.severity === 'high' ? q.high : q.medium}` });
  if (f.askClient) chips.push({ key: 'flag', label: `${q.flag}: ${q.askClient}` });
  if (f.accountantId) chips.push({ key: 'accountant', label: `${q.accountant}: ${accountants.find((a) => a.id === f.accountantId)?.email ?? '—'}` });
  if (f.due) chips.push({ key: 'due', label: `${q.due}: ${{ overdue: q.dueOverdue, week: q.dueWeek, month: q.dueMonth }[f.due]}` });
  if (chips.length === 0) return null;
  return (
    <ul aria-label={u.filtersLabel} className="-mt-2 mb-5 flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <li key={c.key} className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-brand/40 bg-brand-tint pl-3 pr-1 text-small font-medium text-brand-ink">
          <span className="min-w-0 truncate">{c.label}</span>
          <Link
            href={withQuery('/queue', params, { [c.key]: null })} aria-label={u.remove(c.label)} title={u.remove(c.label)}
            className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-raised"
          >
            <IconX size={12} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
