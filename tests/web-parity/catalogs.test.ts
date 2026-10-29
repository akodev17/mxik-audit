// The catalogue screens' browser copies of pure @tasnivo/domain code (apps/web/src/lib/catalogs; the web
// app does not import the domain) must keep answering what the originals answer.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as access from '@tasnivo/domain/access';
import * as groups from '@tasnivo/domain/activity-groups';
import { classifierHealth } from '@tasnivo/domain/classifier-health';
import { bannerReasons as domainBanner } from '@tasnivo/domain/classifier-freshness';
import * as columnMap from '@tasnivo/domain/column-map';
import * as presets from '@tasnivo/domain/import-presets';
import { degradedNotes as domainNotes, type PipelineMeta } from '@tasnivo/domain/pipeline-meta';
import { withQuery as domainWithQuery } from '@tasnivo/domain/query-string';
import { localDate } from '@tasnivo/domain/reminder-dates';
import { typeLines as domainTypeLines } from '@tasnivo/domain/report-summary';
import { fileLine as domainFileLine } from '@tasnivo/domain/sheet-shape';
import * as fileTypes from '@tasnivo/domain/upload-file-types';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { bannerReasons, canWrite, degradedNotes, isAdminRole, localToday, typeLines, withQuery } from '@/lib/catalogs/report';
import { applyPreset, COLUMN_FIELDS, fileLine, hasUploadExtension, IMPORT_PRESETS, mappingIssues, UPLOAD_ACCEPT, UPLOAD_EXTENSIONS } from '@/lib/catalogs/upload';
import { groupDecisions, type ActivityRow } from '@/lib/pure/activity-groups';

