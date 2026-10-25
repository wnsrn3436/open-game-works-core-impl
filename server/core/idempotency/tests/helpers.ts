/**
 * Test instances of `idempotency` with its dependencies `storage` and `server-time`, on the DB of the run's DB kind.
 * `send` calls idempotency the way `routing` handles one request: the committed response before the user
 * transaction, then `find_response`, the handler, and `save_response` with `save_withdrawn_response` in it.
 */
import { createHash } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { create_server_time, type ServerTime } from '../../server-time/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import { create_storage, type GameTx, type RequestCtx, type Storage } from '../../storage/index.ts';
import { TestClock, core_settings, new_db, test_server, type DbTarget } from '../../storage/tests/helpers.ts';
import { NAME_MISMATCH, create_idempotency, type IdempotencyModule } from '../index.ts';

export { TestClock, new_db, type DbTarget };

export const START_AT = 1_800_000_000_000n;
export const RETENTION_MS = 600_000n;
export const NOTIFY_RETENTION_MS = 900_000n;

/** Short retention that still passes the server start check: 2 × 60000 and 60000 + 10000 are below it. */
export const SETTINGS: Readonly<Record<string, number>> = {
  'session.signatureWindowMs': 60_000,
  'NetworkCore.maxRetryAgeMs': 60_000,
  'NetworkCore.requestTimeoutMs': 10_000,
  'idempotency.responseRetentionMs': Number(RETENTION_MS),
  'idempotency.notifyRetentionMs': Number(NOTIFY_RETENTION_MS),
};

export interface Server {
  readonly db: DbTarget;
  readonly clock: TestClock;
  readonly time: ServerTime;
  readonly storage: Storage;
  readonly idempotency: IdempotencyModule;
  /** Cheat time offset ms by user ID. */
  readonly offsets: Map<bigint, bigint>;
  stop(): void;
}

/** Starts `server-time`, `storage` and `idempotency` in dependency order, or returns the server start failure reason. */
export function start_server(db: DbTarget, settings: Readonly<Record<string, number>> = {}, clock = new TestClock(START_AT)): Server | string {
  const merged = { ...core_settings(), ...SETTINGS, ...settings };
  const offsets = new Map<bigint, bigint>();
  const time = create_server_time({ settings: { ...merged, dailyResetOffsetMs: 0 }, modules: {} });
  const time_dev = create_server_time_dev(time);
  time_dev.set_clock(clock);
  time_dev.register_offset_provider((user_id) => offsets.get(user_id) ?? 0n);
  const server = test_server(db, { server_modules: ['server-time', 'storage', 'idempotency'] });
  const storage = create_storage({ settings: merged, modules: { 'server-time': time }, server });
  const idempotency = create_idempotency({ settings: merged, modules: { storage, 'server-time': time }, server });
  const modules = [time, storage, idempotency];
  for (const module of modules) module.begin_start();
  let failure: string | null = null;
  for (const module of modules) {
    failure = module.complete_start();
    if (failure !== null) break;
  }
  const stop = (): void => {
    for (const module of [...modules].reverse()) module.stop();
  };
  if (failure !== null) {
    stop();
    return failure;
  }
  // Server start ends: every job runs once.
  time.end_start();
  return { db, clock, time, storage, idempotency, offsets, stop };
}

const running: Server[] = [];

/** A started server on a new DB, stopped by `stop_all`. */
export async function server(settings: Readonly<Record<string, number>> = {}): Promise<Server> {
  const started = start_server(await new_db(), settings);
  if (typeof started === 'string') throw new Error(`server start failed: ${started}`);
  running.push(started);
  return started;
}

export function stop_all(): void {
  for (const s of running.splice(0)) s.stop();
}

export async function new_user(s: Server): Promise<bigint> {
  const id = await s.storage.run_game_transaction((tx: GameTx) => s.storage.create_user(tx).user_id);
  if (id === 'FAILED') throw new Error('create_user failed');
  return id;
}

export function token_hash(access_token: string): string {
  return createHash('sha256').update(access_token, 'utf8').digest('hex');
}

/** A handler: the response body, or a `CoreError` value for an error response. */
export type Handler = (ctx: RequestCtx) => Uint8Array | number;

export const BUMP = 'test/Bump';
export const OTHER = 'test/Other';
export const WITHDRAW = 'core/Withdraw';

/** Handler calls of every server, by request name. */
export const calls = new Map<string, number>();

function count(name: string): void {
  calls.set(name, (calls.get(name) ?? 0) + 1);
}

