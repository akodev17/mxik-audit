'use server';

import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { admin } from '@/lib/guard';
import { telegramConfig } from '@/lib/telegram/config';
import { createLinkCode, LINK_CODE_TTL_MS, unlink } from '@/lib/telegram/linking';

const LOGO_MAX_BYTES = 300 * 1024;

/** PNG or JPEG by its first bytes, whatever the browser claims. */
function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export type BrandState = { error?: string; saved?: boolean };

/** Firm name and logo for client PDF reports. */
export async function saveBranding(_prev: BrandState, form: FormData): Promise<BrandState> {
  const { t } = await getI18n();
  const user = await admin();
  if (!user || await isDemoOrg(user.orgId)) return { error: t.errorGeneric };
  const name = z.string().max(120).safeParse(form.get('brandName') ?? '');
  if (!name.success) return { error: t.errorGeneric };

  const data: { brandName: string | null; logoData?: Uint8Array<ArrayBuffer> | null; logoMime?: string | null } = {
    brandName: name.data.replace(/\s+/g, ' ').trim() || null,
  };
  const logo = form.get('logo');
  if (form.get('removeLogo') === 'on') {
    data.logoData = null;
    data.logoMime = null;
  } else if (logo instanceof File && logo.size > 0) {
    const bytes = Buffer.from(await logo.arrayBuffer());
    const mime = imageMime(bytes);
    if (!mime || bytes.length > LOGO_MAX_BYTES) return { error: t.brandBadLogo };
    data.logoData = new Uint8Array(bytes);
    data.logoMime = mime;
  }
  await db.organization.update({ where: { id: user.orgId }, data });
  revalidatePath('/settings');
  return { saved: true };
}

export type CodeResult = { ok: true; code: string; minutes: number } | { ok: false };

/** A one-time code the user sends to the bot as "/start CODE". */
export async function telegramCode(): Promise<CodeResult> {
  const user = await admin();
  if (!user || !telegramConfig().enabled || await isDemoOrg(user.orgId)) return { ok: false };
  const { code } = await createLinkCode(user);
  return { ok: true, code, minutes: Math.round(LINK_CODE_TTL_MS / 60_000) };
}

export async function telegramUnlink(linkId: unknown): Promise<{ ok: boolean }> {
  const user = await admin();
  const id = z.string().min(1).safeParse(linkId);
  if (!user || !id.success) return { ok: false };
  const ok = await unlink(user, id.data);
  revalidatePath('/settings');
  return { ok };
}
