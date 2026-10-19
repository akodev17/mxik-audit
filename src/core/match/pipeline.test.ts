import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HashingEmbeddingProvider } from '../embed/index.js';
import type { DictionaryEntry, DictionaryLookup } from './dictionary.js';
import { matchProduct } from './pipeline.js';
import { NoopRerankProvider } from './rerank.js';
import { NONE_REASON } from './rerank-parse.js';
import { BANDS, NO_RERANK_CEILING } from './score.js';
import type {
  CandidateStore, EmbeddingProvider, MxikCandidate, RerankProvider, RerankRequest, RerankVerdict,
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
  liveCodes(codes: readonly string[]): Promise<Set<string>> {
    const known = new Set(this.rows.map((r) => r.code));
    return Promise.resolve(new Set(codes.filter((c) => known.has(c))));
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

/** Records what it was sent, then answers with fixed verdicts. */
class RecordingReranker implements RerankProvider {
  readonly name = 'recording';
  readonly available = true;
  requests: RerankRequest[] = [];
  constructor(private readonly verdicts: RerankVerdict[] = []) {}
  rerank(request: RerankRequest): Promise<RerankVerdict[]> {
    this.requests.push(request);
    return Promise.resolve(this.verdicts);
  }
}

/** A store in which some offered codes have since been retired. */
class PartlyRetiredStore extends FakeStore {
  constructor(rows: MxikCandidate[], private readonly retired: Set<string>) { super(rows); }
  override liveCodes(codes: readonly string[]): Promise<Set<string>> {
    return super.liveCodes(codes.filter((c) => !this.retired.has(c)));
  }
}

describe('reranker safety', () => {
  it('keeps the no-reranker cap when the reranker call fails', async () => {
    // Regression: a configured-but-failing reranker used to lift the cap and
    // push retrieval-only guesses into the bulk-accept band.
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder, reranker: new ThrowingReranker() });
    for (const c of r.candidates) assert.ok(c.confidence <= NO_RERANK_CEILING, `${c.confidence} escaped the cap`);
  });

  it('lifts the cap only for candidates the reranker actually scored', async () => {
    const reranker = new RecordingReranker([{ code: '01901001003000000', confidence: 0.99, reason: 'base code fits' }]);
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder, reranker });
    for (const c of r.candidates) {
      if (c.signals.llm === undefined) assert.ok(c.confidence <= NO_RERANK_CEILING, `${c.candidate.code} escaped the cap`);
    }
  });

  it('discards a returned code that is not a live classifier code', async () => {
    const retired = '01901001003002001';
    const reranker = new RecordingReranker([{ code: retired, confidence: 0.99, reason: 'looks right' }]);
    const r = await matchProduct(
      { rawName: 'guruch' },
      { store: new PartlyRetiredStore(ROWS, new Set([retired])), embedder, reranker },
    );
    assert.equal(r.decidedBy, 'fusion');
    assert.ok(r.notes.some((n) => n.includes('discarded')));
    for (const c of r.candidates) assert.ok(c.confidence <= NO_RERANK_CEILING);
  });

  it('discards a returned code that was never offered', async () => {
    const reranker = new RecordingReranker([{ code: '09999999999999999', confidence: 0.99, reason: 'invented' }]);
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder, reranker });
    assert.ok(!r.candidates.some((c) => c.candidate.code === '09999999999999999'));
    assert.equal(r.decidedBy, 'fusion');
  });

  it('skips a row the gate calls certain, without calling the reranker, and keeps the cap', async () => {
    const reranker = new RecordingReranker([{ code: '01901001003000000', confidence: 0.99, reason: 'x' }]);
    const r = await matchProduct(
      { rawName: 'guruch' },
      { store: new FakeStore(ROWS), embedder, reranker, rerankGate: { minConfidence: 0, minMargin: 0 } },
    );
    assert.equal(reranker.requests.length, 0);
    assert.ok(r.notes.some((n) => n.includes('Reranker skipped')));
    for (const c of r.candidates) assert.ok(c.confidence <= NO_RERANK_CEILING);
  });

  it('sends only the product name, normalized key, unit and prepared-dish flag', async () => {
    const reranker = new RecordingReranker();
    await matchProduct(
      { rawName: 'Guruch 1 kg ART-5531', unit: 'kg', barcode: null, existingMxik: '01901001003000000' },
      { store: new FakeStore(ROWS), embedder, reranker },
    );
    const sent = reranker.requests[0];
    assert.ok(sent);
    assert.deepEqual(Object.keys(sent).sort(), ['candidates', 'normalizedKey', 'productName', 'unit']);
    assert.equal(sent.unit, 'kg');
  });
});

