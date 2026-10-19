'use client';

import { useI18n } from '@/lib/locale-client';
import { Select } from './select';

type Props = {
  label: string;
  required: boolean;
  headers: string[];
  value: number;
  onChange: (index: number) => void;
};

/** Pick which uploaded column feeds a field. */
export function ColumnSelect({ label, required, headers, value, onChange }: Props) {
  const { t } = useI18n();
  return (
    <Select label={label} required={required} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {!required ? <option value={-1}>{t.uploadColumnIgnore}</option> : null}
      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
    </Select>
  );
}
