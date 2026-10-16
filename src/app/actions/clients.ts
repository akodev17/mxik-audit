'use server';

import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, ownedClient } from '@/lib/clients';
import { isDemoOrg } from '@/lib/demo';
import { gate } from '@/lib/plan';
import { currentUser, getSession } from '@/lib/session';
import { canSeeClient } from '@/lib/access';
import { writer } from '@/lib/guard';

export type AddClientState = { error?: string };

/** Creates a client and makes it the one being worked on. */
export async function addClient(_prev: AddClientState, form: FormData): Promise<AddClientState> {
  const { t, ta } = await getI18n();
  const user = await writer();
  if (!user) return { error: t.errorGeneric };
  if (await isDemoOrg(user.orgId)) return { error: t.demoUploadDisabled };
  const allowed = await gate(user.orgId, 'clients');
  if (!allowed.ok) return { error: ta.msg.gate[allowed.reason] };
  const name = z.string().safeParse(form.get('name'));
  if (!name.success) return { error: t.clientsBadName };

  const result = await createClient(user, name.data);
  if (!result.ok) return { error: t.clientsBadName };
  const session = await getSession();
  session.clientId = result.clientId;
  await session.save();
  revalidatePath('/clients');
  redirect(`/clients/${result.clientId}`);
}

/** Remembers which client is being worked on, after checking it is the org's. */
export async function rememberClient(clientId: unknown): Promise<{ ok: boolean }> {
  const user = await currentUser();
  if (!user) return { ok: false };
  const id = z.string().min(1).safeParse(clientId);
  if (!id.success) return { ok: false };
  const client = await ownedClient(user.orgId, id.data);
  if (!client) return { ok: false };
  if (!canSeeClient(user, client.id)) return { ok: false };
  if (user.clientId === client.id) return { ok: true };
  const session = await getSession();
  session.clientId = client.id;
  await session.save();
  return { ok: true };
}
