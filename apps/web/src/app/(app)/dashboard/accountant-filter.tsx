import type { AccountantOption } from '@tasnivo/domain/dashboard';
import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { Button } from '@/ui/button';
import { Select } from '@/ui/select';

/** Admins narrow the dashboard to one accountant's clients. Admins are not listed: they always see every client. */
export async function AccountantFilter({ accountants, selected }: { accountants: AccountantOption[]; selected: AccountantOption | null }) {
  const { locale, ta } = await getI18n();
  const home = ta.firmX.home;
  const note = !selected
    ? home.filterAdmins
    : selected.assigned === 0
      ? home.filterOpenAll(selected.email)
      : home.filterAssigned(selected.email, fmtNumber(locale, selected.assigned), selected.assigned);
  return (
    <form action="/dashboard" className="mb-6">
      <div className="flex flex-wrap items-end gap-2">
        <Select label={home.filterLabel} name="accountant" defaultValue={selected?.id ?? ''} wrapperClassName="w-full sm:w-80" aria-describedby="accountant-note">
          <option value="">{home.filterAll}</option>
          {accountants.map((a) => (
            <option key={a.id} value={a.id}>{a.assigned === 0 ? `${a.email} ${home.filterUnrestricted}` : a.email}</option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">{home.filterShow}</Button>
      </div>
      <p id="accountant-note" className="mt-1.5 text-small text-muted">{note}</p>
    </form>
  );
}
