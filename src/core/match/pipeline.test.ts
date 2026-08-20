import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HashingEmbeddingProvider } from '../embed/index.js';
import { matchProduct } from './pipeline.js';
import { NoopRerankProvider } from './rerank.js';
import { BANDS } from './score.js';
import type {
  CandidateStore, EmbeddingProvider, MxikCandidate, RerankProvider, RerankVerdict,
} from './types.js';

function candidate(code: string, nameUz: string, overrides: Partial<MxikCandidate> = {}): MxikCandidate {
  return {
    code, nameUz, nameRu: nameUz,
    groupName: 'GROUP', className: 'CLASS', positionName: 'POSITION', subPositionName: 'SUBPOS',
    brandName: null, attributeName: null,
    subPositionCode: code.slice(0, 11),
    isBase: code.slice(11) === '000000',
    isMarked: false,
    unitBinding: 'none', unitCanonical: [], unitRaw: null, unitContainer: null, barcode: null,
    ...overrides,
  };
}

/** In-memory store, so the cascade is testable without Postgres. */
class FakeStore implements CandidateStore {
  constructor(private readonly rows: MxikCandidate[]) {}
  calls: string[] = [];

  byBarcode(barcode: string): Promise<MxikCandidate[]> {
    this.calls.push('byBarcode');
    return Promise.resolve(this.rows.filter((r) => r.barcode === barcode));
  }
  byMatchKey(keys: readonly string[]): Promise<MxikCandidate[]> {
    this.calls.push('byMatchKey');
    const wanted = new Set(keys);
    return Promise.resolve(this.rows.filter((r) => wanted.has(r.nameUz.toLowerCase())));
  }
  byLexical(query: string, limit: number): Promise<{ candidate: MxikCandidate; score: number }[]> {
    this.calls.push('byLexical');
    const hits = this.rows
      .filter((r) => r.nameUz.toLowerCase().includes(query.split(' ')[0] ?? query))
      .slice(0, limit)
      .map((r, i) => ({ candidate: r, score: 1 - i * 0.1 }));
    return Promise.resolve(hits);
  }
  byFullText(query: string, limit: number): Promise<{ candidate: MxikCandidate; score: number }[]> {
    this.calls.push('byFullText');
    return this.byLexical(query, limit);
  }
  byVector(_embedding: readonly number[], limit: number): Promise<{ candidate: MxikCandidate; score: number }[]> {
    this.calls.push('byVector');
    return Promise.resolve(this.rows.slice(0, limit).map((r, i) => ({ candidate: r, score: 0.5 - i * 0.05 })));
  }
  byCode(code: string): Promise<MxikCandidate | null> {
    return Promise.resolve(this.rows.find((r) => r.code === code) ?? null);
  }
  baseCodeFor(subPositionCode: string): Promise<MxikCandidate | null> {
    return Promise.resolve(this.rows.find((r) => r.subPositionCode === subPositionCode && r.isBase) ?? null);
  }
}

class StubReranker implements RerankProvider {
  readonly name = 'stub';
  readonly available = true;
  constructor(private readonly verdicts: RerankVerdict[]) {}
  rerank(): Promise<RerankVerdict[]> { return Promise.resolve(this.verdicts); }
}

class ThrowingReranker implements RerankProvider {
  readonly name = 'throwing';
  readonly available = true;
  rerank(): Promise<RerankVerdict[]> { return Promise.reject(new Error('upstream 500')); }
}

const embedder: EmbeddingProvider = new HashingEmbeddingProvider();
const noop = new NoopRerankProvider();

const ROWS = [
  candidate('01901001003000000', 'guruch botqasi'),
  candidate('01901001003002001', 'guruch botqasi osiyo', { isMarked: false }),
  candidate('02202004002001001', 'pivo amstel', { barcode: '04601501483581', isMarked: true }),
  candidate('00701001001000000', 'kartoshka'),
];

