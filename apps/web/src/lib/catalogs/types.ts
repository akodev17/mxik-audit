// The catalogue screens' data as the API answers it (@tasnivo/contracts): dates are ISO strings.
import type { COLUMN_FIELDS, endpoints, ResponseOf } from '@tasnivo/contracts';
import type { z } from 'zod';
import type { ColumnMap as ColumnMapSchema } from '@tasnivo/contracts';

type C = typeof endpoints.catalogs;

export type { Me } from '@/lib/api/me';
export type ColumnMap = z.output<typeof ColumnMapSchema>;
export type ColumnField = (typeof COLUMN_FIELDS)[number];

export type UploadPreview = NonNullable<ResponseOf<C['preview']>>;
export type ParseMeta = NonNullable<UploadPreview['parse']>;
export type ImportDiagnostics = NonNullable<UploadPreview['diagnostics']>;
export type UploadProgress = ResponseOf<C['progress']>;
export type CompletionSummary = Extract<UploadProgress, { status: 'ready' }>['summary'];

export type CatalogListItem = ResponseOf<C['list']>['items'][number];
export type CatalogHeader = ResponseOf<C['get']>;
export type PipelineMeta = NonNullable<CatalogHeader['pipeline']>;

export type VersionDiff = NonNullable<ResponseOf<C['diff']>>;
export type DiffRow = VersionDiff['changed'][number];
export type CarriedRow = VersionDiff['carried'][number];
export type ReportData = ResponseOf<C['report']>;

export type ShareRow = ResponseOf<C['shareLinks']>[number];
export type ReviewView = NonNullable<ResponseOf<C['review']>['review']>;
export type CatalogPurchase = ResponseOf<typeof endpoints.billing.catalogPurchase>;
export type ClassifierHealth = ResponseOf<typeof endpoints.health.get>['classifier'];
