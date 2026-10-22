// Reports which providers the current environment selects, without calling them.
// Run: npm run check:providers
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { embeddingProviderFromEnv } from '@tasnivo/core/embed/index';
import { rerankProviderFromEnv } from '@tasnivo/core/match/rerank';
import { rerankConfigFromEnv } from '@tasnivo/core/match/rerank-config';

const embedder = embeddingProviderFromEnv();
const reranker = rerankProviderFromEnv();
const rerank = rerankConfigFromEnv(process.env);

console.log(`embedding provider   ${embedder.name}`);
console.log(`  dimensions         ${embedder.dimensions}`);
console.log(`  semantic           ${embedder.semantic ? 'yes' : 'NO — local stand-in, stage 4 is surface-form only'}`);
console.log(`rerank provider      ${reranker.name}`);
console.log(`  available          ${reranker.available ? 'yes' : 'NO — stage 6 skipped, confidence capped at 0.85'}`);
console.log(`  endpoint           ${rerank.baseUrl}`);
console.log(`  effort / fallbacks ${rerank.effort ?? '(omitted)'} / ${rerank.fallbacks ? 'server-side default' : 'off'}`);
console.log(`  gate               rerank when top-1 < ${rerank.gate.minConfidence} or margin < ${rerank.gate.minMargin}`);
console.log(`  batching           ${rerank.batchSize} rows/call, timeout ${rerank.timeoutMs}ms, ${rerank.maxRetries} retries`);
console.log(`  price (USD/MTok)   ${rerank.price ? `${rerank.price.inputPerMTok} in / ${rerank.price.outputPerMTok} out` : 'unknown — set RERANK_PRICE_*'}`);
console.log('');
for (const key of ['ANTHROPIC_API_KEY', 'VOYAGE_API_KEY', 'OPENAI_API_KEY'] as const) {
  const v = process.env[key];
  console.log(`  ${key.padEnd(20)} ${v ? `set (${v.length} chars)` : 'not set'}`);
}
const forced = process.env['EMBEDDING_PROVIDER'];
if (forced) console.log(`\n  EMBEDDING_PROVIDER=${forced} is forcing the choice above.`);
