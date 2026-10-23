import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processEnv, type LoadedEnvFiles } from '@next/env';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { securityHeaders } from '@tasnivo/contracts/security-headers';

/**
 * Copy of src/lib/api-rewrite.ts apiRewrites (that file is the tested specification; Next transpiles
 * only next.config.ts itself, so a TS module cannot be imported here). Keep the two in step.
 */
function apiRewrites(env: Record<string, string | undefined>, log: (line: string) => void = console.log): { source: string; destination: string }[] {
  if (env['NEXT_PUBLIC_API_URL']) {
    log(`[next.config] /api/* is not rewritten: the browser calls NEXT_PUBLIC_API_URL (${env['NEXT_PUBLIC_API_URL']}) itself`);
    return [];
  }
  const set = env['API_INTERNAL_URL']?.trim();
  const api = (set || 'http://localhost:4000').replace(/\/$/, '');
  log(`[next.config] /api/* -> ${api}/api/* (${set ? 'API_INTERNAL_URL' : 'default, API_INTERNAL_URL not set'}); a production build keeps this destination, so set API_INTERNAL_URL when building`);
  return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
}

const config: NextConfig = {
  // The workspace packages are TypeScript source (package.json "exports" point at .ts files). The web app
  // reads and writes through the API only: no @tasnivo/domain, @tasnivo/db or @tasnivo/core here (ESLint).
  transpilePackages: ['@tasnivo/api-client', '@tasnivo/contracts', '@tasnivo/i18n'],
  // The dev overlay badge would appear in the landing page screenshots.
  devIndicators: false,
  experimental: {
    // Router cache. dynamic 0 (Next's default): a page opened by a plain navigation is fetched each
    // time; the workspace keeps its rows in client state, so a cached copy of a filter view could
    // show a row as undecided after it was decided. static 30 (Next's minimum, default 300): a page
    // fetched ahead on intent (src/ui/shell/intent-prefetch.ts) is reused for at most 30 s.
    staleTimes: { dynamic: 0, static: 30 },
  },
  // CSP, nosniff, referrer and permissions policies on every route; HSTS in production only.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
  // The habitual addresses land on the real sign-in page instead of a 404.
  async redirects() {
    return [
      { source: '/login', destination: '/sign-in', permanent: true },
      { source: '/signin', destination: '/sign-in', permanent: true },
      // Confirmation e-mails sent before the API took the link over point at /verify/<token>.
      { source: '/verify/:token', destination: '/api/auth/verify/:token', permanent: false },
    ];
  },
  // Development and single-origin setups without Caddy: every /api/* request goes to the API (the web
  // app has no route handlers of its own). With NEXT_PUBLIC_API_URL set the browser calls the API itself
  // and nothing is rewritten. `next build` writes the destination into the build: set API_INTERNAL_URL
  // when building, not only when starting (behind Caddy /api/* never reaches the web app, so there it
  // does not matter).
  async rewrites() {
    return apiRewrites(process.env);
  },
  webpack: (webpackConfig) => {
    // packages/* are also run directly by tsx (scripts, eval, tests),
    // which under "type": "module" requires explicit .js extensions on relative
    // imports. Teach webpack to resolve those back to the .ts sources rather
    // than duplicating every module or dropping the extensions.
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return webpackConfig;
  },
};

/**
 * The root npm scripts run `next <command> apps/web` from the repository root, which stays the
 * working directory (data/, node_modules/ and scripts/ resolve against it). Next reads .env files
 * from apps/web only; the project's .env lives at the root, next to docker-compose.yml. Adds those
 * files the way Next would (same order, the real environment wins, $VAR expansion) without
 * resetting what Next has already set up. A change to them needs a restart of the dev server.
 */
function loadRootEnv(dev: boolean): void {
  const root = process.cwd();
  const mode = process.env.NODE_ENV === 'test' ? 'test' : dev ? 'development' : 'production';
  const names = [`.env.${mode}.local`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}`, '.env'];
  const files: LoadedEnvFiles = [];
  for (const path of names) {
    try {
      files.push({ path, contents: readFileSync(join(root, path), 'utf8'), env: {} });
    } catch {
      // An absent file is the normal case.
    }
  }
  if (files.length > 0) processEnv(files, root, console, true);
}

/**
 * The local style guide (src/app/styleguide/page.dev.tsx) is a page only while the dev server runs:
 * the "dev.tsx" page extension is registered for PHASE_DEVELOPMENT_SERVER and nowhere else, so a
 * production build has no such route and never compiles the files only that page imports.
 */
export default function nextConfig(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  loadRootEnv(dev);
  return {
    ...config,
    pageExtensions: ['tsx', 'ts', 'jsx', 'js', ...(dev ? ['dev.tsx'] : [])],
    // The workspace root (see loadRootEnv): build traces cover packages/* and the hoisted node_modules.
    outputFileTracingRoot: process.cwd(),
  };
}
