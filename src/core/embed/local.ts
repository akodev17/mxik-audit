// Local multilingual sentence embeddings on CPU (transformers.js / ONNX).
// No API key, no per-call cost, and no product name leaves the server. The
// weights are downloaded once from the Hugging Face hub into LOCAL_MODEL_DIR.
import { availableParallelism } from 'node:os';
import type { EmbeddingProvider } from '../match/types.js';

export type LocalModel = {
  /** Hugging Face model id. */
  id: string;
  /** Text prepended to every input, as the model card prescribes. */
  prefix: string;
};

/** Both emit 384 dimensions, the size the schema pins. */
export const LOCAL_MODELS: Record<string, LocalModel> = {
  'multilingual-e5-small': { id: 'Xenova/multilingual-e5-small', prefix: 'query: ' },
  'paraphrase-multilingual-minilm': { id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', prefix: '' },
};

export const DEFAULT_LOCAL_MODEL = 'multilingual-e5-small';

/** LOCAL_EMBED_THREADS, else half the logical CPUs (leaves room for Postgres and the web server). */
export function embedThreads(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env['LOCAL_EMBED_THREADS']);
  return Number.isInteger(n) && n > 0 ? n : Math.max(1, Math.floor(availableParallelism() / 2));
}

type Extractor = (texts: string[], options: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;
  readonly semantic = true;
  readonly name: string;
  private extractor: Promise<Extractor> | null = null;

  constructor(
    private readonly model: LocalModel,
    private readonly cacheDir = process.env['LOCAL_MODEL_DIR']?.trim() || 'data/models',
    private readonly batchSize = 64,
  ) {
    this.name = `local:${model.id}`;
  }

  /** Loaded on first use, so importing this module costs nothing. */
  private load(): Promise<Extractor> {
    this.extractor ??= import('@huggingface/transformers').then(async ({ env, pipeline }) => {
      env.cacheDir = this.cacheDir;
      const extractor: Extractor = await pipeline('feature-extraction', this.model.id, {
        dtype: 'q8',
        // ONNX Runtime's default used ~2 cores; the backfill is CPU-bound.
        session_options: { intraOpNumThreads: embedThreads() },
      });
      return extractor;
    });
    return this.extractor;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const extract = await this.load();
    // A batch is padded to its longest text, and classifier names range from
    // two words to a paragraph: batch similar lengths together, then restore order.
    const order = texts.map((_, i) => i).sort((a, b) => (texts[a]?.length ?? 0) - (texts[b]?.length ?? 0));
    const out = new Array<number[]>(texts.length);
    for (let i = 0; i < order.length; i += this.batchSize) {
      const slice = order.slice(i, i + this.batchSize);
      const tensor = await extract(slice.map((j) => this.model.prefix + (texts[j] ?? '')), { pooling: 'mean', normalize: true });
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
  const model = Object.values(LOCAL_MODELS).find((m) => `local:${m.id}` === name);
  return model ? new LocalEmbeddingProvider(model) : null;
}
