import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HashingEmbeddingProvider } from '../embed/index.js';
import type { DictionaryEntry, DictionaryLookup } from './dictionary.js';
import { matchProduct, vectorColumnsFor } from './pipeline.js';
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

  it('reports a food-service row in its notes and searches with the menu wording', async () => {
    const store = new FakeStore(ROWS);
    const r = await matchProduct({ rawName: 'Palov 1 porsiya' }, { store, embedder, reranker: noop });
    assert.ok(r.notes.some((n) => n.includes('food-service item')));
    assert.ok(r.notes.some((n) => n.includes("palov → asosiy taomlar")));
    const plain = await matchProduct({ rawName: 'Guruch 1 kg' }, { store, embedder, reranker: noop });
    assert.ok(!plain.notes.some((n) => n.includes('food-service item')));
  });

  it('reads a shop word as the cafe\'s when the row\'s own code is in the catering group', async () => {
    const store = new FakeStore(ROWS);
    const shop = await matchProduct({ rawName: 'Ko\'k choy 100 g' }, { store, embedder, reranker: noop });
    assert.ok(!shop.notes.some((n) => n.includes('food-service item')));
    const cafe = await matchProduct({ rawName: 'Ko\'k choy 100 g', existingMxik: '10202001010000001' }, { store, embedder, reranker: noop });
    assert.ok(cafe.notes.some((n) => n.includes('food-service item')));
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
  it('keeps retrieval order, capped and marked, when the reranker finds no fit', async () => {
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder, reranker: new NoneReranker() });
    const plain = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder, reranker: noop });
    assert.equal(r.rerank, 'none');
    assert.deepEqual(r.candidates.map((c) => c.candidate.code), plain.candidates.map((c) => c.candidate.code));
    assert.ok(r.candidates.length > 0);
    assert.ok(r.candidates.every((c) => c.confidence <= NO_RERANK_CEILING && c.band !== 'high' && c.stage !== 'rerank'));
    assert.ok(r.candidates.every((c) => c.evidence.rerankNone && c.evidence.rerankReason === null));
    assert.equal(r.decidedBy, 'fusion');
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

describe('ranking options (plan §3.2, §5)', () => {
  it('adds a position signal only when position fusion is switched on', async () => {
    const off = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder, reranker: noop });
    assert.ok(off.candidates.every((c) => c.signals.positionRrf === undefined));
    const on = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder, reranker: noop, positionFusion: 'subposition' });
    assert.ok(on.candidates.length > 0);
    assert.ok(on.candidates.every((c) => typeof c.signals.positionRrf === 'number'));
    // Both guruch codes share subposition 01901001003, the position every list leads with.
    assert.equal(on.candidates.find((c) => c.candidate.code === '01901001003000000')?.signals.positionRrf, 1);
  });

  it('lets a non-semantic stand-in into fusion at a reduced weight, never as a score', async () => {
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder, reranker: noop, nonSemanticVectorWeight: 0.5 });
    assert.ok(r.candidates.every((c) => c.signals.vector === undefined));
    assert.ok(r.notes.some((n) => n.includes('weight 0.5')));
  });

  it('skips the stand-in entirely at weight 0, embedding nothing', async () => {
    const counting = new CountingEmbedder();
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder: counting, reranker: noop, nonSemanticVectorWeight: 0 });
    assert.equal(counting.calls, 0);
    assert.equal(r.vector, 'off');
    assert.ok(r.candidates.length > 0);
  });

  it('leaves a semantic embedder untouched by the stand-in setting', async () => {
    const semantic: EmbeddingProvider = { name: 'semantic test', dimensions: 384, semantic: true, embed: (t) => embedder.embed(t) };
    const r = await matchProduct({ rawName: 'guruch' }, { store: new FakeStore(ROWS), embedder: semantic, reranker: noop, nonSemanticVectorWeight: 0 });
    assert.equal(r.vector, 'used');
    assert.ok(r.candidates.some((c) => c.signals.vector !== undefined));
  });
});

