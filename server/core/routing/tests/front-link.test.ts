/**
 * The front link of `create_server` (`## API`): a worker instance takes its requests from the message port of its
 * front link and listens on no port, its DB wait state is element 0 of the array of its front link, and the
 * `duration_ms` of its `request` log starts when it received the request from the front. A server instance made
 * without a front link listens on `--port`, also in a worker thread.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, Worker, type MessagePort } from 'node:worker_threads';
import { core_test_register, core_test_server_paths, new_core_test_server_input, type CoreTestServerInput } from '../../testing/dev/index.ts';
import { real_delay } from '../../testing/dev/real_time.ts';
import type { IncomingMessage } from 'node:http';
import { FrontAttachment, type ToFront, type ToWorker } from '../front_link.ts';
import { read_body } from '../http.ts';
import { create_server } from '../index.ts';
import { accepts, free_port, get } from './process_support.ts';

const run_paths = core_test_server_paths();

interface Db {
  readonly input: CoreTestServerInput;
  readonly secret_file: string;
  remove(): Promise<void>;
}

async function new_db(): Promise<Db> {
  const input = await new_core_test_server_input('sqlite');
  const folder = mkdtempSync(join(tmpdir(), 'routing-front-'));
  const secret_file = join(folder, 'secrets.json');
  writeFileSync(secret_file, JSON.stringify(input.secrets.file));
  return {
    input,
    secret_file,
    remove: async () => {
      await input.drop();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

/** A worker thread that watches element 0 of `array` until `stop[0]` is set, and posts whether it saw 1. */
const PROBE = `
const { parentPort, workerData } = require('node:worker_threads');
const { array, stop } = workerData;
let seen = false;
while (Atomics.load(stop, 0) === 0) if (Atomics.load(array, 0) === 1) seen = true;
parentPort.postMessage(seen);
`;

/** The answer of the worker instance to the request `id`. */
function answer_of(port: MessagePort, id: number): Promise<Extract<ToFront, { t: 'res' }>> {
  return new Promise((resolve) => {
    const on = (message: ToFront): void => {
      if (message.t === 'res' && message.id === id) {
        port.off('message', on);
        resolve(message);
      }
    };
    port.on('message', on);
  });
}

function request(id: number, method: string, url: string, headers: Record<string, string>): ToWorker {
  return { t: 'req', id, method, url, headers, distinct: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, [v]])), peer: { address: '127.0.0.1', port: 50000 }, upgrade: null };
}

describe('front link', () => {
  it('makes a worker instance that listens on no port, takes requests from the message port, and has its DB wait state in element 0 of the array', async () => {
    const db = await new_db();
    const channel = new MessageChannel();
    const db_wait = new Int32Array(new SharedArrayBuffer(4));
    const stop = new Int32Array(new SharedArrayBuffer(4));
    const probe = new Worker(PROBE, { eval: true, workerData: { array: db_wait, stop } });
    const seen = new Promise<boolean>((resolve) => probe.once('message', resolve));
    const lines: string[] = [];
    const port = await free_port();
    const instance = create_server({
      args: { env: 'LOCAL', port, db: db.input.database.db_argument, secret_file: db.secret_file },
      server_modules: run_paths.server_modules,
      data_folder: run_paths.data_folder,
      core_settings: run_paths.settings,
      game_settings: {},
      register: core_test_register,
      dev: true,
      log_writer: (line) => lines.push(line),
      front: { port: channel.port2, db_wait },
    });
    try {
      // Server start runs the synchronous DB calls of the schema step on this thread.
      expect(await instance.start()).toBe(port);
      Atomics.store(stop, 0, 1);
      expect(await seen).toBe(true);
      expect(Atomics.load(db_wait, 0)).toBe(0);
      expect(await accepts(port)).toBe(false);

      const route = answer_of(channel.port1, 1);
      channel.port1.postMessage(request(1, 'GET', '/update/deploy_list.json', {}));
      channel.port1.postMessage({ t: 'end', id: 1 } satisfies ToWorker);
      expect([200, 404]).toContain((await route).status);

      // duration_ms starts when the worker instance received the request: the body arrives 300 ms later.
      const before = lines.length;
      const rpc = answer_of(channel.port1, 2);
      channel.port1.postMessage(request(2, 'POST', '/core/Resync', { 'content-type': 'application/x-protobuf' }));
      await real_delay(300n);
      channel.port1.postMessage({ t: 'end', id: 2 } satisfies ToWorker);
      expect((await rpc).status).toBe(200);
      const logged = lines.slice(before).map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.kind === 'request' && line.request === 'core/Resync');
      expect(logged).toHaveLength(1);
      expect(logged[0]?.duration_ms as number).toBeGreaterThanOrEqual(300);
    } finally {
      await instance.stop();
      await probe.terminate();
      channel.port1.close();
      await db.remove();
    }
  });

  it('makes a server instance without a front link that listens on --port, also in a worker thread', async () => {
    const db = await new_db();
    const worker = new Worker(new URL('./instance_in_worker.ts', import.meta.url), { workerData: { db: db.input.database.db_argument, secret_file: db.secret_file } });
    try {
      const started = await new Promise<{ started: number | string }>((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
      });
      expect(typeof started.started).toBe('number');
      expect((await get(started.started as number, '/no/such/path')).status).toBe(404);
      const ended = new Promise((resolve) => worker.once('exit', resolve));
      worker.postMessage('stop');
      await ended;
    } finally {
      await worker.terminate();
      await db.remove();
    }
  });
});

