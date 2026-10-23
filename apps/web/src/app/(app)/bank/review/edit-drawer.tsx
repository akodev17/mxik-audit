'use client';

import { useState } from 'react';
import type { BankRecordRow } from '@tasnivo/contracts/modules/bank';
import { BANK_OPERATIONS } from '@tasnivo/contracts/modules/bank';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Drawer } from '@/ui/drawer';
import { Field, Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Textarea } from '@/ui/textarea';
import { useToast } from '@/ui/toast';
import { Notice } from '../../_manage/notice';

type Remember = 'none' | 'counterparty' | 'purpose';

/** dd.mm.yyyy for the date field (the API reads both that and yyyy-mm-dd). */
const shownDate = (iso: string | null): string => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

/**
 * Correct one line: operation, cash-flow item, contract, counterparty, date, amount, direction,
 * purpose. Only the fields changed are sent; each is re-checked by the API. "Remember" saves the
 * operation as a rule for the counterparty or for a purpose text, applied to the rest of the
 * statement at once.
 */
export function EditDrawer({ record, onClose, onSaved }: { record: BankRecordRow; onClose: () => void; onSaved: () => void }) {
  const { ta } = useI18n();
  const b = ta.bankX;
  const e = b.edit;
  const toast = useToast();
  const p = record.payload;
  const initial = {
    operation: p.operation ?? '', cashFlowItem: p.cashFlowItem ?? '', contract: p.contract ?? '',
    'counterparty.name': p.counterparty.name, 'counterparty.inn': p.counterparty.inn ?? '', 'counterparty.account': p.counterparty.account ?? '',
    date: shownDate(p.date), amount: p.amount ?? '', direction: p.direction ?? '', purpose: p.purpose,
  };
  const [values, setValues] = useState(initial);
  const [remember, setRemember] = useState<Remember>('none');
  const [text, setText] = useState(p.purpose.slice(0, 60));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'save' | 'approve' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof initial, value: string): void => setValues((v) => ({ ...v, [key]: value }));

  async function save(approve: boolean): Promise<void> {
    const corrections: Record<string, string | null> = {};
    for (const key of Object.keys(initial) as (keyof typeof initial)[]) {
      if (values[key] !== initial[key]) corrections[key] = values[key] === '' ? null : values[key];
    }
    const changed = Object.keys(corrections).length > 0;
    setBusy(approve ? 'approve' : 'save');
    setError(null);
    const result = await orRefused(api.bank.decide({
      recordId: record.id,
      action: approve ? 'approve' : 'correct',
      ...(changed || !approve ? { corrections } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(remember !== 'none' ? { remember: { by: remember, ...(remember === 'purpose' && text.trim() ? { value: text.trim() } : {}) } } : {}),
    }), b.errors.network);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    toast(result.ruleId ? e.ruleSaved(result.applied) : e.saved);
    onSaved();
  }

  return (
    <Drawer
      open title={e.title(record.rowIndex)} onClose={onClose} backdrop width="32rem"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{e.cancel}</Button>
          <Button onClick={() => void save(false)} loading={busy === 'save'}>{e.save}</Button>
          <Button variant="primary" onClick={() => void save(true)} loading={busy === 'approve'}>{e.saveApprove}</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        {record.issues.length > 0 ? (
          <ul className="space-y-1 text-small">
            {record.issues.map((i, k) => <li key={k} className={i.severity === 'error' ? 'text-danger-ink' : i.severity === 'warning' ? 'text-warn-ink' : 'text-muted'}>• {(b.issues as Record<string, string>)[i.code] ?? i.code}</li>)}
          </ul>
        ) : null}
        <Select label={e.operation} value={values.operation} onChange={(ev) => set('operation', ev.target.value)}>
          <option value="">{b.operations.none}</option>
          {BANK_OPERATIONS.map((o) => <option key={o} value={o}>{b.operations[o]}</option>)}
        </Select>
        <Select label={e.remember} value={remember} onChange={(ev) => setRemember(ev.target.value as Remember)}>
          <option value="none">{e.rememberNone}</option>
          <option value="counterparty">{e.rememberCounterparty}</option>
          <option value="purpose">{e.rememberPurpose}</option>
        </Select>
        {remember === 'purpose' ? <Field label={e.rememberText}><Input value={text} maxLength={200} onChange={(ev) => setText(ev.target.value)} /></Field> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={e.cashFlowItem}><Input value={values.cashFlowItem} maxLength={120} onChange={(ev) => set('cashFlowItem', ev.target.value)} /></Field>
          <Field label={e.contract}><Input value={values.contract} maxLength={120} onChange={(ev) => set('contract', ev.target.value)} /></Field>
          <Field label={e.counterpartyName}><Input value={values['counterparty.name']} maxLength={300} onChange={(ev) => set('counterparty.name', ev.target.value)} /></Field>
          <Field label={e.inn}><Input value={values['counterparty.inn']} inputMode="numeric" maxLength={14} onChange={(ev) => set('counterparty.inn', ev.target.value)} /></Field>
          <Field label={e.account} className="sm:col-span-2"><Input value={values['counterparty.account']} inputMode="numeric" maxLength={24} onChange={(ev) => set('counterparty.account', ev.target.value)} /></Field>
          <Field label={e.date}><Input value={values.date} placeholder="01.10.2026" onChange={(ev) => set('date', ev.target.value)} /></Field>
          <Field label={e.amount}><Input value={values.amount} inputMode="decimal" onChange={(ev) => set('amount', ev.target.value)} /></Field>
          <Select label={e.direction} value={values.direction} onChange={(ev) => set('direction', ev.target.value)} wrapperClassName="sm:col-span-2">
            <option value="">—</option>
            <option value="debit">{e.directions.debit}</option>
            <option value="credit">{e.directions.credit}</option>
          </Select>
        </div>
        <Field label={e.purpose}><Textarea value={values.purpose} rows={3} maxLength={2000} onChange={(ev) => set('purpose', ev.target.value)} /></Field>
        <Field label={e.note}><Input value={note} maxLength={500} onChange={(ev) => setNote(ev.target.value)} /></Field>
        {p.raw && p.raw.length > 0 ? (
          <details className="text-small">
            <summary className="cursor-pointer text-muted">{e.raw}</summary>
            <p className="mt-1 break-words font-mono text-micro text-muted">{p.raw.filter(Boolean).join(' | ')}</p>
          </details>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </Drawer>
  );
}
