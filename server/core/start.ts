/**
 * The server process start point: `node core/start.ts <server start arguments>` with `server/` as cwd. It makes a
 * server instance with `routing`'s `create_server` and starts it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { create_server, type RegisterFunction, type ServerArgs } from './routing/index.ts';

const ENVS = new Set(['LOCAL', 'DEV', 'STG', 'PROD']);

type ArgValues = Omit<Partial<ServerArgs>, 'env'> & { env: string | null };

/** The server start arguments that take a value, and what each value sets. */
const VALUE_FLAGS: Readonly<Record<string, (args: ArgValues, value: string) => string | null>> = {
  '--env': (args, value) => {
    args.env = value;
    return null;
  },
  '--port': (args, value) => {
    if (!/^[0-9]+$/.test(value) || Number(value) > 65535) return `--port ${value} is not a port number`;
    args.port = Number(value);
    return null;
  },
  '--db': (args, value) => {
    args.db = value;
    return null;
  },
  '--secret-file': (args, value) => {
    args.secret_file = value;
    return null;
  },
};

function check_env(args: ArgValues): string | null {
  if (args.env === null || !ENVS.has(args.env)) return '--env must be LOCAL, DEV, STG or PROD';
  const local_only = args.db !== undefined || args.secret_file !== undefined;
  if (args.env === 'LOCAL' && (args.db === undefined || args.secret_file === undefined)) return 'a LOCAL server needs --db and --secret-file';
  if (args.env !== 'LOCAL' && local_only) return '--db and --secret-file are only for a LOCAL server';
  return null;
}

/** Parses the server start arguments; a string is the reason they are wrong. */
export function parse_server_args(argv: readonly string[]): ServerArgs | string {
  const args: ArgValues = { env: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    if (flag === '--matchmaker') {
      args.matchmaker = true;
      continue;
    }
    const set = VALUE_FLAGS[flag];
    if (set === undefined) return `unknown argument ${flag}`;
    const value = argv[i + 1];
    if (value === undefined) return `${flag} needs a value`;
    i += 1;
    const problem = set(args, value);
    if (problem !== null) return problem;
  }
  const problem = check_env(args);
  if (problem !== null) return problem;
  const { env, ...rest } = args;
  return { ...rest, env: env as ServerArgs['env'] };
}

const core_dir = fileURLToPath(new URL('./', import.meta.url));
const server_dir = fileURLToPath(new URL('../', import.meta.url));

/** True when the server code holds core `dev/` folders or `server/dev/`. */
function has_dev_code(): boolean {
  if (existsSync(`${server_dir}dev`)) return true;
  return readdirSync(core_dir, { withFileTypes: true }).some((e) => e.isDirectory() && existsSync(`${core_dir}${e.name}/dev`));
}

function read_json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function main(): Promise<number> {
  const args = parse_server_args(process.argv.slice(2));
  if (typeof args === 'string') {
    process.stderr.write(`${args}\n`);
    return 2;
  }
  const dev = has_dev_code();
  const settings = read_json(`${server_dir}generated/core_settings.json`) as Record<string, unknown>;
  const server_modules = read_json(`${server_dir}generated/server_modules.json`) as string[];
  const content = (await import(new URL('../main.ts', import.meta.url).href)) as { register: RegisterFunction };
  const content_dev = dev && existsSync(`${server_dir}dev/main.ts`) ? ((await import(new URL('../dev/main.ts', import.meta.url).href)) as { registerDev: RegisterFunction }) : null;
  const server = create_server({
    args,
    server_modules,
    data_folder: `${server_dir}build/data`,
    core_settings: settings,
    game_settings: {},
    register: content.register,
    dev,
    register_dev: content_dev?.registerDev ?? null,
  });
  const started = await server.start();
  if (typeof started === 'string') return 1;
  const stop = (): void => {
    void server.stop().then(() => process.exit(0));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return -1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().then((code) => {
    if (code >= 0) process.exit(code);
  });
}
