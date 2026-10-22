// build:worker: one ESM file, apps/worker/dist/main.js. The @tasnivo/* packages are TypeScript
// source, so they are bundled in; every other package stays in node_modules (Prisma's engine, ONNX,
// bullmq). Legacy decorators as in tsconfig.json; like tsx, esbuild emits no decorator metadata.
// Run from the repository root: npm run build:worker.
import { build } from 'esbuild';

await build({
  entryPoints: ['apps/worker/src/main.ts'],
  outfile: 'apps/worker/dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  tsconfig: 'apps/worker/tsconfig.json',
  logLevel: 'info',
  plugins: [{
    name: 'external-node-modules',
    setup(b) {
      // Bare specifiers other than @tasnivo/* load from node_modules at run time.
      b.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith('@tasnivo/') ? undefined : { path: args.path, external: true }));
    },
  }],
});
