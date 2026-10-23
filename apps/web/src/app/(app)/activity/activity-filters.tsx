import Link from 'next/link';
import { ACTIVITY_CATEGORIES as CATEGORIES } from '@tasnivo/contracts/modules/account';
import { getI18n } from '@/lib/locale';
import { dayInputValue } from '@/lib/pure/activity-dates';
import { withQuery } from '@/lib/pure/query-string';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconX } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { Select } from '@/ui/select';

type Category = (typeof CATEGORIES)[number];
type Params = Record<string, string | undefined>;

type Props = {
  clients: { id: string; name: string }[];
  users: { id: string; email: string }[];
  /** from and to are yyyy-mm-dd (or '' when unset). */
  value: { clientId: string | null; userId: string | null; category: Category; from: string; to: string };
  /** The filters as the address carries them (type, client, user, from, to). */
  params: Params;
};

const chip = (active: boolean): string => cx(
  'inline-flex h-7 items-center rounded-full border px-3 text-small font-medium transition-colors duration-(--duration-fast)',
  active ? 'border-transparent bg-fg text-inverse' : 'border-line bg-raised text-muted hover:border-line-strong hover:text-fg',
);

/**
 * The log's filters, all in the URL: the kind of entry as a row of chips (one click each), client, person and
 * dates in a small GET form, and every filter in use as a chip that removes it. Dates are Tashkent calendar
 * days typed as dd.mm.yyyy: a native date field would follow the browser's language, not the app's.
 */
export async function ActivityFilters({ clients, users, value, params }: Props) {
  const { ta } = await getI18n();
  const words = ta.firmX.log;
  const typeLabel = (c: Category): string => (c === 'clients' ? words.clientsType : ta.log.types[c]);
  const day = (name: 'from' | 'to', label: string, current: string) => (
    <Field label={label} className="w-[8.5rem]">
      <Input
        type="text" name={name} size="compact" defaultValue={dayInputValue(current)} placeholder={words.datePlaceholder}
        inputMode="numeric" autoComplete="off" maxLength={10} className="tabular-nums"
      />
    </Field>
  );

  const used: { key: string; label: string }[] = [];
  const client = clients.find((c) => c.id === value.clientId);
  if (client) used.push({ key: 'client', label: `${ta.log.client}: ${client.name}` });
  const user = users.find((u) => u.id === value.userId);
  if (user) used.push({ key: 'user', label: `${ta.log.user}: ${user.email}` });
  if (value.from) used.push({ key: 'from', label: `${ta.log.from}: ${dayInputValue(value.from)}` });
  if (value.to) used.push({ key: 'to', label: `${ta.log.to}: ${dayInputValue(value.to)}` });

  return (
    <div className="mb-6 space-y-3">
      <nav aria-label={ta.log.type} className="flex flex-wrap items-center gap-1.5">
        {CATEGORIES.map((c) => (
          <Link key={c} href={withQuery('/activity', params, { type: c === 'all' ? null : c, page: null })} aria-current={c === value.category ? 'page' : undefined} className={chip(c === value.category)}>
            {typeLabel(c)}
          </Link>
        ))}
      </nav>

      <form action="/activity" aria-label={words.moreFilters} className="flex flex-wrap items-end gap-x-3 gap-y-2.5 rounded-lg border border-line bg-surface p-3">
        {value.category !== 'all' ? <input type="hidden" name="type" value={value.category} /> : null}
        {clients.length > 1 ? (
          <Select label={ta.log.client} name="client" size="compact" defaultValue={value.clientId ?? ''} wrapperClassName="w-full sm:w-52">
            <option value="">{ta.log.any}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        ) : null}
        <Select label={ta.log.user} name="user" size="compact" defaultValue={value.userId ?? ''} wrapperClassName="w-full sm:w-56">
          <option value="">{ta.log.any}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
        </Select>
        {day('from', ta.log.from, value.from)}
        {day('to', ta.log.to, value.to)}
        <Button type="submit" size="sm">{ta.log.apply}</Button>
      </form>

      {used.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-1.5">
          {used.map((f) => (
            <li key={f.key}>
              <Link
                href={withQuery('/activity', params, { [f.key]: null, page: null })}
                aria-label={words.removeFilter(f.label)}
                className="inline-flex h-7 max-w-[18rem] items-center gap-1.5 rounded-full bg-brand-tint pl-3 pr-2 text-small font-medium text-brand-ink hover:bg-brand-tint/70"
              >
                <span className="truncate">{f.label}</span>
                <IconX size={12} className="shrink-0" />
              </Link>
            </li>
          ))}
          <li><Link href="/activity" className="px-2 text-small font-medium text-muted hover:text-fg hover:underline">{words.reset}</Link></li>
        </ul>
      ) : null}
    </div>
  );
}
