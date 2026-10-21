// Local multilingual sentence embeddings on CPU (transformers.js / ONNX).
// No API key, no per-call cost, and no product name leaves the server. The
// weights are downloaded once from the Hugging Face hub into LOCAL_MODEL_DIR.
import { availableParallelism } from 'node:os';
import type { EmbeddingProvider } from '../match/types.js';
import type { EmbedRole, TextShape } from './text.js';

export type LocalModel = {
  /** Hugging Face model id. */
  id: string;
  /** Text prepended to each input by role, as the model card prescribes. */
  prefix: Record<EmbedRole, string>;
  /** What text the vectors are made from (text.ts). */
  textShape: TextShape;
  /**
   * Told apart in the provider name (and so in embedding_state) when the same
   * weights embed a different text shape: vectors of two shapes must never be
   * compared. Absent for the shape the model was first stored with.
   */
  variant?: string;
};

/**
 * All emit 384 dimensions, the size the schema pins. e5 is asymmetric: rows are
 * queries, classifier names are passages ("query: " / "passage: ", model card).
 */
export const LOCAL_MODELS: Record<string, LocalModel> = {
  'multilingual-e5-small': {
    id: 'Xenova/multilingual-e5-small', prefix: { query: 'query: ', passage: 'passage: ' }, textShape: 'natural', variant: 'natural-v2',
  },
  // The shape stored until 2026-10-22: folded text, "query: " on both sides. Kept
  // so a database embedded that way is still queried the same way until re-embedded.
  'multilingual-e5-small-folded': {
    id: 'Xenova/multilingual-e5-small', prefix: { query: 'query: ', passage: 'query: ' }, textShape: 'folded',
  },
  'paraphrase-multilingual-minilm': {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', prefix: { query: '', passage: '' }, textShape: 'folded',
  },
};

/** The provider name a model is stored under in embedding_state. */
export const localModelName = (model: LocalModel): string => `local:${model.id}${model.variant ? `#${model.variant}` : ''}`;

export const DEFAULT_LOCAL_MODEL = 'multilingual-e5-small';

/**
 * LOCAL_EMBED_THREADS, else 4: on a 16-thread CPU, 4 threads ran fp32 at
 * 46 texts/s and 8 at 27 (oversubscription), so more is not faster.
 */
export function embedThreads(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env['LOCAL_EMBED_THREADS']);
  return Number.isInteger(n) && n > 0 ? n : Math.min(4, availableParallelism());
}

/**
 * Where inference runs. cpu everywhere by default; dml (DirectML, Windows GPU)
 * is ~8x faster for a backfill and gives the same vectors within float noise.
 */
function embedDevice(env: Record<string, string | undefined> = process.env): 'cpu' | 'dml' | 'webgpu' {
  const d = env['LOCAL_EMBED_DEVICE']?.trim();
  return d === 'dml' || d === 'webgpu' ? d : 'cpu';
}

type Extractor = (texts: string[], options: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;
  readonly semantic = true;
  readonly name: string;
  readonly textShape: TextShape;
  private extractor: Promise<Extractor> | null = null;

  constructor(
    private readonly model: LocalModel,
    private readonly cacheDir = process.env['LOCAL_MODEL_DIR']?.trim() || 'data/models',
    private readonly batchSize = 64,
  ) {
    this.name = localModelName(model);
    this.textShape = model.textShape;
  }

  /** Loaded on first use, so importing this module costs nothing. */
  private load(): Promise<Extractor> {
    this.extractor ??= import('@huggingface/transformers').then(async ({ env, pipeline }) => {
      env.cacheDir = this.cacheDir;
      const device = embedDevice();
      const extractor: Extractor = await pipeline('feature-extraction', this.model.id, {
        // fp32 everywhere, so stored and query vectors come from the same
        // weights (int8 differs by ~0.005 in cosine).
        dtype: 'fp32',
        device,
        ...(device === 'cpu' ? { session_options: { intraOpNumThreads: embedThreads() } } : {}),
      });
      return extractor;
    });
    return this.extractor;
  }

  async embed(texts: readonly string[], role: EmbedRole = 'query'): Promise<number[][]> {
    const extract = await this.load();
    const prefix = this.model.prefix[role];
    // A batch is padded to its longest text, and classifier names range from
    // two words to a paragraph: batch similar lengths together, then restore order.
    const order = texts.map((_, i) => i).sort((a, b) => (texts[a]?.length ?? 0) - (texts[b]?.length ?? 0));
    const out = new Array<number[]>(texts.length);
    for (let i = 0; i < order.length; i += this.batchSize) {
      const slice = order.slice(i, i + this.batchSize);
      const tensor = await extract(slice.map((j) => prefix + (texts[j] ?? '')), { pooling: 'mean', normalize: true });
      tensor.tolist().forEach((vec, k) => {
        const j = slice[k];
        if (j !== undefined) out[j] = vec;
      });
    }
    return out;
  }
}

/** The local provider that produced a stored vector set, if it can be rebuilt here. */
export function localProviderByName(name: string): LocalEmbeddingProvider | null {
  const model = Object.values(LOCAL_MODELS).find((m) => localModelName(m) === name);
  return model ? new LocalEmbeddingProvider(model) : null;
}
