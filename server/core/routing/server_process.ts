/**
 * `run_server_process` (`### server process` and `### ops path` of `routing`): the front on the main thread, and the
 * worker threads that each make one worker instance. The front listens on `--port` and `--ops-port`, hands each
 * request of `--port` to a worker instance, relays upgraded connections, and answers the ops paths.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { MessageChannel, Worker, type MessagePort } from 'node:worker_threads';
import type { MetricFamily } from '../logging/index.ts';
import type { ServerArgs } from './context.ts';
import { FRONT_WINDOW_BYTES, own_bytes, post_bytes, type Peer, type ToFront, type ToWorker } from './front_link.ts';
import { listen_port, type Listening } from './loopback.ts';
import { create_system_clock } from '../server-time/adapters/system_clock.ts';
import { network_time_limit } from '../server-time/network_time_limit.ts';
import { read_process_files } from './process_input.ts';
import { run_settings_check } from './settings_check.ts';
import type { WorkerControl, WorkerInput } from './worker_main.ts';

/** The input of `run_server_process`: the server start arguments, with `--ops-port`. */
export interface ServerProcessArgs extends ServerArgs {
  /** `--ops-port`; absent when not received. */
  ops_port?: number;
}

/** The output of `run_server_process` on success: the ports the front listens on. */
export interface ServerProcessPorts {
  readonly port: number;
  readonly ops_port: number | null;
}

/** Real time of the front: the age of an ops report and the time of a log line. */
const real_clock = create_system_clock();

const WORKER_ENTRY = new URL('./worker_main.ts', import.meta.url);

/** How long a worker thread may take to end after it was told to stop, before the front ends it. Real time. */
const WORKER_STOP_MS = 15_000n;

/** The last ops report of a server instance. */
interface OpsReport {
  readonly db_ok: boolean;
  readonly metrics: readonly MetricFamily[];
  /** The real clock when the front received it. */
  readonly received: bigint;
}

/**
 * A request or an upgraded connection that the front handed to a worker instance. `source` is what the front reads
 * the client bytes from, and `in_flight` the bytes sent in `data` messages that the worker instance has not pulled.
 */
type Handed = ({ readonly kind: 'request'; readonly req: IncomingMessage; readonly res: ServerResponse } | { readonly kind: 'upgrade'; readonly socket: Duplex }) & { readonly source: IncomingMessage | Duplex; in_flight: number };

/** A worker thread and its server instance, as the front sees it. */
class WorkerThread {
  readonly name: string;
  readonly worker: Worker;
  readonly link: MessagePort;
  readonly db_wait: Int32Array;
  in_progress = 0;
  started = false;
  report: OpsReport | null = null;
  readonly handed = new Map<number, Handed>();
  readonly exited: Promise<number>;

  constructor(name: string, args: ServerArgs) {
    this.name = name;
    const channel = new MessageChannel();
    this.link = channel.port1;
    this.db_wait = new Int32Array(new SharedArrayBuffer(4));
    const input: WorkerInput = { args, front_port: channel.port2, db_wait: this.db_wait };
    this.worker = new Worker(WORKER_ENTRY, { name, workerData: input, transferList: [channel.port2] });
    this.exited = new Promise((resolve) => {
      this.worker.once('exit', resolve);
    });
  }

  /** True while its thread waits in a synchronous DB call (`storage.watch_db_wait`). */
  db_waiting(): boolean {
    return Atomics.load(this.db_wait, 0) !== 0;
  }

  /** Whether its last ops report has a passed DB probe and is younger than `max_age_ms`. */
  ready(max_age_ms: number): boolean {
    return this.report !== null && this.report.db_ok && real_clock.now() - this.report.received < BigInt(max_age_ms);
  }
}

function peer_of(socket: Socket): Peer {
  return { address: socket.remoteAddress ?? null, port: socket.remotePort ?? null };
}

/** The headers with `Connection: close` in place of any `Connection` header. */
function closing(headers: Readonly<Record<string, string | number | string[]>>): Record<string, string | number | string[]> {
  const kept = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'connection'));
  return { ...kept, Connection: 'close' };
}

function path_of(url: string | undefined): string {
  const value = url ?? '/';
  const q = value.indexOf('?');
  return q < 0 ? value : value.slice(0, q);
}

