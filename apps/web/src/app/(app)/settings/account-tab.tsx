import type { ReactNode } from 'react';
import type { Me } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Badge } from '@/ui/badge';
import { LanguageSwitch } from '@/ui/language-switch';
import { Avatar } from '../_manage/avatar';
import { Card, Fact } from '../_manage/card';
import { ROLE_TONE } from '../_manage/roles';
import { BrandForm } from './brand-form';
import { DictionarySetting } from './dictionary-setting';
import { ThemeSetting } from './theme-setting';

/** A setting as a row: what it is on the left, the control on the right (stacked on a phone). */
function SettingRow({ label, hint, children, labelHidden = false }: { label: string; hint: string; children: ReactNode; labelHidden?: boolean }) {
  return (
    <div className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-data font-medium" aria-hidden={labelHidden || undefined}>{label}</p>
        <p className="mt-0.5 max-w-md text-small text-muted">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Email, role and client access, language and theme; PDF branding and the dictionary setting for admins. */
export async function AccountTab({ user, demo }: { user: Me; demo: boolean }) {
  const { t, ta } = await getI18n();
  const s = ta.setX.account;
  const org = user.role === 'admin' && !demo ? await serverApi().account.get() : null;

  return (
    <div className="space-y-4">
      <Card id="profile" title={s.profile}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Avatar email={user.email} className="size-12! text-section! ring-0" />
          <div className="min-w-0 flex-1 space-y-4">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <Fact label={s.email}>{user.email}</Fact>
                <p className="mt-0.5 text-micro text-muted">{s.emailHint}</p>
              </div>
              <Fact label={s.role}><Badge tone={ROLE_TONE[user.role]}>{ta.team.roles[user.role]}</Badge></Fact>
              {user.role === 'admin' ? null : (
                <Fact label={s.access}>{user.clientIds === null ? s.accessAll : s.accessSome(user.clientIds.length)}</Fact>
              )}
            </dl>
          </div>
        </div>
      </Card>

      <Card id="appearance" title={s.appearance} hint={ta.mgX.instant}>
        <div className="divide-y divide-line">
          <SettingRow label={s.language} hint={s.languageHint}><LanguageSwitch /></SettingRow>
          {/* The theme switch names itself (a radio group); the visible label here is decoration. */}
          <SettingRow label={s.theme} hint={s.themeHint} labelHidden><ThemeSetting /></SettingRow>
        </div>
      </Card>

      {org ? <BrandForm initial={org} title={t.brandSection} hint={t.brandHint} /> : null}
      {org ? <DictionarySetting initial={org} /> : null}
    </div>
  );
}
