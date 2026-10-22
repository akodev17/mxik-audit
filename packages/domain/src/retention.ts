// Lead-form file retention. Files sent through the landing form are kept only
// until the free audit is delivered: erased after LEAD_FILE_RETENTION_DAYS, or
// immediately on request. The lead row keeps when that happened.
import { db } from '@tasnivo/db';

export function leadFileRetentionDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env['LEAD_FILE_RETENTION_DAYS']);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** Erases every stored lead file older than the retention window. */
export async function purgeLeadFiles(now = new Date(), days = leadFileRetentionDays()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const res = await db.lead.updateMany({
    where: { fileData: { not: null }, createdAt: { lt: cutoff } },
    data: { fileData: null, fileDeletedAt: now },
  });
  return res.count;
}

/** On request: erase one lead's file, or the whole lead including the contact. */
export async function deleteLead(leadId: string, everything: boolean, now = new Date()): Promise<boolean> {
  if (everything) {
    const res = await db.lead.deleteMany({ where: { id: leadId } });
    return res.count > 0;
  }
  const res = await db.lead.updateMany({ where: { id: leadId }, data: { fileData: null, fileDeletedAt: now } });
  return res.count > 0;
}
