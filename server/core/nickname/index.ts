/**
 * nickname: registers and changes the nickname of a user. Judges the character rules, banned words, duplicates,
 * the change cooldown and the change cost, and takes the operator forced change and the lookup of users by nickname.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import { ItemChangeResult, change_failure_code, type ItemLedger } from '../item-ledger/index.ts';
import type { Logging } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { DbHandle, FailureCode, GameTx, RequestCtx, Storage } from '../storage/index.ts';
import { TextCheckResult, type Validation } from '../validation/index.ts';

/** The module input (`server-core` `## module`). nickname reads nothing of `server`. */
export interface NicknameInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: unknown;
}

interface NicknameModules {
  readonly storage: Storage;
  readonly 'server-time': ServerTimeApi;
  readonly validation: Validation;
  readonly 'item-ledger': ItemLedger;
  readonly logging: Logging;
}

/** A failure reason of an admin operation handler (`admin-api`). */
export type AdminFailure = 'bad_request' | 'not_found' | 'conflict' | 'internal';

/**
 * An admin operation object (`admin-api`): `routing` hands it to `admin-api.register_admin_operation`. The handler
 * gets the target user's out-of-request ctx when `user_target` is set, a game tx otherwise.
 */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read' | 'ops';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, { readonly type: { readonly kind: 'int64' | 'string' }; readonly optional: boolean }>>;
  readonly user_target: string | null;
  readonly handler: (input: Readonly<Record<string, unknown>>, transaction: RequestCtx | GameTx, prepare_value: unknown, body: Uint8Array | null) => Record<string, unknown> | AdminFailure;
  readonly prepare: null;
  readonly audit_args: null;
}

/** A `get_nicknames` output element. */
export interface UserNickname {
  readonly user_id: bigint;
  readonly nickname: string;
}

/** The `nickname` module object: the `## API` operations, the core `rpc` handler, the admin operations and the lifecycle. */
export interface Nickname {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  SetNickname(ctx: RequestCtx, request: CoreContract.SetNicknameRequest): CoreContract.SetNicknameResponse | FailureCode;
  get_nicknames(ctx: RequestCtx, user_ids: readonly bigint[]): UserNickname[];
  check_nickname(nickname: string): CoreContract.CoreError | null;
  find_user_ids_by_nickname(ctx: RequestCtx, nickname: string, max: number): bigint[];
  readonly rename_user: AdminOperation;
  readonly find_user_by_nickname: AdminOperation;
}

const NAME_TABLE = 'nickname_name';
const CLAIM_TABLE = 'nickname_claim';

const SELECT_OTHER = `SELECT user_id FROM ${NAME_TABLE} WHERE normalized = $1 AND user_id <> $2 LIMIT 1`;
const UPSERT_NAME =
  `INSERT INTO ${NAME_TABLE} (user_id, normalized, nickname) VALUES ($1, $2, $3) ` +
  'ON CONFLICT (normalized, user_id) DO UPDATE SET nickname = excluded.nickname';
const DELETE_NAME = `DELETE FROM ${NAME_TABLE} WHERE normalized = $1 AND user_id = $2`;
const LOOKUP = `SELECT user_id, nickname FROM ${NAME_TABLE} WHERE normalized = $1 ORDER BY user_id LIMIT $2`;

const { CoreError, ItemChangeSource } = CoreContract;

const SPACE = 0x20;

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`nickname: setting ${key} is not an integer`);
  return value;
}

function modules_of(modules: Readonly<Record<string, unknown>>): NicknameModules {
  for (const name of ['storage', 'server-time', 'validation', 'item-ledger', 'logging']) {
    if (modules[name] === undefined || modules[name] === null) throw new Error(`nickname: module ${name} is missing`);
  }
  return modules as unknown as NicknameModules;
}

function code_points(text: string): number[] {
  return Array.from(text, (c) => c.codePointAt(0) ?? 0);
}

/** One character class of `\p{Script=...}` for the allowed scripts. Throws on a name that is not a Unicode `Script` value. */
function script_pattern(scripts: readonly string[]): RegExp {
  const parts = scripts.map((s) => {
    if (!/^[A-Za-z_]+$/.test(s)) throw new Error(`nickname.allowedScripts value ${JSON.stringify(s)} is not a Unicode Script value`);
    return `\\p{Script=${s}}`;
  });
  try {
    return new RegExp(`^[${parts.join('')}]$`, 'u');
  } catch {
    throw new Error(`nickname.allowedScripts ${JSON.stringify(scripts)} has a value that is not a Unicode Script value`);
  }
}

