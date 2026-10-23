/**
 * A test server instance of `p2p-signaling` with its dependencies `server-time` and `logging` (and `logging`'s
 * `storage`) on SQLite or PostgreSQL by the run's DB kind, started in dependency order. Connections play the part
 * of the `/realtime` WebSockets `matchmaker` passes.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { create_logging_dev } from '../../logging/dev/index.ts';
import { create_logging } from '../../logging/index.ts';
import { create_server_time, type ClockAdapter, type ServerTime } from '../../server-time/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import { create_storage } from '../../storage/index.ts';
import { core_settings, new_db, stop_all as stop_holders, test_server } from '../../storage/tests/helpers.ts';
import { create_fake_adapter, create_p2p_signaling_dev, type FakeTurnController } from '../dev/index.ts';
import { create_p2p_signaling, type Connection, type P2pSignaling } from '../index.ts';

export const Kind = CoreContract.MatchmakerFrameKind;
export const START_TIME = 1_800_000_000_000n;
export const MAX_DURATION = 600_000n;

/** A clock that moves only when the test moves it. */
export class TestClock implements ClockAdapter {
  readonly real_time = false;
  #time: bigint;
  readonly #listeners = new Set<() => void>();

  constructor(time: bigint) {
    this.#time = time;
  }

  now(): bigint {
    return this.#time;
  }