describe('front link flow', () => {
  const CHUNK = 64 * 1024;
  const data = (id: number): ToWorker => ({ t: 'data', id, chunk: new Uint8Array(CHUNK) });
  /** Lets the messages posted so far reach the other port. */
  const settle = (): Promise<void> => real_delay(50n);

  it('pulls only the body bytes the request took, takes none while it does not read, and drops the bytes after the answer', async () => {
    const channel = new MessageChannel();
    const pulled = new Map<number, number>();
    const answers = new Map<number, string>();
    channel.port1.on('message', (message: ToFront) => {
      if (message.t === 'pull') pulled.set(message.id, (pulled.get(message.id) ?? 0) + message.bytes);
      if (message.t === 'res') answers.set(message.id, message.body === null ? '' : Buffer.from(message.body).toString());
    });
    const requests = new Map<string, IncomingMessage>();
    let read_held: () => void = () => undefined;
    const attachment = new FrontAttachment(channel.port2, {
      handle: (req, res) => {
        requests.set(req.url ?? '', req);
        const answer = (max: number): void => {
          void read_body(req, max, new AbortController().signal).then((body) => {
            res.writeHead(200);
            res.end(body === null ? 'null' : String(body.byteLength));
          });
        };
        if (req.url === '/limit') answer(10);
        else
          read_held = () => {
            answer(16 * CHUNK);
          };
      },
      handle_upgrade: (_req, socket) => {
        socket.destroy();
      },
    });
    try {
      // A body over the limit: the answer comes at the first chunk, and the later chunks are not buffered.
      channel.port1.postMessage(request(1, 'POST', '/limit', {}));
      for (let i = 0; i < 8; i += 1) channel.port1.postMessage(data(1));
      await settle();
      expect(answers.get(1)).toBe('null');
      expect(requests.get('/limit')?.readableLength).toBe(0);
      expect(pulled.get(1) ?? 0).toBeLessThanOrEqual(CHUNK);

      // A request that does not read its body pulls nothing, so the front stops at its window; it pulls when it reads.
      channel.port1.postMessage(request(2, 'POST', '/held', {}));
      for (let i = 0; i < 4; i += 1) channel.port1.postMessage(data(2));
      await settle();
      expect(pulled.get(2) ?? 0).toBe(0);
      read_held();
      await settle();
      expect(pulled.get(2)).toBe(4 * CHUNK);
      channel.port1.postMessage({ t: 'end', id: 2 } satisfies ToWorker);
      await settle();
      expect(answers.get(2)).toBe(String(4 * CHUNK));
    } finally {
      attachment.detach();
      channel.port1.close();
    }
  });
});
