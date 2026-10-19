import { isAdminRole } from '@/lib/access';
import { db } from '@/lib/db';
import { getI18n } from '@/lib/locale';
import type { CurrentUser } from '@/lib/session';
import { Input } from '@/ui/input';
import { LanguageSwitch } from '@/ui/language-switch';
import { Section } from '@/ui/page';
import { BrandForm } from './brand-form';
import { DictionarySetting } from './dictionary-setting';

/** Email, role and client access, language and theme; PDF branding and the dictionary setting for admins. */
export async function AccountTab({ user, demo }: { user: CurrentUser; demo: boolean }) {
  const { t, ta } = await getI18n();
  const s = ta.setX.account;
  const org = isAdminRole(user) && !demo
    ? await db.organization.findUniqueOrThrow({ where: { id: user.orgId }, select: { name: true, brandName: true, logoData: true, logoMime: true, dictAutoAccept: true } })
    : null;
  const logoUrl = org?.logoData && org.logoMime ? `data:${org.logoMime};base64,${Buffer.from(org.logoData).toString('base64')}` : null;

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
            <p className="mb-1 text-small font-medium">{s.theme}</p>
            <p className="max-w-xl text-small text-muted">{s.themeHint}</p>
          </div>
        </div>
      </Section>

      {org ? (
        <Section title={t.brandSection} hint={t.brandHint}>
          <BrandForm brandName={org.brandName ?? ''} orgName={org.name} logoUrl={logoUrl} />
        </Section>
      ) : null}

      {org ? (
        <Section title={ta.dict.autoTitle}>
          <DictionarySetting initial={org.dictAutoAccept} />
        </Section>
      ) : null}
    </>
  );
}
