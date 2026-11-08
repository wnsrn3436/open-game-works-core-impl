/**
 * The match `seed` of match creation is `storage.make_seed`(`match`): two server instances that
 * `testing.start_local_server` started with the same random base give their k-th match the same `seed`.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { make_purpose_seed } from '../../storage/random.ts';
import { connect_server, default_db_kind, load_data, login, type TestSession } from '../../testing/dev/index.ts';
import { free_port, local_args, local_game, run_local, wait_listening, type LocalGame, type LocalProcess } from '../../testing/tests/local_support.ts';

/** A process test starts `node` processes that build a server instance of every module: a long real time limit. */
const PROCESS_TEST_MS = 180_000;
const K = CoreContract.MatchmakerFrameKind;

interface Local {
  readonly game: LocalGame;
  readonly proc: LocalProcess;
  readonly port: number;
  readonly data_version: string;
  login(name: string): Promise<TestSession>;
}

const running: Local[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const local of running.splice(0)) {
    await local.proc.kill();
    await local.game.remove();
  }
});

async function start_local(random_base: bigint): Promise<Local> {
  const game = await local_game(default_db_kind());
  const port = await free_port();
  const proc = run_local(game, [...local_args(game, port), '--matchmaker'], random_base);
  const partial = { game, proc, port, data_version: '', login: () => Promise.reject(new Error('not listening')) };
  running.push(partial);
  await wait_listening(proc, port);
  const remote = await connect_server(`http://127.0.0.1:${String(port)}`, game.input.data_folder, game.input.secrets.dev_access);
  const local: Local = { game, proc, port, data_version: remote.data_version, login: (name) => login(remote, name) };
  running.splice(running.indexOf(partial), 1, local);
  return local;
}

/** One `/realtime` connection: sends frames and waits for a frame of a kind. */
async function realtime(local: Local, session: TestSession): Promise<{ send(f: CoreContract.MatchmakerFrame): void; wait(kind: number): Promise<CoreContract.MatchmakerFrame> }> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(local.port)}/realtime`);
  sockets.push(socket);
  socket.binaryType = 'arraybuffer';
  const frames: CoreContract.MatchmakerFrame[] = [];
  let wake = (): void => {};
  socket.addEventListener('message', (event) => {
    const data: unknown = event.data;
    const f = data instanceof ArrayBuffer ? CoreContract.MatchmakerFrame.decode(new Uint8Array(data)) : null;
    if (f !== null) frames.push(f);
    wake();
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      reject(new Error('the realtime WebSocket did not open'));
    }, { once: true });
  });
  const send = (f: CoreContract.MatchmakerFrame): void => {
    socket.send(f.encode());
  };
  const wait = async (kind: number): Promise<CoreContract.MatchmakerFrame> => {
    const until = Date.now() + 30_000;
    for (;;) {
      const at = frames.findIndex((f) => f.kind === kind);
      if (at >= 0) return frames.splice(at, 1)[0] as CoreContract.MatchmakerFrame;
      if (Date.now() > until) throw new Error(`no frame of kind ${String(kind)}`);
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 200);
      });
    }
  };
  const hello = new CoreContract.MatchmakerFrame();
  hello.kind = K.MATCHMAKER_FRAME_KIND_HELLO;
  hello.access_token = session.access_token;
  hello.data_version = local.data_version;
  send(hello);
  await wait(K.MATCHMAKER_FRAME_KIND_HELLO_ACK);
  return { send, wait };
}

/** The `seed` of the matches of two pairs of users, made one after the other, on one local server. */
async function match_seeds(local: Local, prefix: string): Promise<bigint[]> {
  const mode_id = load_data().dev.find_id_value('[testing_duel]');
  const seeds: bigint[] = [];
  for (const pair of [0, 1]) {
    const conns = [];
    for (const side of [0, 1]) conns.push(await realtime(local, await local.login(`${prefix}_${String(pair)}_${String(side)}`)));
    for (const conn of conns) {
      const request = new CoreContract.MatchmakerFrame();
      request.kind = K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST;
      request.mode_id = mode_id;
      conn.send(request);
    }
    const found = await Promise.all(conns.map((conn) => conn.wait(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND)));
    expect(new Set(found.map((f) => f.seed)).size).toBe(1);
    seeds.push(found[0]?.seed ?? 0n);
  }
  return seeds;
}

describe('match seed', () => {
  it(
    'gives the first and the second match of two local servers with the same random base and a new DB each the same seed, the values of make_seed(match) with the check seed provider',
    async () => {
      const [a, b] = await Promise.all([start_local(7n), start_local(7n)]);
      const [seeds_a, seeds_b] = await Promise.all([match_seeds(a, 'seed_a'), match_seeds(b, 'seed_b')]);
      expect(seeds_a).toEqual(seeds_b);
      expect(seeds_a).toEqual([make_purpose_seed('match', 7n), make_purpose_seed('match', 8n)]);
    },
    PROCESS_TEST_MS,
  );
});
