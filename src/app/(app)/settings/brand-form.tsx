'use client';

import { useI18n } from '@/lib/locale-client';
import { useActionState } from 'react';
import { saveBranding, type BrandState } from '@/app/actions/settings';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

type Props = { brandName: string; orgName: string; logoUrl: string | null };

export function BrandForm({ brandName, orgName, logoUrl }: Props) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<BrandState, FormData>(saveBranding, {});
  return (
    <form action={action} className="max-w-md space-y-4">
      <Field label={t.brandName}>
        <Input name="brandName" defaultValue={brandName} placeholder={orgName} maxLength={120} />
      </Field>
      <div className="text-sm">
        <span className="mb-1 block font-medium">{t.brandLogo}</span>
        {logoUrl ? <img src={logoUrl} alt="" className="mb-2 block max-h-12 max-w-[160px] rounded-ctl border border-line bg-base p-1" /> : null}
        <input name="logo" type="file" accept="image/png,image/jpeg" className="block text-sm" />
        <span className="mt-1 block text-xs text-muted">{t.brandLogoHint}</span>
        {logoUrl ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" name="removeLogo" className="size-4 accent-[var(--color-brand)]" /> {t.brandRemoveLogo}
          </label>
        ) : null}
      </div>
      <Button type="submit" variant="primary" disabled={pending}>{t.brandSave}</Button>
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      {state.saved ? <p className="text-sm text-good">{t.brandSaved}</p> : null}
    </form>
  );
}
