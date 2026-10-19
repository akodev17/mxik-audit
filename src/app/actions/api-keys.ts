'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createApiKey, revokeApiKey } from '@/lib/api/keys';
import { admin } from '@/lib/guard';
import { isDemoOrg } from '@/lib/demo';

export type KeyState = { token?: string; error?: boolean };

/** Admin only; the token is returned once and never stored in clear. */
export async function addApiKey(name: unknown): Promise<KeyState> {
  const user = await admin();
  const label = z.string().min(1).max(60).safeParse(name);
  if (!user || !label.success || await isDemoOrg(user.orgId)) return { error: true };
  const created = await createApiKey(user, label.data);
  if (!created) return { error: true };
  revalidatePath('/settings');
  return { token: created.token };
}

export async function removeApiKey(keyId: unknown): Promise<boolean> {
  const user = await admin();
  const id = z.string().min(1).safeParse(keyId);
  if (!user || !id.success) return false;
  const ok = await revokeApiKey(user, id.data);
  revalidatePath('/settings');
  return ok;
}
