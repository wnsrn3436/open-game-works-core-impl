/** The server image file `server/core/Dockerfile`: its base image, and images built from it. */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as real_wait } from 'node:timers/promises';
import { core_test_server_paths, new_core_test_server_input } from '../../testing/dev/index.ts';

const run_paths = core_test_server_paths();
const DOCKERFILE_PATH = 'server/core/Dockerfile';
const CHECKOUT = dirname(run_paths.server_root);
/** The first build pulls the base image. */
const BUILD_TIME_MS = 300_000;

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(program: string, args: readonly string[], cwd?: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(program, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1;
      resolve({ code, stdout, stderr });
    });
  });
}

/** A copy of a game `server/` holding DEV code, with the server module list of an environment and its content `main.ts`. */
function build_context(folder: string, server_modules: readonly string[], main_ts: string): string {
  const server = join(folder, 'server');
  cpSync(run_paths.server_root, server, { recursive: true, filter: (source) => !source.includes('node_modules') && !source.includes(join('server', 'build')) });
  writeFileSync(join(server, 'main.ts'), main_ts);
  cpSync(run_paths.data_folder, join(server, 'build', 'data'), { recursive: true, dereference: true });
  mkdirSync(join(server, 'tests'), { recursive: true });
  writeFileSync(join(server, 'tests', 'regression.test.ts'), '\n');
  writeFileSync(join(server, 'generated', 'core_settings.json'), JSON.stringify(run_paths.settings));
  writeFileSync(join(server, 'generated', 'server_modules.json'), JSON.stringify(server_modules));
  // A host whose umask leaves a build context file readable only by its owner.
  chmodSync(join(server, 'generated', 'server_modules.json'), 0o600);
  return server;
}

/** Builds the image of a build context into the local image store the way the build does, under `tag`. */
async function build_image(tag: string, server: string): Promise<void> {
  const built = await run('docker', ['buildx', 'build', '--file', join(server, 'core', 'Dockerfile'), '--load', '--tag', tag, server]);
  if (built.code !== 0) throw new Error(`docker buildx build failed: ${built.stderr}`);
}

