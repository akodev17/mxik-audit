'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { writer } from '@/lib/guard';
import { createShareLink, listShareLinks, revokeShareLink, type ShareLinkView } from '@tasnivo/domain/share';

export type ShareRow = Omit<ShareLinkView, 'createdAt' | 'expiresAt' | 'revokedAt' | 'lastViewedAt'> & {
  createdAt: string; expiresAt: string; revokedAt: string | null; lastViewedAt: string | null;
};

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export async function shareList(catalogId: unknown): Promise<ShareRow[]> {
  const user = await writer();
  const id = z.string().min(1).safeParse(catalogId);
  if (!user || !id.success) return [];
  return (await listShareLinks(user, id.data)).map((l) => ({
    id: l.id, includePdf: l.includePdf, views: l.views,
    createdAt: l.createdAt.toISOString(), expiresAt: l.expiresAt.toISOString(), revokedAt: iso(l.revokedAt), lastViewedAt: iso(l.lastViewedAt),
  }));
}

export async function shareCreate(payload: unknown): Promise<{ url: string } | null> {
  const user = await writer();
  const parsed = z.object({ catalogId: z.string().min(1), days: z.union([z.literal(7), z.literal(30)]), includePdf: z.boolean() }).safeParse(payload);
  if (!user || !parsed.success) return null;
  const result = await createShareLink(user, parsed.data.catalogId, { days: parsed.data.days, includePdf: parsed.data.includePdf });
  revalidatePath(`/catalogs/${parsed.data.catalogId}`);
  return result;
}

export async function shareRevoke(linkId: unknown): Promise<boolean> {
  const user = await writer();
  const id = z.string().min(1).safeParse(linkId);
  return Boolean(user && id.success && await revokeShareLink(user, id.data));
}
