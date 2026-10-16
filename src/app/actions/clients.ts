'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, ownedClient } from '@/lib/clients';
import { isDemoOrg } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { currentUser, getSession } from '@/lib/session';

export type AddClientState = { error?: string };

/** Creates a client and makes it the one being worked on. */
export async function addClient(_prev: AddClientState, form: FormData): Promise<AddClientState> {
  const user = await currentUser();
  if (!user) return { error: t.errorGeneric };
  if (await isDemoOrg(user.orgId)) return { error: t.demoUploadDisabled };
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
  if (user.clientId === client.id) return { ok: true };
  const session = await getSession();
  session.clientId = client.id;
  await session.save();
  return { ok: true };
}