describe('semantic vector stage (plan §5, 2026-10-22)', () => {
  /** A semantic embedder that records what it was asked to embed. */
  class RecordingEmbedder implements EmbeddingProvider {
    readonly name = 'semantic recorder';
    readonly dimensions = 384;
    readonly semantic = true;
    readonly textShape = 'natural' as const;
    calls: { texts: readonly string[]; role: string | undefined }[] = [];
    embed(texts: readonly string[], role?: 'query' | 'passage'): Promise<number[][]> {
      this.calls.push({ texts, role });
      return Promise.resolve(texts.map(() => new Array<number>(384).fill(0.05)));
    }
  }
  /** Answers each column with its own hits and cosines, and records which were asked. */
  class ColumnStore extends FakeStore {
    asked: (string | undefined)[] = [];
    override byVector(_e: readonly number[], limit: number, column?: 'uz' | 'ru') {
      this.asked.push(column);
      const rows = column === 'ru' ? ROWS.slice(0, 2) : ROWS.slice(2);
      return Promise.resolve(rows.slice(0, limit).map((r, i) => ({ candidate: r, score: 0.95, cosine: 0.9 - i * 0.05 })));
    }
  }

  it('embeds the row as natural text in the query role', async () => {
    const e = new RecordingEmbedder();
    await matchProduct({ rawName: 'Трубы эл/св 57х3,0' }, { store: new ColumnStore(ROWS), embedder: e, reranker: noop });
    assert.equal(e.calls[0]?.role, 'query');
    assert.match(e.calls[0]?.texts[0] ?? '', /^Трубы электросварные/);
  });

  it('searches the column of the row script when it is filled, both for a mixed name', async () => {
    const cyr = new ColumnStore(ROWS);
    await matchProduct({ rawName: 'Гуруч' }, { store: cyr, embedder: new RecordingEmbedder(), reranker: noop, vectorColumns: ['uz', 'ru'] });
    assert.deepEqual(cyr.asked, ['ru']);
    const lat = new ColumnStore(ROWS);
    await matchProduct({ rawName: 'guruch' }, { store: lat, embedder: new RecordingEmbedder(), reranker: noop, vectorColumns: ['uz', 'ru'] });
    assert.deepEqual(lat.asked, ['uz']);
    const mixed = new ColumnStore(ROWS);
    await matchProduct({ rawName: 'Guruch гуруч' }, { store: mixed, embedder: new RecordingEmbedder(), reranker: noop, vectorColumns: ['uz', 'ru'] });
    assert.deepEqual([...mixed.asked].sort(), ['ru', 'uz']);
    const onlyUz = new ColumnStore(ROWS);
    await matchProduct({ rawName: 'Гуруч' }, { store: onlyUz, embedder: new RecordingEmbedder(), reranker: noop });
    assert.deepEqual(onlyUz.asked, ['uz']);
  });

  it('scores a semantic cosine on its calibrated band, and the old way on request', async () => {
    const opts = { store: new ColumnStore(ROWS), embedder: new RecordingEmbedder(), reranker: noop, vectorColumns: ['uz'] as const };
    // Not an exact name, so the row is ranked, not settled by stage 2.
    const calibrated = await matchProduct({ rawName: 'kartoshka yangi' }, { ...opts, vectorCalibration: { floor: 0.8, ceil: 0.95 } });
    const potato = calibrated.candidates.find((c) => c.candidate.code === '00701001001000000');
    // Second uz hit: cosine 0.85 on the 0.80..0.95 band is a third of it.
    assert.ok(Math.abs((potato?.signals.vector ?? 0) - (0.05 / 0.15)) < 1e-9);
    const legacy = await matchProduct({ rawName: 'kartoshka yangi' }, { ...opts, vectorCalibration: null });
    assert.equal(legacy.candidates.find((c) => c.candidate.code === '00701001001000000')?.signals.vector, 0.95);
  });
});

describe('vectorColumnsFor', () => {
  it('falls back to the filled columns, and to uz when nothing is recorded', () => {
    assert.deepEqual(vectorColumnsFor('cyrillic', ['uz']), ['uz']);
    assert.deepEqual(vectorColumnsFor('neither', ['uz', 'ru']), ['uz', 'ru']);
    assert.deepEqual(vectorColumnsFor('latin', []), ['uz']);
  });
});

/** A fake that can limit retrieval to a code prefix, like PostgresCandidateStore.withinPrefix. */
class PrefixStore extends FakeStore {
  prefixes: string[] = [];
  constructor(private readonly all: MxikCandidate[]) {
    super(all);
  }
  withinPrefix(prefix: string): CandidateStore {
    this.prefixes.push(prefix);
    return new FakeStore(this.all.filter((r) => r.code.startsWith(prefix)));
  }
}

const PIPES = [
  candidate('07304001001000000', 'truba besshovnaya'),
  candidate('07306001001000000', 'truba elektrosvarnaya', { barcode: '04780000000014' }),
  candidate('03917001001000000', 'truba plastmassovaya'),
];

