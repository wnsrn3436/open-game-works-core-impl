/** `npm run build`: bundles the tool and its runtime dependencies into the one file `bin/data-tool.js`. */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { CHECKS_DIR, moduleChecksSource, VIRTUAL_ID } from './module-checks.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [join(root, 'src', 'main.ts')],
  outfile: join(root, 'bin', 'data-tool.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
  plugins: [{
    name: 'module-checks',
    setup(b) {
      b.onResolve({ filter: /^virtual:module-checks$/ }, () => ({ path: VIRTUAL_ID, namespace: 'module-checks' }));
      b.onLoad({ filter: /.*/, namespace: 'module-checks' }, () => ({ contents: moduleChecksSource(), loader: 'ts', resolveDir: CHECKS_DIR }));
    },
  }],
});
