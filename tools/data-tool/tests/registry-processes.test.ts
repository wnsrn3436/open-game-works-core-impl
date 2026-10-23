/**
 * The ID registry lock and issuing with several processes at once (`data` tool.md `## ID registry`): each test runs
 * real processes that race for the lock, so a gap between a check and a rename shows as two holders or a lost value.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { fileStore, hashedIdValue, registryText, withLock } from '../src/registry.ts';
import { tempDir } from './helpers.ts';

const REGISTRY = pathToFileURL(join(import.meta.dirname, '..', 'src', 'registry.ts')).href;

/**
 * A child script: it waits for the file `go`, so the children start their race together, then runs `body` with the
 * registry module as `r` and its arguments as `args`.
 */
function script(body: string): string {
  return [
    `import { appendFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';`,
    `import * as r from ${JSON.stringify(REGISTRY)};`,
    'const args = JSON.parse(process.argv[1]);',
    'const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);',
    'while (!existsSync(args.go)) sleep(1);',
    body,
  ].join('\n');
}

/** The critical section of a lock test: it fails when another process is in it too. */
const CRITICAL = [
  `writeFileSync(args.inside, String(process.pid), { flag: 'wx' });`,
  'sleep(args.holdMs);',
  'rmSync(args.inside);',
  `appendFileSync(args.log, process.pid + '\\n');`,
].join('\n');

interface Child {
  pid: number;
  /** `<exit code> <stderr>` when it ends. */
  ended: Promise<string>;
  kill(): void;
}

function child(source: string, args: Record<string, unknown>): Child {
  const run = spawn(process.execPath, ['--input-type=module', '-e', source, JSON.stringify(args)], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  run.stderr.on('data', (d: Buffer) => { err += d.toString(); });
  const ended = new Promise<string>((resolve) => { run.on('exit', (code, signal) => { resolve(`${String(code ?? signal)} ${err}`); }); });
  return { pid: run.pid as number, ended, kill: () => { run.kill('SIGKILL'); } };
}

/** The pid of a process that has ended. */
function gonePid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid;
}

function waitFor(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = (): void => {
      if (existsSync(path)) resolve();
      else if (Date.now() - started > 20_000) reject(new Error(`${path} did not come`));
      else setTimeout(check, 5);
    };
    check();
  });
}

