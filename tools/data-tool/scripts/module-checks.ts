/** The source of the module `virtual:module-checks`: every `src/checks/<module name>.ts` by module name. */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIRTUAL_ID = 'virtual:module-checks';

export const CHECKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'checks');

export function moduleChecksSource(dir: string = CHECKS_DIR): string {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).sort() : [];
  const imports = files.map((f, i) => `import { check as c${String(i)} } from ${JSON.stringify(join(dir, f))};`);
  const entries = files.map((f, i) => `[${JSON.stringify(f.slice(0, -3))}, c${String(i)}]`);
  return `${imports.join('\n')}\nexport default new Map([${entries.join(', ')}]);\n`;
}
