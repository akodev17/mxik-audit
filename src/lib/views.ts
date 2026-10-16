// Saved views: per user, named, one default.
import { db } from './db';
import { ViewParams } from './view-params';

type Who = { userId: string; orgId: string };

export type ViewRow = { id: string; name: string; isDefault: boolean; params: ViewParams };

function toRow(r: { id: string; name: string; isDefault: boolean; params: unknown }): ViewRow | null {
  const params = ViewParams.safeParse(r.params);
  return params.success ? { id: r.id, name: r.name, isDefault: r.isDefault, params: params.data } : null;
}

export async function listViews(who: Who): Promise<ViewRow[]> {
  const rows = await db.savedView.findMany({ where: { userId: who.userId, orgId: who.orgId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], take: 50 });
  return rows.flatMap((r) => { const v = toRow(r); return v ? [v] : []; });
}

export async function defaultView(who: Who): Promise<ViewRow | null> {
  const row = await db.savedView.findFirst({ where: { userId: who.userId, orgId: who.orgId, isDefault: true } });
  return row ? toRow(row) : null;
}

export async function saveView(who: Who, name: string, params: ViewParams, makeDefault: boolean): Promise<boolean> {
  const label = name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!label) return false;
  await db.$transaction(async (tx) => {
    if (makeDefault) await tx.savedView.updateMany({ where: { userId: who.userId, isDefault: true }, data: { isDefault: false } });
    await tx.savedView.create({ data: { orgId: who.orgId, userId: who.userId, name: label, params, isDefault: makeDefault } });
  });
  return true;
}

export async function removeView(who: Who, id: string): Promise<boolean> {
  const done = await db.savedView.deleteMany({ where: { id, userId: who.userId, orgId: who.orgId } });
  return done.count > 0;
}

/** Makes one view the default, or clears the default when `id` is null. */
export async function setDefaultView(who: Who, id: string | null): Promise<boolean> {
  await db.$transaction(async (tx) => {
    await tx.savedView.updateMany({ where: { userId: who.userId, isDefault: true }, data: { isDefault: false } });
    if (id) await tx.savedView.updateMany({ where: { id, userId: who.userId, orgId: who.orgId }, data: { isDefault: true } });
  });
  return true;
}
