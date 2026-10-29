// Where a row's suggestion or decision came from, for the drawer: the firm dictionary entry behind a
// reused suggestion (who taught and confirmed it, from which product name, its review state), and
// the catalogue a carried-over decision was first made in. Scoped by the reader's clients; the
// dictionary part only for members who see every client, since its names come from all of them.
import { readEvidence } from '@tasnivo/core/match/evidence';
import { db } from '@tasnivo/db';
import { findingScope } from './access.js';
import { mayUseDictionary } from './dictionary.js';
import { approverEmails } from './dictionary-review.js';

export type DictionarySource = {
  entryId: string;
  kind: string;
  /** The product name the entry was taught from (as last learned). */
  label: string;
  code: string;
  confirmations: number;
  needsReconfirm: boolean;
  disputedAt: Date | null;
  disputedBy: string | null;
  /** First taught: by whom (e-mail, same org; null = unknown or removed) and when. */
  createdBy: string | null;
  createdAt: Date;
  /** Last taught, confirmed or edited, and how (firm_mapping.source). */
  updatedBy: string | null;
  updatedAt: Date;
  source: string | null;
};

export type CarriedFrom = {
  catalogId: string;
  /** Null when that catalogue was deleted since. */
  filename: string | null;
  originalDecidedAt: Date | null;
};

export type FindingProvenance = { dictionary: DictionarySource | null; carriedFrom: CarriedFrom | null };

export async function findingProvenance(
  user: { orgId: string; clientIds?: string[] | null },
  findingId: string,
): Promise<FindingProvenance | null> {
  const finding = await db.finding.findFirst({
    where: { id: findingId, ...findingScope(user) },
    select: { evidence: true, suggestedMxik: true, decisionSource: true, carriedFromCatalogId: true, originalDecidedAt: true },
  });
  if (!finding) return null;
  const evidence = readEvidence(finding.evidence);
  const entryId = evidence?.stage === 'dictionary' ? evidence.dictionaryEntryId : undefined;

  const [entry, carried] = await Promise.all([
    entryId && mayUseDictionary(user) ? db.firmMapping.findFirst({ where: { id: entryId, orgId: user.orgId } }) : null,
    finding.decisionSource === 'carry_over' && finding.carriedFromCatalogId
      ? db.catalog.findFirst({ where: { id: finding.carriedFromCatalogId, orgId: user.orgId }, select: { filename: true } })
      : null,
  ]);
  const emails = entry ? await approverEmails(user.orgId, [entry.createdBy, entry.updatedBy, entry.disputedBy]) : new Map<string, string>();
  const email = (id: string | null): string | null => (id ? emails.get(id) ?? null : null);
  return {
    dictionary: entry ? {
      entryId: entry.id, kind: entry.kind, label: entry.label, code: entry.code, confirmations: entry.confirmations,
      needsReconfirm: entry.needsReconfirm, disputedAt: entry.disputedAt, disputedBy: email(entry.disputedBy),
      createdBy: email(entry.createdBy), createdAt: entry.createdAt, updatedBy: email(entry.updatedBy), updatedAt: entry.updatedAt, source: entry.source,
    } : null,
    carriedFrom: finding.decisionSource === 'carry_over' && finding.carriedFromCatalogId ? {
      catalogId: finding.carriedFromCatalogId, filename: carried?.filename ?? null, originalDecidedAt: finding.originalDecidedAt,
    } : null,
  };
}
