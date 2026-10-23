/**
 * play-session: the start, continue and finish of one single-player play session whose result the client simulation
 * decides. The server fixes the play session ID and start time, content hooks handle the costs, and the result is
 * checked against the data minimum time and a content verify hook before a content hook applies it once.
 */
import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { ItemChangeOutcome, ItemLedger } from '../item-ledger/index.ts';
import type { Logging, LogValue } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { FailureCode, Pass, RequestCtx, Storage } from '../storage/index.ts';
import type { Validation } from '../validation/index.ts';

/** What `create_play_session` reads of `server` (`server-core` `## module`). */
export interface PlaySessionServer {
  readonly data: GameData.DataSet;
}

/** The module input (`server-core` `## module`). */
export interface PlaySessionInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: PlaySessionServer;
}

interface PlaySessionModules {
  readonly storage: Storage;
  readonly 'server-time': ServerTimeApi;
  readonly logging: Logging;
  readonly validation: Validation;
  readonly 'item-ledger': ItemLedger;
}

/** The play session record a hook receives (`### play session`). */
export interface PlaySessionRecord {
  readonly play_session_id: string;
  readonly mode_id: number;
  readonly level_id: number;
  readonly started_at: bigint;
  /** `PlaySessionStartOptions` bytes. */
  readonly options: Uint8Array;
  readonly loadout: Uint8Array;
  /** The `options` bytes of each continue, in `continue_index` order. */
  readonly continues: readonly Uint8Array[];
  /** The request time of `FinishPlaySession`; 0 outside of it. */
  readonly finished_at: bigint;
}


/** `prepare_play_session`: the `loadout` bytes that come with `pass`, or a `GameError`. */
export type PrepareHook = (ctx: RequestCtx, mode_id: number, level_id: number, options: Uint8Array) => Uint8Array | GameContract.GameError;
export type ContinueHook = (ctx: RequestCtx, record: PlaySessionRecord, options: Uint8Array) => Pass | GameContract.GameError;
export type VerifyHook = (ctx: RequestCtx, record: PlaySessionRecord, result: Uint8Array) => Pass | 'reject';
export type ApplyHook = (ctx: RequestCtx, record: PlaySessionRecord, result: Uint8Array) => Pass | GameContract.GameError;

/** The hook slots `routing` fills with the hooks `register_hook` got. An empty slot does the `default`. */
export interface PlaySessionHookSlots {
  prepare_play_session: PrepareHook | null;
  continue_play_session: ContinueHook | null;
  verify_play_session: VerifyHook | null;
  apply_play_session: ApplyHook | null;
}

/** The module object: the `## API` operations, the exports to `routing`, the lifecycle. */
export interface PlaySession {
  StartPlaySession(ctx: RequestCtx, request: CoreContract.StartPlaySessionRequest): CoreContract.StartPlaySessionResponse | FailureCode;
  ContinuePlaySession(ctx: RequestCtx, request: CoreContract.ContinuePlaySessionRequest): CoreContract.ContinuePlaySessionResponse | FailureCode;
  FinishPlaySession(ctx: RequestCtx, request: CoreContract.FinishPlaySessionRequest): CoreContract.FinishPlaySessionResponse | FailureCode;
  get_active_play_session(ctx: RequestCtx): PlaySessionRecord | null;
  refund_entry(ctx: RequestCtx, record: PlaySessionRecord, items: readonly CoreContract.ItemAmount[]): ItemChangeOutcome;
  readonly hook_slots: PlaySessionHookSlots;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

const SESSION_TABLE = 'play_session_session';
const CONTINUE_TABLE = 'play_session_continue';
const REFUND_ONCE_KEY_PREFIX = 'play_session_refund:';

const SELECT_SESSION = `SELECT play_session_id, mode_id, level_id, started_at, options, loadout FROM ${SESSION_TABLE} WHERE user_id = $1`;
const UPSERT_SESSION =
  `INSERT INTO ${SESSION_TABLE} (user_id, play_session_id, mode_id, level_id, started_at, options, loadout) VALUES ($1, $2, $3, $4, $5, $6, $7) ` +
  'ON CONFLICT (user_id) DO UPDATE SET play_session_id = excluded.play_session_id, mode_id = excluded.mode_id, level_id = excluded.level_id, ' +
  'started_at = excluded.started_at, options = excluded.options, loadout = excluded.loadout';
const DELETE_SESSION = `DELETE FROM ${SESSION_TABLE} WHERE user_id = $1`;
const SELECT_CONTINUES = `SELECT options FROM ${CONTINUE_TABLE} WHERE user_id = $1 ORDER BY continue_index`;
const INSERT_CONTINUE = `INSERT INTO ${CONTINUE_TABLE} (user_id, continue_index, options) VALUES ($1, $2, $3)`;
const DELETE_CONTINUES = `DELETE FROM ${CONTINUE_TABLE} WHERE user_id = $1`;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PASS: Pass = 'pass';
const CoreError = CoreContract.CoreError;
const SOURCE_PLAY_SESSION = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_PLAY_SESSION;
const SOURCE_REFUND = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_PLAY_SESSION_REFUND;

/** A stored play session row with its mode row of the server build data. */
interface Stored {
  readonly record: PlaySessionRecord;
  readonly mode: GameData.PlaySessionModeRow;
}

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`play-session: setting ${key} is not an integer`);
  return value;
}

