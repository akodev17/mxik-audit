// Shapes the clients, imports and admin pages name, as the API sends them (@tasnivo/contracts).
import type { z } from 'zod';
import type { DOC_KINDS, DocMap as DocMapSchema, PurchaseMap as PurchaseMapSchema } from '@tasnivo/contracts';
import type { AccuracyRow as AccuracyRowSchema } from '@tasnivo/contracts/modules/admin';
import type {
  AssignableAccountant as AssignableAccountantSchema, AttentionReason as AttentionReasonSchema, CLIENT_FILTERS, CLIENT_SORTS,
  ClientFilterCounts, Dependant as DependantSchema,
} from '@tasnivo/contracts/modules/clients';

export type ClientFilter = (typeof CLIENT_FILTERS)[number];
export type ClientSort = (typeof CLIENT_SORTS)[number];
export type FilterCounts = z.infer<typeof ClientFilterCounts>;
export type AttentionReason = z.infer<typeof AttentionReasonSchema>;
export type Dependant = z.infer<typeof DependantSchema>;
export type AssignableAccountant = z.infer<typeof AssignableAccountantSchema>;
export type DocKind = (typeof DOC_KINDS)[number];
export type DocMap = z.infer<typeof DocMapSchema>;
export type PurchaseMap = z.infer<typeof PurchaseMapSchema>;
export type AccuracyRow = z.infer<typeof AccuracyRowSchema>;
