import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { read_core_fixture, read_fixture, read_shared_fixture } from '../dev/index.ts';
import { base_settings } from '../dev/runner_input.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const RUNTIME = `runtime-${String(process.pid)}`;

/** Runs `fn` with an environment variable set (or removed with null), then puts it back. */
function with_env<T>(name: string, value: string | null, fn: () => T): T {
  const saved = process.env[name];
  if (value === null) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = saved;
  }
}

describe('read_fixture', () => {
  beforeAll(() => {
    const runtime = join(FIXTURES, RUNTIME);
    mkdirSync(runtime, { recursive: true });
    symlinkSync(join(FIXTURES, 'sample.txt'), join(runtime, 'link.txt'));
    symlinkSync(join(FIXTURES, 'nested'), join(runtime, 'linked_dir'));
    writeFileSync(join(runtime, 'big.bin'), Buffer.alloc(Number(base_settings()['testing.maxFixtureBytes']) + 1));
    writeFileSync(join(runtime, 'limit.bin'), Buffer.alloc(Number(base_settings()['testing.maxFixtureBytes'])));
  });

  afterAll(() => {
    rmSync(join(FIXTURES, RUNTIME), { recursive: true, force: true });
  });

  it('reads a regular file below fixtures/ next to the calling test file', () => {
    expect(new TextDecoder().decode(read_fixture('sample.txt'))).toBe('sample fixture\n');
    expect(JSON.parse(new TextDecoder().decode(read_fixture('nested/inner.json')))).toEqual({ inner: true });
    expect(read_fixture(`${RUNTIME}/limit.bin`).length).toBe(Number(base_settings()['testing.maxFixtureBytes']));
  });

  it.each([
    ['an absolute path', join(FIXTURES, 'sample.txt')],
    ['a .. segment', 'nested/../sample.txt'],
    ['a path out of fixtures/', '../fixtures.test.ts'],
    ['a symbolic link file', `${RUNTIME}/link.txt`],
    ['a path through a symbolic link folder', `${RUNTIME}/linked_dir/inner.json`],
    ['a folder', 'nested'],
    ['a missing file', 'missing.txt'],
    ['a file over testing.maxFixtureBytes', `${RUNTIME}/big.bin`],
  ])('throws for %s', (_what, path) => {
    expect(() => read_fixture(path)).toThrow();
  });
});

describe('read_shared_fixture', () => {
  it('gives the bytes of <name>.json in the shared fixture folder and throws for a missing or malformed name', () => {
    const folder = mkdtempSync(join(tmpdir(), 'testing-shared-'));
    try {
      writeFileSync(join(folder, 'damage.base_formula.json'), '{"cases": []}');
      with_env('OGW_SHARED_FIXTURES', folder, () => {
        expect(new TextDecoder().decode(read_shared_fixture('damage.base_formula'))).toBe('{"cases": []}');
        expect(() => read_shared_fixture('damage.missing')).toThrow();
        for (const bad of ['Damage', 'damage-base', 'damage..base', '../damage', 'damage.base_formula.json', '']) expect(() => read_shared_fixture(bad)).toThrow();
      });
      with_env('OGW_SHARED_FIXTURES', null, () => {
        expect(() => read_shared_fixture('damage.base_formula')).toThrow();
      });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('read_core_fixture', () => {
  it('gives the bytes of <name>.json in the core fixture folder and throws for a missing name, a malformed name and a run without the folder', () => {
    const folder = process.env.OGW_CORE_FIXTURES ?? '';
    expect(read_core_fixture('reset-time')).toEqual(new Uint8Array(readFileSync(join(folder, 'reset-time.json'))));
    expect(() => read_core_fixture('no-such-fixture')).toThrow();
    for (const bad of ['reset_time', 'Reset-time', 'reset--time', '../reset-time', 'reset-time.json']) expect(() => read_core_fixture(bad)).toThrow();
    with_env('OGW_CORE_FIXTURES', null, () => {
      expect(() => read_core_fixture('reset-time')).toThrow();
    });
  });
});
