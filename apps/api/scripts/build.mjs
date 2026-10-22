// npm run build:api (from the repository root): one ES module, apps/api/dist/main.mjs.
//
// Why esbuild and not `nest build`/tsc: the @tasnivo/* workspaces are TypeScript source whose
// package.json "exports" point at .ts files, so tsc output that still imports them cannot run on
// plain Node. The bundle inlines apps/api and every @tasnivo/* source it reaches and leaves each npm
// package external (resolved from node_modules at run time, so Prisma's engines, onnxruntime and
// pdfkit's fonts load exactly as under tsx). esbuild reads each file's nearest tsconfig.json:
// apps/api's enables the legacy decorators Nest needs. Like tsx, it emits no decorator metadata,
// which is why every constructor dependency is named with @Inject(...).
import { build } from 'esbuild';

const workspace = /^@tasnivo\//;

/** Every bare specifier except @tasnivo/* stays an import of node_modules. */
const externalPackages = {
  name: 'external-packages',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (workspace.test(args.path)) return undefined;
      // An absolute Windows path (C:\...) is a file, not a package.
      if (/^[A-Za-z]:[\\/]/.test(args.path)) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: ['apps/api/src/main.ts'],
  outfile: 'apps/api/dist/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  plugins: [externalPackages],
  // Bundled code that calls require() (none today) gets Node's.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});
