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
import { useToast } from '@/ui/toast';
import { Card } from '../_manage/card';

/** GET /api/account: profile, branding and data settings, shared by the account and data tabs. */
export type Account = OutputOf<typeof endpoints.account.get>;
type BrandState = OutputOf<typeof endpoints.account.saveBranding>;

const FORM_ID = 'brand-form';

/**
 * Firm name and logo printed on client PDF reports, as a card with its own save. The file picker is
 * our own button, in the UI's language.
 */
export function BrandForm({ initial, title, hint }: { initial: Account; title: string; hint: string }) {
  const { t, ta } = useI18n();
  const s = ta.setX.account;
  const toast = useToast();
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
      if (answer.saved) {
        toast(t.brandSaved);
        await queryClient.invalidateQueries({ queryKey: queryKey(api.account.get) });
      }
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
    <Card
      id="brand" title={title} hint={hint}
      footer={(
        <>
          {state.saved && !pending ? <p role="status" className="mr-auto text-small text-good-ink">{t.brandSaved}</p> : null}
          <Button type="submit" form={FORM_ID} size="sm" variant="primary" loading={pending}>{t.brandSave}</Button>
        </>
      )}
    >
      <form id={FORM_ID} key={round} onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
        <Field label={t.brandName}>
          <Input name="brandName" defaultValue={brandName ?? ''} placeholder={orgName} maxLength={120} />
        </Field>
        <div className="relative">
          <p className="mb-1 text-small font-medium">{t.brandLogo}</p>
          <input
            ref={file} name="logo" type="file" accept="image/png,image/jpeg" tabIndex={-1} aria-hidden className="sr-only"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-24 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-base p-1">
              {logoUrl ? <img src={logoUrl} alt="" className="max-h-full max-w-full object-contain" /> : <span aria-hidden className="text-micro text-subtle">PNG · JPG</span>}
            </span>
            <div className="min-w-0 space-y-1">
              <Button size="sm" onClick={() => file.current?.click()} aria-describedby="brand-logo-name brand-logo-hint">
                {s.logoPick}
              </Button>
              <span id="brand-logo-name" className="block min-w-0 truncate text-small text-muted">{fileName ?? s.logoNone}</span>
            </div>
          </div>
          <p id="brand-logo-hint" className="mt-1.5 text-micro text-muted">{t.brandLogoHint}</p>
          {logoUrl ? <Checkbox name="removeLogo" label={t.brandRemoveLogo} className="mt-2" /> : null}
        </div>
        {state.error ? <p role="alert" className="text-small font-medium text-danger-ink sm:col-span-2">{state.error}</p> : null}
      </form>
    </Card>
  );
}
