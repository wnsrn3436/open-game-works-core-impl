/**
 * The server process start point: `node core/start.ts <server start arguments>` with `server/` as cwd. It runs the
 * server process with `routing`'s `run_server_process`: a front on the main thread and worker threads that each make
 * one server instance. When that returns a server start failure reason, the process ends with exit code 1.
 */
import { fileURLToPath } from 'node:url';
import { run_server_process, type ServerProcessArgs } from './routing/index.ts';

const ENVS = new Set(['LOCAL', 'DEV', 'STG', 'PROD']);

type ArgValues = Omit<Partial<ServerProcessArgs>, 'env'> & { env: string | null };

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
  '--ops-port': (args, value) => {
    if (!/^[0-9]+$/.test(value) || Number(value) > 65535) return `--ops-port ${value} is not a port number`;
    args.ops_port = Number(value);
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
export function parse_server_args(argv: readonly string[]): ServerProcessArgs | string {
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
  if (rest.ops_port !== undefined && rest.ops_port !== 0 && rest.ops_port === (rest.port ?? 8080)) return '--ops-port must differ from --port';
  return { ...rest, env: env as ServerProcessArgs['env'] };
}

async function main(): Promise<number> {
  const args = parse_server_args(process.argv.slice(2));
  if (typeof args === 'string') {
    process.stderr.write(`${args}\n`);
    return 2;
  }
  // The front runs until SIGTERM or SIGINT, or a worker thread ends, and then ends the process itself.
  const started = await run_server_process(args);
  return typeof started === 'string' ? 1 : -1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().then((code) => {
    // Every worker thread has ended when a start failure is returned: the process ends once stdout is written.
    if (code >= 0) process.exitCode = code;
  });
}
