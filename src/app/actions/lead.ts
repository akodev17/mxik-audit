'use server';

import { z } from 'zod';
import { db } from '@/lib/db';
import { parseUpload } from '@/lib/spreadsheet';

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Phone or Telegram handle. Deliberately permissive: an accountant should not be
 * rejected over the shape of their own phone number.
 */
const CONTACT = z.string().trim().min(5).max(120);

export type LeadState = { ok?: true; error?: string };

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function submitLead(_prev: LeadState, form: FormData): Promise<LeadState> {
  const contact = CONTACT.safeParse(field(form, 'contact'));
  if (!contact.success) {
    return { error: 'Telefon raqami yoki Telegram manzilini kiriting.' };
  }

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
      return { error: 'Fayl juda katta (20 MB dan oshmasligi kerak).' };
    }
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      return { error: 'Faqat .xlsx yoki .csv fayl yuborish mumkin.' };
    }
    filename = file.name;
    fileBytes = file.size;
    // Build the view from the ArrayBuffer itself: going via Buffer yields
    // Uint8Array<ArrayBufferLike>, which Prisma's Bytes field will not accept.
    const arrayBuffer = await file.arrayBuffer();
    fileData = new Uint8Array(arrayBuffer);
    // Count rows now so the reply can quote a real number.
    try {
      const parsed = await parseUpload(Buffer.from(arrayBuffer), file.name);
      rowGuess = parsed.rows.length;
    } catch {
      return { error: 'Faylni oʻqib boʻlmadi. Excel (.xlsx) yoki CSV yuboring.' };
    }
  }

  await db.lead.create({
    data: {
      contact: contact.data,
      company,
      filename,
      fileBytes,
      fileData,
      rowGuess,
      note: field(form, 'note') || null,
    },
  });

  return { ok: true };
}
