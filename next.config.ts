import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { securityHeaders } from './src/lib/security/headers';

const config: NextConfig = {
  // The dev overlay badge would appear in the landing page screenshots.
  devIndicators: false,
  // exceljs and pg must run on the server, never be bundled for the browser.
  serverExternalPackages: ['exceljs', 'pg', '@prisma/client', '@huggingface/transformers', 'onnxruntime-node', 'pdfkit'],
  experimental: {
    // Catalogue uploads are the whole point; the 1 MB default is far too small.
    serverActions: { bodySizeLimit: '25mb' },
  },
  // CSP, nosniff, referrer and permissions policies on every route; HSTS in production only.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
  webpack: (webpackConfig) => {
    // src/core and src/lib are also run directly by tsx (scripts, eval, tests),
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
 * The local style guide (src/app/styleguide/page.dev.tsx) is a page only while the dev server runs:
 * the "dev.tsx" page extension is registered for PHASE_DEVELOPMENT_SERVER and nowhere else, so a
 * production build has no such route and never compiles the files only that page imports.
 */
export default function nextConfig(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return { ...config, pageExtensions: ['tsx', 'ts', 'jsx', 'js', ...(dev ? ['dev.tsx'] : [])] };
}
