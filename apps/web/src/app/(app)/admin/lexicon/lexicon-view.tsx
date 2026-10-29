'use client';

// The admin lexicon page's body: global alias candidates (approve / reject), synonym entries and
// unit aliases (add, edit, disable, enable). Every save goes through the API, which runs the
// normaliser's invariants and answers { ok: false, problems } when the entry breaks them.
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import { Badge, StatusIcon, type Tone } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { CodeChip } from '@/ui/code-chip';
import { EmptyState } from '@/ui/empty-state';
import { Field, Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { Card, FLUSH_TABLE } from '../../_manage/card';

type Lexicon = Awaited<ReturnType<typeof api.admin.lexicon>>;
type Entry = Lexicon['synonyms'][number];
type SynonymPayload = Extract<Entry['payload'], { forms: string[] }>;
type UnitPayload = Extract<Entry['payload'], { alias: string }>;
type Save = Awaited<ReturnType<typeof api.admin.createLexiconEntry>>;

const STATUS_TONE: Record<string, Tone> = { candidate: 'info', active: 'good', disabled: 'neutral', rejected: 'warn' };

const splitList = (value: string): string[] => value.split(',').map((s) => s.trim()).filter(Boolean);

/** The problems a refused save listed, under the refusal line. */
function Problems({ problems }: { problems: string[] }) {
  const { ta } = useI18n();
  if (problems.length === 0) return null;
  const x = ta.lexiconX;
  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm" role="alert">
      <p className="font-medium text-danger">{problems[0] === 'duplicate' ? x.duplicate : x.refused}</p>
      {problems[0] === 'duplicate' ? null : <ul className="mt-1 list-disc pl-5 text-micro text-muted">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </div>
  );
}

/** Runs one save, toasts the outcome and refreshes the page's data; returns the problems of a refusal. */
function useSave() {
  const { ta } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const save = async (run: () => Promise<Save>): Promise<string[] | null> => {
    setBusy(true);
    try {
      const result = await run();
      if (!result.ok) return result.problems ?? [ta.wsX.toast.failed];
      toast(ta.lexiconX.saved);
      void queryClient.invalidateQueries({ queryKey: queryKey(api.admin.lexicon) });
      return null;
    } catch (error) {
      toast(isNetworkFailure(error) ? ta.wsX.toast.network : ta.wsX.toast.failed, { tone: 'error' });
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy };
}

function StatusBadge({ status }: { status: string }) {
  const { ta } = useI18n();
  const tone = STATUS_TONE[status] ?? 'neutral';
  return <Badge tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{ta.lexiconX.status[status] ?? status}</Badge>;
}

// ------------------------------------------------------------------ aliases

function AliasRow({ a }: { a: Lexicon['aliases'][number] }) {
  const { ta, locale } = useI18n();
  const x = ta.lexiconX;
  const { save, busy } = useSave();
  const [problems, setProblems] = useState<string[]>([]);
  const decide = async (decision: 'approve' | 'reject'): Promise<void> => {
    if (decision === 'reject' && a.status !== 'rejected' && !window.confirm(x.confirmReject)) return;
    setProblems((await save(() => api.admin.decideAlias({ key: a.key, code: a.code, decision }))) ?? []);
  };
  return (
    <tr className="hover:bg-surface">
      <Td>
        <span className="font-medium">{a.examples[0] ?? a.key}</span>
        <span className="block text-micro text-muted">{a.key}</span>
        {a.examples.length > 1 ? <span className="block text-micro text-muted">{a.examples.slice(1).join(' · ')}</span> : null}
        <Problems problems={problems} />
      </Td>
      <Td><CodeChip code={a.code} />{a.codeName ? <span className="block max-w-72 truncate text-micro text-muted" title={a.codeName}>{a.codeName}</span> : null}</Td>
      <Td numeric>{fmtNumber(locale, a.orgs)}</Td>
      <Td numeric>{fmtNumber(locale, a.confirmations)}</Td>
      <Td><StatusBadge status={a.status} /></Td>
      <Td>
        <span className="flex flex-wrap gap-1">
          {a.status !== 'active' ? <Button size="sm" variant="primary" loading={busy} onClick={() => void decide('approve')}>{x.approve}</Button> : null}
          {a.status !== 'rejected' ? <Button size="sm" variant="danger-ghost" loading={busy} onClick={() => void decide('reject')}>{x.reject}</Button> : null}
        </span>
      </Td>
    </tr>
  );
}

function Aliases({ rows }: { rows: Lexicon['aliases'] }) {
  const { ta } = useI18n();
  const x = ta.lexiconX;
  return (
    <Card title={x.sections.aliases} hint={x.aliasHint} flush>
      {rows.length === 0 ? <div className="p-4"><EmptyState title={x.noAliases} size="compact" /></div> : (
        <Table label={x.sections.aliases} className={FLUSH_TABLE}>
          <thead>
            <tr><Th>{x.cols.name}</Th><Th>{x.cols.code}</Th><Th numeric>{x.cols.orgs}</Th><Th numeric>{x.cols.confirmations}</Th><Th>{x.cols.status}</Th><Th>{x.cols.actions}</Th></tr>
          </thead>
          <tbody>{rows.map((a) => <AliasRow key={`${a.key}|${a.code}`} a={a} />)}</tbody>
        </Table>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------- synonyms

type SynonymDraft = { forms: string; term: string; replace: boolean; unless: string; group: string; kind: string; note: string };

const emptySynonym: SynonymDraft = { forms: '', term: '', replace: false, unless: '', group: '', kind: 'anchor', note: '' };
const draftOf = (p: SynonymPayload, note: string | null): SynonymDraft => ({
  forms: p.forms.join(', '), term: p.term, replace: p.replace === true, unless: (p.unless ?? []).join(', '), group: p.group ?? '', kind: p.kind ?? 'anchor', note: note ?? '',
});
const payloadOf = (d: SynonymDraft): SynonymPayload => ({
  forms: splitList(d.forms), term: d.term.trim(),
  ...(d.replace ? { replace: true } : {}),
  ...(splitList(d.unless).length > 0 ? { unless: splitList(d.unless) } : {}),
  ...(d.group === 'catering' ? { group: 'catering' as const } : {}),
  ...(d.kind === 'contextual' || d.kind === 'qualifier' ? { kind: d.kind } : {}),
});

function SynonymForm({ initial, onSubmit, onCancel, busy, problems }: { initial: SynonymDraft; onSubmit: (d: SynonymDraft) => void; onCancel: () => void; busy: boolean; problems: string[] }) {
  const { ta } = useI18n();
  const f = ta.lexiconX.form;
  const [d, setD] = useState(initial);
  const set = (patch: Partial<SynonymDraft>): void => setD((prev) => ({ ...prev, ...patch }));
  const submit = (event: FormEvent): void => { event.preventDefault(); onSubmit(d); };
  return (
    <form onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-2">
      <Field label={f.forms} hint={f.formsHint} required><Input value={d.forms} onChange={(e) => set({ forms: e.target.value })} required /></Field>
      <Field label={f.term} hint={f.termHint} required><Input value={d.term} onChange={(e) => set({ term: e.target.value })} required /></Field>
      <Field label={f.unless} hint={f.unlessHint}><Input value={d.unless} onChange={(e) => set({ unless: e.target.value })} /></Field>
      <Field label={f.note}><Input value={d.note} onChange={(e) => set({ note: e.target.value })} maxLength={500} /></Field>
      <Select label={f.group} value={d.group} onChange={(e) => set({ group: e.target.value })}>
        <option value="">{f.noGroup}</option>
        <option value="catering">catering</option>
      </Select>
      <Select label={f.kind} value={d.kind} onChange={(e) => set({ kind: e.target.value })} disabled={d.group === ''}>
        {Object.entries(f.kinds).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </Select>
      <Checkbox label={f.replace} checked={d.replace} onChange={(e) => set({ replace: e.target.checked })} />
      <div className="sm:col-span-2"><Problems problems={problems} /></div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" loading={busy}>{ta.lexiconX.save}</Button>
        <Button variant="ghost" onClick={onCancel}>{ta.lexiconX.cancel}</Button>
      </div>
    </form>
  );
}

function Options({ p }: { p: SynonymPayload }) {
  const { ta } = useI18n();
  const o = ta.lexiconX.options;
  const parts = [
    p.replace ? o.replace : null, p.unless && p.unless.length > 0 ? o.unless(p.unless.length) : null,
    p.group ? o.group(p.group) : null, p.kind && p.kind !== 'anchor' ? o.kind(p.kind) : null,
  ].filter((s): s is string => s !== null);
  return <span className="text-micro text-muted">{parts.join(' · ') || '—'}</span>;
}

/** The disable / enable button every entry has; a re-enable is checked like a new entry. */
function Toggle({ entry }: { entry: Entry }) {
  const { ta } = useI18n();
  const { save, busy } = useSave();
  const [problems, setProblems] = useState<string[]>([]);
  const toggle = async (): Promise<void> => {
    const status = entry.status === 'active' ? 'disabled' : 'active';
    setProblems((await save(() => api.admin.updateLexiconEntry({ entryId: entry.id, status }))) ?? []);
  };
  return (
    <>
      <Button size="sm" variant={entry.status === 'active' ? 'danger-ghost' : 'secondary'} loading={busy} onClick={() => void toggle()}>
        {entry.status === 'active' ? ta.lexiconX.disable : ta.lexiconX.enable}
      </Button>
      <Problems problems={problems} />
    </>
  );
}

function SynonymRow({ entry }: { entry: Entry }) {
  const { ta, locale } = useI18n();
  const x = ta.lexiconX;
  const p = entry.payload as SynonymPayload;
  const { save, busy } = useSave();
  const [editing, setEditing] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const submit = async (d: SynonymDraft): Promise<void> => {
    const result = await save(() => api.admin.updateLexiconEntry({ entryId: entry.id, payload: payloadOf(d), note: d.note.trim() || null }));
    setProblems(result ?? []);
    if (result === null) setEditing(false);
  };
  if (editing) {
    return <tr><td colSpan={6}><SynonymForm initial={draftOf(p, entry.note)} onSubmit={(d) => void submit(d)} onCancel={() => setEditing(false)} busy={busy} problems={problems} /></td></tr>;
  }
  return (
    <tr className="hover:bg-surface">
      <Td className="font-medium">{p.forms.join(', ')}{entry.note ? <span className="block text-micro text-muted">{entry.note}</span> : null}</Td>
      <Td className="max-w-96 truncate" title={p.term}>{p.term}</Td>
      <Td><Options p={p} /></Td>
      <Td><StatusBadge status={entry.status} /></Td>
      <Td className="text-micro text-muted">{fmtDateTime(locale, new Date(entry.updatedAt))}</Td>
      <Td><span className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{x.edit}</Button><Toggle entry={entry} /></span></Td>
    </tr>
  );
}

function Synonyms({ rows }: { rows: Entry[] }) {
  const { ta } = useI18n();
  const x = ta.lexiconX;
  const { save, busy } = useSave();
  const [adding, setAdding] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const create = async (d: SynonymDraft): Promise<void> => {
    const result = await save(() => api.admin.createLexiconEntry({ kind: 'synonym', payload: payloadOf(d), ...(d.note.trim() ? { note: d.note.trim() } : {}) }));
    setProblems(result ?? []);
    if (result === null) setAdding(false);
  };
  return (
    <Card title={x.sections.synonyms} flush actions={<Button size="sm" variant="secondary" onClick={() => setAdding(true)}>{x.addSynonym}</Button>}>
      {adding ? <SynonymForm initial={emptySynonym} onSubmit={(d) => void create(d)} onCancel={() => setAdding(false)} busy={busy} problems={problems} /> : null}
      {rows.length === 0 && !adding ? <div className="p-4"><EmptyState title={x.noEntries} size="compact" /></div> : null}
      {rows.length > 0 ? (
        <Table label={x.sections.synonyms} className={FLUSH_TABLE}>
          <thead><tr><Th>{x.cols.forms}</Th><Th>{x.cols.term}</Th><Th>{x.cols.options}</Th><Th>{x.cols.status}</Th><Th>{x.cols.updated}</Th><Th>{x.cols.actions}</Th></tr></thead>
          <tbody>{rows.map((entry) => <SynonymRow key={entry.id} entry={entry} />)}</tbody>
        </Table>
      ) : null}
    </Card>
  );
}

// -------------------------------------------------------------------- units

function UnitForm({ onSubmit, onCancel, busy, problems }: { onSubmit: (p: UnitPayload, note: string) => void; onCancel: () => void; busy: boolean; problems: string[] }) {
  const { ta } = useI18n();
  const f = ta.lexiconX.form;
  const [alias, setAlias] = useState('');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const submit = (event: FormEvent): void => { event.preventDefault(); onSubmit({ alias: alias.trim(), target: target.trim() }, note); };
  return (
    <form onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-3">
      <Field label={f.alias} hint={f.aliasHint} required><Input value={alias} onChange={(e) => setAlias(e.target.value)} required maxLength={60} /></Field>
      <Field label={f.target} hint={f.targetHint} required><Input value={target} onChange={(e) => setTarget(e.target.value)} required maxLength={100} /></Field>
      <Field label={f.note}><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
      <div className="sm:col-span-3"><Problems problems={problems} /></div>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" variant="primary" loading={busy}>{ta.lexiconX.save}</Button>
        <Button variant="ghost" onClick={onCancel}>{ta.lexiconX.cancel}</Button>
      </div>
    </form>
  );
}

function Units({ rows }: { rows: Entry[] }) {
  const { ta, locale } = useI18n();
  const x = ta.lexiconX;
  const { save, busy } = useSave();
  const [adding, setAdding] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const create = async (payload: UnitPayload, note: string): Promise<void> => {
    const result = await save(() => api.admin.createLexiconEntry({ kind: 'unit', payload, ...(note.trim() ? { note: note.trim() } : {}) }));
    setProblems(result ?? []);
    if (result === null) setAdding(false);
  };
  return (
    <Card title={x.sections.units} flush actions={<Button size="sm" variant="secondary" onClick={() => setAdding(true)}>{x.addUnit}</Button>}>
      {adding ? <UnitForm onSubmit={(p, note) => void create(p, note)} onCancel={() => setAdding(false)} busy={busy} problems={problems} /> : null}
      {rows.length === 0 && !adding ? <div className="p-4"><EmptyState title={x.noEntries} size="compact" /></div> : null}
      {rows.length > 0 ? (
        <Table label={x.sections.units} className={FLUSH_TABLE}>
          <thead><tr><Th>{x.cols.alias}</Th><Th>{x.cols.target}</Th><Th>{x.cols.note}</Th><Th>{x.cols.status}</Th><Th>{x.cols.updated}</Th><Th>{x.cols.actions}</Th></tr></thead>
          <tbody>
            {rows.map((entry) => {
              const p = entry.payload as UnitPayload;
              return (
                <tr key={entry.id} className="hover:bg-surface">
                  <Td className="font-medium">{p.alias}</Td>
                  <Td>{p.target}</Td>
                  <Td className="text-micro text-muted">{entry.note ?? '—'}</Td>
                  <Td><StatusBadge status={entry.status} /></Td>
                  <Td className="text-micro text-muted">{fmtDateTime(locale, new Date(entry.updatedAt))}</Td>
                  <Td><Toggle entry={entry} /></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : null}
    </Card>
  );
}

// --------------------------------------------------------------------- page

export function LexiconView({ initial }: { initial: Lexicon }): ReactNode {
  const { ta } = useI18n();
  const x = ta.lexiconX;
  const { data } = useSeededQuery(api.admin.lexicon, initial);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">{x.fileNote(data.file.synonyms, data.file.units)} {x.checkNote}</p>
      <Aliases rows={data.aliases} />
      <Synonyms rows={data.synonyms} />
      <Units rows={data.units} />
    </div>
  );
}
