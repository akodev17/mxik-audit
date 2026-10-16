'use client';

import { useActionState } from 'react';
import { saveBranding, type BrandState } from '@/app/actions/settings';
import { t } from '@/lib/i18n';

type Props = { brandName: string; orgName: string; logoUrl: string | null };

export function BrandForm({ brandName, orgName, logoUrl }: Props) {
  const [state, action, pending] = useActionState<BrandState, FormData>(saveBranding, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm">
        <span className="text-ink-soft">{t.brandName}</span>
        <input
          name="brandName" defaultValue={brandName} placeholder={orgName} maxLength={120}
          className="mt-1 block w-full max-w-md border border-rule px-3 py-2 focus:border-ink focus:outline-none"
        />
      </label>
      <div className="text-sm">
        <span className="text-ink-soft">{t.brandLogo}</span>
        {logoUrl ? (
          <img src={logoUrl} alt="" className="mt-1 block max-h-12 max-w-[160px] border border-rule bg-paper p-1" />
        ) : null}
        <input name="logo" type="file" accept="image/png,image/jpeg" className="mt-1 block text-sm" />
        <span className="mt-1 block text-xs text-ink-faint">{t.brandLogoHint}</span>
        {logoUrl ? (
          <label className="mt-1 flex items-center gap-2 text-xs text-ink-soft">
            <input type="checkbox" name="removeLogo" /> {t.brandRemoveLogo}
          </label>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className="bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50">{t.brandSave}</button>
      {state.error ? <p role="alert" className="text-sm text-risk">{state.error}</p> : null}
      {state.saved ? <p className="text-sm text-ok">{t.brandSaved}</p> : null}
    </form>
  );
}
