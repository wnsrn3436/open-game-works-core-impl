/**
 * `start_local_server` and the check seed provider (`### time and random`): the LOCAL server of an instance whose
 * random is fixed by a random base. One server instance in the thread of its process, with DEV code, listening on
 * `--port` itself: no front, no worker threads, no ops port of `routing.run_server_process`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse_server_args } from '../../start.ts';
import { make_purpose_seed } from '../../storage/random.ts';
import type { SeedProvider } from '../../storage/index.ts';
import { new_server_instance, type ServerInstance } from './server_binding.ts';
import type { RegisterFunction } from './runner_input.ts';
import { StartFailure } from './test_server.ts';

/**
 * The check seed provider of random base `base`: the seed of a request is `make_purpose_seed`(request name, base + k),
 * where k counts the request IDs that came before for that user ID and request name, and a request ID that came before
 * gets the seed it got first. A call with request ID empty string (`storage.make_seed`) gets
 * `make_purpose_seed`(purpose name, base + k), where k counts the earlier such calls of that purpose name. base + k is
 * added modulo 2^64. The counts are in the memory of the returned function.
 */
export function check_seed_provider(base: bigint): SeedProvider {
  /** Per user ID and request name, the seed of each request ID that came, in call order. */
  const requests = new Map<string, Map<string, bigint>>();
  /** Per purpose name, the number of `make_seed` calls so far. */
  const purposes = new Map<string, bigint>();
  const seed_of = (name: string, k: bigint): bigint => make_purpose_seed(name, BigInt.asIntN(64, base + k));
  return (request_id, user_id, request_name) => {
    if (request_id === '') {
      const k = purposes.get(request_name) ?? 0n;
      purposes.set(request_name, k + 1n);
      return seed_of(request_name, k);
    }
    // A request name holds no space, so the key of one user ID and request name is one string.
    const key = `${String(user_id)} ${request_name}`;
    let seen = requests.get(key);
    if (seen === undefined) {
      seen = new Map();
      requests.set(key, seen);
    }
    const first = seen.get(request_id);
    if (first !== undefined) return first;
    const seed = seed_of(request_name, BigInt(seen.size));
    seen.set(request_id, seed);
    return seed;
  };
}

function message_of(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function read_json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** What `start_local_server` reads from its cwd `server/`, as a worker thread of the server process reads it. */
interface LocalFiles {
  readonly server_modules: string[];
  readonly settings: Record<string, unknown>;
  readonly data_folder: string;
  readonly register: RegisterFunction;
  readonly register_dev: RegisterFunction | null;
}

async function read_local_files(folder: string): Promise<LocalFiles> {
  const server_modules = read_json(join(folder, 'generated', 'server_modules.json'));
  if (!Array.isArray(server_modules) || !server_modules.every((m) => typeof m === 'string')) throw new Error('generated/server_modules.json is not a JSON array of module names');
  const settings = read_json(join(folder, 'generated', 'core_settings.json'));
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) throw new Error('generated/core_settings.json is not a JSON object');
  const content = (await import(pathToFileURL(join(folder, 'main.ts')).href)) as { register?: unknown };
  if (typeof content.register !== 'function') throw new Error('main.ts exports no register function');
  const dev_main = join(folder, 'dev', 'main.ts');
  let register_dev: RegisterFunction | null = null;
  if (existsSync(dev_main)) {
    const dev = (await import(pathToFileURL(dev_main).href)) as { registerDev?: unknown };
    if (typeof dev.registerDev !== 'function') throw new Error('dev/main.ts exports no registerDev function');
    register_dev = dev.registerDev as RegisterFunction;
  }
  return {
    server_modules,
    settings: settings as Record<string, unknown>,
    data_folder: join(folder, 'build', 'data'),
    register: content.register as RegisterFunction,
    register_dev,
  };
}

/** Log lines read as JSON objects; a line that is not a JSON object is left out. */
function log_objects(lines: readonly string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) out.push(parsed as Record<string, unknown>);
    } catch {
      // Not a log line object.
    }
  }
  return out;
}

/** A wait that ends when the process gets `SIGTERM` or `SIGINT`, and `cancel`, which removes its listeners. */
function until_signal(): { readonly ended: Promise<void>; cancel(): void } {
  let cancel = (): void => undefined;
  const ended = new Promise<void>((resolve) => {
    const done = (): void => {
      cancel();
      resolve();
    };
    cancel = () => {
      process.off('SIGTERM', done);
      process.off('SIGINT', done);
    };
    process.on('SIGTERM', done);
    process.on('SIGINT', done);
  });
  return { ended, cancel };
}

/**
 * `start_local_server`: makes one server instance with `routing.create_server` and the server start arguments in the
 * thread of this process, sets the check seed provider of `random_base` before `start()`, and runs it until the process
 * gets `SIGTERM` or `SIGINT`, then stops it. It reads its files from the cwd `server/`. Arguments whose `--env` is not
 * `LOCAL` or that hold `--ops-port`, and a server start failure, throw `StartFailure`; then it listens on no port.
 */
export async function start_local_server(args: readonly string[], random_base: bigint): Promise<void> {
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) throw new StartFailure('start_local_server: the server start arguments are not a list of strings', []);
  if (typeof random_base !== 'bigint' || BigInt.asIntN(64, random_base) !== random_base) throw new StartFailure('start_local_server: the random base is not an int64', []);
  const parsed = parse_server_args(args);
  if (typeof parsed === 'string') throw new StartFailure(parsed, []);
  if (parsed.env !== 'LOCAL') throw new StartFailure(`start_local_server takes only --env LOCAL, not --env ${parsed.env}`, []);
  if (parsed.ops_port !== undefined) throw new StartFailure('start_local_server takes no --ops-port', []);
  let files: LocalFiles;
  try {
    files = await read_local_files(process.cwd());
  } catch (error) {
    throw new StartFailure(`start_local_server: ${message_of(error)}`, []);
  }
  /** The log lines of server start, for `StartFailure.logs`; null once server start ended. */
  let start_lines: string[] | null = [];
  const instance: ServerInstance = new_server_instance({
    args: parsed,
    server_modules: files.server_modules,
    data_folder: files.data_folder,
    core_settings: files.settings,
    game_settings: {},
    register: files.register,
    dev: true,
    register_dev: files.register_dev,
    log_writer: (line) => {
      start_lines?.push(line);
      process.stdout.write(`${line}\n`);
    },
  });
  try {
    await instance.dev?.('storage', 'set_seed_provider', [check_seed_provider(random_base)]);
  } catch {
    // Before `start()` this throws only on a server instance whose settings check failed: its `start()` gives the reason.
  }
  // Listening from before `start()`: a signal during server start stops the instance once it has started.
  const signal = until_signal();
  const started = await instance.start().catch((error: unknown) => message_of(error));
  const lines = start_lines;
  start_lines = null;
  if (typeof started === 'string') {
    signal.cancel();
    const cleanup = await instance.stop().then(() => null, (error: unknown) => error);
    const reason = cleanup === null ? started : `${started}; stopping the server instance failed too: ${message_of(cleanup)}`;
    throw new StartFailure(reason, log_objects(lines));
  }
  await signal.ended;
  await instance.stop();
}
