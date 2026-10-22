'use server';

import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { saveBrandingForm, telegramLinkCode, type BrandState, type CodeResult } from '@tasnivo/domain/account-settings';
import { isDemoOrg } from '@/lib/demo';
import { admin } from '@/lib/guard';
import { unlink } from '@tasnivo/domain/telegram/linking';

// The rules live in @tasnivo/domain/account-settings, shared with the API.
export type { BrandState, CodeResult };

/** Firm name and logo for client PDF reports. */
export async function saveBranding(_prev: BrandState, form: FormData): Promise<BrandState> {
  const { t, locale } = await getI18n();
  const user = await admin();
  if (!user || await isDemoOrg(user.orgId)) return { error: t.errorGeneric };
  const logo = form.get('logo');
  const result = await saveBrandingForm(user, {
    brandName: form.get('brandName'),
    removeLogo: form.get('removeLogo') === 'on',
    logo: logo instanceof File && logo.size > 0 ? new Uint8Array(await logo.arrayBuffer()) : null,
  }, locale);
  if (result.saved) revalidatePath('/settings');
  return result;
}

/** A one-time code the user sends to the bot as "/start CODE". */
export async function telegramCode(): Promise<CodeResult> {
  const user = await admin();
  if (!user || await isDemoOrg(user.orgId)) return { ok: false };
  return telegramLinkCode(user);
}

export async function telegramUnlink(linkId: unknown): Promise<{ ok: boolean }> {
  const user = await admin();
  const id = z.string().min(1).safeParse(linkId);
  if (!user || !id.success) return { ok: false };
  const ok = await unlink(user, id.data);
  revalidatePath('/settings');
  return { ok };
}
