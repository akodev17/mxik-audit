// Words and tones of the product module, shared by the list, the drawer and the import wizard. Pure.
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';
import type { Tone } from '@/ui/badge';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
export const PRODUCT_STATUSES = ['ok', 'missing', 'invalid', 'inactive', 'restricted', 'suspicious', 'unchecked'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
/** The status chips: every status plus all (contracts/modules/products.ts PRODUCT_FILTERS). */
export const PRODUCT_FILTERS = ['all', ...PRODUCT_STATUSES] as const;
export type ProductFilter = (typeof PRODUCT_FILTERS)[number];
export type RecordStatus = (typeof accounting.RECORD_STATUSES)[number];

export const STATUS_TONE: Record<ProductStatus, Tone> = {
  ok: 'good', missing: 'danger', invalid: 'danger', inactive: 'danger', restricted: 'warn', suspicious: 'warn', unchecked: 'neutral',
};

export const RECORD_TONE: Record<RecordStatus, Tone> = {
  valid: 'good', corrected: 'brand', suspicious: 'warn', unresolved: 'danger', skipped: 'neutral', exported: 'info',
};

export const SEVERITY_TONE: Record<ValidationIssue['severity'], Tone> = { error: 'danger', warning: 'warn', info: 'info' };

/** `{name}` placeholders filled from params; unknown ones are left empty. */
export function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''));
}

/** An issue in words: its label in the reader's language, or the code when there is none. */
export function issueText(issues: Record<string, string>, issue: ValidationIssue): string {
  const template = issues[issue.code];
  return template ? fill(template, issue.params) : issue.code;
}