/** `nickname_name` rows of `user_id` and `nickname` as `UserNickname` values. */
function user_nicknames(rows: readonly Readonly<Record<string, unknown>>[]): UserNickname[] {
  return rows.map((r) => ({ user_id: r['user_id'] as bigint, nickname: r['nickname'] as string }));
}

/** Makes `nickname` for one server instance. A missing setting or module throws. */
export function create_nickname(input: NicknameInput): Nickname {
  const { settings, modules } = input;
  const min_length = integer_setting(settings, 'nickname.minLength');
  const max_length = integer_setting(settings, 'nickname.maxLength');
  const cooldown_ms = BigInt(integer_setting(settings, 'nickname.changeCooldownMs'));
  const max_lookup = integer_setting(settings, 'nickname.maxLookupCount');
  const max_search_rows = integer_setting(settings, 'admin-api.maxSearchRows');
  const scripts = settings['nickname.allowedScripts'];
  if (!Array.isArray(scripts) || !scripts.every((s) => typeof s === 'string')) throw new Error('nickname: setting nickname.allowedScripts is not a string array');
  const symbols = settings['nickname.allowedSymbols'];
  if (typeof symbols !== 'string') throw new Error('nickname: setting nickname.allowedSymbols is not a string');
  const unique = settings['nicknameUnique'];
  if (typeof unique !== 'boolean') throw new Error('nickname: game settings nicknameUnique is not a boolean');

  const deps = modules_of(modules);
  const storage = deps.storage;
  const time = deps['server-time'];
  const validation = deps.validation;
  const ledger = deps['item-ledger'];
  const logging = deps.logging;

  let script: RegExp | null = null;
  let start_failure: string | null = null;
  try {
    script = script_pattern(scripts);
  } catch (e) {
    start_failure = (e as Error).message;
  }
  const allowed_symbols = new Set(code_points(symbols));

  /** `### rules` 1: the character rules. */
  function follows_character_rules(nickname: string): boolean {
    if (!validation.is_plain_text(nickname, max_length)) return false;
    const points = code_points(nickname);
    if (points.length < min_length) return false;
    let previous = -1;
    for (const p of points) {
      if (p === SPACE && previous === SPACE) return false;
      previous = p;
      if (p === SPACE || (p >= 0x30 && p <= 0x39) || allowed_symbols.has(p)) continue;
      if (script === null || !script.test(String.fromCodePoint(p))) return false;
    }
    return true;
  }

  /** `### rules` 1 and 2. Logs the matched `banned_word` ID value. */
  function check_rules(nickname: string, ctx: RequestCtx | null): CoreContract.CoreError | null {
    if (!follows_character_rules(nickname)) return CoreError.CORE_ERROR_NICKNAME_INVALID;
    const text = validation.check_text(nickname, max_length, false);
    if (text.result === TextCheckResult.INVALID) return CoreError.CORE_ERROR_NICKNAME_INVALID;
    if (text.result === TextCheckResult.BANNED) {
      logging.write({
        kind: 'core',
        level: 'info',
        message: 'nickname has a banned word',
        user_id: ctx === null ? null : ctx.user_id,
        request_id: ctx === null || ctx.request_id === '' ? null : ctx.request_id,
        request: ctx === null || ctx.request_name === '' ? null : ctx.request_name,
        fields: { module: 'nickname', banned_word_id: text.banned_word_id },
      });
      return CoreError.CORE_ERROR_NICKNAME_BANNED;
    }
    return null;
  }

  /** Whether a user other than `user_id` has a `nickname_name` row of `normalized`. */
  function used_by_other(db: DbHandle, normalized: string, user_id: bigint): boolean {
    return db.query(SELECT_OTHER, [normalized, user_id]).length > 0;
  }

  /** The normalized nickname, or null for no nickname (an empty string). */
  function normalized_or_null(nickname: string): string | null {
    return nickname === '' ? null : validation.normalize_text(nickname);
  }

  /**
   * `SetNickname` step 5, name registration of `nickname` normalized to `normalized` over the current nickname
   * normalized to `current_normalized`: `TAKEN` when `nicknameUnique` is on and another user has `normalized`,
   * `FAILED` when the `nickname_claim` lock timed out.
   */
  function register_name(ctx: RequestCtx, nickname: string, normalized: string, current_normalized: string | null): 'TAKEN' | 'FAILED' | null {
    const db = storage.db(ctx);
    if (current_normalized === normalized) {
      db.query(UPSERT_NAME, [ctx.user_id, normalized, nickname]);
      return null;
    }
    if (unique) {
      if (storage.lock_game_row(ctx, CLAIM_TABLE, [normalized]) === 'FAILED') return 'FAILED';
      if (used_by_other(db, normalized, ctx.user_id)) return 'TAKEN';
    }
    db.query(UPSERT_NAME, [ctx.user_id, normalized, nickname]);
    if (current_normalized !== null) db.query(DELETE_NAME, [current_normalized, ctx.user_id]);
    return null;
  }

  function current_state(ctx: RequestCtx): CoreContract.NicknameUserState | null {
    return storage.get_state(ctx, CoreContract.NicknameUserState, 0n) as CoreContract.NicknameUserState | null;
  }

  /** The `cost` of the `nickname_cost` row with the largest `change_number` ≤ n, or an empty list. */
  function cost_of(ctx: RequestCtx, n: number): readonly CoreContract.ItemAmount[] {
    let best: { change_number: number; cost: readonly CoreContract.ItemAmount[] } | null = null;
    for (const row of ctx.data.NicknameCostTable.all_rows()) {
      if (row.change_number <= n && (best === null || row.change_number > best.change_number)) best = row;
    }
    return best === null ? [] : best.cost;
  }

  /** `SetNickname` step 2: the rules. Rule 3 is skipped when the normalized input is the user's own normalized nickname. */
  function check_set_rules(ctx: RequestCtx, nickname: string, normalized: string, current_normalized: string | null): CoreContract.CoreError | null {
    const failure = check_rules(nickname, ctx);
    if (failure !== null || !unique) return failure;
    if (current_normalized === normalized) return null;
    return used_by_other(storage.db(ctx), normalized, ctx.user_id) ? CoreError.CORE_ERROR_NICKNAME_TAKEN : null;
  }

  /** `SetNickname` step 3: a change after a nickname that was not given by an operator forced change, in the cooldown. */
  function in_cooldown(state: CoreContract.NicknameUserState | null, now: bigint): boolean {
    return state !== null && state.nickname !== '' && !state.forced && state.changed_at + cooldown_ms > now;
  }

  /** `SetNickname` step 4: takes the cost of change number n with source `Nickname`; the failure code when it cannot. */
  function pay_cost(ctx: RequestCtx, n: number): FailureCode | null {
    const cost = cost_of(ctx, n);
    if (cost.length === 0) return null;
    const result = ledger.subtract_items(ctx, cost, { source: ItemChangeSource.ITEM_CHANGE_SOURCE_NICKNAME, ref: String(n), once_key: '' });
    return result === ItemChangeResult.OK ? null : change_failure_code(result);
  }

  function SetNickname(ctx: RequestCtx, request: CoreContract.SetNicknameRequest): CoreContract.SetNicknameResponse | FailureCode {
    const nickname = request.nickname;
    const state = current_state(ctx);
    const current = state === null ? '' : state.nickname;
    const response = new CoreContract.SetNicknameResponse();
    response.nickname = nickname;
    // 1. the same string
    if (state !== null && current === nickname) return response;
    // 2. rules
    const normalized = validation.normalize_text(nickname);
    const current_normalized = normalized_or_null(current);
    const failure = check_set_rules(ctx, nickname, normalized, current_normalized);
    if (failure !== null) return failure;
    // 3. cooldown
    const now = time.now(ctx);
    if (in_cooldown(state, now)) return CoreError.CORE_ERROR_NICKNAME_COOLDOWN;
    // 4. cost
    const n = state === null || current === '' ? 0 : state.change_count + 1;
    const unpaid = pay_cost(ctx, n);
    if (unpaid !== null) return unpaid;
    // 5. name registration
    const registered = register_name(ctx, nickname, normalized, current_normalized);
    if (registered === 'TAKEN') return CoreError.CORE_ERROR_NICKNAME_TAKEN;
    if (registered === 'FAILED') return CoreError.CORE_ERROR_INTERNAL;
    // 6. state
    const next = new CoreContract.NicknameUserState();
    next.nickname = nickname;
    next.changed_at = now;
    next.change_count = n;
    next.forced = false;
    storage.put_core_state(ctx, next);
    return response;
  }

  function get_nicknames(ctx: RequestCtx, user_ids: readonly bigint[]): UserNickname[] {
    if (user_ids.length > max_lookup) throw new Error(`nickname: get_nicknames got ${String(user_ids.length)} user IDs, over nickname.maxLookupCount ${String(max_lookup)}`);
    const ids = [...new Set(user_ids)];
    if (ids.length === 0) return [];
    const params = ids.map((_, i) => `$${String(i + 1)}`).join(', ');
    const rows = storage.db(ctx).query(`SELECT user_id, nickname FROM ${NAME_TABLE} WHERE user_id IN (${params}) ORDER BY user_id`, ids);
    return user_nicknames(rows);
  }

  function check_nickname(nickname: string): CoreContract.CoreError | null {
    return check_rules(nickname, null);
  }

  /** Whether a lookup input is empty or longer than `nickname.maxLength` code points. */
  function bad_lookup(nickname: string): boolean {
    return nickname === '' || code_points(nickname).length > max_length;
  }

  /** `### find by nickname`: the nickname lookup rows, user ID ascending, at most `max`. */
  function lookup(db: DbHandle, nickname: string, max: number): UserNickname[] {
    return user_nicknames(db.query(LOOKUP, [validation.normalize_text(nickname), BigInt(max)]));
  }

  function find_user_ids_by_nickname(ctx: RequestCtx, nickname: string, max: number): bigint[] {
    if (bad_lookup(nickname) || max < 1) return [];
    return lookup(storage.db(ctx), nickname, max).map((r) => r.user_id);
  }

  const rename_user: AdminOperation = {
    name: 'rename_user',
    role: 'ops',
    body: 'json',
    max_body_bytes: null,
    input: {
      operation_id: { type: { kind: 'string' }, optional: false },
      user_id: { type: { kind: 'int64' }, optional: false },
      nickname: { type: { kind: 'string' }, optional: false },
      reason: { type: { kind: 'string' }, optional: false },
    },
    user_target: 'user_id',
    handler: (fields, transaction) => {
      const ctx = transaction as RequestCtx;
      const nickname = fields['nickname'] as string;
      if (!follows_character_rules(nickname)) return 'bad_request';
      const state = current_state(ctx);
      const registered = register_name(ctx, nickname, validation.normalize_text(nickname), normalized_or_null(state === null ? '' : state.nickname));
      if (registered === 'TAKEN') return 'conflict';
      if (registered === 'FAILED') return 'internal';
      const next = new CoreContract.NicknameUserState();
      next.nickname = nickname;
      next.changed_at = time.now(ctx);
      next.change_count = state === null ? 0 : state.change_count;
      next.forced = true;
      storage.put_core_state(ctx, next);
      return {};
    },
    prepare: null,
    audit_args: null,
  };

  const find_user_by_nickname: AdminOperation = {
    name: 'find_user_by_nickname',
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: {
      nickname: { type: { kind: 'string' }, optional: false },
    },
    user_target: null,
    handler: (fields, transaction) => {
      const tx = transaction as GameTx;
      const nickname = fields['nickname'] as string;
      if (bad_lookup(nickname)) return 'bad_request';
      return { users: lookup(storage.db(tx), nickname, max_search_rows) };
    },
    prepare: null,
    audit_args: null,
  };

  return {
    begin_start: () => {
      storage.register_table(
        NAME_TABLE,
        'user',
        [
          { name: 'user_id', type: 'int64' },
          { name: 'normalized', type: 'string' },
          { name: 'nickname', type: 'string' },
        ],
        ['normalized', 'user_id'],
        null,
        false,
        null,
        [['user_id']],
      );
      storage.register_table(CLAIM_TABLE, 'game', [{ name: 'normalized', type: 'string' }], ['normalized'], null, null);
    },
    complete_start: () => start_failure,
    stop: () => undefined,
    SetNickname,
    get_nicknames,
    check_nickname,
    find_user_ids_by_nickname,
    rename_user,
    find_user_by_nickname,
  };
}
