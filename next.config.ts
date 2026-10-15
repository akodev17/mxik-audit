import type { NextConfig } from 'next';

const config: NextConfig = {
  // The dev overlay badge would appear in the landing page screenshots.
  devIndicators: false,
  // exceljs and pg must run on the server, never be bundled for the browser.
  serverExternalPackages: ['exceljs', 'pg', '@prisma/client', '@huggingface/transformers', 'onnxruntime-node'],
  experimental: {
    // Catalogue uploads are the whole point; the 1 MB default is far too small.
    serverActions: { bodySizeLimit: '25mb' },
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

export default config;