describe('matchProduct with a TN VED code', () => {
  it('limits retrieval to the heading and records it on every candidate', async () => {
    const store = new PrefixStore(PIPES);
    const r = await matchProduct({ rawName: 'Truba 57', tnved: '7304390000' }, { store, embedder, reranker: noop });
    assert.deepEqual(store.prefixes, ['07304']);
    assert.equal(r.tnved, 'restricted');
    assert.ok(r.candidates.length > 0);
    for (const c of r.candidates) {
      assert.ok(c.candidate.code.startsWith('07304'), c.candidate.code);
      assert.equal(c.evidence.tnvedHeading, '7304');
      assert.equal(c.evidence.tnvedOutside, undefined);
    }
    assert.ok(r.notes.some((n) => n.includes('limited to TN VED heading 7304')));
    // The barcode-free row never asked the whole classifier for names.
    assert.ok(!store.calls.includes('byLexical'));
  });

  it('the same name under another heading gets that heading\'s code', async () => {
    const r = await matchProduct({ rawName: 'Truba 57', tnved: '3917230000' }, { store: new PrefixStore(PIPES), embedder, reranker: noop });
    assert.equal(r.candidates[0]?.candidate.code, '03917001001000000');
  });

  it('a name equal to a code outside the heading is not settled by the exact stage', async () => {
    const r = await matchProduct({ rawName: 'truba elektrosvarnaya', tnved: '7304' }, { store: new PrefixStore(PIPES), embedder, reranker: noop });
    assert.notEqual(r.decidedBy, 'exact');
    assert.equal(r.candidates[0]?.candidate.code, '07304001001000000');
  });

  it('falls back to the whole classifier when the heading has nothing, and says so', async () => {
    const store = new PrefixStore(PIPES);
    const r = await matchProduct({ rawName: 'Truba 57', tnved: '8471300000' }, { store, embedder, reranker: noop });
    assert.equal(r.tnved, 'fallback');
    assert.ok(r.candidates.length > 0);
    assert.match(r.notes[0] ?? '', /^TN VED heading 8471: no code of the heading was retrieved/);
    for (const c of r.candidates) {
      assert.equal(c.evidence.tnvedHeading, '8471');
      assert.equal(c.evidence.tnvedFallback, true);
      assert.equal(c.evidence.tnvedOutside, true);
    }
    // The result still describes the row as it came in.
    assert.equal(r.input.tnved, '8471300000');
  });

  it('keeps a barcode identity outside the heading, flagged as outside', async () => {
    const r = await matchProduct(
      { rawName: 'Truba', barcode: '4780000000014', tnved: '7304' },
      { store: new PrefixStore(PIPES), embedder, reranker: noop },
    );
    assert.equal(r.decidedBy, 'barcode');
    assert.equal(r.candidates[0]?.candidate.code, '07306001001000000');
    assert.equal(r.candidates[0]?.evidence.tnvedOutside, true);
  });

  it('records that the row\'s own code lies outside the heading', async () => {
    const r = await matchProduct(
      { rawName: 'Truba 57', tnved: '7304', existingMxik: '07306001001000000' },
      { store: new PrefixStore(PIPES), embedder, reranker: noop },
    );
    assert.equal(r.candidates[0]?.evidence.tnvedExistingOutside, true);
    const inside = await matchProduct(
      { rawName: 'Truba 57', tnved: '7304', existingMxik: '07304001001000000' },
      { store: new PrefixStore(PIPES), embedder, reranker: noop },
    );
    assert.equal(inside.candidates[0]?.evidence.tnvedExistingOutside, undefined);
  });

  it('ignores an unreadable code, and only records the heading when the store cannot limit', async () => {
    const bad = new PrefixStore(PIPES);
    const r = await matchProduct({ rawName: 'Truba 57', tnved: '73' }, { store: bad, embedder, reranker: noop });
    assert.equal(r.tnved, 'invalid');
    assert.deepEqual(bad.prefixes, []);
    assert.ok(r.notes.some((n) => n.includes('"73" is not a 4-10 digit HS code')));
    assert.equal(r.candidates[0]?.evidence.tnvedHeading, undefined);

    const plain = await matchProduct({ rawName: 'Truba 57', tnved: '7304' }, { store: new FakeStore(PIPES), embedder, reranker: noop });
    assert.equal(plain.tnved, 'unscoped');
    assert.equal(plain.candidates[0]?.evidence.tnvedHeading, '7304');
  });

  it('changes nothing for a row without one', async () => {
    const store = new PrefixStore(PIPES);
    const r = await matchProduct({ rawName: 'Truba 57' }, { store, embedder, reranker: noop });
    assert.equal(r.tnved, 'none');
    assert.deepEqual(store.prefixes, []);
    assert.ok(r.candidates.every((c) => c.evidence.tnvedHeading === undefined));
  });
});

