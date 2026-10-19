import type { QueueFilter } from '@/lib/queue';
import { FINDING_TYPES } from '@/lib/workspace';
import { getI18n } from '@/lib/locale';
import { Button, ButtonLink } from '@/ui/button';
import { typeLabels } from '@/ui/labels';
import { Select } from '@/ui/select';

type Props = {
  filter: QueueFilter;
  clients: { id: string; name: string }[];
  /** Admins only; empty hides the field. */
  accountants: { id: string; email: string; unrestricted: boolean }[];
  active: boolean;
};

/** Plain GET form: every filter is in the URL, so a filtered queue can be bookmarked or shared. */
export async function QueueFilters({ filter, clients, accountants, active }: Props) {
  const { t, ta } = await getI18n();
  const q = ta.firmX.queue;
  const labels = typeLabels(t);
  return (
    <form action="/queue" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7 xl:items-end">
      {clients.length > 1 ? (
        <Select label={q.client} name="client" defaultValue={filter.clientId ?? ''} wrapperClassName="col-span-2 lg:col-span-1">
          <option value="">{q.allClients}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      ) : null}
      <Select label={q.type} name="type" defaultValue={filter.type ?? ''}>
        <option value="">{q.allTypes}</option>
        {FINDING_TYPES.map((x) => <option key={x} value={x}>{labels[x] ?? x}</option>)}
      </Select>
      <Select label={q.severity} name="severity" defaultValue={filter.severity ?? ''}>
        <option value="">{q.any}</option>
        <option value="high">{q.high}</option>
        <option value="medium">{q.medium}</option>
      </Select>
      <Select label={q.flag} name="flag" defaultValue={filter.askClient ? 'ask_client' : ''}>
        <option value="">{q.any}</option>
        <option value="ask_client">{q.askClient}</option>
      </Select>
      {accountants.length > 0 ? (
        <Select label={q.accountant} name="accountant" defaultValue={filter.accountantId ?? ''}>
          <option value="">{q.allAccountants}</option>
          {accountants.map((a) => <option key={a.id} value={a.id}>{a.unrestricted ? `${a.email} ${ta.firmX.home.filterUnrestricted}` : a.email}</option>)}
        </Select>
      ) : null}
      <Select label={q.due} name="due" defaultValue={filter.due ?? ''}>
        <option value="">{q.dueAny}</option>
        <option value="overdue">{q.dueOverdue}</option>
        <option value="week">{q.dueWeek}</option>
        <option value="month">{q.dueMonth}</option>
      </Select>
      <div className="col-span-2 flex flex-wrap items-end gap-2 lg:col-span-1">
        <Button type="submit" variant="primary">{q.apply}</Button>
        {active ? <ButtonLink href="/queue" variant="ghost">{q.reset}</ButtonLink> : null}
      </div>
    </form>
  );
}
