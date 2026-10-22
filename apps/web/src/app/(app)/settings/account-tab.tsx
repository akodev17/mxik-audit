import type { Me } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Input } from '@/ui/input';
import { LanguageSwitch } from '@/ui/language-switch';
import { Section } from '@/ui/page';
import { BrandForm } from './brand-form';
import { DictionarySetting } from './dictionary-setting';
import { ThemeSetting } from './theme-setting';

/** Email, role and client access, language and theme; PDF branding and the dictionary setting for admins. */
export async function AccountTab({ user, demo }: { user: Me; demo: boolean }) {
  const { t, ta } = await getI18n();
  const s = ta.setX.account;
  const org = user.role === 'admin' && !demo ? await serverApi().account.get() : null;

  return (
    <>
      <Section title={s.profile}>
        <div className="max-w-md space-y-4">
          <div>
            <label htmlFor="account-email" className="mb-1 block text-small font-medium">{s.email}</label>
            <Input id="account-email" value={user.email} readOnly aria-describedby="account-email-hint" />
            <p id="account-email-hint" className="mt-1 text-micro text-muted">{s.emailHint}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-small">
            <dt className="text-muted">{s.role}</dt>
            <dd>{ta.team.roles[user.role]}</dd>
            {user.role === 'admin' ? null : (
              <>
                <dt className="text-muted">{s.access}</dt>
                <dd>{user.clientIds === null ? s.accessAll : s.accessSome(user.clientIds.length)}</dd>
              </>
            )}
          </dl>
        </div>
      </Section>

      <Section title={s.appearance}>
        <div className="space-y-5">
          <div>
            <p className="mb-1.5 text-small font-medium">{s.language}</p>
            <LanguageSwitch />
            <p className="mt-1 text-micro text-muted">{s.languageHint}</p>
          </div>
          <div>
            <p className="mb-1.5 text-small font-medium" aria-hidden>{s.theme}</p>
            <ThemeSetting />
            <p className="mt-1 text-micro text-muted">{s.themeHint}</p>
          </div>
        </div>
      </Section>

      {org ? (
        <Section title={t.brandSection} hint={t.brandHint}>
          <BrandForm initial={org} />
        </Section>
      ) : null}

      {org ? (
        <Section title={ta.dict.autoTitle}>
          <DictionarySetting initial={org} />
        </Section>
      ) : null}
    </>
  );
}
