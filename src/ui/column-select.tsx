'use client';

import { useI18n } from '@/lib/locale-client';

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
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}{required ? <span className="text-danger"> *</span> : null}</span>
      <select
        value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 w-full rounded-ctl border border-line-strong bg-base px-2 text-[15px] focus:border-brand focus:outline-none"
      >
        {!required ? <option value={-1}>{t.uploadColumnIgnore}</option> : null}
        {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
      </select>
    </label>
  );
}
