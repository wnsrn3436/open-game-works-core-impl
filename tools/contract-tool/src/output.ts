/** Replaces generation target folders: files not in the result are deleted, only files whose bytes differ are written. */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

function removeEmptyDirs(dir: string, keep: string): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  for (const name of readdirSync(dir)) removeEmptyDirs(join(dir, name), keep);
  if (dir !== keep && readdirSync(dir).length === 0) rmdirSync(dir);
}

/**
 * An engine meta file (`client-core` Godot `## engine meta file`) of a file the result keeps: the engine and the meta
 * sync own it, so writing the generated file again keeps its UID.
 */
function isKeptMeta(path: string, wanted: ReadonlySet<string>): boolean {
  const meta = /\.(uid|import)$/.exec(path);
  return meta !== null && wanted.has(path.slice(0, -meta[0].length));
}

/** Writes `files` (paths relative to `root` with `/`) and makes each folder of `targets` hold exactly them. */
export function replaceTargets(root: string, targets: readonly string[], files: ReadonlyMap<string, string>): void {
  const wanted = new Set([...files.keys()].map((p) => join(root, ...p.split('/'))));
  for (const target of targets) {
    const dir = join(root, ...target.split('/'));
    for (const path of listFiles(dir)) {
      if (!wanted.has(path) && !isKeptMeta(path, wanted)) rmSync(path);
    }
  }
  for (const [rel, text] of files) {
    const path = join(root, ...rel.split('/'));
    const bytes = Buffer.from(text, 'utf8');
    if (existsSync(path) && readFileSync(path).equals(bytes)) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  for (const target of targets) {
    const dir = join(root, ...target.split('/'));
    removeEmptyDirs(dir, dir);
  }
}
