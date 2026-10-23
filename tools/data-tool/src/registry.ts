/** The ID registry: the `id-registry` branch of the game repo, or an `id_registry.json` file (`data` tool.md `## ID registry`). */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { compareBytes } from './diag.ts';
import { ID_NAME } from './values.ts';

export const BRANCH = 'id-registry';
export const REGISTRY_FILE = 'id_registry.json';
const LOCK_NAME = 'ogw-id-registry.lock';
/**
 * How long a run waits for the lock. A holder keeps it for one read, issue and write of the registry, well under a
 * second, so a wait this long is a holder that runs but does not go on, not a queue of runs.
 */
export const LOCK_WAIT_MS = 10 * 60_000;
/** How often a waiting run tries the lock again. */
const LOCK_POLL_MS = 100;
/**
 * Reads and writes of one issue: the registry is read again when it changed between the read and the write. Only a
 * writer outside the lock changes it then, so a registry that changes this many times in a row keeps changing.
 */
const ISSUE_TRIES = 5;
/** The claim beside a lock or claim that a run taking it over places first. */
const TAKEOVER = '.takeover';

/** The largest ID value: ID values are int32 of 1 or more. */
const MAX_ID_VALUE = 2 ** 31 - 1;
/**
 * The largest ID value the stores issue, `MAX_ID_VALUE`: tests lower it to issue into a registry that has every value,
 * which no test can hold at `MAX_ID_VALUE`.
 */
export const idValueLimit = { max: MAX_ID_VALUE };

/** The ID registry or its lock could not be read or written. */
export class RegistryError extends Error {}

export type Registry = Map<string, number>;

/** Reads registry JSON; a string is why it is not one. */
export function parseRegistry(text: string): Registry | string {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return 'id_registry.json is not JSON';
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return 'id_registry.json is not a JSON object';
  const out: Registry = new Map();
  const seen = new Map<number, string>();
  for (const [name, value] of Object.entries(json as Record<string, unknown>)) {
    if (!ID_NAME.test(name)) return `key ${name} is not an ID name`;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_ID_VALUE) return `value of ${name} is not an int32 of 1 or more`;
    const other = seen.get(value);
    if (other !== undefined) return `${other} and ${name} have the same ID value ${String(value)}`;
    seen.set(value, name);
    out.set(name, value);
  }
  return out;
}

/** Registry JSON with keys in byte order. */
export function registryText(registry: Registry): string {
  const obj: Record<string, number> = {};
  for (const name of [...registry.keys()].sort(compareBytes)) obj[name] = registry.get(name) as number;
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * The ID value a name gets when no other name has it: the first 8 bytes of SHA-256 of its UTF-8 bytes as an unsigned
 * big-endian integer, mod 2147483647, plus 1. Not a sequence, so no ID value tells another and `id + 1` is wrong at once.
 */
export function hashedIdValue(name: string): number {
  const head = createHash('sha256').update(name, 'utf8').digest().readBigUInt64BE(0);
  return Number(head % BigInt(MAX_ID_VALUE)) + 1;
}

/**
 * New mappings for the names the registry does not have, in byte order, each its hashed ID value, or the next value
 * after it no name has, going from `max` back to 1. A string is why nothing is issued: a name that is not an ID name
 * would make a registry that fails its own form check, and a registry without a free value for each new name has no
 * value left. That check is what ends the search for a free value. Below `MAX_ID_VALUE`, `max` only lets tests fill
 * the registry: a hashed ID value above it starts the search at that value mod `max`, plus 1.
 */
export function issue(registry: Registry, names: Iterable<string>, max = MAX_ID_VALUE): Registry | string {
  const out = new Map(registry);
  const used = new Set(registry.values());
  const missing = [...new Set(names)].filter((n) => !registry.has(n)).sort(compareBytes);
  const bad = missing.find((n) => !ID_NAME.test(n));
  if (bad !== undefined) return `${bad} is not an ID name`;
  const taken = [...used].filter((v) => v >= 1 && v <= max).length;
  if (taken + missing.length > max) return `the ID registry has no ID value left for ${String(missing.length)} new ID names`;
  for (const name of missing) {
    let value = ((hashedIdValue(name) - 1) % max) + 1;
    while (used.has(value)) value = value === max ? 1 : value + 1;
    used.add(value);
    out.set(name, value);
  }
  return out;
}

const COMMITTER = { GIT_AUTHOR_NAME: 'data tool', GIT_AUTHOR_EMAIL: 'data-tool@localhost', GIT_COMMITTER_NAME: 'data tool', GIT_COMMITTER_EMAIL: 'data-tool@localhost' };

/** Output of a git command; RegistryError with its stderr when it fails. */
function git(cwd: string, args: string[], input?: string, env: Record<string, string> = {}): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim();
  } catch (error) {
    const raw = (error as { stderr?: unknown }).stderr;
    const stderr = typeof raw === 'string' ? raw.trim() : '';
    throw new RegistryError(`git ${args[0] ?? ''} failed in ${cwd}: ${stderr === '' ? (error as Error).message : stderr}`);
  }
}

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

