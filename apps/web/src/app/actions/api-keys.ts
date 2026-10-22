'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createApiKey, MAX_ACTIVE_KEYS, revokeApiKey } from '@tasnivo/domain/api/keys';
import { db } from '@tasnivo/db';
import { admin } from '@/lib/guard';
import { isDemoOrg } from '@/lib/demo';

export type KeyState = { token: string } | { error: 'name' | 'limit' | 'failed' };

/** Admin only; the token is returned once and never stored in clear. */
export async function addApiKey(name: unknown): Promise<KeyState> {
  const user = await admin();
  if (!user || await isDemoOrg(user.orgId)) return { error: 'failed' };
  const label = z.string().trim().min(1).max(60).safeParse(name);
  if (!label.success) return { error: 'name' };
  if (await db.apiKey.count({ where: { orgId: user.orgId, revokedAt: null } }) >= MAX_ACTIVE_KEYS) return { error: 'limit' };
  const created = await createApiKey(user, label.data);
  if (!created) return { error: 'failed' };
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