  advance(ms: bigint): void {
    this.#time += ms;
    for (const listener of [...this.#listeners]) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** A connection that keeps the frames sent to it. */
export class TestConnection implements Connection {
  readonly user_id: bigint;
  readonly frames: CoreContract.MatchmakerFrame[] = [];
  closed = false;

  constructor(user_id: bigint) {
    this.user_id = user_id;
  }

  send(frame: CoreContract.MatchmakerFrame): void {
    this.frames.push(frame);
  }

  close(): void {
    this.closed = true;
  }

  /** The frames received since the last call. */
  take(): CoreContract.MatchmakerFrame[] {
    return this.frames.splice(0);
  }
}

export interface StartOptions {
  readonly env?: 'LOCAL' | 'DEV' | 'STG' | 'PROD';
  /** `environments.<ENV>.adapters.turn`. Default: `fake`. */
  readonly turn?: string | null;
  /** Gives the fake adapter as the server instance's fake adapter override. Default: true. */
  readonly fake_override?: boolean;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly secrets?: Readonly<Record<string, string>>;
  /**
   * Host secret store values by secret name. When given, `p2p-signaling` gets a module input `server` without `--db`,
   * the way a DEV, STG or PROD server reads its secrets.
   */
  readonly host_secrets?: Readonly<Record<string, string>>;
}

export interface Server {
  readonly p2p: P2pSignaling;
  readonly time: ServerTime;
  readonly clock: TestClock;
  /** The fake `turn` adapter's controller; null without the override. */
  readonly fake: FakeTurnController | null;
  /** The log lines, in order. */
  readonly lines: string[];
  /** The `kind` `core` lines `p2p-signaling` wrote, parsed. */
  core_logs(): Record<string, unknown>[];
  /** Lets the jobs the clock made due run. */
  idle(): Promise<void>;
  stop(): void;
}

const running: Server[] = [];

/** Stops the instances the test started. */
export function stop_all(): void {
  for (const server of running.splice(0)) server.stop();
  stop_holders();
}

function settings_of(options: StartOptions): Record<string, unknown> {
  return {
    ...core_settings(),
    'environments.<ENV>.adapters.analytics': null,
    'environments.<ENV>.adapters.turn': options.turn === undefined ? 'fake' : options.turn,
    'environments.<ENV>.turnCoturn.urls': [],
    'environments.<ENV>.secrets.turn': '',
    ...options.settings,
  };
}

/** The module input `server` of `p2p-signaling`: without `--db` and with the host secret store when `host_secrets` is given. */
function p2p_server_of(server: ReturnType<typeof test_server>, host_secrets: StartOptions['host_secrets']): ReturnType<typeof test_server> {
  if (host_secrets === undefined) return server;
  return { ...server, db: null, read_secret: (name: string) => host_secrets[name] ?? null };
}

/** Starts `server-time`, `storage`, `logging` and `p2p-signaling` in dependency order. Returns the server start failure reason on failure. */
export async function start_server(options: StartOptions = {}): Promise<Server | string> {
  const env = options.env ?? 'LOCAL';
  const dev = env !== 'STG' && env !== 'PROD';
  const db = await new_db();
  const clock = new TestClock(START_TIME);
  const time = create_server_time({ settings: { 'server-time.silentMarginMs': 5000, dailyResetOffsetMs: 0 }, modules: {} });
  const time_dev = create_server_time_dev(time);
  time_dev.set_clock(clock);
  const settings = settings_of(options);
  const lines: string[] = [];
  const fake = options.fake_override === false ? null : create_fake_adapter('turn');
  const module_server = test_server(db, {
    env,
    dev,
    server_modules: ['server-time', 'storage', 'logging', 'p2p-signaling'],
    secrets: options.secrets ?? {},
    write_log_line: (line: string) => lines.push(line),
    fake_adapters: fake === null ? {} : { turn: fake.adapter },
  });
  const storage = create_storage({ settings, modules: { 'server-time': time }, server: module_server });
  const logging = create_logging({ settings, modules: { storage, 'server-time': time }, server: module_server });
  if (dev) create_logging_dev(logging);
  const p2p = create_p2p_signaling({ settings, modules: { 'server-time': time, logging }, server: p2p_server_of(module_server, options.host_secrets) });
  if (dev) create_p2p_signaling_dev(p2p);
  const modules = [time, storage, logging, p2p];
  for (const module of modules) module.begin_start();
  let failure: string | null = null;
  for (const module of modules) failure ??= module.complete_start();
  const stop = (): void => {
    for (const module of [...modules].reverse()) module.stop();
  };
  if (failure !== null) {
    stop();
    return failure;
  }
  // Server start ends: every job runs once.
  time.end_start();
  const server: Server = {
    p2p,
    time,
    clock,
    fake: fake?.controller ?? null,
    lines,
    core_logs: () =>
      lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line.kind === 'core' && line.module === 'p2p-signaling'),
    idle: () => time_dev.wait_idle(),
    stop,
  };
  running.push(server);
  return server;
}

/** `start_server` that throws on a server start failure. */
export async function started(options: StartOptions = {}): Promise<Server> {
  const server = await start_server(options);
  if (typeof server === 'string') throw new Error(`server start failed: ${server}`);
  return server;
}

export function player(user_id: bigint, index: number): CoreContract.MatchPlayer {
  const p = new CoreContract.MatchPlayer();
  p.user_id = user_id;
  p.index = index;
  return p;
}

export interface Match<C extends readonly TestConnection[]> {
  readonly match_id: string;
  readonly players: CoreContract.MatchPlayer[];
  readonly connections: C;
  readonly transport: CoreContract.Transport;
  readonly expires_at: bigint;
  readonly changes: ReturnType<P2pSignaling['open_match_session']>;
}

let next_user = 1000n;

/** A new user ID for a test participant. */
export function new_user_id(): bigint {
  next_user += 1n;
  return next_user;
}

/** Connections of two new users. */
export function pair(): [TestConnection, TestConnection] {
  return [new TestConnection(new_user_id()), new TestConnection(new_user_id())];
}

/** Connections of three new users. */
export function trio(): [TestConnection, TestConnection, TestConnection] {
  return [new TestConnection(new_user_id()), new TestConnection(new_user_id()), new TestConnection(new_user_id())];
}

/** Prepares the transport and opens the match session of a match the way `matchmaker`'s match creation does. */
export async function open_match<C extends readonly TestConnection[]>(server: Server, match_id: string, connections: C, start_at: bigint = server.clock.now()): Promise<Match<C>> {
  const players = connections.map((c, index) => player(c.user_id, index));
  const transport = await server.p2p.prepare_transport(match_id, start_at, MAX_DURATION);
  const expires_at = start_at + MAX_DURATION;
  const changes = server.p2p.open_match_session(match_id, players, connections, transport, expires_at);
  return { match_id, players, connections, transport, expires_at, changes };
}

export function signal(index: number, payload: Uint8Array): CoreContract.MatchmakerFrame {
  const f = new CoreContract.MatchmakerFrame();
  f.kind = Kind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL;
  f.index = index;
  f.payload = payload;
  return f;
}

export function match_frame(kind: CoreContract.MatchmakerFrameKind, match_id: string): CoreContract.MatchmakerFrame {
  const f = new CoreContract.MatchmakerFrame();
  f.kind = kind;
  f.match_id = match_id;
  return f;
}

export function leave(match_id: string): CoreContract.MatchmakerFrame {
  return match_frame(Kind.MATCHMAKER_FRAME_KIND_MATCH_LEAVE, match_id);
}

export function rejoin(match_id: string): CoreContract.MatchmakerFrame {
  return match_frame(Kind.MATCHMAKER_FRAME_KIND_MATCH_REJOIN, match_id);
}

export function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

/** The frames of a connection as `{kind, index}` pairs. */
export function kinds(frames: readonly CoreContract.MatchmakerFrame[]): { kind: number; index: number }[] {
  return frames.map((f) => ({ kind: f.kind, index: f.index }));
}

/** The encoded bytes of a message, for comparing two messages field by field. */
export function encoded(message: { encode(): Uint8Array } | null): number[] {
  return message === null ? [] : [...message.encode()];
}

/** An integer core settings value from `core-settings.json`. */
export function core_settings_value(key: string): number {
  const value = core_settings()[key];
  if (typeof value !== 'number') throw new Error(`core setting ${key} is not a number`);
  return value;
}
