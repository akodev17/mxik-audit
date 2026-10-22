// The "pick another code" search for this API process: one candidate store on the injected pg pool,
// with the process's shared embedding provider (sharedEmbeddingProvider: a local model is built once
// and only loads its weights if something embeds, which the lexical and full-text search never does).
// Built on first use, so the API boots without the classifier; refreshed now and then because vector
// readiness changes with re-embeds and classifier updates.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sharedEmbeddingProvider } from '@tasnivo/core/embed/index';
import { classifierSearchStore, searchClassifierIn } from '@tasnivo/domain/audit-runner';
import type { ClassifierSearch } from '@tasnivo/domain/code-lookup';
import { PgPoolService } from '../db/pg-pool.service';
import { ApiError } from '../http/errors';

type Store = Awaited<ReturnType<typeof classifierSearchStore>>;

/** How long one store (and its vector readiness) is reused before it is set up again. */
export const STORE_TTL_MS = 5 * 60_000;

@Injectable()
export class ClassifierSearchService {
  private readonly log = new Logger('ClassifierSearchService');
  private store: { at: number; value: Promise<Store> } | null = null;

  constructor(@Inject(PgPoolService) private readonly pg: PgPoolService) {}

  /** The classifier search the domain's lookupCodes takes. */
  readonly search: ClassifierSearch = async (query, limit) => searchClassifierIn(await this.candidateStore(), query, limit);

  private async candidateStore(now = Date.now()): Promise<Store> {
    if (!this.store || now - this.store.at > STORE_TTL_MS) this.store = { at: now, value: this.setUp() };
    try {
      return await this.store.value;
    } catch (error) {
      // Not kept: the next request tries again (a classifier load or a migration may be under way).
      this.store = null;
      this.log.warn({ msg: 'classifier search unavailable', error: error instanceof Error ? error.message : String(error) });
      throw new ApiError(503, 'classifier_unavailable', 'The classifier is not loaded yet; try again in a few minutes.');
    }
  }

  private async setUp(): Promise<Store> {
    const loaded = await this.pg.pool.query('SELECT 1 FROM mxik_code WHERE "retiredAt" IS NULL LIMIT 1');
    if (loaded.rowCount === 0) throw new Error('no live classifier codes');
    return classifierSearchStore(this.pg.pool, sharedEmbeddingProvider());
  }
}
