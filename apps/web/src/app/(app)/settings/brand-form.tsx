'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Field, Input } from '@/ui/input';

/** GET /api/account: profile, branding and data settings, shared by the account and data tabs. */
export type Account = OutputOf<typeof endpoints.account.get>;
type BrandState = OutputOf<typeof endpoints.account.saveBranding>;

/** Firm name and logo printed on client PDF reports. The file picker is our own button, in the UI's language. */
export function BrandForm({ initial }: { initial: Account }) {
  const { t, ta } = useI18n();
  const s = ta.setX.account;
  const queryClient = useQueryClient();
  const { data: { brandName, name: orgName, logoUrl } } = useSeededQuery(api.account.get, initial);
  const [state, setState] = useState<BrandState>({});
  // A new key after every save gives fresh inputs (the saved name, no file, the box unticked).
  const [round, setRound] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  useEffect(() => setFileName(null), [state]);

  const save = useMutation({
    mutationFn: (form: FormData) => api.account.saveBranding(form),
    onSuccess: async (answer) => {
      if (answer.saved) await queryClient.invalidateQueries({ queryKey: queryKey(api.account.get) });
      setState(answer);
    },
    onError: () => setState({ error: t.errorGeneric }),
    onSettled: () => setRound((n) => n + 1),
  });
  const pending = save.isPending;

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    const logo = form.get('logo');
    if (logo instanceof File && logo.size === 0) form.delete('logo');
    save.mutate(form);
  };

  return (
    <form key={round} onSubmit={submit} className="max-w-md space-y-4">
      <Field label={t.brandName}>
        <Input name="brandName" defaultValue={brandName ?? ''} placeholder={orgName} maxLength={120} />
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
