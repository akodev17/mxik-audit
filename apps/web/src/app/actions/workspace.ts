'use server';

import { z } from 'zod';
import { catalogScope } from '@tasnivo/domain/access';
import { db } from '@tasnivo/db';
import { rowDetail, type RowDetail } from '@tasnivo/domain/row-detail';
import { getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { decodeCursor, workspacePageIds } from '@tasnivo/domain/workspace';
import { FilterInput, readFilter } from '@tasnivo/domain/workspace-filter';
import { gridRows, type GridRow } from '@tasnivo/domain/workspace-rows';

/** Full detail for the row drawer; null when the finding is not the user's to see. */
export async function loadRowDetail(findingId: unknown): Promise<RowDetail | null> {
  const user = await currentUser();
  const id = z.string().min(1).safeParse(findingId);
  if (!user || !id.success) return null;
  const { ta, locale } = await getI18n();
  return rowDetail(user, id.data, ta, locale);
}

const PAGE = 120;
const RowsInput = z.object({ catalogId: z.string().min(1), cursor: z.string().max(400), filter: FilterInput });

/** The next page of grid rows for the current filter; null when the catalogue is not the user's. */
export async function loadRows(payload: unknown): Promise<{ rows: GridRow[]; next: string | null } | null> {
  const user = await currentUser();
  const parsed = RowsInput.safeParse(payload);
  if (!user || !parsed.success) return null;
  const catalog = await db.catalog.findFirst({ where: { id: parsed.data.catalogId, ...catalogScope(user) }, select: { id: true } });
  if (!catalog) return null;
  const { locale } = await getI18n();
  const { ids, next } = await workspacePageIds(catalog.id, readFilter(parsed.data.filter), decodeCursor(parsed.data.cursor), PAGE);
  return { rows: await gridRows(user.orgId, catalog.id, ids, locale), next };
}
