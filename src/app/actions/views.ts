'use server';

import { z } from 'zod';
import { currentUser } from '@/lib/session';
import { listViews, removeView, saveView, setDefaultView, type ViewRow } from '@/lib/views';
import { ViewParams } from '@/lib/view-params';

export async function viewsList(): Promise<ViewRow[]> {
  const user = await currentUser();
  return user ? listViews(user) : [];
}

export async function viewsSave(payload: unknown): Promise<ViewRow[]> {
  const user = await currentUser();
  const parsed = z.object({ name: z.string().min(1).max(60), params: ViewParams, makeDefault: z.boolean() }).safeParse(payload);
  if (!user || user.demo || !parsed.success) return user ? listViews(user) : [];
  await saveView(user, parsed.data.name, parsed.data.params, parsed.data.makeDefault);
  return listViews(user);
}

export async function viewsRemove(id: unknown): Promise<ViewRow[]> {
  const user = await currentUser();
  const parsed = z.string().min(1).safeParse(id);
  if (!user) return [];
  if (parsed.success) await removeView(user, parsed.data);
  return listViews(user);
}

export async function viewsDefault(id: unknown): Promise<ViewRow[]> {
  const user = await currentUser();
  const parsed = z.string().min(1).nullable().safeParse(id);
  if (!user) return [];
  if (parsed.success) await setDefaultView(user, parsed.data);
  return listViews(user);
}