describe('matchProduct cascade', () => {
  it('short-circuits on a unique barcode at confidence 1.0', async () => {
    const store = new FakeStore(ROWS);
    const r = await matchProduct(
      { rawName: 'anything at all', barcode: '4601501483581' },
      { store, embedder, reranker: noop },
    );
    assert.equal(r.decidedBy, 'barcode');
    assert.equal(r.candidates[0]?.candidate.code, '02202004002001001');
    assert.equal(r.candidates[0]?.confidence, 1);
    assert.equal(r.candidates[0]?.band, 'high');
    // Later stages must not have run.
    assert.ok(!store.calls.includes('byLexical'));
  });

  it('ignores a barcode of invalid length and says so', async () => {
    const store = new FakeStore(ROWS);
    const r = await matchProduct(
      { rawName: 'kartoshka', barcode: '12345678901' },
      { store, embedder, reranker: noop },
    );
    assert.notEqual(r.decidedBy, 'barcode');
    assert.ok(r.notes.some((n) => n.includes('not a valid GTIN')));
  });

  it('falls through to name matching when a barcode is ambiguous', async () => {
    const dupes = [
      candidate('00000000000000001', 'a', { barcode: '04601501483581' }),
      candidate('00000000000000002', 'b', { barcode: '04601501483581' }),
    ];
    const store = new FakeStore(dupes);
    const r = await matchProduct(
      { rawName: 'a', barcode: '4601501483581' },
      { store, embedder, reranker: noop },
    );
    assert.notEqual(r.decidedBy, 'barcode');
    assert.ok(r.notes.some((n) => n.includes('maps to 2 codes')));
  });

  it('takes a unique normalized-name hit at 0.95', async () => {
    const store = new FakeStore(ROWS);
    const r = await matchProduct({ rawName: 'Kartoshka' }, { store, embedder, reranker: noop });
    assert.equal(r.decidedBy, 'exact');
    assert.equal(r.candidates[0]?.confidence, 0.95);
    assert.ok(!store.calls.includes('byVector'));
  });

  it('caps confidence below the high band when no reranker is available', async () => {
    const store = new FakeStore(ROWS);
    const r = await matchProduct({ rawName: 'guruch' }, { store, embedder, reranker: noop });
    assert.equal(r.decidedBy, 'fusion');
    for (const c of r.candidates) {
      assert.ok(c.confidence < BANDS.high, `${c.confidence} should be capped`);
    }
    assert.ok(r.notes.some((n) => n.includes('Reranker unavailable')));
  });

  it('lets the reranker reorder and reach the high band', async () => {
    const store = new FakeStore(ROWS);
    const reranker = new StubReranker([
      { code: '01901001003002001', confidence: 0.99, reason: 'brand named in the product' },
      { code: '01901001003000000', confidence: 0.2, reason: 'too general' },
    ]);
    const r = await matchProduct({ rawName: 'guruch' }, { store, embedder, reranker });
    assert.equal(r.decidedBy, 'rerank');
    assert.equal(r.candidates[0]?.candidate.code, '01901001003002001');
    assert.equal(r.candidates[0]?.reason, 'brand named in the product');
  });

  it('survives a reranker failure and keeps fusion order', async () => {
    const store = new FakeStore(ROWS);
    const r = await matchProduct({ rawName: 'guruch' }, { store, embedder, reranker: new ThrowingReranker() });
    assert.equal(r.decidedBy, 'fusion');
    assert.ok(r.candidates.length > 0);
    assert.ok(r.notes.some((n) => n.includes('Reranker failed')));
  });

  it('returns no candidates rather than throwing when nothing is retrieved', async () => {
    const store = new FakeStore([]);
    const r = await matchProduct({ rawName: 'zzzzzzzz' }, { store, embedder, reranker: noop });
    assert.equal(r.decidedBy, 'none');
    assert.deepEqual(r.candidates, []);
  });

  it('returns at most topK candidates, most confident first', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      candidate(`0190100100300${String(i).padStart(4, '0')}`, `guruch variant ${i}`));
    const store = new FakeStore(many);
    const r = await matchProduct({ rawName: 'guruch' }, { store, embedder, reranker: noop, topK: 5 });
    assert.equal(r.candidates.length, 5);
    for (let i = 1; i < r.candidates.length; i++) {
      const prev = r.candidates[i - 1]?.confidence ?? 0;
      const cur = r.candidates[i]?.confidence ?? 0;
      assert.ok(prev >= cur, `not sorted at ${i}: ${prev} < ${cur}`);
    }
  });

  it('reports the prepared-dish rule in its notes', async () => {
    const store = new FakeStore(ROWS);
    const r = await matchProduct({ rawName: 'Palov 1 porsiya' }, { store, embedder, reranker: noop });
    assert.ok(r.notes.some((n) => n.includes('prepared dish')));
  });

  it('warns when the embedder is not semantic', async () => {
    const store = new FakeStore(ROWS);
    const r = await matchProduct({ rawName: 'guruch' }, { store, embedder, reranker: noop });
    assert.ok(r.notes.some((n) => n.includes('not semantic')));
  });

  it('surfaces a unit conflict as an adjustment note even on an exact hit', async () => {
    const store = new FakeStore([
      candidate('00701001001000000', 'kartoshka', { unitBinding: 'strict', unitCanonical: ['kilogramm'] }),
    ]);
    const r = await matchProduct({ rawName: 'Kartoshka', unit: 'litr' }, { store, embedder, reranker: noop });
    assert.equal(r.decidedBy, 'exact');
    assert.ok(r.candidates[0]?.adjustments.some((a) => a.includes('Unit mismatch')));
  });

  it('normalizes the query before retrieval', async () => {
    // "GO'ShT" and "goʻsht" must reach the same row.
    const store = new FakeStore([candidate('00201001001000000', 'gosht')]);
    const a = await matchProduct({ rawName: "GO'ShT" }, { store, embedder, reranker: noop });
    const b = await matchProduct({ rawName: 'goʻsht' }, { store, embedder, reranker: noop });
    assert.equal(a.candidates[0]?.candidate.code, b.candidates[0]?.candidate.code);
  });
});

class FailingEmbedder implements EmbeddingProvider {
  readonly name = 'failing';
  readonly dimensions = 384;
  readonly semantic = true;
  embed(): Promise<number[][]> { return Promise.reject(new Error('429 insufficient_quota')); }
}

describe('provider failure handling', () => {
  it('degrades to lexical retrieval when the embedder fails', async () => {
    // A quota-exhausted or down provider must not take the whole audit with it.
    const store = new FakeStore(ROWS);
    const r = await matchProduct(
      { rawName: 'guruch' },
      { store, embedder: new FailingEmbedder(), reranker: noop },
    );
    assert.ok(r.candidates.length > 0, 'should still return lexical candidates');
    assert.ok(r.notes.some((n) => n.includes('Vector stage unavailable')), JSON.stringify(r.notes));
    assert.ok(r.notes.some((n) => n.includes('insufficient_quota')));
  });

  it('still short-circuits on a barcode without touching the embedder', async () => {
    const store = new FakeStore(ROWS);
    const r = await matchProduct(
      { rawName: 'x', barcode: '4601501483581' },
      { store, embedder: new FailingEmbedder(), reranker: noop },
    );
    assert.equal(r.decidedBy, 'barcode');
    assert.equal(r.candidates[0]?.confidence, 1);
  });
});