/** The git common dir of a folder, or null when it is not in a git checkout. */
export function gitCommonDir(dir: string): string | null {
  const out = tryGit(dir, ['rev-parse', '--git-common-dir']);
  if (out === null) return null;
  return isAbsolute(out) ? out : resolve(dir, out);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Called in each gap between two file system changes of the lock, with the step and the lock or claim path it is at:
 * tests end a run there to see what a run killed at that point leaves.
 */
export const lockSteps: { at: (step: string, path: string) => void } = { at: () => undefined };

/** The text of a lock file this process places: its pid and a token, one line each. */
function ownerText(): string {
  return `${String(process.pid)}\n${randomBytes(8).toString('hex')}\n`;
}

/** The text of the lock or claim file at `path`; undefined when it is not there, null when it does not read. */
function readOwner(path: string): string | null | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    return (error as { code?: string }).code === 'ENOENT' ? undefined : null;
  }
}

/** The owner pid of a lock text; null when its first line is not a pid, so its owner is not known. */
function ownerPid(owner: string): number | null {
  const line = owner.split('\n')[0] ?? '';
  return /^[1-9][0-9]*$/.test(line) ? Number(line) : null;
}

/** A lock whose owner process is gone can be taken over; one whose owner is not known cannot. */
function isStale(owner: string): boolean {
  const pid = ownerPid(owner);
  return pid !== null && pid !== process.pid && !isAlive(pid);
}

/**
 * Puts a file holding `own` at `path` with one hard link of a temporary file that already holds it; false when
 * anything is at `path`. A run that ends before the link leaves only the temporary file beside `path`, and one that
 * ends after it leaves a lock that names its owner.
 */
function place(path: string, own: string): boolean {
  const temp = `${path}.${String(process.pid)}-${randomBytes(8).toString('hex')}`;
  writeFileSync(temp, own, { flag: 'wx' });
  try {
    lockSteps.at('written', path);
    try {
      linkSync(temp, path);
    } catch (error) {
      if ((error as { code?: string }).code === 'EEXIST') return false;
      throw error;
    }
    lockSteps.at('linked', path);
    return true;
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Removes the lock or claim file at `path` when it still holds `own`. */
function release(path: string, own: string): void {
  if (readOwner(path) !== own) return;
  lockSteps.at('releasing', path);
  rmSync(path, { force: true });
}

/** Puts the file holding `own` at `path`, taking over a file there whose owner is gone; false when it is held. */
function hold(path: string, own: string): boolean {
  if (place(path, own)) return true;
  const owner = readOwner(path);
  if (typeof owner !== 'string' || !isStale(owner)) return false;
  lockSteps.at('judged', path);
  return takeOver(path, owner, own);
}

/**
 * Takes over the lock or claim at `path` whose text was `owner`, judged stale, with the text `own`. Only the run that
 * holds the claim `<path>.takeover` takes it over; it removes `path` only while `path` still holds `owner`, so a lock
 * freed and taken again in between is not taken over. A claim whose owner is gone is taken over the same way.
 */
export function takeOver(path: string, owner: string, own: string): boolean {
  const claim = `${path}${TAKEOVER}`;
  if (!hold(claim, own)) return false;
  try {
    lockSteps.at('claimed', path);
    if (readOwner(path) !== owner) return false;
    rmSync(path, { force: true });
    lockSteps.at('removed', path);
    return place(path, own);
  } finally {
    release(claim, own);
  }
}

/** The rest of a temporary file name `<lock>(.takeover)*.<pid>-<token>` that `place` writes, with its pid. */
const TEMP = /^(?:\.takeover)*\.([1-9][0-9]*)-[0-9a-f]{16}$/;
/** The text `place` writes in it: the owner text of `ownerText`. */
const OWNER_TEXT = /^([1-9][0-9]*)\n[0-9a-f]{16}\n$/;
/** The rest of a temporary file name `<registry>.<pid>-<token>` that `fileStore` writes, with its pid. */
const REGISTRY_TEMP = /^\.([1-9][0-9]*)-[0-9a-f]{16}$/;

/**
 * Removes the files beside `path` named `path` and a rest that `rest` matches with a pid, whose pid has ended and
 * whose text `written` reads as the text this tool writes there for that pid. Only the run holding the lock calls it.
 * A file stays when its pid runs or when its text does not read, so a file another run is writing, or one this tool
 * did not write, is never removed. A file that cannot be removed only stays: it does not block the lock.
 */
function sweep(path: string, rest: RegExp, written: (text: string, pid: string) => boolean): void {
  const dir = dirname(path);
  const base = basename(path);
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(base)) continue;
    const match = rest.exec(name.slice(base.length));
    if (match === null) continue;
    const pid = match[1] as string;
    const file = join(dir, name);
    const text = readOwner(file);
    if (typeof text !== 'string' || !written(text, pid) || isAlive(Number(pid))) continue;
    lockSteps.at('sweeping', file);
    try {
      rmSync(file, { force: true });
    } catch {
      // a leftover temporary file is not the lock: leaving it changes nothing for this run or the next
    }
  }
}

