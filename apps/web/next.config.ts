import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processEnv, type LoadedEnvFiles } from '@next/env';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { securityHeaders } from '@tasnivo/domain/security/headers';

const config: NextConfig = {
  // The workspace packages are TypeScript source (package.json "exports" point at .ts files).
  transpilePackages: ['@tasnivo/core', '@tasnivo/db', '@tasnivo/domain', '@tasnivo/i18n'],
  // The dev overlay badge would appear in the landing page screenshots.
  devIndicators: false,
  // exceljs and pg must run on the server, never be bundled for the browser.
  serverExternalPackages: ['exceljs', 'pg', '@prisma/client', '@huggingface/transformers', 'onnxruntime-node', 'pdfkit'],
  experimental: {
    // Catalogue uploads are the whole point; the 1 MB default is far too small.
    serverActions: { bodySizeLimit: '25mb' },
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
    ];
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
