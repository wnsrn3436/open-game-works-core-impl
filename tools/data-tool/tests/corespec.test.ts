/**
 * The tool with the `core-spec/` of this core: the core data of every module goes into an empty game, and the
 * generated code of every core table type-checks under strict TypeScript, loads with Node's type stripping and
 * decodes the binaries.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { REQUIREMENT_TABLE } from '../src/corespec.ts';
import { parseCsv } from '../src/csv.ts';
import { fixture, has, read, run, typeErrors, writeFiles } from './helpers.ts';

const IMPL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface SpecModuleJson {
  name: string;
  tables: { name: string; columns: { type: string; target: string; name: string }[] }[];
  enums: { type: string; elements: string[] }[];
  reserved: { table: string; id: string }[];
}

function coreSpec(): { version: string; modules: SpecModuleJson[] } {
  const dir = join(IMPL, 'core-spec');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return { version: '0.0.0', modules: files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as SpecModuleJson) };
}

const CORE_CONTRACT = `export class ItemAmount {
  item_id = 0;
  amount = 0n;
  big_amount = "";

  static decode(bytes: Uint8Array): ItemAmount | null {
    return bytes.length === 0 ? new ItemAmount() : null;
  }
}
`;

describe('core-spec/ of this core', () => {
  test('every module: every core table, enum, invariant and required reserved row goes into an empty game', () => {
    const spec = coreSpec();
    const f = fixture({ coreSpec: spec, modules: spec.modules.map((m) => m.name), settings: { sourceLanguage: 'ko', supportedLanguages: ['ko'] } });
    const r = run(f);
    expect(r.stderr).toEqual([]);
    expect(new Set(r.stdout.map((l) => l.split(' ')[2]))).toEqual(new Set(['empty_required', 'banned_word_missing', 'required_missing']));
    // The empty `language` table has no row for the supported language `ko` (`LocalizationCore`).
    expect(r.stdout.filter((l) => l.split(' ')[2] === 'required_missing')).toEqual(['data/tables/language.csv:1:1 ERROR required_missing language ko of game settings supportedLanguages has no language row']);
    for (const m of spec.modules) {
      for (const t of m.tables.filter((x) => x.name !== REQUIREMENT_TABLE)) {
        const parsed = parseCsv(read(f, `data/tables/${t.name}.csv`));
        const header = parsed.ok ? parsed.records.slice(1, 4).map((x) => x.cells.map((c) => c.text).join(',')) : [];
        expect(header).toEqual([t.columns.map((c) => c.target).join(','), t.columns.map((c) => c.type).join(','), t.columns.map((c) => c.name).join(',')]);
      }
      for (const e of m.enums) for (const el of e.elements) expect(read(f, 'data/enums.csv')).toContain(`${e.type},${el},`);
      for (const x of m.reserved) expect(read(f, `data/system/${x.table}.csv`)).toContain(`\n${x.id},`);
    }
    expect(has(f, 'data/tables/requirement.csv')).toBe(false);
    expect(run(f).stdout).toEqual(r.stdout);
  });

  test('no module: the generated code has every core table, type-checks, loads with type stripping and decodes', async () => {
    const spec = coreSpec();
    const f = fixture({ coreSpec: spec, modules: [] });
    writeFiles(f.game, { 'server/generated/contract/core_contract.ts': CORE_CONTRACT });
    const r = run(f);
    expect(r.stdout).toEqual([]);
    expect(r.code).toBe(0);
    expect(typeErrors(f)).toEqual([]);
    const file = join(f.game, 'server', 'generated', 'data', 'game_data.ts');
    const names = spec.modules.flatMap((m) => m.tables.map((t) => t.name));
    expect(names).toContain(REQUIREMENT_TABLE);
    const script = `const m = await import(${JSON.stringify(file)}); const fs = await import("node:fs"); const dir = ${JSON.stringify(join(f.game, 'server', 'build', 'data'))};
const files = new Map(fs.readdirSync(dir).filter((n) => n.endsWith(".bin")).map((n) => [n, new Uint8Array(fs.readFileSync(dir + "/" + n))]));
const set = m.load_data_set(files); if (set === null) throw new Error("no data set");
console.log(JSON.stringify(Object.keys(set).sort()));`;
    const node = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(node.stderr).toBe('');
    const keys = JSON.parse(node.stdout) as string[];
    const pascal = (s: string): string => s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    for (const n of names) expect(keys).toContain(`${pascal(n)}Table`);
    expect(keys).toEqual(expect.arrayContaining(['GameSetting', 'ReservedId', 'ReservedString']));
    const mod = (await import(file)) as { ItemType: Record<string, number>; RequirementType: Record<string, number> };
    expect(mod.ItemType).toEqual({ None: 0, Currency: 1, Goods: 2 });
    expect(mod.RequirementType).toEqual({ None: 0 });
  });
});
