import { CATEGORIES, type Category } from '@/lib/activity';
import { isoDay } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { Button, ButtonLink } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { Select } from '@/ui/select';

type Props = {
  clients: { id: string; name: string }[];
  users: { id: string; email: string }[];
  value: { clientId: string | null; userId: string | null; category: Category; from: string; to: string };
  active: boolean;
};

/** GET form: filters live in the URL. Dates are Tashkent calendar days. */
export async function ActivityFilters({ clients, users, value, active }: Props) {
  const { ta } = await getI18n();
  const today = isoDay(new Date());
  return (
    <form action="/activity" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6 lg:items-end">
      {clients.length > 1 ? (
        <Select label={ta.log.client} name="client" defaultValue={value.clientId ?? ''} wrapperClassName="col-span-2 lg:col-span-1">
          <option value="">{ta.log.any}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      ) : null}
      <Select label={ta.log.user} name="user" defaultValue={value.userId ?? ''}>
        <option value="">{ta.log.any}</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
      </Select>
      <Select label={ta.log.type} name="type" defaultValue={value.category}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{ta.log.types[c]}</option>)}
      </Select>
      <Field label={ta.log.from}>
        <Input type="date" name="from" defaultValue={value.from} max={today} />
      </Field>
      <Field label={ta.log.to}>
        <Input type="date" name="to" defaultValue={value.to} max={today} />
      </Field>
      <div className="col-span-2 flex flex-wrap items-end gap-2 lg:col-span-1">
        <Button type="submit" variant="primary">{ta.log.apply}</Button>
        {active ? <ButtonLink href="/activity" variant="ghost">{ta.firmX.log.reset}</ButtonLink> : null}
      </div>
    </form>
  );
}