describe('catalogue screens: web copies equal the domain', () => {
  it('column fields, mapping issues', () => {
    assert.deepEqual([...COLUMN_FIELDS], [...columnMap.COLUMN_FIELDS]);
    const maps = [
      { name: 0, barcode: 1, mxik: 2, unit: 3, price: 4, sales: 5, tnved: -1 },
      { name: 0, barcode: 0, mxik: 9, unit: -1, price: -1, sales: -1, tnved: -1 },
      { name: 2, barcode: 2, mxik: 2, unit: 7, price: 1, sales: -1, tnved: -1 },
    ];
    for (const m of maps) for (const width of [1, 3, 6, 8]) assert.deepEqual(mappingIssues(m, width), columnMap.mappingIssues(m, width));
  });

  it('import presets and how they map headers', () => {
    assert.deepEqual(IMPORT_PRESETS, presets.IMPORT_PRESETS);
    const fallback = { name: 1, barcode: -1, mxik: -1, unit: -1, price: -1, sales: -1, tnved: -1 };
    const headerSets = [
      ['Код', 'Наименование', 'Штрихкод', 'ИКПУ', 'Ед. изм.', 'Цена продажи', 'Выручка'],
      ['Nomi', 'Barcode', 'IKPU', 'Oʻlchov birligi', 'Narx'],
      ['A', 'B'],
    ];
    for (const preset of IMPORT_PRESETS) {
      const original = presets.IMPORT_PRESETS.find((p) => p.id === preset.id);
      assert.ok(original);
      for (const headers of headerSets) assert.deepEqual(applyPreset(preset, headers, fallback), presets.applyPreset(original, headers, fallback));
    }
  });

  it('file lines of data rows', () => {
    const infos = [
      { headerRow: 1, lineJumps: null },
      { headerRow: 3, lineJumps: [] as [number, number][] },
      { headerRow: 2, lineJumps: [[0, 3], [5, 12], [9, 20]] as [number, number][] },
    ];
    for (const info of infos) for (const row of [0, 1, 4, 5, 8, 9, 30]) assert.equal(fileLine(info, row), domainFileLine(info, row));
  });

  it('accepted upload types', () => {
    assert.deepEqual([...UPLOAD_EXTENSIONS], [...fileTypes.UPLOAD_EXTENSIONS]);
    assert.equal(UPLOAD_ACCEPT, fileTypes.UPLOAD_ACCEPT);
    for (const name of ['a.xlsx', 'A.XLS', 'b.csv ', '.csv', 'c.pdf', 'xlsx', 'd.xlsx.txt']) assert.equal(hasUploadExtension(name), fileTypes.hasUploadExtension(name), name);
  });

  it('roles', () => {
    for (const role of ['admin', 'accountant', 'viewer'] as const) {
      assert.equal(canWrite({ role }), access.canWrite({ role }));
      assert.equal(isAdminRole({ role }), access.isAdminRole({ role }));
    }
  });

  it('report type lines and degraded-run notes', () => {
    const data = {
      byType: [{ type: 'MISMATCH', count: 3 }, { type: 'MISSING', count: 1 }, { type: 'RESTRICTED', count: 0 }],
      rows: [
        { type: 'MISMATCH', decision: 'pending' as const }, { type: 'MISMATCH', decision: 'accepted' as const },
        { type: 'MISMATCH', decision: 'rejected' as const }, { type: 'MISSING', decision: 'accepted' as const },
      ],
    };
    assert.deepEqual(typeLines(data as Parameters<typeof typeLines>[0]), domainTypeLines(data as Parameters<typeof domainTypeLines>[0]));
    const meta: PipelineMeta = {
      embedder: 'e', vectorUsable: false, reranker: { enabled: false, model: null, promptVersion: 'v1' },
      degradedReasons: ['rerank_off', 'vector_off', 'vector_not_semantic', 'rerank_failed', 'vector_failed', 'restricted_unchecked', 'rows_failed'],
      rowsWithoutAi: 3, llmRowsFailed: 4, llmRowsNone: 0, vectorErrors: 5, rowsAudited: 10, rowsFailed: 2, fromRow: 0, throughRow: 10, finishedAt: '2026-10-01T00:00:00.000Z',
      classifierSnapshotId: null, classifierTakenAt: null,
    };
    for (const locale of ['uz', 'ru'] as const) assert.deepEqual(degradedNotes(meta, appDict(locale)), domainNotes(meta, appDict(locale)));
  });

  it('the classifier banner from /api/health', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    const day = 86_400_000;
    const cases = [
      { snapshot: null, last: null },
      { snapshot: { takenAt: new Date(now.getTime() - 2 * day) }, last: null },
      { snapshot: { takenAt: new Date(now.getTime() - 9 * day) }, last: null },
      { snapshot: { takenAt: new Date(now.getTime() - 2 * day) }, last: { outcome: 'failed' as const, at: new Date(now.getTime() - day), message: 'x' } },
      { snapshot: { takenAt: new Date(now.getTime() - 9 * day) }, last: { outcome: 'failed' as const, at: new Date(now.getTime() - day), message: 'x' } },
    ];
    for (const c of cases) {
      const banner = domainBanner(c.snapshot, c.last, now);
      const health = classifierHealth(true, { takenAt: c.snapshot?.takenAt ?? null, ageDays: 0, codeCount: 1, lastUpdate: c.last, banner });
      assert.deepEqual(bannerReasons(health), banner);
    }
  });

  it('today in Tashkent, links with the list filters', () => {
    for (const iso of ['2026-10-20T18:59:59Z', '2026-10-20T19:00:00Z', '2026-12-31T23:30:00Z']) {
      assert.equal(localToday(new Date(iso)), localDate(new Date(iso)).date.toISOString().slice(0, 10));
    }
    const current = { client: 'c1', page: '3', empty: '', list: ['a', 'b'] };
    const changes: Record<string, string | null>[] = [{}, { page: null }, { page: '2' }, { client: '' }];
    for (const change of changes) assert.equal(withQuery('/catalogs', current, change), domainWithQuery('/catalogs', current, change));
  });

  it('decision runs in the history', () => {
    const at = (min: number): Date => new Date(Date.UTC(2026, 9, 20, 10, 0) - min * 60_000);
    const row = (id: string, action: string, min: number, actorId = 'u1', catalogId: string | null = 'k1'): ActivityRow => ({
      id, action, at: at(min), actorId, actor: 'a@b.uz', catalogId, catalogName: 'K', catalogDeleted: false, clientId: 'c', clientName: 'C', count: null, product: null,
    });
    const rows = [
      row('1', 'finding.accepted', 0), row('2', 'finding.rejected', 5), row('3', 'finding.accepted', 50),
      row('4', 'catalog.uploaded', 51), row('5', 'finding.accepted', 52, 'u2'), row('6', 'finding.accepted', 53, 'u2', null),
    ];
    assert.deepEqual(groupDecisions(rows), groups.groupDecisions(rows));
  });
});
