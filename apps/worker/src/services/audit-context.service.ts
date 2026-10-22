// The matching setup a worker reuses across audits and doc checks: one embedding provider (a local
// model loads its weights once, not per audit), next to audit-runner's one classifier pg pool. The
// rest of an audit context (the org's dictionary, its rerank cache, vector readiness) is per org and
// changes with decisions, re-embeds and classifier updates, so auditContext() still builds it per run.
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sharedEmbeddingProvider } from '@tasnivo/core/embed/index';
import type { EmbeddingProvider } from '@tasnivo/core/match/types';
import { useEmbedderSource } from '@tasnivo/domain/audit-runner';

@Injectable()
export class AuditContextService implements OnModuleInit {
  private readonly log = new Logger('AuditContextService');
  /** Providers by name: readiness may settle on a local model rebuilt from the stored vectors' name. */
  private readonly byName = new Map<string, EmbeddingProvider>();

  onModuleInit(): void {
    useEmbedderSource({
      configured: () => this.keep(sharedEmbeddingProvider()),
      reuse: (embedder) => this.keep(embedder),
    });
    this.log.log({ msg: 'embedding provider shared for this process', provider: sharedEmbeddingProvider().name });
  }

  /** The first provider seen under a name stays; later equal ones are dropped for it. */
  keep(embedder: EmbeddingProvider): EmbeddingProvider {
    const kept = this.byName.get(embedder.name);
    if (kept) return kept;
    this.byName.set(embedder.name, embedder);
    return embedder;
  }

  /** Embedders kept so far, for /healthz. */
  embedders(): string[] {
    return [...this.byName.keys()];
  }
}
