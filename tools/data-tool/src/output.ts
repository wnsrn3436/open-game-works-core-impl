/**
 * Writes the generation target folders all or nothing (`data` tool.md `## CLI`): a run that does not end with exit
 * code 0 leaves them as they were.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

/** A generation target folder and the whole content it gets. */
export interface FolderWrite {
  dir: string;
  files: ReadonlyMap<string, Uint8Array | string>;
}

/** A generation target folder that was not written; nothing of the run is in the folders. */
export class OutputError extends Error {}

/**
 * One file change: `staged` is the new file beside `path` (null removes `path`), `backup` the file `path` had, `done`
 * whether `path` has the change.
 */
interface Change {
  path: string;
  staged: string | null;
  backup: string | null;
  done: boolean;
}

/** Files under a folder, relative with `/`. */
export function filesUnder(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
}

/**
 * An engine meta file (`client-core` Godot `## engine meta file`) of a file the result keeps: the engine and the meta
 * sync own it, so writing the generated file again keeps its UID.
 */
function isKeptMeta(name: string, files: ReadonlyMap<string, unknown>): boolean {
  const meta = /\.(uid|import)$/.exec(name);
  return meta !== null && files.has(name.slice(0, -meta[0].length));
}

/** Whether a relative file path stays inside its folder. */
export function isInside(dir: string, name: string): boolean {
  const base = resolve(dir);
  return resolve(base, name).startsWith(`${base}${sep}`);
}

/**
 * A hidden file beside `path`. Its name does not end like a generated file, so the engine and the server do not load
 * it, and a run that ends before removing it leaves a file the next run removes as one its result does not have.
 */
function sidePath(path: string, kind: 'new' | 'old'): string {
  return join(dirname(path), `.${basename(path)}.${kind}-${String(process.pid)}-${randomBytes(8).toString('hex')}`);
}

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function bytesOf(content: Uint8Array | string): Buffer {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
}

/**
 * Stages the changes of one folder: the files whose bytes differ are written beside their path. Each change goes into
 * `changes` before its file is written and `made` gets the folders it makes, so an undo after a throw here also takes
 * out what this folder staged.
 */
function stage(write: FolderWrite, changes: Change[], made: string[]): void {
  for (const name of filesUnder(write.dir)) {
    if (!write.files.has(name) && !isKeptMeta(name, write.files)) changes.push({ path: join(write.dir, name), staged: null, backup: null, done: false });
  }
  for (const [name, content] of write.files) {
    const path = join(write.dir, name);
    const bytes = bytesOf(content);
    if (isFile(path) && readFileSync(path).equals(bytes)) continue;
    const first = mkdirSync(dirname(path), { recursive: true });
    if (first !== undefined) made.push(first);
    const change: Change = { path, staged: sidePath(path, 'new'), backup: null, done: false };
    changes.push(change);
    writeFileSync(change.staged as string, bytes);
  }
}

/**
 * Puts one change in. A replaced file is kept as a hard link first, so `path` is never missing while the new file
 * is renamed over it; without hard links it is renamed away.
 */
function apply(change: Change): void {
  if (existsSync(change.path)) {
    const backup = sidePath(change.path, 'old');
    if (change.staged === null) renameSync(change.path, backup);
    else {
      try {
        linkSync(change.path, backup);
      } catch {
        renameSync(change.path, backup);
      }
    }
    change.backup = backup;
  }
  if (change.staged !== null) renameSync(change.staged, change.path);
  change.done = true;
}

/** Takes one change out again; the message of what could not be undone. */
function undo(change: Change): string | null {
  try {
    if (change.backup !== null && (change.done || !existsSync(change.path))) renameSync(change.backup, change.path);
    else if (change.backup !== null) rmSync(change.backup, { force: true });
    else if (change.done) rmSync(change.path, { force: true });
    if (change.staged !== null) rmStaged(change.staged);
    return null;
  } catch (error) {
    return `${change.path}: ${(error as Error).message}`;
  }
}

/** Removes a staged file; a name too long for the file system was never written. */
function rmStaged(staged: string): void {
  try {
    rmSync(staged, { force: true });
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENAMETOOLONG') throw error;
  }
}

/**
 * Replaces generation target folders: files not in a folder's `files` go, files whose bytes differ are written, other
 * files are left as they are. When any write fails, every folder is put back as it was and OutputError is thrown.
 */
export function replaceFolders(writes: readonly FolderWrite[]): void {
  const outside = writes.flatMap((w) => [...w.files.keys()].filter((name) => !isInside(w.dir, name)).map((name) => join(w.dir, name)));
  if (outside.length > 0) throw new OutputError(`generation target paths go outside their folder: ${outside.join(', ')}`);
  const changes: Change[] = [];
  const made: string[] = [];
  try {
    for (const write of writes) stage(write, changes, made);
    for (const change of changes) apply(change);
  } catch (error) {
    const failed = changes.reverse().map(undo).filter((m) => m !== null);
    for (const dir of made.reverse()) rmEmptyFolders(dir);
    const rest = failed.length === 0 ? '' : `; these could not be put back: ${failed.join('; ')}`;
    throw new OutputError(`the generation targets were not written: ${(error as Error).message}${rest}`);
  }
  for (const change of changes) if (change.backup !== null) rmSync(change.backup, { force: true });
}

/** Removes `dir` and the folders under it when they hold no file. */
function rmEmptyFolders(dir: string): void {
  if (!existsSync(dir) || filesUnder(dir).length > 0) return;
  try {
    rmSync(dir, { recursive: true });
  } catch {
    // a folder left empty is no generated file
  }
}

/** Replaces one generation target folder (`replaceFolders`). */
export function replaceFolder(dir: string, files: ReadonlyMap<string, Uint8Array | string>): void {
  replaceFolders([{ dir, files }]);
}

