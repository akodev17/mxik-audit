// Reports which providers the current environment selects, without calling them.
// Run: npm run check:providers
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { embeddingProviderFromEnv } from '../src/core/embed/index.js';
import { rerankProviderFromEnv } from '../src/core/match/rerank.js';

const embedder = embeddingProviderFromEnv();
const reranker = rerankProviderFromEnv();

console.log(`embedding provider   ${embedder.name}`);
console.log(`  dimensions         ${embedder.dimensions}`);
console.log(`  semantic           ${embedder.semantic ? 'yes' : 'NO — local stand-in, stage 4 is surface-form only'}`);
console.log(`rerank provider      ${reranker.name}`);
console.log(`  available          ${reranker.available ? 'yes' : 'NO — stage 6 skipped, confidence capped at 0.85'}`);
console.log('');
for (const key of ['ANTHROPIC_API_KEY', 'VOYAGE_API_KEY', 'OPENAI_API_KEY'] as const) {
  const v = process.env[key];
  console.log(`  ${key.padEnd(20)} ${v ? `set (${v.length} chars)` : 'not set'}`);
}
const forced = process.env['EMBEDDING_PROVIDER'];
if (forced) console.log(`\n  EMBEDDING_PROVIDER=${forced} is forcing the choice above.`);