/** Adds one to the user's `TutorialProgressUserState` 1 and answers it, so each handler run changes the delta and body. */
export function bump(s: Server): Handler {
  return (ctx) => {
    count(BUMP);
    const state = (s.storage.get_state(ctx, CoreContract.TutorialProgressUserState, 1n) as CoreContract.TutorialProgressUserState | null) ?? new CoreContract.TutorialProgressUserState();
    state.id = 1n;
    state.step += 1;
    s.storage.put_core_state(ctx, state);
    return state.encode();
  };
}

export function other(): Handler {
  return () => {
    count(OTHER);
    return new Uint8Array([1]);
  };
}

/** Deletes the user, like `Withdraw`. */
export function withdraw(s: Server): Handler {
  return (ctx) => {
    count(WITHDRAW);
    s.storage.delete_user(ctx);
    return new Uint8Array([2]);
  };
}

export function failing(code: number): Handler {
  return () => {
    count('failing');
    return code;
  };
}

function error_envelope(time: bigint, code: number): Uint8Array {
  const envelope = new CoreContract.ResponseEnvelope();
  envelope.server_time_at = time;
  envelope.error = new CoreContract.ServerError();
  envelope.error.code = code;
  return envelope.encode();
}

export const INVALID_REQUEST = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;

/** One request of a user with an access token, handled as `routing` does around idempotency. */
export async function send(s: Server, user_id: bigint, name: string, request_id: string, handler: Handler, access_token = `token-${String(user_id)}`): Promise<CoreContract.ResponseEnvelope> {
  const hash = token_hash(access_token);
  const read = s.storage.read_db();
  if (name === WITHDRAW) {
    const withdrawn = s.idempotency.find_withdrawn_response(read, hash, request_id, name, s.time.clock_now());
    if (withdrawn !== null) return decode(withdrawn === NAME_MISMATCH ? error_envelope(s.time.clock_now(), INVALID_REQUEST) : withdrawn);
  }
  const user_now = s.time.user_now(user_id, read);
  const committed = s.idempotency.find_committed_response(read, user_id, request_id, name, user_now);
  if (committed !== null) return decode(committed === NAME_MISMATCH ? error_envelope(user_now, INVALID_REQUEST) : committed);
  const fields = { request_name: name, request_id, silent: false, retry: false, session_id: '', client_version: '', platform: '' };
  const result = await s.storage.run_request_transaction(user_id, fields, (ctx) => {
    const found = s.idempotency.find_response(ctx);
    if (found !== null) return found === NAME_MISMATCH ? error_envelope(ctx.request_time, INVALID_REQUEST) : found;
    const out = handler(ctx);
    let bytes: Uint8Array;
    if (typeof out === 'number') {
      bytes = error_envelope(ctx.request_time, out);
    } else {
      const { delta } = s.storage.take_response_delta(ctx);
      const envelope = new CoreContract.ResponseEnvelope();
      envelope.server_time_at = ctx.request_time;
      envelope.user_state = delta.user_state;
      envelope.pending_user_state = delta.pending_user_state;
      envelope.item_changes = delta.item_changes;
      envelope.item_mails = delta.item_mails;
      envelope.body = out;
      bytes = envelope.encode();
    }
    // routing rolls back an error response; this commits it so that the filter of the save operations is what keeps it out.
    s.idempotency.save_response(ctx, bytes);
    s.idempotency.save_withdrawn_response(ctx, hash, bytes);
    return bytes;
  });
  if (typeof result === 'string') throw new Error(`request ${name} ${request_id}: ${result}`);
  return decode(result);
}

export function decode(bytes: Uint8Array): CoreContract.ResponseEnvelope {
  const envelope = CoreContract.ResponseEnvelope.decode(bytes);
  if (envelope === null) throw new Error('not a ResponseEnvelope');
  return envelope;
}

/** The envelope bytes with `server_time_at` cleared, to compare every other field. */
export function without_time(envelope: CoreContract.ResponseEnvelope): Uint8Array {
  const copy = decode(envelope.encode());
  copy.server_time_at = 0n;
  return copy.encode();
}

export function step_of(envelope: CoreContract.ResponseEnvelope): number {
  const state = CoreContract.TutorialProgressUserState.decode(envelope.body);
  if (state === null) throw new Error('not a TutorialProgressUserState body');
  return state.step;
}

/** Committed rows of an idempotency table. */
export function rows(s: Server, sql: string, params: readonly (bigint | string)[]): Record<string, unknown>[] {
  return [...s.storage.read_db().query(sql, params)];
}
