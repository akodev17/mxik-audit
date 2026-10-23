// One embedding provider for the API process (Q1). /api/v1/check, and inline audits and doc checks
// when JOBS_MODE is not bullmq, run the matching pipeline in this process; without a shared source
// audit-runner builds a fresh provider per call, so a local model loaded its ~470 MB of weights per
// check and a burst of checks ran the process out of memory. Same rule as the worker's
// AuditContextService: one provider per name for the process's life.
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { keptEmbedders, useEmbedderSource, type KeptEmbedders } from '@tasnivo/domain/audit-runner';

@Injectable()
export class EmbedderService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('EmbedderService');
  private source: KeptEmbedders | null = null;

  onModuleInit(): void {
    this.source = keptEmbedders();
    useEmbedderSource(this.source);
    this.log.log({ msg: 'embedding provider shared for this process', provider: this.source.configured().name });
  }

  onModuleDestroy(): void {
    useEmbedderSource(null);
    this.source = null;
  }

  /** Providers kept so far, by name. */
  embedders(): string[] {
    return this.source?.names() ?? [];
  }
}
