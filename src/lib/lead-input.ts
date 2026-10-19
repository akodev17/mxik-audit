// Length bounds for the public lead form's free-text fields and file name,
// checked on the server (the form's maxLength is only a convenience).
import { z } from 'zod';
import { LEAD_LIMITS } from './lead-guard.js';

const LeadText = z.object({
  company: z.string().trim().max(LEAD_LIMITS.company),
  note: z.string().trim().max(LEAD_LIMITS.note),
});

const Filename = z.string().min(1).max(LEAD_LIMITS.filename);

const formText = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};

/** Company and note, trimmed (empty = not given); null when either is too long. */
export function parseLeadText(form: FormData): { company: string | null; note: string | null } | null {
  const parsed = LeadText.safeParse({ company: formText(form, 'company'), note: formText(form, 'note') });
  if (!parsed.success) return null;
  return { company: parsed.data.company || null, note: parsed.data.note || null };
}

export const leadFilenameOk = (name: string): boolean => Filename.safeParse(name).success;
