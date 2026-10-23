/** The ID registry: issuing order and values, the `id-registry` branch and the file form check. */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { branchStore, fileStore, gitCommonDir, hashedIdValue, idValueLimit, issue, lockSteps, parseRegistry, RegistryError, registryText, takeOver, withLock, type Registry } from '../src/registry.ts';
import { runDataTool } from '../src/run.ts';
import { args, fixture, table, tempDir, writeFiles, type Fixture } from './helpers.ts';

function git(cwd: string, a: string[], input?: string): string {
  return execFileSync('git', a, { cwd, encoding: 'utf8', input, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
}

/** A game repo with an `id-registry` branch holding a registry, and the work branch checked out. */
function repo(registry: Record<string, number>): Fixture {
  const f = fixture({ files: { 'data/tables/b.csv': table(['id|id(key)|All'], [['[b2]'], ['[b1]']]), 'data/tables/a.csv': table(['id|id(key)|All'], [['[a]'], ['[kept]']]) } });
  git(f.game, ['init', '-q', '-b', 'main']);
  git(f.game, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const blob = git(f.game, ['hash-object', '-w', '--stdin'], registryText(new Map(Object.entries(registry))));
  const tree = git(f.game, ['mktree'], `100644 blob ${blob}\tid_registry.json\n`);
  const commit = git(f.game, ['commit-tree', tree, '-m', 'registry']);
  git(f.game, ['update-ref', 'refs/heads/id-registry', commit]);
  return f;
}

function branchArgs(f: Fixture, extra: string[] = []): string[] {
  return args(f, extra).filter((a, i, all) => a !== '--id-registry' && all[i - 1] !== '--id-registry');
}

/** Moves the `id-registry` branch to a new commit holding the registry plus `added`. */
function moveBranch(f: Fixture, added: Record<string, number>): void {
  const now = JSON.parse(git(f.game, ['show', 'id-registry:id_registry.json'])) as Record<string, number>;
  const blob = git(f.game, ['hash-object', '-w', '--stdin'], registryText(new Map(Object.entries({ ...now, ...added }))));
  const tree = git(f.game, ['mktree'], `100644 blob ${blob}\tid_registry.json\n`);
  const commit = git(f.game, ['commit-tree', tree, '-p', 'id-registry', '-m', 'other worktree']);
  git(f.game, ['update-ref', 'refs/heads/id-registry', commit]);
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** A worktree of the game repo with the same data files, as another work branch would have. */
function worktree(f: Fixture): string {
  const wt = join(f.root, 'wt');
  git(f.game, ['worktree', 'add', '-q', '-b', 'work', wt]);
  cpSync(join(f.game, 'data'), join(wt, 'data'), { recursive: true });
  return wt;
}

describe('ID registry lock and branch moves', () => {
  test('the branch moving between the read and update-ref: values are issued again from the new head, no mapping is lost', () => {
    const f = repo({ '[kept]': 7 });
    let moves = 0;
    const store = branchStore(f.game, () => {
      if (moves === 0) moveBranch(f, { '[other]': 8 });
      moves += 1;
    });
    const out = store.issue(new Set(['[a]', '[kept]']));
    expect(moves).toBe(2);
    expect(out).toEqual(new Map([['[kept]', 7], ['[other]', 8], ['[a]', 1287278444]]));
    expect(JSON.parse(git(f.game, ['show', 'id-registry:id_registry.json']))).toEqual({ '[a]': 1287278444, '[kept]': 7, '[other]': 8 });
    expect(git(f.game, ['rev-list', '--count', 'id-registry'])).toBe('3');
  });

  test('a branch that keeps moving fails the issue after the retries', () => {
    const f = repo({ '[kept]': 7 });
    let n = 0;
    const out = branchStore(f.game, () => { n += 1; moveBranch(f, { [`[other_${String(n)}]`]: 100 + n }); }).issue(new Set(['[a]']));
    expect(out).toBeTypeOf('string');
    expect(out).toContain('kept moving');
  });

  test('a lock that another process holds in the git common dir makes a run in another worktree wait for it', async () => {
    const f = repo({ '[kept]': 7 });
    const wt = worktree(f);
    const common = gitCommonDir(wt) as string;
    expect(realpathSync(common)).toBe(realpathSync(gitCommonDir(f.game) as string));
    const lock = join(common, 'ogw-id-registry.lock');
    const holder = spawn(process.execPath, ['-e', `const fs = require("node:fs"); fs.writeFileSync(${JSON.stringify(lock)}, process.pid + "\\nholder\\n", { flag: "wx" }); setTimeout(() => fs.rmSync(${JSON.stringify(lock)}), 1500);`]);
    const exited = new Promise((resolve) => holder.on('exit', resolve));
    for (let i = 0; i < 100 && !existsSync(lock); i += 1) sleep(20);
    expect(existsSync(lock)).toBe(true);
    const start = Date.now();
    const r = runDataTool(branchArgs({ ...f, game: wt }));
    const waited = Date.now() - start;
    await exited;
    expect(r.stderr).toEqual([]);
    expect(r.code).toBe(0);
    expect(waited).toBeGreaterThanOrEqual(1000);
    expect(JSON.parse(git(f.game, ['show', 'id-registry:id_registry.json']))).toEqual({ '[a]': 1287278444, '[b1]': 924983006, '[b2]': 586265708, '[kept]': 7 });
    expect(existsSync(lock)).toBe(false);
  });

  test('a lock whose owner process is gone is taken over', () => {
    const f = repo({ '[kept]': 7 });
    const lock = join(gitCommonDir(f.game) as string, 'ogw-id-registry.lock');
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(lock, `${String(gone)}\ndead\n`);
    const start = Date.now();
    const r = runDataTool(branchArgs(f));
    expect(r.code).toBe(0);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(JSON.parse(git(f.game, ['show', 'id-registry:id_registry.json']))).toEqual({ '[a]': 1287278444, '[b1]': 924983006, '[b2]': 586265708, '[kept]': 7 });
    expect(readdirSync(dirname(lock)).filter((n) => n.startsWith('ogw-id-registry.lock'))).toEqual([]);
  });

  test('of two runs that both judged a lock stale, the one holding the claim takes it over and the other fails; a lock taken again in between is not taken over', () => {
    const lock = join(tempDir(), 'ogw-id-registry.lock');
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    const judged = `${String(gone)}\ndead\n`;
    writeFileSync(lock, judged);
    const a = `${String(process.pid)}\na\n`;
    const b = `${String(process.pid)}\nb\n`;
    // b tries while a holds the claim, then again after a took the lock over
    let during: boolean | null = null;
    lockSteps.at = (step, path) => {
      if (step !== 'claimed' || during !== null) return;
      expect(path).toBe(lock);
      expect(readFileSync(`${lock}.takeover`, 'utf8')).toBe(a);
      during = takeOver(lock, judged, b);
    };
    try {
      expect(takeOver(lock, judged, a)).toBe(true);
    } finally {
      lockSteps.at = () => undefined;
    }
    expect(during).toBe(false);
    expect(readFileSync(lock, 'utf8')).toBe(a);
    expect(takeOver(lock, judged, b)).toBe(false);
    expect(readFileSync(lock, 'utf8')).toBe(a);
    expect(readdirSync(dirname(lock))).toEqual(['ogw-id-registry.lock']);

    rmSync(lock);
    writeFileSync(lock, `${String(process.pid)}\nfresh\n`);
    expect(takeOver(lock, judged, `${String(process.pid)}\nc\n`)).toBe(false);
    expect(readFileSync(lock, 'utf8')).toBe(`${String(process.pid)}\nfresh\n`);
    expect(readdirSync(dirname(lock))).toEqual(['ogw-id-registry.lock']);
  });

  test('a held lock is one file with this run\'s pid and token; the release removes it and leaves nothing beside it', () => {
    const lock = join(tempDir(), 'ogw-id-registry.lock');
    const inFn = withLock(lock, () => ({ text: readFileSync(lock, 'utf8'), names: readdirSync(dirname(lock)) }));
    expect(inFn.text).toMatch(new RegExp(`^${String(process.pid)}\n[0-9a-f]{16}\n$`));
    expect(inFn.names).toEqual(['ogw-id-registry.lock']);
    expect(readdirSync(dirname(lock))).toEqual([]);
  });

  test('a takeover puts this run\'s lock in place of the dead owner\'s and removes its claim', () => {
    const lock = join(tempDir(), 'ogw-id-registry.lock');
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(lock, `${String(gone)}\ndead\n`);
    const inFn = withLock(lock, () => ({ text: readFileSync(lock, 'utf8'), names: readdirSync(dirname(lock)) }));
    expect(inFn.text).toMatch(new RegExp(`^${String(process.pid)}\n[0-9a-f]{16}\n$`));
    expect(inFn.names).toEqual(['ogw-id-registry.lock']);
    expect(readdirSync(dirname(lock))).toEqual([]);
  });

  test('a lock that no longer holds this run\'s owner text is not removed by its release', () => {
    const lock = join(tempDir(), 'ogw-id-registry.lock');
    const other = `${String(process.ppid)}\nother\n`;
    withLock(lock, () => { writeFileSync(lock, other); });
    expect(readFileSync(lock, 'utf8')).toBe(other);
  });

  test('the run that takes the lock removes the temporary files of runs that ended before linking them; files of a live pid and files that do not read stay, and the lock and claim are not touched', () => {
    const dir = tempDir();
    const lock = join(dir, 'ogw-id-registry.lock');
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    const temp = (path: string, pid: number, token: string, text = `${String(pid)}\n${token}\n`): string => {
      const name = `${path}.${String(pid)}-${token}`;
      writeFileSync(name, text);
      return name;
    };
    const deadLock = temp(lock, gone, '0123456789abcdef');
    const deadClaim = temp(`${lock}.takeover`, gone, '1123456789abcdef');
    const live = temp(lock, process.ppid, '2123456789abcdef');
    const empty = temp(lock, gone, '3123456789abcdef', '');
    const otherPid = temp(lock, gone, '4123456789abcdef', `${String(process.ppid)}\n4123456789abcdef\n`);
    const notOwner = temp(lock, gone, '5123456789abcdef', `${String(gone)}\nnot a token\n`);
    // `place` names the file with a token of its own, so a dead pid's file with another token in it is removed
    const ownToken = temp(lock, gone, '8123456789abcdef', `${String(gone)}\nffffffffffffffff\n`);
    const unreadable = temp(lock, gone, '6123456789abcdef');
    chmodSync(unreadable, 0o000);
    const notTemp = [`${lock}.${String(gone)}`, `${lock}.${String(gone)}-short`, `${lock}x.${String(gone)}-7123456789abcdef`].map((name) => {
      writeFileSync(name, `${String(gone)}\n7123456789abcdef\n`);
      return name;
    });
    // a live claim beside the lock this run holds: the removal leaves it
    const claim = `${lock}.takeover`;
    const inFn = withLock(lock, () => {
      writeFileSync(claim, `${String(process.ppid)}\nclaim\n`);
      return readdirSync(dir);
    });
    try {
      expect(inFn).not.toContain(deadLock.slice(dir.length + 1));
      expect(inFn).not.toContain(deadClaim.slice(dir.length + 1));
      expect(inFn).not.toContain(ownToken.slice(dir.length + 1));
      expect(readdirSync(dir).sort()).toEqual([claim, live, empty, otherPid, notOwner, unreadable, ...notTemp].map((p) => p.slice(dir.length + 1)).sort());
      expect(readFileSync(claim, 'utf8')).toBe(`${String(process.ppid)}\nclaim\n`);
    } finally {
      chmodSync(unreadable, 0o644);
    }
  });

  test('issuing into an --id-registry file removes the new registry files of runs that ended before renaming them; files of a live pid, files that do not read as a registry and the lock\'s files stay', () => {
    const dir = tempDir();
    const path = join(dir, 'id_registry.json');
    writeFileSync(path, registryText(new Map([['[kept]', 7]])));
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    const temp = (pid: number, token: string, text = registryText(new Map([['[x]', 1]]))): string => {
      const name = `${path}.${String(pid)}-${token}`;
      writeFileSync(name, text);
      return name;
    };
    const dead = temp(gone, '0123456789abcdef');
    const deadEmpty = temp(gone, '1123456789abcdef', '{}\n');
    const live = temp(process.ppid, '2123456789abcdef');
    const notRegistry = temp(gone, '3123456789abcdef', '{"[x]": 1');
    const unreadable = temp(gone, '4123456789abcdef');
    chmodSync(unreadable, 0o000);
    // names of the lock beside a registry outside git, and names that are not a new registry file
    const kept = [`${path}.lock.${String(gone)}-5123456789abcdef`, `${path}.${String(gone)}`, `${path}.${String(gone)}-short`, `${path}x.${String(gone)}-6123456789abcdef`].map((name) => {
      writeFileSync(name, name.includes('.lock.') ? `${String(process.ppid)}\n5123456789abcdef\n` : '{}\n');
      return name;
    });
    try {
      const issued = fileStore(path).issue(new Set(['[a]']));
      expect(issued instanceof Map ? Object.fromEntries(issued) : issued).toEqual({ '[kept]': 7, '[a]': 1287278444 });
      const left = readdirSync(dir);
      expect(left).not.toContain(dead.slice(dir.length + 1));
      expect(left).not.toContain(deadEmpty.slice(dir.length + 1));
      expect(left.sort()).toEqual([path, live, notRegistry, unreadable, ...kept].map((p) => p.slice(dir.length + 1)).sort());
    } finally {
      chmodSync(unreadable, 0o644);
    }
  });

  test('the removal of temporary files never removes the lock it holds: the lock stays this run\'s until fn ends', () => {
    const dir = tempDir();
    const lock = join(dir, 'ogw-id-registry.lock');
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(`${lock}.${String(gone)}-0123456789abcdef`, `${String(gone)}\n0123456789abcdef\n`);
    const text = withLock(lock, () => readFileSync(lock, 'utf8'));
    expect(text).toMatch(new RegExp(`^${String(process.pid)}\n[0-9a-f]{16}\n$`));
    expect(readdirSync(dir)).toEqual([]);
  });

  test('runs in several processes take the lock one at a time and leave nothing behind', () => {
    const dir = tempDir();
    const lock = join(dir, 'ogw-id-registry.lock');
    const inside = join(dir, 'inside');
    const log = join(dir, 'log');
    const script = [
      `import { appendFileSync, rmSync, writeFileSync } from 'node:fs';`,
      `import { withLock } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '..', 'src', 'registry.ts')).href)};`,
      'for (let i = 0; i < 8; i += 1) withLock(process.argv[1], () => {',
      `  writeFileSync(process.argv[2], '', { flag: 'wx' });`,
      '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);',
      '  rmSync(process.argv[2]);',
      `  appendFileSync(process.argv[3], 'x');`,
      '});',
    ].join('\n');
    const runs = Array.from({ length: 4 }, () => spawn(process.execPath, ['--input-type=module', '-e', script, lock, inside, log], { stdio: ['ignore', 'ignore', 'pipe'] }));
    const codes = runs.map((run) => {
      let err = '';
      run.stderr.on('data', (d: Buffer) => { err += d.toString(); });
      return new Promise<string>((resolve) => { run.on('exit', (code) => { resolve(`${String(code)} ${err}`); }); });
    });
    return Promise.all(codes).then((out) => {
      expect(out).toEqual(['0 ', '0 ', '0 ', '0 ']);
      expect(readFileSync(log, 'utf8')).toBe('x'.repeat(32));
      expect(readdirSync(dir).sort()).toEqual(['log']);
    });
  });

  test('a lock whose owner is gone but whose claim owner runs is waited for, then the claim and the lock are taken over', () => {
    const f = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All'], [['[a]']]) }, registry: { '[kept]': 7 } });
    const lock = `${f.registry}.lock`;
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(lock, `${String(gone)}\ndead\n`);
    // Not a child of this process: a child that ends stays a zombie while the run blocks the event loop.
    const holder = execFileSync('sh', ['-c', `"${process.execPath}" -e 'setTimeout(() => undefined, 1500)' >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' }).trim();
    writeFileSync(`${lock}.takeover`, `${holder}\nclaim\n`);
    const start = Date.now();
    const r = runDataTool(args(f));
    const waited = Date.now() - start;
    expect(r).toEqual({ code: 0, stdout: [], stderr: [] });
    expect(waited).toBeGreaterThanOrEqual(1000);
    expect(JSON.parse(readFileSync(f.registry, 'utf8'))).toEqual({ '[a]': 1287278444, '[kept]': 7 });
    expect(readdirSync(f.root).filter((n) => n.startsWith('id_registry.json.'))).toEqual([]);
  });

  test('a claim whose owner is gone beside a live lock does not free the lock: the lock is waited for, and once its owner is gone too both are taken over', () => {
    const lock = join(tempDir(), 'ogw-id-registry.lock');
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    const holder = execFileSync('sh', ['-c', `"${process.execPath}" -e 'setTimeout(() => undefined, 1500)' >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' }).trim();
    writeFileSync(lock, `${holder}\nlive\n`);
    writeFileSync(`${lock}.takeover`, `${String(gone)}\ndead\n`);
    const start = Date.now();
    expect(() => {
      withLock(lock, () => undefined, 300);
    }).toThrow(`its owner process ${holder} still runs`);
    expect(readFileSync(lock, 'utf8')).toBe(`${holder}\nlive\n`);
    expect(readFileSync(`${lock}.takeover`, 'utf8')).toBe(`${String(gone)}\ndead\n`);
    // the holder ends without removing its lock
    expect(withLock(lock, () => readFileSync(lock, 'utf8'))).toMatch(new RegExp(`^${String(process.pid)}\n`));
    expect(Date.now() - start).toBeGreaterThanOrEqual(1000);
    expect(readdirSync(dirname(lock))).toEqual([]);
  });

  test.each([
    ['a folder, the lock of an older data tool', (lock: string) => { mkdirSync(lock); writeFileSync(join(lock, 'pid'), '1\nold\n'); }],
    ['a file this run cannot read', (lock: string) => { writeFileSync(lock, `${String(spawnSync(process.execPath, ['-e', '']).pid)}\ndead\n`); chmodSync(lock, 0o000); }],
    ['an empty file', (lock: string) => { writeFileSync(lock, ''); }],
    ['a file whose first line is not a pid', (lock: string) => { writeFileSync(lock, 'note\n'); }],
  ])('a lock that does not read as an owner pid (%s) is not taken over: the wait ends with a RegistryError that says what to remove', (_, make) => {
    const dir = tempDir();
    const lock = join(dir, 'ogw-id-registry.lock');
    make(lock);
    let ran = false;
    const start = Date.now();
    try {
      expect(() => { withLock(lock, () => { ran = true; }, 300); }).toThrow(RegistryError);
      expect(() => { withLock(lock, () => { ran = true; }, 300); }).toThrow(`the ID registry lock ${lock} was busy for 0 s: ${lock} does not read as an owner pid, so its owner is not known; remove ${lock} when no data tool runs`);
    } finally {
      chmodSync(lock, 0o755);
    }
    expect(Date.now() - start).toBeGreaterThanOrEqual(600);
    expect(ran).toBe(false);
    expect(readdirSync(dir)).toEqual(['ogw-id-registry.lock']);
  });

  test('a claim that does not read beside a stale lock is not taken over: the takeover fails, and the wait names the claim to remove', () => {
    const lock = join(tempDir(), 'ogw-id-registry.lock');
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(lock, `${String(gone)}\ndead\n`);
    writeFileSync(`${lock}.takeover`, '');
    expect(takeOver(lock, `${String(gone)}\ndead\n`, `${String(process.pid)}\nmine\n`)).toBe(false);
    let ran = false;
    expect(() => { withLock(lock, () => { ran = true; }, 200); }).toThrow(`${lock}.takeover does not read as an owner pid, so its owner is not known; remove ${lock}.takeover when no data tool runs`);
    expect(ran).toBe(false);
    expect(readFileSync(lock, 'utf8')).toBe(`${String(gone)}\ndead\n`);
    expect(readFileSync(`${lock}.takeover`, 'utf8')).toBe('');
  });

  test('git failing with a stderr of several lines in the id-registry branch issue is exit code 2 with one stderr line', () => {
    const f = repo({ '[kept]': 7 });
    const objects = join(gitCommonDir(f.game) as string, 'objects');
    execFileSync('chmod', ['-R', 'a-w', objects]);
    try {
      const raw = (() => {
        try {
          branchStore(f.game).issue(new Set(['[a]']));
          return '';
        } catch (error) {
          return (error as Error).message;
        }
      })();
      // the git error itself is several lines, so the one-line reason below is the data tool's doing
      expect(raw.split('\n').length).toBeGreaterThan(1);
      const r = runDataTool(branchArgs(f));
      expect(r.code).toBe(2);
      expect(r.stdout).toEqual([]);
      expect(r.stderr).toHaveLength(1);
      expect(r.stderr[0]).not.toMatch(/[\r\n]/);
      expect(r.stderr[0]).toMatch(/^git hash-object failed in .*: \S.*; \S/);
      for (const line of raw.split('\n').slice(1)) expect(r.stderr[0]).toContain(line.trim());
    } finally {
      execFileSync('chmod', ['-R', 'u+w', objects]);
    }
    expect(existsSync(join(f.game, 'server', 'generated'))).toBe(false);
  });

  test('git failing in the id-registry branch issue is exit code 2 with the git error, not a branch that kept moving, and writes nothing', () => {
    const f = repo({ '[kept]': 7 });
    const heads = join(gitCommonDir(f.game) as string, 'refs', 'heads');
    const before = git(f.game, ['rev-parse', 'id-registry']);
    chmodSync(heads, 0o555);
    try {
      const r = runDataTool(branchArgs(f));
      expect(r.code).toBe(2);
      expect(r.stdout).toEqual([]);
      expect(r.stderr).toHaveLength(1);
      expect(r.stderr[0]).toMatch(/^git update-ref failed in .*: /);
    } finally {
      chmodSync(heads, 0o755);
    }
    expect(git(f.game, ['rev-parse', 'id-registry'])).toBe(before);
    expect(existsSync(join(f.game, 'server', 'generated'))).toBe(false);
    expect(existsSync(join(f.game, 'server', 'build'))).toBe(false);
  });

  test('an id_registry.json of the id-registry branch that git cannot read is exit code 2 with the git error, not a structure line', () => {
    const f = repo({ '[kept]': 7 });
    const blob = git(f.game, ['rev-parse', 'id-registry:id_registry.json']);
    const object = join(gitCommonDir(f.game) as string, 'objects', blob.slice(0, 2), blob.slice(2));
    chmodSync(object, 0o000);
    try {
      const r = runDataTool(branchArgs(f));
      expect(r.stdout).toEqual([]);
      expect(r.code).toBe(2);
      expect(r.stderr).toHaveLength(1);
      expect(r.stderr[0]).toMatch(/^ID registry: id_registry\.json of the id-registry branch does not read: git show failed in .*: \S/);
    } finally {
      chmodSync(object, 0o444);
    }
    expect(existsSync(join(f.game, 'server', 'generated'))).toBe(false);
  });

  test('an id-registry branch without id_registry.json is exit code 2 that names the file', () => {
    const f = repo({});
    const tree = git(f.game, ['mktree'], '');
    git(f.game, ['update-ref', 'refs/heads/id-registry', git(f.game, ['commit-tree', tree, '-p', 'id-registry', '-m', 'empty'])]);
    const r = runDataTool(branchArgs(f));
    expect(r.stdout).toEqual([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toEqual([expect.stringMatching(/^ID registry: id_registry\.json of the id-registry branch does not read: git show failed in .*: \S/)]);
  });

  test('an --id-registry file that cannot be read is exit code 2 whose line gives the error code once', () => {
    const f = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All'], [['[a]']]) }, registry: { '[kept]': 7 } });
    chmodSync(f.registry, 0o000);
    try {
      const r = runDataTool(args(f));
      expect(r.stdout).toEqual([]);
      expect(r.code).toBe(2);
      expect(r.stderr).toEqual([`EACCES: permission denied, open '${f.registry}'`]);
    } finally {
      chmodSync(f.registry, 0o644);
    }
  });

  test('the --id-registry file changing between the read and the write: values are issued again from the new file, no mapping is lost', () => {
    const f = fixture({ registry: { '[kept]': 7 } });
    let moved = false;
    const store = fileStore(f.registry, () => {
      if (moved) return;
      moved = true;
      writeFileSync(f.registry, registryText(new Map([['[kept]', 7], ['[other]', 8]])));
    });
    const issued = store.issue(new Set(['[a]', '[kept]']));
    expect(issued instanceof Map ? Object.fromEntries(issued) : issued).toEqual({ '[kept]': 7, '[other]': 8, '[a]': 1287278444 });
    expect(JSON.parse(readFileSync(f.registry, 'utf8'))).toEqual({ '[a]': 1287278444, '[kept]': 7, '[other]': 8 });
    expect(readdirSync(f.root).filter((n) => n.startsWith('id_registry.json'))).toEqual(['id_registry.json']);
  });
});

describe('ID registry', () => {
  test('a new ID name gets the first 8 bytes of SHA-256 of its UTF-8 bytes, big-endian, mod 2147483647, plus 1; issued mappings stay', () => {
    const expected = (name: string): number => Number(createHash('sha256').update(Buffer.from(name, 'utf8')).digest().readBigUInt64BE(0) % 2147483647n) + 1;
    expect(hashedIdValue('[a]')).toBe(1287278444);
    expect(hashedIdValue('[x]')).toBe(1119835138);
    for (const name of ['[b]', '[_z]', '[kept]', '[sword_basic]', '[검]']) expect(hashedIdValue(name)).toBe(expected(name));
    const next = issue(new Map([['[kept]', 5], ['[gone]', 9]]), ['[b]', '[a]', '[kept]', '[_z]']);
    expect(next instanceof Map ? [...next] : next).toEqual([['[kept]', 5], ['[gone]', 9], ['[_z]', expected('[_z]')], ['[a]', 1287278444], ['[b]', expected('[b]')]]);
    const one = issue(new Map(), ['[x]']);
    expect(one instanceof Map ? one.get('[x]') : one).toBe(1119835138);
  });

  test('a hashed ID value another ID name has goes up by 1 to a free value; two new names with one hashed value get it in byte order', () => {
    // [n42605] and [n72480] both hash to 1073553126
    expect(hashedIdValue('[n42605]')).toBe(1073553126);
    expect(hashedIdValue('[n72480]')).toBe(1073553126);
    const taken = issue(new Map([['[p]', 1287278444], ['[q]', 1287278444 + 1]]), ['[a]']);
    expect(taken instanceof Map ? taken.get('[a]') : taken).toBe(1287278444 + 2);
    const both = issue(new Map([['[p]', 1073553127]]), ['[n72480]', '[n42605]']);
    expect(both instanceof Map ? Object.fromEntries(both) : both).toEqual({ '[p]': 1073553127, '[n42605]': 1073553126, '[n72480]': 1073553128 });
  });

  test('the search for a free value goes from 2147483647 back to 1', () => {
    // [w3451645] hashes to 2147483201
    expect(hashedIdValue('[w3451645]')).toBe(2147483201);
    const held: Registry = new Map();
    for (let v = 2147483201; v <= 2147483647; v += 1) held.set(`[h_${String(v)}]`, v);
    held.set('[h_1]', 1);
    held.set('[h_2]', 2);
    const next = issue(held, ['[w3451645]']);
    expect(next instanceof Map ? next.get('[w3451645]') : next).toBe(3);
  });

  test('a registry with a free value for each new name gets them all; one value short issues nothing', () => {
    const held: Registry = new Map([['[p]', 1], ['[q]', 3]]);
    const fits = issue(held, ['[b]', '[a]'], 4);
    expect(fits instanceof Map ? [...fits.values()].sort((x, y) => x - y) : fits).toEqual([1, 2, 3, 4]);
    // [a] hashes to 1287278444: 1287278443 mod 4, plus 1, is 4
    expect(fits instanceof Map ? fits.get('[a]') : fits).toBe(4);
    expect(issue(held, ['[c]', '[b]', '[a]'], 4)).toBe('the ID registry has no ID value left for 3 new ID names');
    expect(issue(new Map([['[p]', 1], ['[q]', 2]]), ['[a]'], 2)).toBe('the ID registry has no ID value left for 1 new ID names');
    expect([...held]).toEqual([['[p]', 1], ['[q]', 3]]);
  });

  test('only values up to the largest one count as taken', () => {
    const next = issue(new Map([['[p]', 1], ['[big]', 100]]), ['[a]'], 2);
    expect(next instanceof Map ? next.get('[a]') : next).toBe(2);
  });

  test('a run with no ID value left is exit code 2 with one stderr line and writes neither the --id-registry file nor a generation target; a value left for each new name passes', () => {
    const f = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All'], [['[a]'], ['[kept]']]) }, registry: { '[kept]': 1 } });
    const before = readFileSync(f.registry, 'utf8');
    try {
      idValueLimit.max = 1;
      expect(runDataTool(args(f))).toEqual({ code: 2, stdout: [], stderr: ['ID registry: the ID registry has no ID value left for 1 new ID names'] });
      expect(readFileSync(f.registry, 'utf8')).toBe(before);
      expect(readdirSync(f.root).filter((n) => n.startsWith('id_registry.json'))).toEqual(['id_registry.json']);
      expect(existsSync(join(f.game, 'server'))).toBe(false);
      idValueLimit.max = 2;
      expect(runDataTool(args(f))).toEqual({ code: 0, stdout: [], stderr: [] });
      expect(JSON.parse(readFileSync(f.registry, 'utf8'))).toEqual({ '[a]': 2, '[kept]': 1 });
    } finally {
      idValueLimit.max = 2147483647;
    }
  });

  test('the id-registry branch with no ID value left is exit code 2 and the branch stays where it was', () => {
    const f = repo({ '[kept]': 1, '[a]': 2 });
    const head = git(f.game, ['rev-parse', 'id-registry']);
    try {
      idValueLimit.max = 3;
      const r = runDataTool(branchArgs(f));
      expect(r).toEqual({ code: 2, stdout: [], stderr: ['ID registry: the ID registry has no ID value left for 2 new ID names'] });
      expect(git(f.game, ['rev-parse', 'id-registry'])).toBe(head);
      expect(existsSync(join(f.game, 'server'))).toBe(false);
    } finally {
      idValueLimit.max = 2147483647;
    }
  });

  test('a name that is not an ID name is not issued, so the registry never fails its own form check', () => {
    expect(issue(new Map([['[a]', 1]]), ['[b]', '[req__t__c__[x]__1]'])).toBe('[req__t__c__[x]__1] is not an ID name');
    expect(issue(new Map(), ['Bad'])).toBeTypeOf('string');
    const f = fixture({ registry: { '[a]': 1 } });
    writeFileSync(f.registry, registryText(new Map([['[a]', 1]])));
    expect(fileStore(f.registry).issue(new Set(['[b]', '[stage_[1]]']))).toBeTypeOf('string');
    expect(readFileSync(f.registry, 'utf8')).toBe('{\n  "[a]": 1\n}\n');
  });

  test('an int key column holding an ID name makes a requirement row name with the inner name; later runs pass', () => {
    const f = fixture({
      files: {
        'data/tables/stage.csv': table(['id|id(key)|All'], [['[stage_1]']]),
        'data/tables/reward.csv': table(['id|id|All', 'stage|int|All', 'desc|tstring<id,stage>|All', 'req|requirement<id,stage>|All'], [['[r]', '[stage_1]', '보상', 'Level(3)']]),
        'data/enums.csv': 'type,element,value,#comment\nRequirementType,Level,1,\n',
        'data/requirement_types.csv': 'element,target,value,#comment\nLevel,none,true,\n',
      },
    });
    const first = runDataTool(args(f));
    expect(first.stdout).toEqual([]);
    expect(first.code).toBe(0);
    const ids = JSON.parse(readFileSync(f.registry, 'utf8')) as Record<string, number>;
    expect(Object.keys(ids).sort()).toEqual(['[r]', '[req__reward__req__r__stage_1__1]', '[stage_1]']);
    expect(runDataTool(args(f))).toEqual({ code: 0, stdout: [], stderr: [] });
  });

  test('the form check: object, ID name keys, int32 values of 1 or more, unique values', () => {
    expect(parseRegistry('[]')).toBeTypeOf('string');
    expect(parseRegistry('{"bad": 1}')).toBeTypeOf('string');
    expect(parseRegistry('{"[a]": 0}')).toBeTypeOf('string');
    expect(parseRegistry('{"[a]": 1.5}')).toBeTypeOf('string');
    expect(parseRegistry('{"[a]": 2147483648}')).toBeTypeOf('string');
    expect(parseRegistry('{"[a]": 1, "[b]": 1}')).toBeTypeOf('string');
    expect(parseRegistry('{"[a]": 1, "[b]": 2}')).toBeInstanceOf(Map);
  });

  test('the --id-registry file: issued values are written with keys in byte order and are the same next run', () => {
    const f = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All'], [['[zeta]'], ['[alpha]']]) }, registry: { '[old]': 3 } });
    expect(runDataTool(args(f)).code).toBe(0);
    const text = readFileSync(f.registry, 'utf8');
    expect(text).toBe('{\n  "[alpha]": 1337587382,\n  "[old]": 3,\n  "[zeta]": 1492545443\n}\n');
    expect(runDataTool(args(f)).code).toBe(0);
    expect(readFileSync(f.registry, 'utf8')).toBe(text);
  });

  test('the id-registry branch: issuing commits on that branch without changing the checked out branch', () => {
    const f = repo({ '[kept]': 7 });
    const r = runDataTool(branchArgs(f));
    expect(r.stderr).toEqual([]);
    expect(r.code).toBe(0);
    expect(git(f.game, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
    expect(JSON.parse(git(f.game, ['show', 'id-registry:id_registry.json']))).toEqual({ '[a]': 1287278444, '[b1]': 924983006, '[b2]': 586265708, '[kept]': 7 });
    expect(git(f.game, ['rev-list', '--count', 'id-registry'])).toBe('2');
    expect(runDataTool(branchArgs(f)).code).toBe(0);
    expect(git(f.game, ['rev-list', '--count', 'id-registry'])).toBe('2');
  });

  test('a binary build does not issue: an ID name the registry does not have fails it', () => {
    const f = repo({ '[a]': 1, '[b1]': 2, '[b2]': 3 });
    runDataTool(branchArgs(f, []));
    writeFiles(f.game, { 'data/tables/c.csv': table(['id|id(key)|All'], [['[new]']]) });
    const r = runDataTool(branchArgs(f, ['--binary']));
    expect(r.code).toBe(1);
    expect(r.stderr.join('\n')).toContain('[new]');
    expect(git(f.game, ['show', 'id-registry:id_registry.json'])).not.toContain('[new]');
  });

  test('a game repo without the id-registry branch is an input error', () => {
    const f = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All'], [['[a]']]) } });
    git(f.game, ['init', '-q', '-b', 'main']);
    const r = runDataTool(branchArgs(f));
    expect(r.code).toBe(2);
    expect(r.stderr.join('\n')).toContain('id-registry');
  });

  test('a registry file that fails the form check gets a structure line and no ID values are issued', () => {
    const f = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All'], [['[a]']]) } });
    writeFileSync(f.registry, '{"[x]": -1}');
    const r = runDataTool(args(f));
    expect(r.code).toBe(1);
    expect(r.stdout[0]).toMatch(/^id_registry\.json:1:1 ERROR structure /);
    expect(readFileSync(f.registry, 'utf8')).toBe('{"[x]": -1}');
    expect(readFileSync(join(f.root, 'id_registry.json'), 'utf8')).toBe('{"[x]": -1}');
  });
});
