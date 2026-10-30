'use client';

// The org's 1C settings (admins): how the bank file names the МФО, and the optional direct
// connection with its test. The connection is labelled "not verified against a real 1C" until the
// owner's environment has been tested (docs/accounting-2026-10-23/agent1-result.md).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { refusalText } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { Segmented } from '@/ui/segmented';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { Card } from '../../_manage/card';

type Connection = OutputOf<typeof endpoints.onec.connection>;
type Test = OutputOf<typeof endpoints.onec.testConnection>;
type Kind = Connection['kind'];
type BankKeys = Connection['bankKeys'];

type Problem = NonNullable<Test['problems']>[number];

/** What the base's OData composition lacks, each with the object to publish (onec §8.25); also shown by a refused transfer. */
export function CompositionProblems({ problems }: { problems: readonly Problem[] }) {
  const { ta } = useI18n();
  const s = ta.onecX.settings;
  return (
    <Alert tone={problems.some((p) => p.required) ? 'danger' : 'warn'} className="mt-3" title={s.problemsTitle}>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {problems.map((p) => (
          <li key={`${p.kind}:${p.entitySet}:${p.attribute ?? ''}`}>
            <span className="font-mono text-mono">{s.problem[p.kind]?.(p.entitySet, p.attribute ?? '') ?? `${p.entitySet} ${p.attribute ?? ''}`}</span>
            {p.required ? <span className="ml-2 text-danger-ink">({s.required})</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-2">{s.problemsHint}</p>
    </Alert>
  );
}

export function ConnectionForm({ initial, demo }: { initial: Connection; demo: boolean }) {
  const { locale, ta } = useI18n();
  const s = ta.onecX.settings;
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data } = useSeededQuery(api.onec.connection, initial);
  const [kind, setKind] = useState<Kind>(initial.kind);
  const [bankKeys, setBankKeys] = useState<BankKeys>(initial.bankKeys);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? '');
  const [username, setUsername] = useState(initial.username ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<Test | null>(null);
  const fail = (e: unknown) => setError(refusalText(e, ta.onecX.errors['generic'] ?? ''));

  const save = useMutation({
    mutationFn: () => api.onec.saveConnection({
      kind, bankKeys, baseUrl: baseUrl.trim() || null, username: username.trim() || null, ...(password ? { password } : {}),
    }),
    onMutate: () => { setError(null); setTest(null); },
    onSuccess: async (res) => {
      if (!res.ok) { setError(res.error); return; }
      setPassword('');
      toast(s.saved);
      await queryClient.invalidateQueries({ queryKey: queryKey(api.onec.connection) });
    },
    onError: fail,
  });
  const check = useMutation({
    mutationFn: () => api.onec.testConnection(),
    onMutate: () => { setError(null); setTest(null); },
    onSuccess: async (res) => {
      setTest(res);
      await queryClient.invalidateQueries({ queryKey: queryKey(api.onec.connection) });
    },
    onError: fail,
  });

  const codeText = (code: string): string => s.codes[code] ?? s.codes[code.split(':')[0] ?? ''] ?? code;
  const verdict = test ?? (data.lastTestedAt ? { ok: data.lastOk ?? false, code: data.lastError ?? 'ok', entitySets: null, missing: [] as string[], testedAt: data.lastTestedAt } : null);

  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Card title={s.bankFile} hint={s.bankKeysHint}>
        <Segmented
          label={s.bankKeys} value={bankKeys} onChange={setBankKeys} size="md"
          options={[{ value: 'standard', label: s.bankKeysStandard }, { value: 'uz_mfo', label: s.bankKeysUz }]}
        />
      </Card>

      <Card title={s.connection} hint={s.notVerified}>
        <div className="grid gap-4 md:grid-cols-2">
          <Select label={s.kind} value={kind} size="compact" onChange={(e) => setKind(e.target.value as Kind)}>
            {(['none', 'odata', 'http'] as const).map((k) => <option key={k} value={k}>{s.kinds[k]}</option>)}
          </Select>
          <span className="hidden md:block" />
          {kind !== 'none' ? (
            <>
              <Field label={s.baseUrl} hint={s.baseUrlHint} className="md:col-span-2">
                <Input size="compact" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://" autoComplete="off" />
              </Field>
              <Field label={s.username}>
                <Input size="compact" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              </Field>
              <Field label={s.password} hint={data.hasPassword ? s.passwordKept : undefined}>
                <Input size="compact" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </Field>
            </>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusChip tone="warn">{s.notVerified.split('.')[0]}</StatusChip>
        </div>
        {verdict ? (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-small" aria-live="polite">
            <StatusIcon tone={verdict.ok ? 'good' : 'danger'} />
            <span className="font-medium">
              {verdict.ok ? (verdict.entitySets !== null ? s.testOk(verdict.entitySets) : kind === 'http' ? s.testOkHttp : codeText('ok')) : codeText(verdict.code)}
            </span>
            {verdict.missing.length > 0 ? <span className="text-warn-ink">{s.missing(verdict.missing.join(', '))}</span> : null}
            <span className="text-muted">{s.lastTest}: {fmtDateTime(locale, verdict.testedAt)}</span>
          </p>
        ) : <p className="mt-3 text-small text-muted">{s.lastTest}: {s.never}</p>}
        {kind !== 'none' && (test?.insecure || baseUrl.trim().toLowerCase().startsWith('http:')) ? <Alert tone="warn" className="mt-3">{s.insecure}</Alert> : null}
        {test?.problems && test.problems.length > 0 ? <CompositionProblems problems={test.problems} /> : null}
        {test?.resolved && Object.keys(test.resolved).length > 0 ? (
          <ul className="mt-3 space-y-1 text-small text-muted">
            {Object.entries(test.resolved).map(([from, to]) => <li key={from}>{s.renamed(from, to)}</li>)}
          </ul>
        ) : null}
      </Card>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={demo}>{s.save}</Button>
        {data.kind !== 'none' ? <Button loading={check.isPending} disabled={demo} onClick={() => check.mutate()}>{check.isPending ? s.testing : s.test}</Button> : null}
      </div>
    </form>
  );
}
