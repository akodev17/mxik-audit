// The matching setup a worker reuses across audits and doc checks: one embedding provider (a local
// model loads its weights once, not per audit), next to audit-runner's one classifier pg pool. The
// rest of an audit context (the org's dictionary, its rerank cache, vector readiness) is per org and
// changes with decisions, re-embeds and classifier updates, so auditContext() still builds it per run.
// The API process installs the same source (apps/api/src/matching/embedder.service.ts).
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { keptEmbedders, useEmbedderSource } from '@tasnivo/domain/audit-runner';

@Injectable()
export class AuditContextService implements OnModuleInit {
  private readonly log = new Logger('AuditContextService');
  /** Providers by name: readiness may settle on a local model rebuilt from the stored vectors' name. */
  private readonly source = keptEmbedders();

  onModuleInit(): void {
    useEmbedderSource(this.source);
    this.log.log({ msg: 'embedding provider shared for this process', provider: this.source.configured().name });
  }

  /** Embedders kept so far, for /healthz. */
  embedders(): string[] {
    return this.source.names();
  }
}