/**
 * Removes the temporary files beside `lock` of runs that ended between writing them and removing them: `place` of
 * the lock or a claim leaves `<lock>.<pid>-<token>` or `<lock>.takeover.<pid>-<token>` when its run is killed there.
 * A file is removed only when it holds an owner text with the pid of its name. The lock and its claims never match
 * the name.
 */
function removeTemps(lock: string): void {
  sweep(lock, TEMP, (text, pid) => OWNER_TEXT.exec(text)?.[1] === pid);
}

/**
 * Removes the new registry files beside the `id_registry.json` file at `path` of runs that ended between writing one
 * and renaming it over the registry: `fileStore` leaves `<path>.<pid>-<token>` when its run is killed there. The new
 * file holds the registry, not an owner text, so a file is removed only when it reads as a registry; the pid of its
 * name is the run that wrote it. Its lock `<path>.lock` and that lock's files never match the name.
 */
function removeRegistryTemps(path: string): void {
  sweep(path, REGISTRY_TEMP, (text) => typeof parseRegistry(text) !== 'string');
}

/** Why a lock is busy, for the message of a run that waited too long for it. */
function busyReason(lock: string): string {
  const live: string[] = [];
  for (let path = lock; ; path = `${path}${TAKEOVER}`) {
    const owner = readOwner(path);
    if (owner === undefined) break;
    const pid = owner === null ? null : ownerPid(owner);
    if (pid === null) return `${path} does not read as an owner pid, so its owner is not known; remove ${path} when no data tool runs`;
    if (isAlive(pid)) live.push(String(pid));
  }
  return live.length === 0 ? 'its owner process ended while it was waited for' : `its owner process ${live.join(', ')} still runs`;
}

/**
 * Runs `fn` holding the file lock at `lock`: a file holding the owner pid and a token, placed with one hard link and
 * removed when `fn` ends. A lock whose owner process is gone is taken over, so the lock is free once the process that
 * took it ends. Holding it, the run removes the temporary files of runs that ended before linking them. RegistryError
 * when the lock stays busy for `waitMs`.
 */
export function withLock<T>(lock: string, fn: () => T, waitMs = LOCK_WAIT_MS): T {
  mkdirSync(dirname(lock), { recursive: true });
  const own = ownerText();
  const deadline = Date.now() + waitMs;
  while (!hold(lock, own)) {
    if (Date.now() >= deadline) throw new RegistryError(`the ID registry lock ${lock} was busy for ${String(Math.round(waitMs / 1000))} s: ${busyReason(lock)}`);
    sleepMs(LOCK_POLL_MS);
  }
  try {
    removeTemps(lock);
    return fn();
  } finally {
    release(lock, own);
  }
}

/** Where a registry is read and written. */
export interface RegistryStore {
  /** The registry; a string is why it fails its form check. RegistryError when it cannot be read. */
  read(): Registry | string;
  /** Issues mappings for the missing names and stores them; returns the registry with them. RegistryError as `read`. */
  issue(names: ReadonlySet<string>): Registry | string;
  /** Where the registry is, for messages. */
  label: string;
}

