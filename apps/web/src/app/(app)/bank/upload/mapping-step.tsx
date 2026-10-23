'use client';

import { useState } from 'react';
import type { BankColumnMap, BankConventions, BankRole } from '@tasnivo/contracts/modules/bank';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { PreviewTable } from '@/ui/preview-table';
import { Segmented } from '@/ui/segmented';
import { Select } from '@/ui/select';
import { Card } from '../../_manage/card';
import { Notice } from '../../_manage/notice';
import { directionFor, mappingProblem, ROLE_ORDER } from '../bank-pure';
import type { Preview } from './bank-upload';

/** Roles each direction convention uses; the others are hidden so the form asks only what matters. */
const AMOUNT_ROLES: Record<BankConventions['direction'], readonly BankRole[]> = {
  columns: ['debit', 'credit'],
  signed: ['amount'],
  flag: ['amount', 'direction'],
};
const HIDDEN = new Set<BankRole>(['debit', 'credit', 'amount', 'direction']);

/**
 * Choose which column holds what, and how the file writes dates, decimals and the direction of
 * money. Starts from the header-word guess; the next step previews the file with these columns.
 */
export function MappingStep({ preview, busy, onBack, onDone }: { preview: Preview; busy: boolean; onBack: () => void; onDone: (map: BankColumnMap, conventions: BankConventions) => void }) {
  const { t, ta } = useI18n();
  const b = ta.bankX;
  const m = b.mapping;
  const [map, setMap] = useState<BankColumnMap>(preview.columnMap);
  const [conventions, setConventions] = useState<BankConventions>({ ...preview.conventions, direction: directionFor(preview.columnMap, preview.conventions.direction) });
  const [tried, setTried] = useState(false);
  const problem = mappingProblem(map, conventions);

  const roles = ROLE_ORDER.filter((r) => !HIDDEN.has(r) || AMOUNT_ROLES[conventions.direction].includes(r));
  const set = (role: BankRole, column: number): void => setMap((prev) => ({ ...prev, [role]: column }));
  const labelled: [number, string][] = roles.flatMap((r) => ((map[r] ?? -1) >= 0 ? [[map[r] ?? -1, b.roles[r]] as [number, string]] : []));

  return (
    <Card title={m.title} hint={preview.recognised ? undefined : m.hint} as="h2">
      <div className="space-y-5">
        {!preview.recognised ? <Notice tone="info">{b.upload.notRecognised}</Notice> : null}
        <PreviewTable headers={preview.headers} rows={preview.rows} roles={labelled} label={b.upload.sample} limit={6} maxHeight="18rem" />

        <fieldset className="space-y-3">
          <legend className="mb-2 text-data font-semibold">{m.direction}</legend>
          <Segmented
            label={m.direction} size="md"
            value={conventions.direction}
            onChange={(direction) => setConventions((c) => ({ ...c, direction }))}
            options={[
              { value: 'columns', label: m.directionColumns },
              { value: 'signed', label: m.directionSigned },
              { value: 'flag', label: m.directionFlag },
            ]}
          />
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => {
            const required = role === 'date' || AMOUNT_ROLES[conventions.direction].includes(role);
            return (
              <Select
                key={role} label={b.roles[role]} required={required} value={map[role] ?? -1}
                invalid={tried && required && (map[role] ?? -1) < 0}
                onChange={(e) => set(role, Number(e.target.value))}
              >
                <option value={-1}>{t.uploadColumnIgnore}</option>
                {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
              </Select>
            );
          })}
        </div>

        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-data font-semibold sm:col-span-3">{m.conventions}</legend>
          <Select label={m.dateOrder} value={conventions.dateOrder} onChange={(e) => setConventions((c) => ({ ...c, dateOrder: e.target.value as BankConventions['dateOrder'] }))}>
            {(['dmy', 'ymd', 'mdy'] as const).map((o) => <option key={o} value={o}>{m.dateOrders[o]}</option>)}
          </Select>
          <Select label={m.decimal} value={conventions.decimal} onChange={(e) => setConventions((c) => ({ ...c, decimal: e.target.value as BankConventions['decimal'] }))}>
            {(['auto', 'comma', 'dot'] as const).map((o) => <option key={o} value={o}>{m.decimals[o]}</option>)}
          </Select>
          <label className="block text-data">
            <span className="mb-1 block font-medium">{m.currency}</span>
            <Input value={conventions.currency} maxLength={3} onChange={(e) => setConventions((c) => ({ ...c, currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }))} />
          </label>
        </fieldset>

        {tried && problem ? <Notice tone="danger">{m.problems[problem]}</Notice> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onBack}>{b.upload.back}</Button>
          <Button
            variant="primary" loading={busy}
            onClick={() => {
              setTried(true);
              if (!problem && /^[A-Z]{3}$/.test(conventions.currency)) onDone(map, conventions);
            }}
          >
            {b.upload.steps.check}
          </Button>
        </div>
      </div>
    </Card>
  );
}
