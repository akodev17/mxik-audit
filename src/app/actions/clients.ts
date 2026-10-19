'use server';

import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { switchableClient } from '@/lib/active-client';
import { archiveClient, deleteClient, renameClient, restoreClient, setClientAccountants, type Dependant, type LifecycleError } from '@/lib/client-lifecycle';
import { createClient } from '@/lib/clients';
import { isDemoOrg } from '@/lib/demo';
import { gate } from '@/lib/plan';
import { currentUser, getSession } from '@/lib/session';
import { admin, writer } from '@/lib/guard';

export type AddClientState = { error?: string };

/** Creates a client and makes it the one being worked on. Viewers are refused here, not just in the UI. */
export async function addClient(_prev: AddClientState, form: FormData): Promise<AddClientState> {
  const { t, ta } = await getI18n();
  const user = await writer();
  if (!user) return { error: ta.firmX.errors.forbidden };
  if (await isDemoOrg(user.orgId)) return { error: t.demoUploadDisabled };
  const allowed = await gate(user.orgId, 'clients');
  if (!allowed.ok) return { error: ta.msg.gate[allowed.reason] };
  const name = z.string().safeParse(form.get('name'));
  if (!name.success) return { error: t.clientsBadName };

  const result = await createClient(user, name.data);
  if (!result.ok) return { error: result.error === 'forbidden' ? ta.firmX.errors.forbidden : t.clientsBadName };
  const session = await getSession();
  session.clientId = result.clientId;
  await session.save();
  revalidatePath('/clients');
  revalidatePath('/dashboard');
  redirect(`/clients/${result.clientId}`);
}

/** Remembers which client is being worked on: the org's, visible to the user and not archived. */
export async function rememberClient(clientId: unknown): Promise<{ ok: boolean }> {
  const user = await currentUser();
  if (!user) return { ok: false };
  const id = z.string().min(1).max(64).safeParse(clientId);
  if (!id.success) return { ok: false };
  const client = await switchableClient(user, id.data);
  if (!client) return { ok: false };
  if (user.clientId === client.id) return { ok: true };
  const session = await getSession();
  session.clientId = client.id;
  await session.save();
  return { ok: true };
}

export type ClientActionResult = { ok: true } | { ok: false; error: string };
/** Archiving tells who is left without an active client; a refused delete lists whose only client it is. */
export type ArchiveActionResult = { ok: true; stranded: string[] } | { ok: false; error: string };
export type DeleteActionResult = { ok: true } | { ok: false; error: string; blockers?: Dependant[] };

async function lifecycleUser() {
  const user = await admin();
  if (!user || await isDemoOrg(user.orgId)) return null;
  return user;
}

async function failure(error: LifecycleError): Promise<{ ok: false; error: string }> {
  const { ta } = await getI18n();
  return { ok: false, error: ta.firmX.errors[error] };
}

function refresh(clientId: string): void {
  revalidatePath('/clients');
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/dashboard');
  revalidatePath('/queue');
}

const Id = z.string().min(1).max(64);

export async function renameClientAction(payload: unknown): Promise<ClientActionResult> {
  const user = await lifecycleUser();
  const parsed = z.object({ clientId: Id, name: z.string().max(400) }).safeParse(payload);
  if (!user) return failure('forbidden');
  if (!parsed.success) return failure('bad name');
  const result = await renameClient(user, parsed.data.clientId, parsed.data.name);
  if (!result.ok) return failure(result.error);
  refresh(parsed.data.clientId);
  return { ok: true };
}

export async function archiveClientAction(clientId: unknown): Promise<ArchiveActionResult> {
  const user = await lifecycleUser();
  const id = Id.safeParse(clientId);
  if (!user) return failure('forbidden');
  if (!id.success) return failure('not found');
  const result = await archiveClient(user, id.data);
  if (!result.ok) return failure(result.error);
  // The archived client stops being the one this person works on.
  if (user.clientId === id.data) {
    const session = await getSession();
    session.clientId = undefined;
    await session.save();
  }
  refresh(id.data);
  return { ok: true, stranded: result.stranded };
}

export async function restoreClientAction(clientId: unknown): Promise<ClientActionResult> {
  const user = await lifecycleUser();
  const id = Id.safeParse(clientId);
  if (!user) return failure('forbidden');
  if (!id.success) return failure('not found');
  const result = await restoreClient(user, id.data);
  if (!result.ok) return failure(result.error);
  refresh(id.data);
  return { ok: true };
}

/** Deletes a client after its exact name was typed. The caller navigates away on success. */
export async function deleteClientAction(payload: unknown): Promise<DeleteActionResult> {
  const user = await lifecycleUser();
  const parsed = z.object({ clientId: Id, confirmName: z.string().max(400) }).safeParse(payload);
  if (!user) return failure('forbidden');
  if (!parsed.success) return failure('name mismatch');
  const result = await deleteClient(user, parsed.data.clientId, parsed.data.confirmName);
  if (!result.ok && 'blockers' in result) {
    const { ta } = await getI18n();
    return { ok: false, error: ta.firmX.client.deleteBlocked, blockers: result.blockers };
  }
  if (!result.ok) return failure(result.error);
  if (user.clientId === parsed.data.clientId) {
    const session = await getSession();
    session.clientId = undefined;
    await session.save();
  }
  refresh(parsed.data.clientId);
  revalidatePath('/catalogs');
  return { ok: true };
}

export async function setAccountantsAction(payload: unknown): Promise<ClientActionResult> {
  const user = await lifecycleUser();
  const parsed = z.object({ clientId: Id, userIds: z.array(Id).max(500) }).safeParse(payload);
  if (!user) return failure('forbidden');
  if (!parsed.success) return failure('bad user');
  const result = await setClientAccountants(user, parsed.data.clientId, parsed.data.userIds);
  if (!result.ok) return failure(result.error);
  refresh(parsed.data.clientId);
  return { ok: true };
}