describe('identifying codes and the reranker pool (plan T2)', () => {
  const PIPES = [
    candidate('07306001005015618', 'truba vodogazoprovodnaya: diametr 15 mm, devor 2,5 mm', { attributeName: 'diametr 15 mm, devor 2,5 mm' }),
    candidate('07306001005000000', 'truba vodogazoprovodnaya shovli'),
    candidate('07306001005003162', 'truba vodogazoprovodnaya: 3, diametr 100 mm, devor 4,6 mm', { brandName: '3', attributeName: 'diametr 100 mm, devor 4,6 mm' }),
  ];
  /** Three sizes of one pipe a lexical search cannot tell apart: the rules decide. */
  class PipeStore extends FakeStore {
    override byLexical(query: string, limit: number): Promise<{ candidate: MxikCandidate; score: number }[]> {
      return super.byLexical(query, limit).then((hits) => hits.map((h, i) => ({ ...h, score: 0.8 - i * 0.01 })));
    }
  }

  it('ranks the identifying code the name earns above the base code, still below the high band', async () => {
    const r = await matchProduct({ rawName: 'Труба ВГП 15х2,5' }, { store: new PipeStore(PIPES), embedder, reranker: noop });
    const top = r.candidates[0];
    assert.equal(top?.candidate.code, '07306001005015618');
    assert.deepEqual(top?.evidence.identifyingMatchedTokens, ['15х2,5']);
    assert.ok(top?.evidence.rules?.includes('identifyingPreferred'));
    for (const c of r.candidates) assert.ok(c.confidence <= NO_RERANK_CEILING && c.band !== 'high');
  });

  it('keeps the base code first for a generic name, and when the rule is switched off', async () => {
    const generic = await matchProduct({ rawName: 'Труба ВГП' }, { store: new PipeStore(PIPES), embedder, reranker: noop });
    assert.equal(generic.candidates[0]?.candidate.code, '07306001005000000');
    const off = await matchProduct({ rawName: 'Труба ВГП 15х2,5' }, { store: new PipeStore(PIPES), embedder, reranker: noop, identifyingRule: false });
    assert.equal(off.candidates[0]?.candidate.code, '07306001005000000');
  });

  it('lifts the ceiling only once the reranker scores the identifying code', async () => {
    const reranker = new StubReranker([{ code: '07306001005015618', confidence: 1, reason: '15 mm, 2,5 mm' }]);
    const r = await matchProduct({ rawName: 'Труба ВГП 15х2,5' }, { store: new PipeStore(PIPES), embedder, reranker });
    assert.equal(r.candidates[0]?.candidate.code, '07306001005015618');
    assert.ok((r.candidates[0]?.confidence ?? 0) > NO_RERANK_CEILING);
    assert.ok(r.candidates.slice(1).every((c) => c.confidence <= NO_RERANK_CEILING));
  });

  it('adds a branded code only the identifying query finds to the pool', async () => {
    const drinks = [
      candidate('02202002001092003', 'koka kola pet butilka 1,5 l', { brandName: 'Bagca Saray', attributeName: 'Koka kola, PET butilka 1,5 l', isMarked: true }),
      candidate('02202002001010009', 'alkogolsiz ichimliklar: coca-cola, shirin, pet butilka 1,5 l.', { brandName: 'COCA-COLA', attributeName: 'shirin, PET butilka 1,5 l.', isMarked: true }),
    ];
    class BrandStore extends FakeStore {
      override byFullText(query: string, limit: number): Promise<{ candidate: MxikCandidate; score: number }[]> {
        // The Latin spelling only the identifying query carries.
        if (query.includes('coca')) return Promise.resolve([{ candidate: drinks[1]!, score: 0.9 }]);
        return super.byFullText(query, limit);
      }
    }
    const opts = { embedder, reranker: noop, disabledStages: new Set(['vector'] as const) };
    const r = await matchProduct({ rawName: 'Кока-Кола 1,5л пэт' }, { ...opts, store: new BrandStore(drinks) });
    assert.ok(r.pool.includes('02202002001010009'));
    assert.deepEqual(r.candidates.find((c) => c.candidate.code === '02202002001010009')?.evidence.identifyingMatchedTokens, ['COCA-COLA', '1,5л']);
    const without = await matchProduct({ rawName: 'Кока-Кола 1,5л пэт' }, { ...opts, store: new BrandStore(drinks), identifyingRetrieval: false });
    assert.ok(!without.pool.includes('02202002001010009'));
  });

  it('describes the pool and caps it per subposition on request', async () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => candidate(`0730600100500000${i + 1}`, `truba ${i + 1}`)),
      candidate('07306001006000001', 'truba other'),
    ];
    const plain = await matchProduct({ rawName: 'truba' }, { store: new FakeStore(many), embedder, reranker: noop });
    assert.ok(plain.notes.some((n) => n.startsWith('Rerank pool: 7 codes in 2 subpositions (07306001005 ×6, 07306001006)')));
    const capped = await matchProduct({ rawName: 'truba' }, { store: new FakeStore(many), embedder, reranker: noop, poolPerPosition: 3 });
    assert.equal(capped.pool.filter((c) => c.startsWith('07306001005')).length, 3);
    assert.ok(capped.pool.includes('07306001006000001'));
    assert.ok(capped.notes.some((n) => n.includes('3 left out over the per-subposition cap')));
  });
});
