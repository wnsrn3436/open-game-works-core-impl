import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOST_SECRET_DIR, secret_reader } from '../start_parts.ts';

describe('host secret store', () => {
  let folder: string;
  let outside: string;

  beforeEach(() => {
    outside = mkdtempSync(join(tmpdir(), 'routing-secret-store-'));
    folder = join(outside, 'secrets');
    mkdirSync(folder);
    mkdirSync(join(folder, 'nested'));
    writeFileSync(join(folder, 'no_newline'), 'value-a');
    writeFileSync(join(folder, 'one_newline'), 'value-b\n');
    writeFileSync(join(folder, 'two_newlines'), 'value-c\n\n');
    writeFileSync(join(folder, 'inner_newline'), 'line-1\nline-2\n');
    writeFileSync(join(folder, 'empty'), '');
    writeFileSync(join(folder, 'nested', 'key'), 'nested-value');
    writeFileSync(join(outside, 'above'), 'above-value');
  });

  afterEach(() => {
    rmSync(outside, { recursive: true, force: true });
  });

  it('is the folder /run/secrets of the server image', () => {
    expect(HOST_SECRET_DIR).toBe('/run/secrets');
  });

  it('reads a secret as the file content without one trailing newline', () => {
    const read = secret_reader(null, folder);
    expect(read('no_newline')).toBe('value-a');
    expect(read('one_newline')).toBe('value-b');
    expect(read('two_newlines')).toBe('value-c\n');
    expect(read('inner_newline')).toBe('line-1\nline-2');
    expect(read('empty')).toBe('');
  });

  it('reads null for a missing secret and for a name that is not one file name of the store', () => {
    const read = secret_reader(null, folder);
    expect(read('missing')).toBeNull();
    expect(read('')).toBeNull();
    expect(read('.')).toBeNull();
    expect(read('..')).toBeNull();
    expect(read('nested')).toBeNull();
    expect(read('nested/key')).toBeNull();
    expect(read('../above')).toBeNull();
  });

  it('reads the --secret-file values instead of the store when they are given', () => {
    const read = secret_reader({ no_newline: 'from-file', toString: 'x' }, folder);
    expect(read('no_newline')).toBe('from-file');
    expect(read('one_newline')).toBeNull();
    expect(read('toString')).toBe('x');
    expect(read('hasOwnProperty')).toBeNull();
  });
});
