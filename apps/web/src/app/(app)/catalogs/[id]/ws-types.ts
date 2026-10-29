// The workspace's data as the API sends it (packages/contracts), for the grid, drawer and dialogs.
import type { BodyOf, endpoints, ResponseOf } from '@tasnivo/contracts';

type W = typeof endpoints.workspace;

export type GridRow = NonNullable<ResponseOf<W['rows']>>['rows'][number];
export type RowsPage = NonNullable<ResponseOf<W['rows']>>;
export type RowDetail = NonNullable<ResponseOf<W['rowDetail']>>;
export type CodeView = NonNullable<RowDetail['current']>;
export type CodeState = NonNullable<GridRow['currentState']>;
export type Signal = RowDetail['signals'][number];
export type ReasonFacts = RowDetail['facts'];
export type UnitAdvice = RowDetail['advice'];
export type NameFromBarcode = NonNullable<RowDetail['nameOffer']>;
export type DecideResult = ResponseOf<W['decide']>;
export type ManyOutcome = ResponseOf<W['decideGroup']>;
export type SurePreviewResult = ResponseOf<W['previewSure']>;
export type DryRunResult = ResponseOf<W['bulkPreview']>;
export type BulkActionInput = BodyOf<W['bulkApply']>['action'];
export type UndoTarget = BodyOf<W['undo']>;
export type CommentView = ResponseOf<W['comments']>[number];
export type ViewRow = ResponseOf<W['views']>[number];
export type ClassifierHit = ResponseOf<W['lookupCodes']>[number];
export type Counts = ResponseOf<W['counts']>;
export type ChipCounts = Counts['chips'];
export type WsSummary = ResponseOf<typeof endpoints.catalogs.summary>;
export type FailedRowsData = ResponseOf<W['failedRows']>;
export type Skipped = Extract<ManyOutcome, { ok: true }>['skipped'];
