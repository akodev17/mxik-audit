'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { addApiKeyForm, type KeyState } from '@tasnivo/domain/account-settings';
import { revokeApiKey } from '@tasnivo/domain/api/keys';
import { admin } from '@/lib/guard';
import { isDemoOrg } from '@/lib/demo';

export type { KeyState };

/** Admin only; the token is returned once and never stored in clear (@tasnivo/domain/account-settings, shared with the API). */
export async function addApiKey(name: unknown): Promise<KeyState> {
  const user = await admin();
  if (!user || await isDemoOrg(user.orgId)) return { error: 'failed' };
  const result = await addApiKeyForm(user, name);
  if ('token' in result) revalidatePath('/settings');
  return result;
}

export async function removeApiKey(keyId: unknown): Promise<boolean> {
  const user = await admin();
  const id = z.string().min(1).safeParse(keyId);
  if (!user || !id.success) return false;
  const ok = await revokeApiKey(user, id.data);
  revalidatePath('/settings');
  return ok;
}
