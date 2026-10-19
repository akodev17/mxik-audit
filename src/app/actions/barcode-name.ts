'use server';

import { z } from 'zod';
import { applyBarcodeName } from '@/lib/barcode-name';
import { writer } from '@/lib/guard';

/** Fills the product name from the classifier; viewers cannot write. */
export async function fillNameFromBarcode(findingId: unknown): Promise<boolean> {
  const user = await writer();
  const id = z.string().min(1).safeParse(findingId);
  return Boolean(user && id.success && await applyBarcodeName(user, id.data));
}