/** Two base codes in a photo finish: lexical 0.80 vs 0.79, nothing else retrieved. */
class RaceStore extends FakeStore {
  constructor(private readonly race: MxikCandidate[]) { super(race); }
  override byLexical(): Promise<{ candidate: MxikCandidate; score: number }[]> {
    return Promise.resolve(this.race.map((candidate, i) => ({ candidate, score: 0.8 - i * 0.01 })));
  }
  override byFullText(): Promise<{ candidate: MxikCandidate; score: number }[]> { return Promise.resolve([]); }
  override byVector(): Promise<{ candidate: MxikCandidate; score: number }[]> { return Promise.resolve([]); }
}

describe('margin shaping', () => {
  const LEADER = '01901001003000000';
  const RUNNER_UP = '01901001004000000';
  const race = [candidate(LEADER, 'guruch oq'), candidate(RUNNER_UP, 'guruch qizil')];

  it('never lets the runner-up of a close race overtake the leader into the high band', async () => {
    // Regression: the leader was shaped with its tiny margin while #2 was shaped
    // as if unopposed, so #2 came out on top at ~0.92 (bulk-acceptable).
    const reranker = new StubReranker([
      { code: LEADER, confidence: 0.9, reason: 'fits' },
      { code: RUNNER_UP, confidence: 0.88, reason: 'also fits' },
    ]);
    const r = await matchProduct({ rawName: 'guruch' }, { store: new RaceStore(race), embedder, reranker });
    assert.equal(r.candidates[0]?.candidate.code, LEADER);
    assert.ok((r.candidates[0]?.confidence ?? 0) >= (r.candidates[1]?.confidence ?? 1));
    for (const c of r.candidates) assert.notEqual(c.band, 'high', `${c.candidate.code} at ${c.confidence}`);
    assert.equal(r.candidates[0]?.ranks.fusion, 1);
  });

  it('keeps the leader first without a reranker too', async () => {
    const r = await matchProduct({ rawName: 'guruch' }, { store: new RaceStore(race), embedder, reranker: noop });
    assert.equal(r.candidates[0]?.candidate.code, LEADER);
    assert.deepEqual(r.pool, [LEADER, RUNNER_UP]);
  });
});

/** Rejects every candidate it is shown, as the model's "none" answer does. */
class NoneReranker implements RerankProvider {
  readonly name = 'none';
  readonly available = true;
  rerank(request: RerankRequest): Promise<RerankVerdict[]> {
    return Promise.resolve(request.candidates.map((c) => ({ code: c.code, confidence: 0, reason: NONE_REASON })));
  }
}

class CountingEmbedder extends HashingEmbeddingProvider {
  calls = 0;
  override embed(texts: readonly string[]): Promise<number[][]> {
    this.calls++;
    return super.embed(texts);
  }
}

describe('stage outcomes and the veto', () => {
  it('returns the veto on the result instead of silently emptying it', async () => {
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder, reranker: new NoneReranker() });
    assert.equal(r.rerank, 'none');
    assert.deepEqual(r.candidates, []);
    assert.equal(r.decidedBy, 'none');
    assert.ok(r.veto && r.veto.offered.length > 0);
    assert.ok(r.notes.some((n) => n.includes('no candidate fits')));
    assert.ok(!r.notes.some((n) => n.includes('unrelated')), 'a veto is not an unrelated-candidate filter');
  });

  it('reports what stage 6 did for each kind of row', async () => {
    const store = new FakeStore(ROWS);
    assert.equal((await matchProduct({ rawName: 'Kartoshka' }, { store, embedder, reranker: noop })).rerank, 'not_needed');
    assert.equal((await matchProduct({ rawName: 'guruch' }, { store, embedder, reranker: noop })).rerank, 'off');
    assert.equal((await matchProduct({ rawName: 'guruch' }, { store, embedder, reranker: new ThrowingReranker() })).rerank, 'failed');
    const skipped = await matchProduct({ rawName: 'guruch' }, { store, embedder, reranker: new RecordingReranker(), rerankGate: { minConfidence: 0, minMargin: 0 } });
    assert.equal(skipped.rerank, 'skipped');
    const ranked = await matchProduct({ rawName: 'guruch' }, {
      store, embedder, reranker: new StubReranker([{ code: '01901001003000000', confidence: 0.9, reason: 'fits' }]),
    });
    assert.equal(ranked.rerank, 'ranked');
    assert.equal(ranked.veto, null);
  });

  it('computes no query embedding when the vector stage is switched off', async () => {
    const counting = new CountingEmbedder();
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder: counting, reranker: noop, disabledStages: new Set(['vector']) });
    assert.equal(counting.calls, 0);
    assert.equal(r.vector, 'off');
    assert.ok(r.candidates.length > 0);
    assert.ok(!r.notes.some((n) => n.includes('not semantic')), 'an unused embedder is not worth a warning');
  });

  it('marks a failed vector stage on the result', async () => {
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder: new FailingEmbedder(), reranker: noop });
    assert.equal(r.vector, 'failed');
  });

  it('stores the rule keys that shaped a candidate in its evidence', async () => {
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder, reranker: noop });
    const base = r.candidates.find((c) => c.candidate.code === '01901001003000000');
    assert.deepEqual(base?.evidence.rules, ['baseCodePreferred']);
    const unmarked = r.candidates.find((c) => c.candidate.code === '01901001003002001');
    assert.deepEqual(unmarked?.evidence.rules, ['identifyingUnmarked']);
  });
});

