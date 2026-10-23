import { ACTIVITY_CATEGORIES as CATEGORIES } from '@tasnivo/contracts/modules/account';
import { getI18n } from '@/lib/locale';
import { dayInputValue } from '@/lib/pure/activity-dates';
import { Field, Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { FILTER_FIELD, FilterBar } from '../queue/filter-bar';

type Category = (typeof CATEGORIES)[number];

type Props = {
  clients: { id: string; name: string }[];
  users: { id: string; email: string }[];
  /** from and to are yyyy-mm-dd (or '' when unset). */
  value: { clientId: string | null; userId: string | null; category: Category; from: string; to: string };
  active: boolean;
};

/**
 * GET form: filters live in the URL. Dates are Tashkent calendar days typed as dd.mm.yyyy: a native
 * date field would follow the browser's language (mm/dd/yyyy in an English Chrome), not the app's.
 */
export async function ActivityFilters({ clients, users, value, active }: Props) {
  const { ta } = await getI18n();
  const words = ta.firmX.log;
  const day = (name: 'from' | 'to', label: string, current: string) => (
    <Field label={label} className={FILTER_FIELD}>
      <Input
        type="text" name={name} defaultValue={dayInputValue(current)} placeholder={words.datePlaceholder}
        inputMode="numeric" autoComplete="off" maxLength={10} className="tabular-nums"
      />
    </Field>
  );
  return (
    <FilterBar action="/activity" reset={active ? '/activity' : null}>
      {clients.length > 1 ? (
        <Select label={ta.log.client} name="client" defaultValue={value.clientId ?? ''} wrapperClassName={`col-span-2 lg:col-span-1 ${FILTER_FIELD}`}>
          <option value="">{ta.log.any}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      ) : null}
      <Select label={ta.log.user} name="user" defaultValue={value.userId ?? ''} wrapperClassName={FILTER_FIELD}>
        <option value="">{ta.log.any}</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
      </Select>
      <Select label={ta.log.type} name="type" defaultValue={value.category} wrapperClassName={FILTER_FIELD}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c === 'clients' ? words.clientsType : ta.log.types[c]}</option>)}
      </Select>
      {day('from', ta.log.from, value.from)}
      {day('to', ta.log.to, value.to)}
    </FilterBar>
  );
}
