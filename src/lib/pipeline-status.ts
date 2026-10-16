// Suggestion-engine status for operators. Shown on /admin and written to logs,
// never on customer screens: the customer sees labelled suggestions either way.
import { rerankConfigFromEnv } from '../core/match/rerank-config.js';
import { db } from './db.js';

export type StatusLine = { label: string; value: string; ok: boolean };

export async function pipelineStatus(env: NodeJS.ProcessEnv = process.env): Promise<StatusLine[]> {
  const rerank = rerankConfigFromEnv(env);
  const embedding = await db.embeddingState.findUnique({ where: { id: 1 } }).catch(() => null);
  return [
    {
      label: 'LLM qayta tartiblash (6-bosqich)',
      value: rerank.enabled ? `yoqilgan · ${rerank.model}` : `oʻchirilgan · ${rerank.disabledReason ?? ''}`,
      ok: rerank.enabled,
    },
    {
      label: 'Vektor qidiruv (4-bosqich)',
      value: embedding ? `${embedding.provider} · ${embedding.rowsEmbedded.toLocaleString('uz-UZ')} qator` : 'maʼlumot yoʻq',
      ok: embedding !== null && !embedding.provider.startsWith('rebuilding') && embedding.provider !== 'hashing',
    },
  ];
}
