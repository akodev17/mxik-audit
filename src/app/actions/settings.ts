'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isDemoOrg } from '@/lib/demo';
import { currentUser } from '@/lib/session';
import { telegramConfig } from '@/lib/telegram/config';
import { createLinkCode, LINK_CODE_TTL_MS, unlink } from '@/lib/telegram/linking';

export type CodeResult = { ok: true; code: string; minutes: number } | { ok: false };

/** A one-time code the user sends to the bot as "/start CODE". */
export async function telegramCode(): Promise<CodeResult> {
  const user = await currentUser();
  if (!user || !telegramConfig().enabled || await isDemoOrg(user.orgId)) return { ok: false };
  const { code } = await createLinkCode(user);
  return { ok: true, code, minutes: Math.round(LINK_CODE_TTL_MS / 60_000) };
}

export async function telegramUnlink(linkId: unknown): Promise<{ ok: boolean }> {
  const user = await currentUser();
  const id = z.string().min(1).safeParse(linkId);
  if (!user || !id.success) return { ok: false };
  const ok = await unlink(user, id.data);
  revalidatePath('/settings');
  return { ok };
}