describe('barcode identity', () => {
  const restricted = candidate('04501001001000000', 'tarozi mahsuloti', { barcode: '02000000000015' });

  it('treats an in-store (restricted-circulation) barcode as no identity and matches by name', async () => {
    const store = new FakeStore([...ROWS, restricted]);
    const r = await matchProduct({ rawName: 'Kartoshka', barcode: '2000000000015' }, { store, embedder, reranker: noop });
    assert.notEqual(r.decidedBy, 'barcode');
    assert.ok(!store.calls.includes('byBarcode'));
    assert.ok(r.notes.some((n) => n.includes('restricted-circulation')));
    assert.equal(r.candidates[0]?.candidate.code, '00701001001000000');
  });

  it('ignores a barcode whose check digit is wrong', async () => {
    const store = new FakeStore(ROWS);
    const r = await matchProduct({ rawName: 'Kartoshka', barcode: '4601501483582' }, { store, embedder, reranker: noop });
    assert.notEqual(r.decidedBy, 'barcode');
    assert.ok(!store.calls.includes('byBarcode'));
    assert.ok(r.notes.some((n) => n.includes('check digit')));
  });
});

describe('firm dictionary against the barcode', () => {
  const GURUCH = '01901001003000000';
  const PIVO = '02202004002001001';
  const lookup = (entry: DictionaryEntry): DictionaryLookup => ({ find: () => entry });

  it('keeps the barcode identity first when a name-keyed entry disagrees, and flags it', async () => {
    const dictionary = lookup({ id: 'm1', code: GURUCH, uses: 4, kind: 'name', confirmations: 2 });
    const r = await matchProduct({ rawName: 'pivo', barcode: '4601501483581' }, { store: new FakeStore(ROWS), embedder, reranker: noop, dictionary });
    assert.equal(r.decidedBy, 'barcode');
    assert.equal(r.candidates[0]?.candidate.code, PIVO);
    assert.equal(r.candidates[0]?.evidence.dictionaryConflict, GURUCH);
    assert.equal(r.candidates[1]?.candidate.code, GURUCH);
    assert.equal(r.candidates[1]?.stage, 'dictionary');
  });

  it('still puts a barcode-keyed entry first: the firm decided for this very barcode', async () => {
    const dictionary = lookup({ id: 'm2', code: GURUCH, uses: 1, kind: 'barcode', confirmations: 1 });
    const r = await matchProduct({ rawName: 'pivo', barcode: '4601501483581' }, { store: new FakeStore(ROWS), embedder, reranker: noop, dictionary });
    assert.equal(r.decidedBy, 'dictionary');
    assert.equal(r.candidates[0]?.candidate.code, GURUCH);
  });

  it('carries confirmations, not uses, into the dictionary evidence', async () => {
    const dictionary = lookup({ id: 'm3', code: GURUCH, uses: 9, kind: 'name', confirmations: 0 });
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder, reranker: noop, dictionary });
    assert.equal(r.decidedBy, 'dictionary');
    assert.equal(r.rerank, 'not_needed');
    assert.equal(r.candidates[0]?.evidence.dictionaryConfirmations, 0);
    assert.equal(r.candidates[0]?.evidence.dictionaryUses, 9);
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
