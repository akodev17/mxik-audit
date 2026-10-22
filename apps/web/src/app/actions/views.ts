'use server';

import { z } from 'zod';
import { writer } from '@/lib/guard';
import { currentUser } from '@/lib/session';
import { listViews, type ViewRow } from '@tasnivo/domain/views';
import { ViewParams } from '@tasnivo/domain/view-params';
import { removeViewFor, saveViewFor, setDefaultViewFor, type ViewsResult } from '@tasnivo/domain/workspace-ops';

export type { ViewsResult };

export async function viewsList(): Promise<ViewRow[]> {
  const user = await currentUser();
  return user ? listViews(user) : [];
}

/** Saving, removing and choosing the default are for people who may write; viewers only open views. */
export async function viewsSave(payload: unknown): Promise<ViewsResult> {
  const user = await writer();
  const parsed = z.object({ name: z.string().min(1).max(60), params: ViewParams, makeDefault: z.boolean() }).safeParse(payload);
  if (!user || user.demo || !parsed.success) return { ok: false, views: await viewsList() };
  return saveViewFor(user, parsed.data);
}

export async function viewsRemove(id: unknown): Promise<ViewsResult> {
  const user = await writer();
  const parsed = z.string().min(1).safeParse(id);
  if (!user || !parsed.success) return { ok: false, views: await viewsList() };
  return removeViewFor(user, parsed.data);
}

export async function viewsDefault(id: unknown): Promise<ViewsResult> {
  const user = await writer();
  const parsed = z.string().min(1).nullable().safeParse(id);
  if (!user || !parsed.success) return { ok: false, views: await viewsList() };
  return setDefaultViewFor(user, parsed.data);
}
