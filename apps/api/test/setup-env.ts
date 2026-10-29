// Import first in every apps/api test: reflect-metadata, the root .env, and test defaults for what
// the API refuses to start without. Domain modules read SESSION_SECRET and DATABASE_URL when first
// imported, so this must run before anything from @tasnivo/* (ES modules evaluate in import order).
import 'reflect-metadata';
import { loadRootEnv } from '../src/config/load-env';

loadRootEnv();
// Never a real LLM call from a test: the root .env may hold a GEMINI_API_KEY (or an
// Anthropic one), and stage 6 would then call the provider and make results non-deterministic.
process.env['RERANK_PROVIDER'] = 'off';
// The docker-compose development database (.env.example); a real .env or environment wins.
process.env['DATABASE_URL'] ||= 'postgresql://mxik:mxik@127.0.0.1:54329/mxik?schema=public';
process.env['SESSION_SECRET'] ||= 'apps-api-test-session-secret-0123456789abcdef';
// The tests stand where Caddy would: each request names its client in X-Real-IP (testIp()), so
// per-address limits never carry over between tests. client-ip.test.ts covers the unset case (Q5).
process.env['TRUST_PROXY'] ||= '1';
