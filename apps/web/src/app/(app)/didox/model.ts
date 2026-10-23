// Browser-side helpers of the Didox pages. Money arrives as the contract's decimal strings and is
// shown without ever becoming a float. `recordTone` and `ISSUE_SEVERITY_ORDER` mirror the domain's
// statusFor (packages/domain/src/didox/check.ts); model.test.ts keeps them in step.
import type { Tone } from '@/ui/badge';

/** "1234567.5" → "1 234 567,50" (ru/uz grouping, two decimals for money); quantities keep their own decimals. */
export function decimalText(value: string | null | undefined, options: { money?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) return value;
  const [, sign, whole = '0', fraction = ''] = m;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (options.money) {
    const { digits, carry } = roundedFraction(fraction);
    if (carry) return decimalText(addOne(sign ?? '', whole), options);
    return `${sign}${digits === '00' ? grouped : `${grouped},${digits}`}`;
  }
  const frac = fraction.replace(/0+$/, '');
  return `${sign}${frac ? `${grouped},${frac}` : grouped}`;
}

function roundedFraction(fraction: string): { digits: string; carry: boolean } {
  const two = Number((fraction + '00').slice(0, 2));
  const up = (fraction[2] ?? '0') >= '5';
  const n = two + (up ? 1 : 0);
  return n === 100 ? { digits: '00', carry: true } : { digits: String(n).padStart(2, '0'), carry: false };
}

function addOne(sign: string, whole: string): string {
  // Whole part + 1 (away from zero), as text so 17-digit sums stay exact.
  return `${sign}${(BigInt(whole) + 1n).toString()}`;
}

export type RecordStatus = 'valid' | 'corrected' | 'suspicious' | 'unresolved' | 'skipped' | 'exported';

export function recordTone(status: RecordStatus): Tone {
  switch (status) {
    case 'valid': return 'good';
    case 'corrected': return 'brand';
    case 'suspicious': return 'warn';
    case 'unresolved': return 'danger';
    case 'exported': return 'info';
    default: return 'neutral';
  }
}

export const severityTone = (severity: 'error' | 'warning' | 'info'): Tone => (severity === 'error' ? 'danger' : severity === 'warning' ? 'warn' : 'neutral');

/** The domain's rule: an error leaves a line unresolved, a warning suspicious, else valid. */
export function statusFromIssues(issues: ReadonlyArray<{ severity: 'error' | 'warning' | 'info' }>): 'valid' | 'suspicious' | 'unresolved' {
  if (issues.some((i) => i.severity === 'error')) return 'unresolved';
  if (issues.some((i) => i.severity === 'warning')) return 'suspicious';
  return 'valid';
}

export const batchTone = (status: string): Tone =>
  status === 'approved' ? 'good' : status === 'exported' ? 'info' : status === 'failed' ? 'danger' : status === 'review' ? 'warn' : 'neutral';
