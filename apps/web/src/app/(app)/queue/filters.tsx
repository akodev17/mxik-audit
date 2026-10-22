import type { QueueFilter } from '@tasnivo/domain/queue';
import { FINDING_TYPES } from '@tasnivo/domain/workspace';
import { getI18n } from '@/lib/locale';
import { typeLabels } from '@/ui/labels';
import { Select } from '@/ui/select';
import { FILTER_FIELD, FilterBar } from './filter-bar';

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
    <FilterBar action="/queue" reset={active ? '/queue' : null}>
      {clients.length > 1 ? (
        <Select label={q.client} name="client" defaultValue={filter.clientId ?? ''} wrapperClassName={`col-span-2 lg:col-span-1 ${FILTER_FIELD}`}>
          <option value="">{q.allClients}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      ) : null}
      <Select label={q.type} wrapperClassName={FILTER_FIELD} name="type" defaultValue={filter.type ?? ''}>
        <option value="">{q.allTypes}</option>
        {FINDING_TYPES.map((x) => <option key={x} value={x}>{labels[x] ?? x}</option>)}
      </Select>
      <Select label={q.severity} wrapperClassName={FILTER_FIELD} name="severity" defaultValue={filter.severity ?? ''}>
        <option value="">{q.any}</option>
        <option value="high">{q.high}</option>
        <option value="medium">{q.medium}</option>
      </Select>
      <Select label={q.flag} wrapperClassName={FILTER_FIELD} name="flag" defaultValue={filter.askClient ? 'ask_client' : ''}>
        <option value="">{q.any}</option>
        <option value="ask_client">{q.askClient}</option>
      </Select>
      {accountants.length > 0 ? (
        <Select label={q.accountant} wrapperClassName={FILTER_FIELD} name="accountant" defaultValue={filter.accountantId ?? ''}>
          <option value="">{q.allAccountants}</option>
          {accountants.map((a) => <option key={a.id} value={a.id}>{a.unrestricted ? `${a.email} ${ta.firmX.home.filterUnrestricted}` : a.email}</option>)}
        </Select>
      ) : null}
      <Select label={q.due} wrapperClassName={FILTER_FIELD} name="due" defaultValue={filter.due ?? ''}>
        <option value="">{q.dueAny}</option>
        <option value="overdue">{q.dueOverdue}</option>
        <option value="week">{q.dueWeek}</option>
        <option value="month">{q.dueMonth}</option>
      </Select>
    </FilterBar>
  );
}