/**
 * The registry of an `id_registry.json` file; issuing takes the lock in the git common dir of its folder. The new file
 * is written beside it and renamed over it only while it still has the text issuing read, so no issued mapping is lost.
 * Holding the lock, issuing removes the new files of runs that ended before renaming them.
 */
export function fileStore(path: string, beforeWrite: () => void = () => undefined): RegistryStore {
  const readText = (): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);
  const notThere = (): RegistryError => new RegistryError(`ID registry: ${path} is not there`);
  const read = (): Registry | string => {
    const text = readText();
    if (text === null) throw notThere();
    return parseRegistry(text);
  };
  return {
    label: path,
    read,
    issue(names) {
      const common = gitCommonDir(dirname(path));
      const lock = common === null ? `${path}.lock` : join(common, LOCK_NAME);
      return withLock(lock, () => {
        removeRegistryTemps(path);
        for (let tries = 0; tries < ISSUE_TRIES; tries += 1) {
          const text = readText();
          if (text === null) throw notThere();
          const now = parseRegistry(text);
          if (typeof now === 'string') return now;
          const next = issue(now, names, idValueLimit.max);
          if (typeof next === 'string' || next.size === now.size) return next;
          const temp = `${path}.${String(process.pid)}-${randomBytes(8).toString('hex')}`;
          writeFileSync(temp, registryText(next));
          beforeWrite();
          if (readText() === text) {
            renameSync(temp, path);
            return next;
          }
          rmSync(temp, { force: true });
        }
        return `${path} kept changing while ID values were issued`;
      });
    },
  };
}

/**
 * The `id-registry` branch head and the registry it holds; a string is why the registry fails its form check.
 * RegistryError when the branch or its registry file cannot be read.
 */
function readBranchHead(game: string): { head: string; registry: Registry } | string {
  const refs = git(game, ['for-each-ref', '--format=%(refname) %(objectname)', `refs/heads/${BRANCH}`]).split('\n');
  const head = refs.find((l) => l.startsWith(`refs/heads/${BRANCH} `))?.split(' ')[1];
  if (head === undefined) throw new RegistryError(`ID registry: the ${BRANCH} branch is not in the game repo`);
  let text: string;
  try {
    text = git(game, ['show', `${head}:${REGISTRY_FILE}`]);
  } catch (error) {
    throw new RegistryError(`ID registry: ${REGISTRY_FILE} of the ${BRANCH} branch does not read: ${(error as Error).message}`);
  }
  const registry = parseRegistry(text);
  return typeof registry === 'string' ? registry : { head, registry };
}

function readBranch(game: string): Registry | string {
  const read = readBranchHead(game);
  return typeof read === 'string' ? read : read.registry;
}

/**
 * Commits the registry on `head` and moves the branch there when it is still at `head`; false when the branch moved.
 * RegistryError when git fails otherwise.
 */
function commitBranch(game: string, registry: Registry, head: string): boolean {
  const blob = git(game, ['hash-object', '-w', '--stdin'], registryText(registry));
  const tree = git(game, ['mktree'], `100644 blob ${blob}\t${REGISTRY_FILE}\n`);
  const commit = git(game, ['commit-tree', tree, '-p', head, '-m', 'Issue ID values'], undefined, COMMITTER);
  try {
    git(game, ['update-ref', `refs/heads/${BRANCH}`, commit, head]);
    return true;
  } catch (error) {
    if (tryGit(game, ['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]) !== head) return false;
    throw error;
  }
}

/**
 * The registry of the `id-registry` branch of the game repo. `beforeCommit` runs after each read, before the branch
 * is moved: tests move the branch there.
 */
export function branchStore(game: string, beforeCommit: () => void = () => undefined): RegistryStore {
  return {
    label: `the ${BRANCH} branch`,
    read: () => readBranch(game),
    issue(names) {
      const common = gitCommonDir(game);
      if (common === null) return 'the game folder is not a git checkout';
      return withLock(join(common, LOCK_NAME), () => {
        for (let tries = 0; tries < ISSUE_TRIES; tries += 1) {
          const now = readBranchHead(game);
          if (typeof now === 'string') return now;
          const next = issue(now.registry, names, idValueLimit.max);
          if (typeof next === 'string' || next.size === now.registry.size) return next;
          beforeCommit();
          if (commitBranch(game, next, now.head)) return next;
        }
        return `the ${BRANCH} branch kept moving while ID values were issued`;
      });
    },
  };
}
