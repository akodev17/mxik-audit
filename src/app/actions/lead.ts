'use server';

import { headers } from 'next/headers';
import { db } from '@/lib/db';
import {
  clientKey, createRateLimiter, isHoneypotFilled, parseContact,
} from '@/lib/lead-guard';
import { looksLikeZip, zipWithinLimits } from '@/lib/security/zip-guard';
import { parseUpload } from '@/lib/spreadsheet';

// A sample file is enough for a lead; a smaller cap keeps an anonymous form from loading the server.
const MAX_BYTES = 5 * 1024 * 1024;

/* Five requests per address per ten minutes: a person who mistyped their number
   twice is never blocked, a script filling the leads table is. Per process, so
   kept on globalThis to survive dev-server module reloads. */
const globalForLimiter = globalThis as unknown as { mxikLeadLimiter?: ReturnType<typeof createRateLimiter> };
const limiter = globalForLimiter.mxikLeadLimiter
  ?? createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });
globalForLimiter.mxikLeadLimiter = limiter;

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
  const typed = field(form, 'contact');

  // A filled honeypot is a bot. Answer exactly as for a person, store nothing:
  // telling it what tripped would only teach it to skip the field.
  if (isHoneypotFilled(form)) return { ok: true };

  const { allowed, retryAfterMs } = limiter.hit(clientKey(await headers()));
  if (!allowed) {
    const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
    return {
      error: `Soʻrovlar juda koʻp. ${minutes} daqiqadan keyin qayta urinib koʻring.`,
      contact: typed,
    };
  }

  const contact = parseContact(typed);
  if (!contact.ok) return { error: contact.error, field: 'contact', contact: typed };

  const company = field(form, 'company') || null;
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
      data: {
        contact: contact.value,
        company,
        filename,
        fileBytes,
        fileData,
        rowGuess,
        note: field(form, 'note') || null,
      },
    });
  } catch {
    return {
      error: 'Soʻrovni saqlab boʻlmadi. Birozdan keyin qayta urinib koʻring.',
      contact: typed,
    };
  }

  return { ok: true };
}
