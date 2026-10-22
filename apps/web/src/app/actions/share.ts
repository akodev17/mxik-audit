'use server';

import { revalidatePath } from 'next/cache';
import { writer } from '@/lib/guard';
import { shareCreateFor, shareRevokeFor, shareRows, type ShareRow } from '@tasnivo/domain/share';

export type { ShareRow };

export async function shareList(catalogId: unknown): Promise<ShareRow[]> {
  return shareRows(await writer(), catalogId);
}

export async function shareCreate(payload: unknown): Promise<{ url: string } | null> {
  const user = await writer();
  if (!user) return null;
  const result = await shareCreateFor(user, payload);
  const catalogId = (payload as { catalogId?: unknown } | null)?.catalogId;
  if (typeof catalogId === 'string') revalidatePath(`/catalogs/${catalogId}`);
  return result;
}

export async function shareRevoke(linkId: unknown): Promise<boolean> {
  return shareRevokeFor(await writer(), linkId);
}
