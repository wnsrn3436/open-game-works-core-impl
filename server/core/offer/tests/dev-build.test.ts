import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODULE_DIR = join(import.meta.dirname, '..');

/** The `.ts` files of the module outside `dev/` and `tests/`: what an STG and PROD build keeps. */
function build_files(dir: string = MODULE_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== 'dev' && entry.name !== 'tests') out.push(...build_files(join(dir, entry.name)));
    } else if (entry.name.endsWith('.ts')) out.push(join(dir, entry.name));
  }
  return out;
}

describe('set_offer in STG and PROD builds', () => {
  it('lives only in dev/: no file outside dev/ defines set_offer or imports the DEV code', () => {
    const files = build_files();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/set_offer/);
      expect(text, file).not.toMatch(/from '\.\/dev\/|from '\.\.\/dev\//);
    }
    expect(readFileSync(join(MODULE_DIR, 'dev', 'index.ts'), 'utf8')).toMatch(/set_offer\(ctx, offer_id, started_at, trigger_count\)/);
  });
});
