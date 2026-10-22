'use server';

import { z } from 'zod';
import { writer } from '@/lib/guard';
import { currentUser } from '@/lib/session';
import { listViews, removeView, saveView, setDefaultView, type ViewRow } from '@/lib/views';
import { ViewParams } from '@/lib/view-params';

export type ViewsResult = { ok: true; views: ViewRow[] } | { ok: false; views: ViewRow[] };

export async function viewsList(): Promise<ViewRow[]> {
  const user = await currentUser();
  return user ? listViews(user) : [];
}

/** Saving, removing and choosing the default are for people who may write; viewers only open views. */
export async function viewsSave(payload: unknown): Promise<ViewsResult> {
  const user = await writer();
  const parsed = z.object({ name: z.string().min(1).max(60), params: ViewParams, makeDefault: z.boolean() }).safeParse(payload);
  if (!user || user.demo || !parsed.success) return { ok: false, views: await viewsList() };
  const ok = await saveView(user, parsed.data.name, parsed.data.params, parsed.data.makeDefault);
  return { ok, views: await listViews(user) };
}

export async function viewsRemove(id: unknown): Promise<ViewsResult> {
  const user = await writer();
  const parsed = z.string().min(1).safeParse(id);
  if (!user || !parsed.success) return { ok: false, views: await viewsList() };
  const ok = await removeView(user, parsed.data);
  return { ok, views: await listViews(user) };
}

export async function viewsDefault(id: unknown): Promise<ViewsResult> {
  const user = await writer();
  const parsed = z.string().min(1).nullable().safeParse(id);
  if (!user || !parsed.success) return { ok: false, views: await viewsList() };
  const ok = await setDefaultView(user, parsed.data);
  return { ok, views: await listViews(user) };
}
