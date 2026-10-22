// Import first in every apps/api test: reflect-metadata, the root .env, and test defaults for what
// the API refuses to start without. Domain modules read SESSION_SECRET and DATABASE_URL when first
// imported, so this must run before anything from @tasnivo/* (ES modules evaluate in import order).
import 'reflect-metadata';
import { loadRootEnv } from '../src/config/load-env';

loadRootEnv();
// The docker-compose development database (.env.example); a real .env or environment wins.
process.env['DATABASE_URL'] ||= 'postgresql://mxik:mxik@127.0.0.1:54329/mxik?schema=public';
process.env['SESSION_SECRET'] ||= 'apps-api-test-session-secret-0123456789abcdef';