function modules_of(modules: Readonly<Record<string, unknown>>): PlaySessionModules {
  for (const name of ['storage', 'server-time', 'logging', 'validation', 'item-ledger']) {
    if (modules[name] === undefined || modules[name] === null) throw new TypeError(`play-session: module ${name} is missing`);
  }
  return modules as unknown as PlaySessionModules;
}

function bytes_of(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError('play-session: a stored bytes column is not bytes');
  return value;
}

/** Makes `play-session` for one server instance. A missing setting or module throws. */
export function create_play_session(input: PlaySessionInput): PlaySession {
  const deps = modules_of(input.modules);
  const { storage, logging, validation } = deps;
  const time = deps['server-time'];
  const ledger = deps['item-ledger'];
  integer_setting(input.settings, 'play-session.resultMaxBytes');
  integer_setting(input.settings, 'play-session.optionsMaxBytes');
  const loadout_max_bytes = integer_setting(input.settings, 'play-session.loadoutMaxBytes');
  const data = input.server.data;

  const hook_slots: PlaySessionHookSlots = {
    prepare_play_session: null,
    continue_play_session: null,
    verify_play_session: null,
    apply_play_session: null,
  };
  /** The ctx of each request whose `apply_play_session` hook is running; `refund_entry` works only there. */
  const applying = new Set<RequestCtx>();

  function log(ctx: RequestCtx, kind: 'error' | 'security', message: string, fields: Record<string, LogValue>): void {
    logging.write({
      kind,
      level: kind === 'error' ? 'error' : 'warn',
      message,
      user_id: ctx.user_id,
      request_id: ctx.request_id === '' ? null : ctx.request_id,
      request: ctx.request_name === '' ? null : ctx.request_name,
      fields: kind === 'error' ? { stack_trace: null, ...fields } : fields,
    });
  }

  /** True when the module message bytes decode and pass `validation.validate_message`. */
  function is_valid_message(name: 'PlaySessionResult' | 'PlaySessionStartOptions' | 'PlaySessionContinueOptions', bytes: Uint8Array): boolean {
    const decoded =
      name === 'PlaySessionResult'
        ? GameContract.PlaySessionResult.decode(bytes)
        : name === 'PlaySessionStartOptions'
          ? GameContract.PlaySessionStartOptions.decode(bytes)
          : GameContract.PlaySessionContinueOptions.decode(bytes);
    return decoded !== null && validation.validate_message(name, decoded) === PASS;
  }

  /** The user's play session row and its mode row; null without a row or when the mode is not in the data. */
  function load(ctx: RequestCtx, finished_at: bigint): Stored | null {
    const db = storage.db(ctx);
    const row = db.query(SELECT_SESSION, [ctx.user_id])[0];
    if (row === undefined) return null;
    const mode_id = row['mode_id'] as number;
    if (!data.PlaySessionModeTable.has_row(mode_id)) return null;
    const record: PlaySessionRecord = {
      play_session_id: row['play_session_id'] as string,
      mode_id,
      level_id: row['level_id'] as number,
      started_at: row['started_at'] as bigint,
      options: bytes_of(row['options']),
      loadout: bytes_of(row['loadout']),
      continues: db.query(SELECT_CONTINUES, [ctx.user_id]).map((r) => bytes_of(r['options'])),
      finished_at,
    };
    return { record, mode: data.PlaySessionModeTable.get_row(mode_id) };
  }

  function is_expired(ctx: RequestCtx, stored: Stored): boolean {
    return time.is_reached_strict(ctx, stored.record.started_at + stored.mode.max_duration);
  }

  /** Steps 1 to 3 of `### continue` and `### finish`: the play session of `play_session_id`, or the failure. */
  function find_open(ctx: RequestCtx, play_session_id: string, finished_at: bigint): Stored | FailureCode {
    if (!UUID_V4.test(play_session_id)) return CoreError.CORE_ERROR_INVALID_REQUEST;
    const stored = load(ctx, finished_at);
    if (stored === null || stored.record.play_session_id !== play_session_id) return CoreError.CORE_ERROR_PLAY_SESSION_NOT_FOUND;
    if (is_expired(ctx, stored)) return CoreError.CORE_ERROR_PLAY_SESSION_EXPIRED;
    return stored;
  }

  /** A hook output that is not of the hook's form: routing logs the throw and answers `INTERNAL`. */
  function malformed(hook: keyof PlaySessionHookSlots): never {
    throw new Error(`play-session: hook ${hook} returned an output that is not of its form`);
  }

  function start_play_session(ctx: RequestCtx, request: CoreContract.StartPlaySessionRequest): CoreContract.StartPlaySessionResponse | FailureCode {
    if (!is_valid_message('PlaySessionStartOptions', request.options)) return CoreError.CORE_ERROR_INVALID_REQUEST;
    const play_session_id = randomUUID();
    const started_at = ctx.request_time;
    const prepare = hook_slots.prepare_play_session;
    let loadout: Uint8Array = new Uint8Array(0);
    if (prepare !== null) {
      // The hook is content code: its output is checked, not trusted to match the type.
      const out: unknown = storage.with_hook_change_source(ctx, SOURCE_PLAY_SESSION, play_session_id, () =>
        prepare(ctx, request.mode_id, request.level_id, request.options),
      );
      if (out instanceof Uint8Array) {
        loadout = out;
      } else {
        // `pass` comes with the loadout bytes, so a bare `pass` is not of the hook's form either.
        const failure = storage.check_hook_output('prepare_play_session', out);
        if (failure === PASS) malformed('prepare_play_session');
        return failure;
      }
    }
    if (loadout.length > loadout_max_bytes) {
      log(ctx, 'error', 'prepare_play_session returned a loadout over play-session.loadoutMaxBytes', { mode_id: request.mode_id, loadout_bytes: loadout.length });
      return CoreError.CORE_ERROR_INTERNAL;
    }
    const db = storage.db(ctx);
    db.query(UPSERT_SESSION, [ctx.user_id, play_session_id, request.mode_id, request.level_id, started_at, request.options, loadout]);
    db.query(DELETE_CONTINUES, [ctx.user_id]);
    const response = new CoreContract.StartPlaySessionResponse();
    response.play_session_id = play_session_id;
    response.started_at = started_at;
    response.loadout = loadout;
    return response;
  }

  function continue_play_session(ctx: RequestCtx, request: CoreContract.ContinuePlaySessionRequest): CoreContract.ContinuePlaySessionResponse | FailureCode {
    const stored = find_open(ctx, request.play_session_id, 0n);
    if (typeof stored === 'number') return stored;
    const { record, mode } = stored;
    if (record.continues.length >= mode.max_continue_count) return CoreError.CORE_ERROR_PLAY_SESSION_CONTINUE_LIMIT;
    if (!is_valid_message('PlaySessionContinueOptions', request.options)) return CoreError.CORE_ERROR_INVALID_REQUEST;
    const hook = hook_slots.continue_play_session;
    // complete_start keeps a mode with continues from starting without the hook.
    if (hook === null) throw new Error('play-session: hook continue_play_session is not registered');
    const out = storage.check_hook_output(
      'continue_play_session',
      storage.with_hook_change_source(ctx, SOURCE_PLAY_SESSION, record.play_session_id, () => hook(ctx, record, request.options)),
    );
    if (out !== PASS) return out;
    const continue_index = record.continues.length;
    storage.db(ctx).query(INSERT_CONTINUE, [ctx.user_id, continue_index, request.options]);
    const response = new CoreContract.ContinuePlaySessionResponse();
    response.continue_count = continue_index + 1;
    return response;
  }

  function finish_play_session(ctx: RequestCtx, request: CoreContract.FinishPlaySessionRequest): CoreContract.FinishPlaySessionResponse | FailureCode {
    const stored = find_open(ctx, request.play_session_id, ctx.request_time);
    if (typeof stored === 'number') return stored;
    const { record, mode } = stored;
    const elapsed_ms = ctx.request_time - record.started_at;
    if (elapsed_ms < mode.min_duration) {
      log(ctx, 'security', 'play session finished before min_duration', { reason: 'play_session_too_fast', mode_id: record.mode_id, elapsed_ms });
      return CoreError.CORE_ERROR_PLAY_SESSION_TOO_FAST;
    }
    if (!is_valid_message('PlaySessionResult', request.result)) return CoreError.CORE_ERROR_INVALID_REQUEST;
    const verify = hook_slots.verify_play_session;
    if (verify !== null) {
      const verdict: unknown = verify(ctx, record, request.result);
      if (verdict === 'reject') {
        log(ctx, 'security', 'verify_play_session rejected the result', {
          reason: 'play_session_rejected',
          mode_id: record.mode_id,
          play_session_id: record.play_session_id,
        });
        return CoreError.CORE_ERROR_PLAY_SESSION_REJECTED;
      }
      if (verdict !== PASS) malformed('verify_play_session');
    }
    const apply = hook_slots.apply_play_session;
    if (apply !== null) {
      applying.add(ctx);
      let out: unknown;
      try {
        out = storage.with_hook_change_source(ctx, SOURCE_PLAY_SESSION, record.play_session_id, () => apply(ctx, record, request.result));
      } finally {
        applying.delete(ctx);
      }
      const checked = storage.check_hook_output('apply_play_session', out);
      if (checked !== PASS) return checked;
    }
    const db = storage.db(ctx);
    db.query(DELETE_SESSION, [ctx.user_id]);
    db.query(DELETE_CONTINUES, [ctx.user_id]);
    const response = new CoreContract.FinishPlaySessionResponse();
    response.result = request.result;
    return response;
  }

  return {
    StartPlaySession: start_play_session,
    ContinuePlaySession: continue_play_session,
    FinishPlaySession: finish_play_session,

    get_active_play_session(ctx) {
      const stored = load(ctx, 0n);
      if (stored === null || is_expired(ctx, stored)) return null;
      return stored.record;
    },

    refund_entry(ctx, record, items) {
      // Routing writes the error log of the throw and answers INTERNAL.
      if (!applying.has(ctx)) throw new Error('play-session: refund_entry was called outside of apply_play_session');
      return ledger.add_items(ctx, items, {
        source: SOURCE_REFUND,
        ref: record.play_session_id,
        once_key: `${REFUND_ONCE_KEY_PREFIX}${record.play_session_id}`,
      });
    },

    hook_slots,

    begin_start() {
      storage.register_table(
        SESSION_TABLE,
        'user',
        [
          { name: 'user_id', type: 'int64' },
          { name: 'play_session_id', type: 'string' },
          { name: 'mode_id', type: 'int32' },
          { name: 'level_id', type: 'int32' },
          { name: 'started_at', type: 'int64' },
          { name: 'options', type: 'bytes' },
          { name: 'loadout', type: 'bytes' },
        ],
        ['user_id'],
        null,
        false,
      );
      storage.register_table(
        CONTINUE_TABLE,
        'user',
        [
          { name: 'user_id', type: 'int64' },
          { name: 'continue_index', type: 'int32' },
          { name: 'options', type: 'bytes' },
        ],
        ['user_id', 'continue_index'],
        null,
        false,
      );
    },

    complete_start() {
      if (hook_slots.continue_play_session !== null) return null;
      const row = data.PlaySessionModeTable.all_rows().find((r) => r.max_continue_count >= 1);
      if (row === undefined) return null;
      // Routing writes the error log of the server start failure.
      return `hook continue_play_session is not registered and play_session_mode ${String(row.id)} has max_continue_count ${String(row.max_continue_count)}`;
    },

    stop() {
      applying.clear();
    },
  };
}
