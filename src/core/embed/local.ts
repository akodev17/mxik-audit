// Local multilingual sentence embeddings on CPU (transformers.js / ONNX).
// No API key, no per-call cost, and no product name leaves the server. The
// weights are downloaded once from the Hugging Face hub into LOCAL_MODEL_DIR.
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
      const extractor: Extractor = await pipeline('feature-extraction', this.model.id, { dtype: 'q8' });
      return extractor;
    });
    return this.extractor;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const extract = await this.load();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize).map((t) => this.model.prefix + t);
      const tensor = await extract(batch, { pooling: 'mean', normalize: true });
      out.push(...tensor.tolist());
    }
    return out;
  }
}

/** The local provider that produced a stored vector set, if it can be rebuilt here. */
export function localProviderByName(name: string): LocalEmbeddingProvider | null {
  const model = Object.values(LOCAL_MODELS).find((m) => `local:${m.id}` === name);
  return model ? new LocalEmbeddingProvider(model) : null;
}
