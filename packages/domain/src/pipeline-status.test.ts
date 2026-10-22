import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { HashingEmbeddingProvider } from '@tasnivo/core/embed/index';
import type { VectorReadiness } from '@tasnivo/core/match/vector-readiness';
import type { EmbeddingProvider } from '@tasnivo/core/match/types';
import { db } from '@tasnivo/db';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { buildPipelineMeta } from './pipeline-meta.js';
import { lastAuditLine, vectorLine } from './pipeline-status.js';

const view = { ta: appDict('uz'), locale: 'uz' as const };
const semantic: EmbeddingProvider = { name: 'local:Xenova/multilingual-e5-small', dimensions: 384, semantic: true, embed: () => Promise.resolve([]) };
const stored = { provider: 'hashing (local, non-semantic)', dimensions: 384, rowsEmbedded: 438_925 };

after(async () => { await db.$disconnect(); });

describe('vectorLine', () => {
  it('reports the substituted hashing stand-in as degraded, not healthy', () => {
    // Regression: the old check compared the provider name to "hashing" while the
    // stored name is "hashing (local, non-semantic)", so the stand-in showed green.
    const readiness: VectorReadiness = { embedder: new HashingEmbeddingProvider(), usable: true, substituted: true, reason: 'substituted', stored };
    const line = vectorLine(readiness, view);
    assert.equal(line.ok, false);
    assert.match(line.value, /semantik emas/);
  });

  it('reports an unusable stage with its reason', () => {
    const line = vectorLine({ embedder: semantic, usable: false, substituted: false, reason: 'Vectors are being rebuilt', stored: null }, view);
    assert.equal(line.ok, false);
    assert.match(line.value, /rebuilt/);
  });

  it('is healthy only for usable semantic vectors', () => {
    const line = vectorLine({ embedder: semantic, usable: true, substituted: false, reason: null, stored: { ...stored, provider: semantic.name } }, view);
    assert.equal(line.ok, true);
    assert.match(line.value, /438/);
  });
});

describe('lastAuditLine', () => {
  const setup = { embedder: { name: 'x', semantic: true }, vectorUsable: true, reranker: { enabled: true, model: 'm', promptVersion: 'v' } };
  const at = new Date('2026-10-19T09:00:00Z');

  it('shows the latest run as full or degraded from its stored codes', () => {
    const full = lastAuditLine(buildPipelineMeta(setup, { rowsAudited: 1, rowsWithoutAi: 0, llmRowsFailed: 0, vectorErrors: 0 }, 0, at), view);
    assert.equal(full.ok, true);
    const degraded = lastAuditLine(buildPipelineMeta({ ...setup, vectorUsable: false }, { rowsAudited: 1, rowsWithoutAi: 0, llmRowsFailed: 0, vectorErrors: 0 }, 0, at), view);
    assert.equal(degraded.ok, false);
    assert.match(degraded.value, /vektor oʻchiq/);
    assert.match(degraded.value, /19\.10\.2026 14:00/);
  });

  it('says there is no run yet', () => {
    assert.equal(lastAuditLine(null, view).value, view.ta.matchX.status.lastAuditNone);
  });
});