/** A label value in the Prometheus text exposition format 0.0.4. */
function label_value(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

function label_text(labels: Readonly<Record<string, string>>): string {
  const keys = Object.keys(labels).sort();
  return keys.length === 0 ? '' : `{${keys.map((k) => `${k}="${label_value(labels[k] ?? '')}"`).join(',')}}`;
}

function number_text(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return '+Inf';
  if (value === -Infinity) return '-Inf';
  return String(value);
}

function byte_compare(a: string, b: string): number {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return Buffer.compare(x, y);
}

/**
 * The metrics of the process in the Prometheus text exposition format 0.0.4: per sample name and label set the sum
 * of that sample over the families given, families in byte order of name with a `# TYPE` line, samples in byte order
 * of their label text (then of their name).
 */
export function metrics_text(families: readonly MetricFamily[]): string {
  const merged = new Map<string, { type: string; samples: Map<string, { name: string; labels: string; value: number }> }>();
  for (const family of families) {
    let entry = merged.get(family.name);
    if (entry === undefined) {
      entry = { type: family.type, samples: new Map() };
      merged.set(family.name, entry);
    }
    for (const sample of family.samples) {
      const labels = label_text(sample.labels);
      const key = `${sample.name}${labels}`;
      const kept = entry.samples.get(key);
      if (kept === undefined) entry.samples.set(key, { name: sample.name, labels, value: sample.value });
      else kept.value += sample.value;
    }
  }
  const lines: string[] = [];
  for (const name of [...merged.keys()].sort(byte_compare)) {
    const entry = merged.get(name);
    if (entry === undefined) continue;
    lines.push(`# TYPE ${name} ${entry.type}`);
    const samples = [...entry.samples.values()].sort((a, b) => byte_compare(a.labels, b.labels) || byte_compare(a.name, b.name));
    for (const sample of samples) lines.push(`${sample.name}${sample.labels} ${number_text(sample.value)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** One `error` log line of the front, on stdout; `done` is called once it is written. */
function front_error(message: string, done?: () => void): void {
  const line = JSON.stringify({ time: Number(real_clock.now()), level: 'error', kind: 'error', user_id: null, request_id: null, request: null, message, stack_trace: null });
  process.stdout.write(`${line}\n`, () => done?.());
}

function close_listener(server: Server | null, listening: Listening | null, sockets: Set<Duplex>): Promise<void> {
  listening?.loopback?.close();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server === null || !server.listening) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
    server.closeAllConnections();
  });
}

/** The front of the server process. */
class Front {
  private readonly args: ServerProcessArgs;
  private readonly request_workers: WorkerThread[] = [];
  private realtime: WorkerThread | null = null;
  private ready_max_age_ms = 0;
  private request_worker_count = 0;
  private http: Server | null = null;
  private ops: Server | null = null;
  private http_listening: Listening | null = null;
  private ops_listening: Listening | null = null;
  private readonly http_sockets = new Set<Duplex>();
  private readonly ops_sockets = new Set<Duplex>();
  /** Requests received before every server instance has started. */
  private waiting: (() => void)[] = [];
  private all_started = false;
  private stopping = false;
  private next_id = 1;

  constructor(args: ServerProcessArgs) {
    this.args = args;
  }

  private workers(): WorkerThread[] {
    return this.realtime === null ? [...this.request_workers] : [...this.request_workers, this.realtime];
  }

  async run(): Promise<ServerProcessPorts | string> {
    const settings = this.read_settings();
    if (typeof settings === 'string') return this.fail(settings);
    const listened = await this.listen();
    if (typeof listened === 'string') return this.fail(listened);
    const started = await this.start_workers();
    if (started !== null) return this.fail(started);
    this.all_started = true;
    for (const worker of this.workers()) this.watch_exit(worker);
    const waiting = this.waiting;
    this.waiting = [];
    for (const run of waiting) run();
    process.once('SIGTERM', () => void this.stop());
    process.once('SIGINT', () => void this.stop());
    return listened;
  }

  /** The settings the front reads, after the settings check of the values of the game `server/` folder. */
  private read_settings(): string | null {
    let settings: Record<string, unknown>;
    try {
      settings = read_process_files().settings;
    } catch (error) {
      return `the server process cannot read server/generated: ${error instanceof Error ? error.message : String(error)}`;
    }
    const failure = run_settings_check(settings, null);
    if (failure !== null) return failure;
    this.request_worker_count = settings['routing.requestWorkers'] as number;
    this.ready_max_age_ms = settings['routing.readyMaxReportAgeMs'] as number;
    return null;
  }

  private async listen(): Promise<ServerProcessPorts | string> {
    const http = createServer((req, res) => {
      this.on_request(req, res);
    });
    http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      this.on_upgrade(req, socket, head);
    });
    track(http, this.http_sockets);
    this.http = http;
    const listening = await listen_port(http, this.args.port ?? 8080);
    if (typeof listening === 'string') return listening;
    this.http_listening = listening;
    if (this.args.ops_port === undefined) return { port: listening.port, ops_port: null };
    const ops = createServer((req, res) => {
      this.on_ops(req, res);
    });
    track(ops, this.ops_sockets);
    this.ops = ops;
    const ops_listening = await listen_port(ops, this.args.ops_port);
    if (typeof ops_listening === 'string') return `--ops-port: ${ops_listening}`;
    this.ops_listening = ops_listening;
    return { port: listening.port, ops_port: ops_listening.port };
  }

  /** Starts every worker thread together; null when every server instance started, otherwise the first failure reason. */
  private async start_workers(): Promise<string | null> {
    const port = this.http_listening?.port ?? 0;
    const args: ServerArgs = { env: this.args.env, port, matchmaker: false };
    if (this.args.db !== undefined) args.db = this.args.db;
    if (this.args.secret_file !== undefined) args.secret_file = this.args.secret_file;
    for (let i = 1; i <= this.request_worker_count; i += 1) this.request_workers.push(new WorkerThread(`request worker ${String(i)}`, { ...args, port, matchmaker: false }));
    if (this.args.matchmaker === true) this.realtime = new WorkerThread('realtime worker', { ...args, port, matchmaker: true });
    for (const worker of this.workers()) {
      worker.link.on('message', (message: ToFront) => {
        this.from_worker(worker, message);
      });
    }
    const results = await Promise.all(this.workers().map((worker) => this.wait_start(worker)));
    return results.find((r) => r !== null) ?? null;
  }

  private wait_start(worker: WorkerThread): Promise<string | null> {
    return new Promise((resolve) => {
      let error: string | null = null;
      worker.worker.on('error', (e: unknown) => {
        error = e instanceof Error ? e.message : String(e);
      });
      worker.worker.on('message', (message: WorkerControl) => {
        if (message.t === 'started') {
          worker.started = true;
          resolve(null);
        } else resolve(`${worker.name}: ${message.reason}`);
      });
      void worker.exited.then((code) => {
        if (!worker.started) resolve(`${worker.name} ended with exit code ${String(code)} during server start${error === null ? '' : `: ${error}`}`);
      });
    });
  }

  /** A worker thread that ends while the process runs ends the process with exit code 1. */
  private watch_exit(worker: WorkerThread): void {
    void worker.exited.then((code) => {
      if (this.stopping) return;
      this.stopping = true;
      front_error(`${worker.name} ended with exit code ${String(code)} while the server process runs`, () => process.exit(1));
    });
  }

  /** A start failure: stops the other server instances, closes the ports, writes the `error` log line, and returns the reason. */
  private async fail(reason: string): Promise<string> {
    this.stopping = true;
    await this.end_workers();
    await this.close_ports();
    for (const run of this.waiting) run();
    this.waiting = [];
    await new Promise<void>((resolve) => {
      front_error(reason, resolve);
    });
    return reason;
  }

  /** Tells every worker thread to stop and waits for each to end (ending it after `WORKER_STOP_MS`). */
  private async end_workers(): Promise<void> {
    await Promise.all(
      this.workers().map(async (worker) => {
        worker.worker.postMessage({ t: 'stop' });
        let ended = false;
        network_time_limit(WORKER_STOP_MS).addEventListener('abort', () => {
          if (!ended) void worker.worker.terminate();
        });
        await worker.exited;
        ended = true;
        worker.link.close();
      }),
    );
  }

  private async close_ports(): Promise<void> {
    await Promise.all([close_listener(this.http, this.http_listening, this.http_sockets), close_listener(this.ops, this.ops_listening, this.ops_sockets)]);
  }

  /** `SIGTERM`, `SIGINT`: stops accepting connections, stops every server instance, and ends the process. */
  private async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.http?.close();
    this.ops?.close();
    this.http_listening?.loopback?.close();
    this.ops_listening?.loopback?.close();
    await this.end_workers();
    await this.close_ports();
    process.exit(0);
  }

  // ---- hand-off

  /** The worker instance of a request: the realtime worker for `GET /realtime`, else the request worker that is least busy. */
  private choose(method: string | undefined, url: string | undefined): WorkerThread {
    if (this.realtime !== null && method === 'GET' && path_of(url) === '/realtime') return this.realtime;
    const free = this.request_workers.filter((w) => !w.db_waiting());
    const from = free.length > 0 ? free : this.request_workers;
    let chosen = from[0] as WorkerThread;
    for (const worker of from) if (worker.in_progress < chosen.in_progress) chosen = worker;
    return chosen;
  }

  private when_started(run: () => void, refuse: () => void): void {
    if (this.stopping) refuse();
    else if (this.all_started) run();
    else
      this.waiting.push(() => {
        if (this.stopping) refuse();
        else run();
      });
  }

  private on_request(req: IncomingMessage, res: ServerResponse): void {
    this.when_started(
      () => {
        this.hand_request(req, res);
      },
      () => {
        res.destroy();
      },
    );
  }

  private hand_request(req: IncomingMessage, res: ServerResponse): void {
    const worker = this.choose(req.method, req.url);
    const id = this.next_id++;
    worker.in_progress += 1;
    const handed: Handed = { kind: 'request', req, res, source: req, in_flight: 0 };
    worker.handed.set(id, handed);
    const head: ToWorker = { t: 'req', id, method: req.method ?? '', url: req.url ?? '/', headers: req.headers, distinct: req.headersDistinct, peer: peer_of(req.socket), upgrade: null };
    worker.link.postMessage(head);
    // After the answer the request is no longer handed: its later bytes are not sent.
    req.on('data', (chunk: Buffer) => {
      if (worker.handed.has(id)) this.send_data(worker, id, handed, chunk);
    });
    req.on('end', () => {
      if (worker.handed.has(id)) worker.link.postMessage({ t: 'end', id } satisfies ToWorker);
    });
    res.on('close', () => {
      if (!res.writableEnded && worker.handed.has(id)) worker.link.postMessage({ t: 'abort', id } satisfies ToWorker);
    });
  }

  private on_upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.http_sockets.add(socket);
    socket.on('close', () => this.http_sockets.delete(socket));
    this.when_started(
      () => {
        this.hand_upgrade(req, socket, head);
      },
      () => {
        socket.destroy();
      },
    );
  }

  private hand_upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const worker = this.choose(req.method, req.url);
    const id = this.next_id++;
    worker.in_progress += 1;
    const handed: Handed = { kind: 'upgrade', socket, source: socket, in_flight: 0 };
    worker.handed.set(id, handed);
    const bytes = own_bytes(head);
    const message: ToWorker = { t: 'req', id, method: req.method ?? '', url: req.url ?? '/', headers: req.headers, distinct: req.headersDistinct, peer: peer_of(req.socket), upgrade: bytes };
    post_bytes(worker.link, message, bytes);
    socket.on('data', (chunk: Buffer) => {
      if (worker.handed.has(id)) this.send_data(worker, id, handed, chunk);
    });
    socket.on('end', () => {
      if (worker.handed.has(id)) worker.link.postMessage({ t: 'end', id } satisfies ToWorker);
    });
    socket.on('close', () => {
      if (!worker.handed.has(id)) return;
      worker.link.postMessage({ t: 'abort', id } satisfies ToWorker);
      this.done(worker, id);
    });
    socket.on('error', () => {
      socket.destroy();
    });
  }

  /** Sends client bytes to the worker instance, and stops reading the client while `FRONT_WINDOW_BYTES` are in flight. */
  private send_data(worker: WorkerThread, id: number, handed: Handed, chunk: Buffer): void {
    const bytes = own_bytes(chunk);
    handed.in_flight += bytes.byteLength;
    post_bytes(worker.link, { t: 'data', id, chunk: bytes }, bytes);
    if (handed.in_flight >= FRONT_WINDOW_BYTES) handed.source.pause();
  }

  private done(worker: WorkerThread, id: number): void {
    if (worker.handed.delete(id)) worker.in_progress -= 1;
  }

  private from_worker(worker: WorkerThread, message: ToFront): void {
    if (message.t === 'report') {
      worker.report = { db_ok: message.db_ok, metrics: message.metrics, received: real_clock.now() };
      return;
    }
    const handed = worker.handed.get(message.id);
    if (handed === undefined) return;
    if (message.t === 'pull') {
      handed.in_flight -= message.bytes;
      if (handed.in_flight < FRONT_WINDOW_BYTES && handed.source.isPaused()) handed.source.resume();
      return;
    }
    if (handed.kind === 'request') {
      if (message.t !== 'res') return;
      this.done(worker, message.id);
      const res = handed.res;
      if (res.destroyed || res.writableEnded) return;
      const headers = message.headers as Record<string, string | number | string[]>;
      // A body the worker instance did not read to its end is not read further: the connection closes after the answer.
      res.writeHead(message.status, handed.req.complete ? headers : closing(headers));
      res.end(message.body === null ? undefined : Buffer.from(message.body));
      return;
    }
    this.from_upgrade(worker, handed.socket, message);
  }

  /** A message of the worker instance about an upgraded connection. */
  private from_upgrade(worker: WorkerThread, socket: Duplex, message: Exclude<ToFront, { t: 'report' | 'pull' }>): void {
    if (message.t === 'sdata') socket.write(Buffer.from(message.chunk));
    else if (message.t === 'send') socket.end();
    else if (message.t === 'sclose') {
      this.done(worker, message.id);
      // After the worker instance ended its side, its bytes reach the client before the connection closes.
      if (socket.writableEnded && !socket.writableFinished)
        socket.once('finish', () => {
          socket.destroy();
        });
      else socket.destroy();
    } else {
      // A response to an upgrade request that the server instance did not take over: written as it is, then closed.
      const head = `HTTP/1.1 ${String(message.status)} \r\nConnection: close\r\n\r\n`;
      socket.end(head);
      this.done(worker, message.id);
    }
  }

  // ---- ops paths

  private instances_ready(): number {
    return this.workers().filter((w) => w.ready(this.ready_max_age_ms)).length;
  }

  private is_ready(): boolean {
    return this.all_started && !this.stopping && this.workers().every((w) => w.ready(this.ready_max_age_ms));
  }

  private front_families(): MetricFamily[] {
    const gauge = (name: string, value: number): MetricFamily => ({ name, type: 'gauge', samples: [{ name, labels: {}, value }] });
    const cpu = process.cpuUsage();
    return [
      gauge('ogw_request_workers', this.request_workers.length),
      gauge('ogw_request_workers_db_waiting', this.request_workers.filter((w) => w.db_waiting()).length),
      gauge('ogw_requests_in_progress', this.request_workers.reduce((sum, w) => sum + w.in_progress, 0)),
      gauge('ogw_server_instances_ready', this.instances_ready()),
      gauge('process_resident_memory_bytes', process.memoryUsage.rss()),
      { name: 'process_cpu_seconds_total', type: 'counter', samples: [{ name: 'process_cpu_seconds_total', labels: {}, value: (cpu.user + cpu.system) / 1e6 }] },
    ];
  }

  private on_ops(req: IncomingMessage, res: ServerResponse): void {
    const text = (status: number, body: string, type = 'text/plain; charset=utf-8'): void => {
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': String(Buffer.byteLength(body)) });
      res.end(body);
    };
    const path = path_of(req.url);
    if (req.method === 'GET' && path === '/health/live') text(200, 'live');
    else if (req.method === 'GET' && path === '/health/ready') {
      if (this.is_ready()) text(200, 'ready');
      else text(503, 'not ready');
    } else if (req.method === 'GET' && path === '/metrics') {
      const families = [...this.workers().flatMap((w) => w.report?.metrics ?? []), ...this.front_families()];
      text(200, metrics_text(families), 'text/plain; version=0.0.4; charset=utf-8');
    } else {
      res.writeHead(404);
      res.end();
    }
  }
}

function track(server: Server, sockets: Set<Duplex>): void {
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
}

/**
 * `run_server_process`: runs the server process. Once the front listens and every server instance has started, the
 * ports the front listens on; on server start failure, the reason, after every worker thread has ended.
 */
export function run_server_process(args: ServerProcessArgs): Promise<ServerProcessPorts | string> {
  return new Front(args).run();
}
