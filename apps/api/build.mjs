// Bundles the API for production. Workspace packages (@uposhom/*) ship TypeScript source, so they
// are compiled into dist/; every other dependency stays external and is installed by
// `pnpm deploy --prod` into the image's node_modules.
import { build } from 'esbuild';

const externalExceptWorkspace = {
  name: 'external-except-workspace',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@uposhom/')) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: ['src/index.ts', 'src/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externalExceptWorkspace],
});
