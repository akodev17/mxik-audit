import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appDict } from './i18n-app.js';
import {
  buildPipelineMeta, countMatch, degradedNotes, emptyCounters, readPipelineMeta, setupReasons, type PipelineSetup,
} from './pipeline-meta.js';

const FULL: PipelineSetup = {
  embedder: { name: 'local:Xenova/multilingual-e5-small', semantic: true },
  vectorUsable: true,
  reranker: { enabled: true, model: 'claude-opus-5-5', promptVersion: 'v3-uz' },
};
const AT = new Date('2026-10-19T10:00:00Z');

describe('countMatch', () => {
  it('counts rows without AI review, failed AI rows and vector errors', () => {
    const c = emptyCounters();
    countMatch(c, { rerank: 'ranked', vector: 'used' });
    countMatch(c, { rerank: 'skipped', vector: 'used' });
    countMatch(c, { rerank: 'failed', vector: 'failed' });
    countMatch(c, { rerank: 'off', vector: 'off' });
    countMatch(c, { rerank: 'not_needed', vector: 'not_needed' });
    countMatch(c, { rerank: 'none', vector: 'used' });
    assert.deepEqual(c, { rowsAudited: 6, rowsWithoutAi: 3, llmRowsFailed: 1, vectorErrors: 1 });
  });
});

describe('setupReasons', () => {
  it('is empty for a full setup', () => {
    assert.deepEqual(setupReasons(FULL), []);
  });

  it('reports the hashing stand-in as not semantic, and a disabled stage as off', () => {
    assert.deepEqual(setupReasons({ ...FULL, embedder: { name: 'hashing (local, non-semantic)', semantic: false } }), ['vector_not_semantic']);
    assert.deepEqual(setupReasons({ ...FULL, vectorUsable: false, reranker: { ...FULL.reranker, enabled: false, model: null } }), ['rerank_off', 'vector_off']);
  });
});

describe('buildPipelineMeta', () => {
  it('adds run-time failures to the setup reasons as stable codes', () => {
    const meta = buildPipelineMeta(FULL, { rowsAudited: 10, rowsWithoutAi: 4, llmRowsFailed: 2, vectorErrors: 1 }, 0, AT);
    assert.deepEqual(meta.degradedReasons, ['rerank_failed', 'vector_failed']);
    assert.equal(meta.embedder, FULL.embedder.name);
    assert.deepEqual(meta.reranker, FULL.reranker);
    assert.equal(meta.finishedAt, AT.toISOString());
  });

  it('round-trips through JSON and the reader', () => {
    const meta = buildPipelineMeta(FULL, { rowsAudited: 3, rowsWithoutAi: 1, llmRowsFailed: 0, vectorErrors: 0 }, 2, AT);
    assert.deepEqual(readPipelineMeta(JSON.parse(JSON.stringify(meta))), meta);
  });
});

describe('readPipelineMeta', () => {
  it('returns null for catalogues audited before the column existed', () => {
    assert.equal(readPipelineMeta(null), null);
    assert.equal(readPipelineMeta(undefined), null);
    assert.equal(readPipelineMeta({ nothing: true }), null);
  });

  it('drops unknown codes and repairs bad counts instead of failing', () => {
    const meta = readPipelineMeta({
      embedder: 'x', vectorUsable: true, reranker: { enabled: false, model: null, promptVersion: 'v3-uz' },
      degradedReasons: ['rerank_off', 'lunar_eclipse'], rowsWithoutAi: -3, llmRowsFailed: 'many', vectorErrors: 0,
      rowsAudited: 5, fromRow: 0, finishedAt: '2026-10-19T10:00:00.000Z',
    });
    assert.deepEqual(meta?.degradedReasons, ['rerank_off']);
    assert.equal(meta?.rowsWithoutAi, 0);
    assert.equal(meta?.llmRowsFailed, 0);
  });
});

describe('degradedNotes', () => {
  it('gives one translated sentence per reason, with counts in Russian plural form', () => {
    const meta = buildPipelineMeta({ ...FULL, reranker: { ...FULL.reranker, enabled: false, model: null } }, { rowsAudited: 9, rowsWithoutAi: 9, llmRowsFailed: 0, vectorErrors: 2 }, 0, AT);
    const uz = degradedNotes(meta, appDict('uz'));
    assert.equal(uz.length, 2);
    assert.match(uz[0] ?? '', /AI tekshiruvi/);
    assert.match(uz[1] ?? '', /2 ta qatorda/);
    assert.match(degradedNotes(meta, appDict('ru'))[1] ?? '', /В 2 строках/);
  });

  it('is empty for a full run', () => {
    assert.deepEqual(degradedNotes(buildPipelineMeta(FULL, emptyCounters(), 0, AT), appDict('uz')), []);
  });
});
