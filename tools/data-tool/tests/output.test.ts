/** Generation target folders are written all or nothing (`data` tool.md `## CLI`). */
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { OutputError, replaceFolders } from '../src/output.ts';
import { tempDir } from './helpers.ts';

/** Every name in the folder, hidden files included, with the bytes of the files that read. */
function listing(dir: string): string[] {
  return readdirSync(dir).sort().map((name) => {
    try {
      return `${name} ${readFileSync(join(dir, name)).toString('hex')}`;
    } catch {
      return name;
    }
  });
}

describe('replaceFolders', () => {
  test.skipIf(process.getuid?.() === 0)('a failure after a file of the same folder was staged leaves the folder as it was, hidden files included', () => {
    const dir = join(tempDir(), 'data');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.bin'), 'old');
    writeFileSync(join(dir, 'b.bin'), 'old');
    chmodSync(join(dir, 'b.bin'), 0o000);
    const before = listing(dir);
    try {
      expect(() => { replaceFolders([{ dir, files: new Map([['a.bin', 'new'], ['b.bin', 'new']]) }]); }).toThrow(OutputError);
      expect(listing(dir)).toEqual(before);
    } finally {
      chmodSync(join(dir, 'b.bin'), 0o644);
    }
  });

  test('a staged file name too long for the file system leaves the folder as it was, and its error has nothing that was not put back', () => {
    const dir = join(tempDir(), 'data');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.bin'), 'old');
    const before = listing(dir);
    let message = '';
    try {
      replaceFolders([{ dir, files: new Map([['a.bin', 'new'], [`${'t'.repeat(236)}.bin`, 'new']]) }]);
    } catch (error) {
      expect(error).toBeInstanceOf(OutputError);
      message = (error as Error).message;
    }
    expect(message).toMatch(/^the generation targets were not written: ENAMETOOLONG/);
    expect(message).not.toContain('could not be put back');
    expect(listing(dir)).toEqual(before);
  });

  test('a failure in a folder it made removes that folder', () => {
    const root = tempDir();
    const dir = join(root, 'data');
    expect(() => { replaceFolders([{ dir, files: new Map([['sub/a.bin', 'new'], [`sub/${'t'.repeat(236)}.bin`, 'new']]) }]); }).toThrow(OutputError);
    expect(readdirSync(root)).toEqual([]);
  });
});