/** The regular files of an image below its working directory. */
async function image_paths(tag: string): Promise<string[]> {
  const listed = await run('docker', ['run', '--rm', '--entrypoint', 'find', tag, '.', '-type', 'f']);
  expect(listed.code).toBe(0);
  return listed.stdout.split('\n').filter((line) => line !== '').map((line) => line.replace(/^\.\//, ''));
}

/** A started server process's error log messages on stdout. */
function error_messages(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.kind === 'error')
    .map((line) => String(line.message));
}

const is_dev_code = (path: string): boolean => /^(dev|core\/[^/]+\/dev)\//.test(path);

describe('server image file', () => {
  it('is a file of server/core/ that git keeps, so server.tgz holds it', async () => {
    expect(existsSync(join(CHECKOUT, DOCKERFILE_PATH))).toBe(true);
    const listed = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', DOCKERFILE_PATH], CHECKOUT);
    expect(listed.code).toBe(0);
    expect(listed.stdout.trim()).toBe(DOCKERFILE_PATH);
  });

  it('pins its base image by digest, with the Node major of this test run', () => {
    const text = readFileSync(join(CHECKOUT, DOCKERFILE_PATH), 'utf8');
    const pinned = /^ARG NODE_IMAGE=node:([0-9]+)-[a-z0-9-]+@sha256:[0-9a-f]{64}$/m.exec(text);
    expect(pinned?.[1]).toBe(process.versions.node.split('.')[0]);
    const from = text.split('\n').filter((line) => line.startsWith('FROM '));
    expect(from.length).toBeGreaterThan(0);
    for (const line of from) expect(line).toContain('${NODE_IMAGE}');
  });
});

describe('server image', () => {
  const dev_tag = `ogw-core-test-${randomUUID()}`;
  const stg_tag = `ogw-core-test-${randomUUID()}`;
  let folder = '';

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'routing-server-image-'));
    const with_dev = run_paths.server_modules.includes('cheat') ? run_paths.server_modules : [...run_paths.server_modules, 'cheat'];
    const dev_server = build_context(join(folder, 'dev'), with_dev, `export { core_test_register as register } from './core/testing/dev/index.ts';\n`);
    const input = await new_core_test_server_input('sqlite');
    writeFileSync(join(dev_server, 'secrets.json'), JSON.stringify(input.secrets.file));
    await input.drop();
    const stg_server = build_context(join(folder, 'stg'), with_dev.filter((module) => module !== 'cheat' && module !== 'testing'), 'export function register() {}\n');
    await Promise.all([build_image(dev_tag, dev_server), build_image(stg_tag, stg_server)]);
  }, BUILD_TIME_MS);

  afterAll(async () => {
    await run('docker', ['image', 'rm', '--force', dev_tag, stg_tag]);
    rmSync(folder, { recursive: true, force: true });
  });

  it('runs as UID 10001 and GID 10001 on the Node major of this test run, listens on port 8080, and reads the build context files that only their owner could read', async () => {
    const inside = await run('docker', ['run', '--rm', '--entrypoint', 'sh', stg_tag, '-c', 'id -u; id -g; pwd; node -p process.versions.node; cat generated/server_modules.json > /dev/null && echo readable; test -w generated/server_modules.json || echo not-writable']);
    expect(inside.stderr).toBe('');
    const [uid, gid, cwd, node, readable, not_writable] = inside.stdout.trim().split('\n');
    expect([uid, gid, cwd, readable, not_writable]).toEqual(['10001', '10001', '/server', 'readable', 'not-writable']);
    expect(node?.split('.')[0]).toBe(process.versions.node.split('.')[0]);
    const config = await run('docker', ['image', 'inspect', stg_tag, '--format', '{{json .Config.ExposedPorts}}']);
    expect(JSON.parse(config.stdout)).toEqual({ '8080/tcp': {} });
  }, 60_000);

  it('starts core/start.ts and passes the container arguments on as server start arguments', async () => {
    const started = await run('docker', ['run', '--rm', stg_tag, '--env', 'NOT_AN_ENV']);
    expect(started.code).toBe(2);
    expect(started.stderr).toContain('--env must be');
  }, 60_000);

  it('holds no DEV code, no regression test and no Dockerfile when the server module list has no DEV module, and such a server goes past the DEV code refusal on --env STG', async () => {
    const paths = await image_paths(stg_tag);
    expect(paths.filter(is_dev_code)).toEqual([]);
    expect(paths.filter((path) => path.startsWith('tests/') || /^core\/[^/]+\/tests\//.test(path))).toEqual([]);
    expect(paths).not.toContain('core/Dockerfile');
    expect(paths).toEqual(expect.arrayContaining(['core/start.ts', 'core/routing/index.ts', 'main.ts', 'package.json', 'build/data/client_data_version', 'generated/core_settings.json']));
    const started = await run('docker', ['run', '--rm', stg_tag, '--env', 'STG']);
    expect(started.code).toBe(1);
    const errors = error_messages(started.stdout);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.filter((message) => message.includes('DEV code'))).toEqual([]);
  }, 60_000);

  it('holds the DEV code when the server module list has a DEV module, and such a server is refused on --env STG', async () => {
    const paths = await image_paths(dev_tag);
    expect(paths).toContain('core/cheat/dev/index.ts');
    expect(paths.some((path) => path.startsWith('dev/'))).toBe(true);
    const started = await run('docker', ['run', '--rm', dev_tag, '--env', 'STG']);
    expect(started.code).toBe(1);
    expect(error_messages(started.stdout).some((message) => message.includes('DEV code'))).toBe(true);
  }, 60_000);

  it('runs the server process as UID 10001, which answers HTTP on port 8080 of the container', async () => {
    const name = `ogw-core-test-${randomUUID()}`;
    const started = await run('docker', ['run', '--detach', '--name', name, '--publish', '127.0.0.1:0:8080', dev_tag, '--env', 'LOCAL', '--db', '/tmp/server.db', '--secret-file', 'secrets.json']);
    try {
      expect(started.code).toBe(0);
      const published = await run('docker', ['port', name, '8080/tcp']);
      const url = `http://${published.stdout.trim().split('\n')[0] ?? ''}/update/deploy_list.json`;
      let status = 0;
      for (let i = 0; i < 300 && status === 0; i += 1) {
        status = await fetch(url).then(
          (response) => response.status,
          () => 0,
        );
        if (status === 0) await real_wait(100);
      }
      expect([200, 404]).toContain(status);
      const owner = await run('docker', ['exec', name, 'sh', '-c', 'stat -c %u:%g /proc/1']);
      expect(owner.stdout.trim()).toBe('10001:10001');
    } finally {
      await run('docker', ['rm', '--force', name]);
    }
  }, 60_000);
});
