'use server';

import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { isHoneypotFilled, LEAD_LIMITS, parseContact } from '@/lib/lead-guard';
import { leadFilenameOk, parseLeadText } from '@/lib/lead-input';
import { clientIp } from '@/lib/security/client-ip';
import { hit, minutesOf, RULES } from '@/lib/security/rate-limit';
import { looksLikeZip, zipWithinLimits } from '@/lib/security/zip-guard';
import { parseUpload } from '@/lib/spreadsheet';

// A sample file is enough for a lead; a smaller cap keeps an anonymous form from loading the server.
const MAX_BYTES = 5 * 1024 * 1024;

const SAVE_FAILED = 'Soʻrovni saqlab boʻlmadi. Birozdan keyin qayta urinib koʻring.';

export type LeadState = {
  ok?: true;
  error?: string;
  /** Which field the error is about, so the form can mark it. */
  field?: 'contact' | 'file';
  /** What was typed, returned so a failed submit does not wipe it. */
  contact?: string;
};

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function submitLead(_prev: LeadState, form: FormData): Promise<LeadState> {
  const raw = field(form, 'contact');
  // Echoed back to the form, so never more than the field can hold; validation sees it all.
  const typed = raw.slice(0, LEAD_LIMITS.contact);

  // A filled honeypot is a bot. Answer exactly as for a person, store nothing:
  // telling it what tripped would only teach it to skip the field.
  if (isHoneypotFilled(form)) return { ok: true };

  /* Five requests per address per ten minutes, kept in the database so a restart or a
     second instance does not reset it: a person who mistyped their number twice is
     never blocked, a script filling the leads table is. */
  const verdict = await hit(RULES.leadIp, clientIp(await headers())).catch(() => null);
  if (!verdict) return { error: SAVE_FAILED, contact: typed };
  if (!verdict.allowed) {
    return {
      error: `Soʻrovlar juda koʻp. ${minutesOf(verdict.retryAfterMs)} daqiqadan keyin qayta urinib koʻring.`,
      contact: typed,
    };
  }

  const contact = parseContact(raw);
  if (!contact.ok) return { error: contact.error, field: 'contact', contact: typed };

  // The form has no company or note fields today; anything sent anyway is bounded.
  const text = parseLeadText(form);
  if (!text) return { error: 'Matn juda uzun.', contact: typed };
  const file = form.get('file');

  let filename: string | null = null;
  let fileBytes: number | null = null;
  // Prisma's Bytes maps to Uint8Array<ArrayBuffer> specifically; the bare
  // Uint8Array alias widens to ArrayBufferLike and will not assign.
  let fileData: Uint8Array<ArrayBuffer> | null = null;
  let rowGuess: number | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      return { error: 'Fayl juda katta (5 MB dan oshmasligi kerak).', field: 'file', contact: typed };
    }
    if (!leadFilenameOk(file.name)) {
      return { error: `Fayl nomi juda uzun (${LEAD_LIMITS.filename} belgigacha).`, field: 'file', contact: typed };
    }
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      return { error: 'Faqat .xlsx yoki .csv fayl yuborish mumkin.', field: 'file', contact: typed };
    }
    filename = file.name;
    fileBytes = file.size;
    // Build the view from the ArrayBuffer itself: going via Buffer yields
    // Uint8Array<ArrayBufferLike>, which Prisma's Bytes field will not accept.
    const arrayBuffer = await file.arrayBuffer();
    fileData = new Uint8Array(arrayBuffer);
    const buffer = Buffer.from(arrayBuffer);
    const unreadable: LeadState = { error: 'Faylni oʻqib boʻlmadi. Excel (.xlsx) yoki CSV yuboring.', field: 'file', contact: typed };
    // An .xlsx is a zip: refuse one that would inflate past the limits before ExcelJS opens it.
    if (looksLikeZip(buffer) && !(await zipWithinLimits(buffer))) return unreadable;
    // Count rows now so the reply can quote a real number.
    try {
      const parsed = await parseUpload(buffer, file.name);
      rowGuess = parsed.rows.length;
    } catch {
      return unreadable;
    }
  }

  try {
    await db.lead.create({
      data: { contact: contact.value, company: text.company, filename, fileBytes, fileData, rowGuess, note: text.note },
    });
  } catch {
    return { error: SAVE_FAILED, contact: typed };
  }

  return { ok: true };
}
