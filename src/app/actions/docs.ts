'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { canSeeClient } from '@/lib/access';
import { MAX_UPLOAD_BYTES } from '@/lib/catalog-import';
import { applyDocMap, deleteDocList, DocMapSchema, DOC_KINDS, storeDocList, type DocKind, type DocMap } from '@/lib/docs';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { writer } from '@/lib/guard';
import { getI18n } from '@/lib/locale';
import { parseUpload } from '@/lib/spreadsheet';

export type DocUploadState = {
  error?: string;
  preview?: { listId: string; filename: string; headers: string[]; rows: string[][]; totalRows: number; map: DocMap };
};

/** Stores an uploaded list under the client and returns a preview for the column mapping. */
export async function uploadDoc(_prev: DocUploadState, form: FormData): Promise<DocUploadState> {
  const { t, ta } = await getI18n();
  const user = await writer();
  if (!user || await isDemoOrg(user.orgId)) return { error: t.demoUploadDisabled };
  const clientId = form.get('clientId');
  const kind = DOC_KINDS.find((k) => k === form.get('kind'));
  const client = typeof clientId === 'string' && kind ? await db.client.findFirst({ where: { id: clientId, orgId: user.orgId }, select: { id: true } }) : null;
  if (!client || !kind || !canSeeClient(user, client.id)) return { error: t.errorGeneric };
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: ta.msg.fileNone };
  if (file.size > MAX_UPLOAD_BYTES) return { error: ta.msg.fileTooBig };

  try {
    const parsed = await parseUpload(Buffer.from(await file.arrayBuffer()), file.name);
    if (parsed.rows.length === 0) return { error: ta.msg.fileEmpty };
    const { listId, map } = await storeDocList({ orgId: user.orgId, clientId: client.id, kind, filename: file.name, parsed });
    await db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: `${kind}.uploaded`, targetId: listId, payload: { clientId: client.id, filename: file.name, rowCount: parsed.rows.length } } });
    return { preview: { listId, filename: file.name, headers: parsed.headers, rows: parsed.rows.slice(0, 5), totalRows: parsed.rows.length, map } };
  } catch (error) {
    return { error: ta.msg.fileReadFailed(error instanceof Error ? error.message : '') };
  }
}

/** Confirms the mapping and starts the check. */
export async function applyDoc(payload: unknown): Promise<{ ok: boolean }> {
  const user = await writer();
  const parsed = z.object({ listId: z.string().min(1), map: DocMapSchema }).safeParse(payload);
  if (!user || !parsed.success) return { ok: false };
  const list = await db.docList.findFirst({ where: { id: parsed.data.listId, orgId: user.orgId }, select: { clientId: true } });
  if (!list || !canSeeClient(user, list.clientId)) return { ok: false };
  const ok = await applyDocMap(user.orgId, parsed.data.listId, parsed.data.map);
  revalidatePath(`/clients/${list.clientId}/imports`);
  return { ok };
}

export async function removeDoc(listId: unknown): Promise<{ ok: boolean }> {
  const user = await writer();
  const id = z.string().min(1).safeParse(listId);
  if (!user || !id.success) return { ok: false };
  const list = await db.docList.findFirst({ where: { id: id.data, orgId: user.orgId }, select: { clientId: true } });
  if (!list || !canSeeClient(user, list.clientId)) return { ok: false };
  const ok = await deleteDocList(user.orgId, id.data);
  revalidatePath(`/clients/${list.clientId}/imports`);
  return { ok };
}

export type { DocKind };
