'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { saveBranding, type BrandState } from '@/app/actions/settings';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Field, Input } from '@/ui/input';

type Props = { brandName: string; orgName: string; logoUrl: string | null };

/** Firm name and logo printed on client PDF reports. The file picker is our own button, in the UI's language. */
export function BrandForm({ brandName, orgName, logoUrl }: Props) {
  const { t, ta } = useI18n();
  const s = ta.setX.account;
  const [state, action, pending] = useActionState<BrandState, FormData>(saveBranding, {});
  const file = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // A saved form is reset by React, file input included.
  useEffect(() => setFileName(null), [state]);

  return (
    <form action={action} className="max-w-md space-y-4">
      <Field label={t.brandName}>
        <Input name="brandName" defaultValue={brandName} placeholder={orgName} maxLength={120} />
      </Field>
      <div className="relative">
        <p className="mb-1 text-small font-medium">{t.brandLogo}</p>
        {logoUrl ? <img src={logoUrl} alt="" className="mb-2 block max-h-12 max-w-[160px] rounded-md border border-line bg-base p-1" /> : null}
        <input
          ref={file} name="logo" type="file" accept="image/png,image/jpeg" tabIndex={-1} aria-hidden className="sr-only"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button size="sm" onClick={() => file.current?.click()} aria-describedby="brand-logo-name brand-logo-hint">
            {s.logoPick}
          </Button>
          <span id="brand-logo-name" className="min-w-0 truncate text-small text-muted">{fileName ?? s.logoNone}</span>
        </div>
        <p id="brand-logo-hint" className="mt-1 text-micro text-muted">{t.brandLogoHint}</p>
        {logoUrl ? <Checkbox name="removeLogo" label={t.brandRemoveLogo} className="mt-2" /> : null}
      </div>
      <Button type="submit" variant="primary" loading={pending}>{t.brandSave}</Button>
      {state.error ? <p role="alert" className="text-small text-danger-ink">{state.error}</p> : null}
      {state.saved && !pending ? <p role="status" className="text-small text-good-ink">{t.brandSaved}</p> : null}
    </form>
  );
}
