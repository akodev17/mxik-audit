// Swappable embedding providers. The schema pins 384 dimensions, and every real
// provider here is asked to project down to it so the column never has to change.
import type { EmbeddingProvider } from '../match/types.js';

/** Only the handful of string keys these factories read. */
export type EnvLike = Record<string, string | undefined>;

export const EMBEDDING_DIMENSIONS = 384;

function l2Normalize(vector: number[]): number[] {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

/** FNV-1a, for stable bucket assignment without pulling in a hash dependency. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Local stand-in: hashes character trigrams and word tokens into a fixed vector.
 *
 * This is NOT a semantic model. It captures surface form only, so it behaves as a
 * second lexical channel rather than a true vector stage. It exists so the
 * pipeline, the fusion step and the eval harness are exercisable without network
 * credentials; `semantic` is false and the eval report says so in its output.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'hashing (local, non-semantic)';
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly semantic = false;

  embed(texts: readonly string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.embedOne(text)));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const clean = text.toLowerCase().trim();
    if (!clean) return vector;

    const bump = (bucket: number, weight: number): void => {
      vector[bucket] = (vector[bucket] ?? 0) + weight;
    };
    // Word tokens carry more signal than trigrams, so weight them higher.
    for (const token of clean.split(/\s+/)) {
      if (!token) continue;
      bump(fnv1a(`w:${token}`) % this.dimensions, 2);
    }
    const padded = ` ${clean} `;
    for (let i = 0; i < padded.length - 2; i++) {
      bump(fnv1a(`t:${padded.slice(i, i + 3)}`) % this.dimensions, 1);
    }
    return l2Normalize(vector);
  }
}

type RemoteConfig = {
  apiKey: string;
  model: string;
  endpoint: string;
  batchSize: number;
  /** In-flight requests. Re-embedding 439k rows twice is 7k requests; serial is hours. */
  concurrency: number;
};

/** Runs `fn` over `items` with a bounded number in flight, preserving order. */
async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) return;
      out[i] = await fn(item, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Splits into fixed-size batches. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** An upstream failure, tagged with whether trying again could ever help. */
export class EmbeddingRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
    this.name = 'EmbeddingRequestError';
  }
}

/**
 * Decides whether a status is worth retrying. A 429 is ambiguous: rate limiting
 * is transient, but `insufficient_quota` arrives as 429 too and will never
 * succeed — retrying it burns four attempts per batch across thousands of
 * batches for nothing.
 */
function isRetryable(status: number, body: string): boolean {
  if (status === 429) return !/insufficient_quota|billing|exceeded your current quota/i.test(body);
  if (status === 408 || status === 409) return true;
  return status >= 500;
}

/** Retries a batch on transient failures, since a long run will hit some. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // Auth, quota and bad-request failures are permanent; fail fast.
      if (error instanceof EmbeddingRequestError && !error.retryable) break;
      if (attempt === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** OpenAI-compatible embeddings, which accept a `dimensions` projection. */
class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly semantic = true;
  readonly name: string;

  constructor(private readonly config: RemoteConfig) {
    this.name = `openai:${config.model}`;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const batches = chunk(texts, this.config.batchSize);
    const results = await mapPool(batches, this.config.concurrency, (batch) => withRetry(async () => {
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ model: this.config.model, input: batch, dimensions: this.dimensions }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new EmbeddingRequestError(
          `embedding request failed: ${res.status} ${body.slice(0, 300)}`,
          res.status,
          isRetryable(res.status, body),
        );
      }
      const body = (await res.json()) as { data?: { embedding?: number[] }[] };
      const vectors = (body.data ?? []).map((row) => {
        if (!row.embedding) throw new Error('embedding response missing vector');
        return l2Normalize(row.embedding);
      });
      if (vectors.length !== batch.length) {
        throw new Error(`embedding count mismatch: asked ${batch.length}, got ${vectors.length}`);
      }
      return vectors;
    }));
    return results.flat();
  }
}

/** Voyage's multilingual model, which the brief's "multilingual default" fits. */
class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly semantic = true;
  readonly name: string;

  constructor(private readonly config: RemoteConfig) {
    this.name = `voyage:${config.model}`;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const batches = chunk(texts, this.config.batchSize);
    const results = await mapPool(batches, this.config.concurrency, (batch) => withRetry(async () => {
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model, input: batch,
          output_dimension: this.dimensions, input_type: 'document',
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new EmbeddingRequestError(
          `embedding request failed: ${res.status} ${body.slice(0, 300)}`,
          res.status,
          isRetryable(res.status, body),
        );
      }
      const body = (await res.json()) as { data?: { embedding?: number[] }[] };
      const vectors = (body.data ?? []).map((row) => {
        if (!row.embedding) throw new Error('embedding response missing vector');
        return l2Normalize(row.embedding);
      });
      if (vectors.length !== batch.length) {
        throw new Error(`embedding count mismatch: asked ${batch.length}, got ${vectors.length}`);
      }
      return vectors;
    }));
    return results.flat();
  }
}

/**
 * Picks a provider from the environment. Falls back to the local stand-in so
 * nothing in the pipeline has to branch on credential availability.
 */
export function embeddingProviderFromEnv(env: EnvLike = process.env): EmbeddingProvider {
  const requested = env['EMBEDDING_PROVIDER']?.toLowerCase();

  const voyageKey = env['VOYAGE_API_KEY'];
  if (requested !== 'hashing' && voyageKey) {
    return new VoyageEmbeddingProvider({
      apiKey: voyageKey,
      model: env['VOYAGE_MODEL'] ?? 'voyage-3',
      endpoint: 'https://api.voyageai.com/v1/embeddings',
      batchSize: 128,
      concurrency: Number(env['EMBEDDING_CONCURRENCY'] ?? '8'),
    });
  }

  const openAiKey = env['OPENAI_API_KEY'];
  if (requested !== 'hashing' && openAiKey) {
    return new OpenAiEmbeddingProvider({
      apiKey: openAiKey,
      model: env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
      endpoint: 'https://api.openai.com/v1/embeddings',
      batchSize: 256,
      concurrency: Number(env['EMBEDDING_CONCURRENCY'] ?? '8'),
    });
  }

  return new HashingEmbeddingProvider();
}
