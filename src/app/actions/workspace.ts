'use server';

import { z } from 'zod';
import { rowDetail, type RowDetail } from '@/lib/row-detail';
import { getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';

/** Full detail for the row drawer; null when the finding is not the org's. */
export async function loadRowDetail(findingId: unknown): Promise<RowDetail | null> {
  const user = await currentUser();
  const id = z.string().min(1).safeParse(findingId);
  if (!user || !id.success) return null;
  return rowDetail(user, id.data, (await getI18n()).ta);
}
