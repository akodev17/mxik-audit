'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { accounting } from '@tasnivo/contracts';
import { fmtDateTime } from '@tasnivo/i18n/format';
import type { z } from 'zod';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { useI18n } from '@/lib/locale-client';
import { Badge, StatusChip } from '@/ui/badge';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { Drawer } from '@/ui/drawer';
import { Field, Input } from '@/ui/input';
import { Spinner } from '@/ui/spinner';
import { useToast } from '@/ui/toast';
import { fill, issueText, SEVERITY_TONE, STATUS_TONE } from './labels';

type MatchCandidate = z.infer<typeof accounting.MatchCandidate>;

type Props = { productId: string | null; editable: boolean; onClose: () => void; onChanged: () => void };

/** One product: what the check found and why, the suggested and runner-up codes, Tasnif packaging, "Confirm MXIK". */
export function ProductDrawer({ productId, editable, onClose, onChanged }: Props) {
  const { ta, locale } = useI18n();
  const x = ta.productsX;
  const d = x.drawer;
  const toast = useToast();
  const detail = useQuery({
    queryKey: ['products', 'detail', productId],
    queryFn: ({ signal }) => api.products.detail({ productId: productId ?? '' }, { signal }),
    enabled: productId !== null,
  });
  const packages = useQuery({
    queryKey: ['products', 'packages', productId, detail.data?.product.mxik ?? null],
    queryFn: ({ signal }) => api.products.packages({ productId: productId ?? '' }, { signal }),
    enabled: productId !== null && Boolean(detail.data?.product.mxik),
  });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function confirm(value: string): Promise<void> {
    if (!productId) return;
    setBusy(value);
    setError(null);
    try {
      const r = await api.products.confirm({ productId, code: value });
      if (!r.ok) { setError(r.error); return; }
      toast(x.toast.confirmed, { tone: 'ok' });
      setCode('');
      void detail.refetch();
      void packages.refetch();
      onChanged();
    } catch (e) {
      toast(isNetworkFailure(e) ? x.toast.network : x.toast.failed, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const p = detail.data?.product;
  const candidate = (c: MatchCandidate, primary: boolean) => (
    <li key={c.id} className="rounded-md border border-line bg-surface p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <CodeChip code={c.id} />
        <Badge tone={c.confidence >= 0.85 ? 'good' : c.confidence >= 0.6 ? 'warn' : 'neutral'}>{Math.round(c.confidence * 100)}%</Badge>
        {editable ? (
          <Button size="compact" variant={primary ? 'primary' : 'secondary'} className="ml-auto" loading={busy === c.id} disabled={busy !== null} onClick={() => void confirm(c.id)}>
            {x.actions.useSuggestion}
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-small">{c.label.replace(`${c.id} · `, '')}</p>
      {c.reason ? <p className="mt-0.5 text-micro text-muted">{c.reason}</p> : null}
    </li>
  );

  return (
    <Drawer open={productId !== null} title={p?.name ?? d.title} onClose={onClose} width="520px">
      {detail.isPending ? <div className="grid place-items-center py-10"><Spinner /></div> : null}
      {detail.isError ? <p className="text-small text-danger-ink">{x.toast.failed}</p> : null}
      {p ? (
        <div className="space-y-5">
          <section>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={STATUS_TONE[p.mxikStatus]}>{x.status[p.mxikStatus]}</StatusChip>
              {p.markingRequired ? <Badge tone="info">{d.marking}</Badge> : null}
              {p.checkedAt ? <span className="text-micro text-muted">{fill(d.checkedAt, { date: fmtDateTime(locale, p.checkedAt) })}</span> : null}
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small">
              <dt className="text-muted">{x.columns.mxik}</dt>
              <dd>{p.mxik ? <><CodeChip code={p.mxik} /> {p.mxikName ? <span className="block text-micro text-muted">{p.mxikName}</span> : null}</> : '—'}</dd>
              <dt className="text-muted">{x.columns.package}</dt>
              <dd>{p.packageCode ?? '—'}{p.packageName ? <span className="block text-micro text-muted">{p.packageName}</span> : null}</dd>
              <dt className="text-muted">{x.columns.unit}</dt><dd>{p.unit ?? '—'}</dd>
              <dt className="text-muted">{x.columns.barcode}</dt><dd className="tabular-nums">{p.barcode ?? '—'}</dd>
              {p.onecRef ? <><dt className="text-muted">{x.columns.onecRef}</dt><dd>{p.onecRef}</dd></> : null}
              <dt className="text-muted">{x.columns.client}</dt><dd>{p.clientName ?? x.orgOwn}</dd>
            </dl>
            {p.confirmedAt ? <p className="mt-2 text-micro text-good-ink">{fill(d.confirmed, { date: fmtDateTime(locale, p.confirmedAt) })}</p> : null}
          </section>

          <section>
            <h3 className="mb-1.5 text-label font-semibold">{d.issues}</h3>
            {p.issues.length === 0 ? <p className="text-small text-muted">{p.mxikStatus === 'unchecked' ? x.status.unchecked : d.noIssues}</p> : (
              <ul className="space-y-1">
                {p.issues.map((i, n) => (
                  <li key={`${i.code}-${n}`} className="flex items-start gap-2 text-small">
                    <Badge tone={SEVERITY_TONE[i.severity]} className="mt-0.5 shrink-0">{x.severity[i.severity]}</Badge>
                    <span>{issueText(x.issues, i)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {p.suggestion ? (
            <section>
              <h3 className="mb-1.5 text-label font-semibold">{d.suggestion}</h3>
              <ul>{candidate(p.suggestion, true)}</ul>
            </section>
          ) : null}

          <section>
            <h3 className="mb-1.5 text-label font-semibold">{d.alternatives}</h3>
            {(detail.data?.alternatives ?? []).filter((a) => a.id !== p.suggestion?.id).length === 0
              ? <p className="text-small text-muted">{d.noAlternatives}</p>
              : <ul className="space-y-2">{(detail.data?.alternatives ?? []).filter((a) => a.id !== p.suggestion?.id).map((a) => candidate(a, false))}</ul>}
          </section>

          {editable ? (
            <section>
              <Field label={x.actions.confirm} hint={d.confirmHint} error={error ?? undefined}>
                <div className="flex gap-2">
                  <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={d.codePlaceholder} inputMode="numeric" invalid={Boolean(error)} />
                  <Button variant="primary" loading={busy === code} disabled={busy !== null || !code.trim()} onClick={() => void confirm(code.trim())}>{x.actions.confirm}</Button>
                </div>
              </Field>
              {p.mxik && !p.confirmedAt ? (
                <Button className="mt-2" size="sm" variant="secondary" loading={busy === p.mxik} disabled={busy !== null} onClick={() => void confirm(p.mxik ?? '')}>
                  {fill(x.actions.confirmCurrent, { code: p.mxik })}
                </Button>
              ) : null}
            </section>
          ) : null}

          {p.mxik ? (
            <section>
              <h3 className="mb-1.5 text-label font-semibold">{d.packages}</h3>
              {packages.isPending ? <Spinner /> : null}
              {packages.data?.source === 'unavailable' ? <p className="text-small text-muted">{fill(d.packagesUnavailable, { reason: packages.data.reason ?? '' })}</p> : null}
              {packages.data && packages.data.source !== 'unavailable' && packages.data.packages.length === 0 ? <p className="text-small text-muted">{d.packagesNone}</p> : null}
              {packages.data && packages.data.packages.length > 0 ? (
                <ul className="space-y-1 text-small">
                  {packages.data.packages.map((k) => (
                    <li key={k.code} className="flex gap-2">
                      <span className={k.code === p.packageCode ? 'font-semibold text-brand-ink tabular-nums' : 'tabular-nums'}>{k.code}</span>
                      <span className="text-muted">{(locale === 'ru' ? k.nameRu : k.nameUz) ?? k.name}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {(detail.data?.aliases.length ?? 0) > 0 ? (
            <section>
              <h3 className="mb-1.5 text-label font-semibold">{d.aliases}</h3>
              <ul className="list-disc pl-5 text-small">{detail.data?.aliases.map((a) => <li key={a}>{a}</li>)}</ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