function git(cwd: string, a: string[], input?: string): string {
  return execFileSync('git', a, { cwd, encoding: 'utf8', input, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
}

/** Expects the registry to give every name one value, its hashed ID value (the names here share none), with none twice. */
function expectWhole(registry: Record<string, number>, names: readonly string[]): void {
  expect(Object.keys(registry).sort()).toEqual([...names].sort());
  expect(new Set(Object.values(registry)).size).toBe(names.length);
  for (const name of names) expect(registry[name]).toBe(hashedIdValue(name));
}

describe('ID registry lock with several processes', () => {
  test('two processes that both find a lock whose owner is gone: one takes it over and the other waits, and they never hold it together', async () => {
    for (let round = 0; round < 25; round += 1) {
      const dir = tempDir();
      const lock = join(dir, 'ogw-id-registry.lock');
      writeFileSync(lock, `${String(gonePid())}\ndead\n`);
      const args = { go: join(dir, 'go'), inside: join(dir, 'inside'), log: join(dir, 'log'), lock, holdMs: 20 };
      const runs = [0, 1].map(() => child(script(`r.withLock(args.lock, () => {\n${CRITICAL}\n});`), args));
      writeFileSync(args.go, '');
      expect(await Promise.all(runs.map((c) => c.ended))).toEqual(['0 ', '0 ']);
      expect(readFileSync(args.log, 'utf8').trim().split('\n').sort()).toEqual(runs.map((c) => String(c.pid)).sort());
      expect(readdirSync(dir).sort()).toEqual(['go', 'log']);
    }
  });

  test('a holder killed while it holds the lock: the two processes waiting take it over one after the other', async () => {
    for (let round = 0; round < 10; round += 1) {
      const dir = tempDir();
      const lock = join(dir, 'ogw-id-registry.lock');
      const args = { go: join(dir, 'go'), inside: join(dir, 'inside'), log: join(dir, 'log'), held: join(dir, 'held'), lock, holdMs: 20 };
      writeFileSync(args.go, '');
      const holder = child(script(`r.withLock(args.lock, () => { writeFileSync(args.held, ''); sleep(60_000); });`), args);
      await waitFor(args.held);
      const runs = [0, 1].map(() => child(script(`r.withLock(args.lock, () => {\n${CRITICAL}\n});`), args));
      holder.kill();
      expect(await holder.ended).toBe('SIGKILL ');
      expect(await Promise.all(runs.map((c) => c.ended))).toEqual(['0 ', '0 ']);
      expect(readFileSync(args.log, 'utf8').trim().split('\n').sort()).toEqual(runs.map((c) => String(c.pid)).sort());
      expect(readdirSync(dir).filter((n) => n.startsWith('ogw-id-registry.lock'))).toEqual([]);
    }
  });

  test('a live holder whose lock is older than a few seconds and does not read is not taken over by another process', async () => {
    const dir = tempDir();
    const lock = join(dir, 'ogw-id-registry.lock');
    const args = { go: join(dir, 'go'), inside: join(dir, 'inside'), log: join(dir, 'log'), held: join(dir, 'held'), release: join(dir, 'release'), lock, holdMs: 0 };
    writeFileSync(args.go, '');
    const holder = child(script(`r.withLock(args.lock, () => {\n${CRITICAL.replace('sleep(args.holdMs);', 'writeFileSync(args.held, ""); while (!existsSync(args.release)) sleep(5);')}\n});`), args);
    await waitFor(args.held);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const text = readFileSync(lock, 'utf8');
    chmodSync(lock, 0o000);
    const other = child(script(`r.withLock(args.lock, () => {\n${CRITICAL}\n});`), args);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // a takeover would put the other process's lock in place of the holder's
    const kept = existsSync(lock);
    if (kept) chmodSync(lock, 0o644);
    const same = kept && readFileSync(lock, 'utf8') === text;
    writeFileSync(args.release, '');
    expect(kept).toBe(true);
    expect(same).toBe(true);
    expect(await Promise.all([holder.ended, other.ended])).toEqual(['0 ', '0 ']);
    expect(readFileSync(args.log, 'utf8').trim().split('\n')).toEqual([String(holder.pid), String(other.pid)]);
  });

  test('two processes issue ID values into one --id-registry file at once: every name gets one value and none is lost', async () => {
    const dir = tempDir();
    const path = join(dir, 'id_registry.json');
    writeFileSync(path, registryText(new Map()));
    const names = (who: string): string[] => Array.from({ length: 30 }, (_, i) => `[${who}_${String(i)}]`);
    const body = 'for (const name of args.names) { const out = r.fileStore(args.path).issue(new Set([name])); if (typeof out === "string") throw new Error(out); }';
    const runs = ['a', 'b'].map((who) => child(script(body), { go: join(dir, 'go'), path, names: names(who) }));
    writeFileSync(join(dir, 'go'), '');
    expect(await Promise.all(runs.map((c) => c.ended))).toEqual(['0 ', '0 ']);
    expectWhole(JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>, [...names('a'), ...names('b')]);
    expect(readdirSync(dir).sort()).toEqual(['go', 'id_registry.json']);
  });

  test('a run killed between writing the new --id-registry file and renaming it over the registry: the next run that issues removes the file it left', async () => {
    const dir = tempDir();
    const path = join(dir, 'id_registry.json');
    writeFileSync(path, registryText(new Map([['[kept]', 7]])));
    const body = `r.fileStore(args.path, () => { process.kill(process.pid, 'SIGKILL'); sleep(60_000); }).issue(new Set(['[a]']));`;
    writeFileSync(join(dir, 'go'), '');
    expect(await child(script(body), { go: join(dir, 'go'), path }).ended).toBe('SIGKILL ');
    // the lock is beside the registry here (no git), held by the killed run
    expect(readdirSync(dir).filter((n) => n.startsWith('id_registry.json.')).sort()).toEqual([expect.stringMatching(/^id_registry\.json\.[0-9]+-[0-9a-f]{16}$/), 'id_registry.json.lock']);
    const issued = fileStore(path).issue(new Set(['[b]']));
    expect(issued instanceof Map ? Object.fromEntries(issued) : issued).toEqual({ '[kept]': 7, '[b]': hashedIdValue('[b]') });
    expect(readdirSync(dir).filter((n) => n.startsWith('id_registry.json'))).toEqual(['id_registry.json']);
  });

  test('two worktrees issue ID values into the id-registry branch at once: every name gets one value and none is lost', async () => {
    const dir = tempDir();
    const game = join(dir, 'game');
    mkdirSync(game);
    git(game, ['init', '-q', '-b', 'main']);
    git(game, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const blob = git(game, ['hash-object', '-w', '--stdin'], registryText(new Map()));
    const tree = git(game, ['mktree'], `100644 blob ${blob}\tid_registry.json\n`);
    git(game, ['update-ref', 'refs/heads/id-registry', git(game, ['commit-tree', tree, '-m', 'registry'])]);
    const wt = join(dir, 'wt');
    git(game, ['worktree', 'add', '-q', '-b', 'work', wt]);
    const names = (who: string): string[] => Array.from({ length: 10 }, (_, i) => `[${who}_${String(i)}]`);
    const body = 'for (const name of args.names) { const out = r.branchStore(args.game).issue(new Set([name])); if (typeof out === "string") throw new Error(out); }';
    const runs = [[game, 'a'], [wt, 'b']].map(([where, who]) => child(script(body), { go: join(dir, 'go'), game: where, names: names(who as string) }));
    writeFileSync(join(dir, 'go'), '');
    expect(await Promise.all(runs.map((c) => c.ended))).toEqual(['0 ', '0 ']);
    expectWhole(JSON.parse(git(game, ['show', 'id-registry:id_registry.json'])) as Record<string, number>, [...names('a'), ...names('b')]);
    expect(git(game, ['rev-list', '--count', 'id-registry'])).toBe('21');
  });
});

/**
 * A child that takes the lock at `args.lock` and counts the gaps between its lock file changes (`lockSteps`) and the
 * call of `fn`: it writes each to `args.steps` when given, and kills itself at the gap `args.killAt`.
 */
const KILLED_AT = [
  'let n = 0;',
  `const gap = (what) => { if (args.steps) appendFileSync(args.steps, what + '\\n'); if (n++ === args.killAt) { process.kill(process.pid, 'SIGKILL'); sleep(60_000); } };`,
  `r.lockSteps.at = (step, path) => gap(step + ' lock' + path.slice(args.lock.length));`,
  `r.withLock(args.lock, () => gap('fn'));`,
].join('\n');

/** What a run finds before it takes the lock. */
const STARTS: [string, (lock: string) => void][] = [
  ['a free lock', () => undefined],
  ['a lock whose owner is gone', (lock) => { writeFileSync(lock, `${String(gonePid())}\ndead\n`); }],
  ['a lock and its claim whose owners are gone', (lock) => {
    writeFileSync(lock, `${String(gonePid())}\ndead\n`);
    writeFileSync(`${lock}.takeover`, `${String(gonePid())}\nclaim\n`);
  }],
  ['a lock whose owner is gone and temporary files of runs that ended before linking them', (lock) => {
    const gone = gonePid();
    writeFileSync(lock, `${String(gonePid())}\ndead\n`);
    writeFileSync(`${lock}.${String(gone)}-0123456789abcdef`, `${String(gone)}\n0123456789abcdef\n`);
    writeFileSync(`${lock}.takeover.${String(gone)}-1123456789abcdef`, `${String(gone)}\n1123456789abcdef\n`);
  }],
];

/** The lock, its claims and the temporary files of killed runs beside them in `dir`. */
const LOCK_FILE = /^ogw-id-registry\.lock(\.takeover)*(\.[0-9]+-[0-9a-f]{16})?$/;
/** A temporary file of the lock or a claim. */
const TEMP_FILE = /^ogw-id-registry\.lock(\.takeover)*\.[0-9]+-[0-9a-f]{16}$/;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
}

describe('ID registry lock with a run killed at each step', () => {
  test.each(STARTS)('%s: a run killed at any step of taking, taking over or releasing the lock leaves it free or held by an owner that is gone, and the next run takes it', async (what, start) => {
    const traced = tempDir();
    const lock = join(traced, 'ogw-id-registry.lock');
    start(lock);
    const steps = join(traced, 'steps');
    writeFileSync(join(traced, 'go'), '');
    expect(await child(script(KILLED_AT), { go: join(traced, 'go'), lock, steps, killAt: -1 }).ended).toBe('0 ');
    const gaps = readFileSync(steps, 'utf8').trim().split('\n');
    expect(gaps).toContain('fn');
    expect(gaps.at(-1)).toBe('releasing lock');
    // the run that takes the lock removes the two temporary files, so a kill before, between and after their removal is tried
    expect(gaps.filter((g) => g.startsWith('sweeping'))).toHaveLength(what.includes('temporary files') ? 2 : 0);
    expect(readdirSync(traced).filter((n) => n.startsWith('ogw-id-registry.lock'))).toEqual([]);

    for (let killAt = 0; killAt < gaps.length; killAt += 1) {
      const dir = tempDir();
      const at = join(dir, 'ogw-id-registry.lock');
      start(at);
      writeFileSync(join(dir, 'go'), '');
      const killed = child(script(KILLED_AT), { go: join(dir, 'go'), lock: at, killAt });
      expect([gaps[killAt], await killed.ended]).toEqual([gaps[killAt], 'SIGKILL ']);
      const left = readdirSync(dir).filter((n) => n !== 'go');
      expect([gaps[killAt], left.filter((n) => !LOCK_FILE.test(n))]).toEqual([gaps[killAt], []]);
      for (const name of left.filter((n) => /^ogw-id-registry\.lock(\.takeover)*$/.test(n))) {
        const pid = Number(readFileSync(join(dir, name), 'utf8').split('\n')[0]);
        expect([gaps[killAt], name, Number.isInteger(pid) && pid > 0 && !isAlive(pid)]).toEqual([gaps[killAt], name, true]);
      }
      let ran = false;
      withLock(at, () => { ran = true; }, 5000);
      expect([gaps[killAt], ran]).toEqual([gaps[killAt], true]);
      expect([gaps[killAt], existsSync(at)]).toEqual([gaps[killAt], false]);
      // the killed run's pid is gone, so the run that took the lock removed its temporary files
      expect([gaps[killAt], readdirSync(dir).filter((n) => TEMP_FILE.test(n))]).toEqual([gaps[killAt], []]);
    }
  });

  test('the gaps of a takeover of a lock and its claim whose owners are gone are all there for the kills above', async () => {
    const dir = tempDir();
    const lock = join(dir, 'ogw-id-registry.lock');
    (STARTS[2] as [string, (lock: string) => void])[1](lock);
    writeFileSync(join(dir, 'go'), '');
    expect(await child(script(KILLED_AT), { go: join(dir, 'go'), lock, steps: join(dir, 'steps'), killAt: -1 }).ended).toBe('0 ');
    expect(readFileSync(join(dir, 'steps'), 'utf8').trim().split('\n')).toEqual([
      'written lock', 'judged lock',
      'written lock.takeover', 'judged lock.takeover',
      'written lock.takeover.takeover', 'linked lock.takeover.takeover', 'claimed lock.takeover', 'removed lock.takeover', 'written lock.takeover', 'linked lock.takeover', 'releasing lock.takeover.takeover',
      'claimed lock', 'removed lock', 'written lock', 'linked lock', 'releasing lock.takeover',
      'fn', 'releasing lock',
    ]);
  });
});
