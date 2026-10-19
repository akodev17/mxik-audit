'use client';

import { useI18n } from '@/lib/locale-client';
import { useActionState } from 'react';
import { saveBranding, type BrandState } from '@/app/actions/settings';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Field, Input } from '@/ui/input';

type Props = { brandName: string; orgName: string; logoUrl: string | null };

/** Firm name and logo printed on client PDF reports. */
export function BrandForm({ brandName, orgName, logoUrl }: Props) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<BrandState, FormData>(saveBranding, {});
  return (
    <form action={action} className="max-w-md space-y-4">
      <Field label={t.brandName}>
        <Input name="brandName" defaultValue={brandName} placeholder={orgName} maxLength={120} />
      </Field>
      <div>
        <label htmlFor="brand-logo" className="mb-1 block text-small font-medium">{t.brandLogo}</label>
        {logoUrl ? <img src={logoUrl} alt="" className="mb-2 block max-h-12 max-w-[160px] rounded-md border border-line bg-base p-1" /> : null}
        <input id="brand-logo" name="logo" type="file" accept="image/png,image/jpeg" aria-describedby="brand-logo-hint" className="block max-w-full text-small file:mr-3 file:h-control-compact file:cursor-pointer file:rounded-md file:border file:border-line-strong file:bg-raised file:px-3 file:text-data file:text-fg" />
        <p id="brand-logo-hint" className="mt-1 text-micro text-muted">{t.brandLogoHint}</p>
        {logoUrl ? <Checkbox name="removeLogo" label={t.brandRemoveLogo} className="mt-2" /> : null}
      </div>
      <Button type="submit" variant="secondary" loading={pending}>{t.brandSave}</Button>
      {state.error ? <p role="alert" className="text-small text-danger-ink">{state.error}</p> : null}
      {state.saved && !pending ? <p role="status" className="text-small text-good-ink">{t.brandSaved}</p> : null}
    </form>
  );
}
