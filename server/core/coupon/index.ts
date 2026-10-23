/**
 * coupon: lets a user redeem a coupon code an operator made. It keeps the use limits, one use per user, the active
 * window, the redeem attempt limit and the use records, and grants the reward through `mailbox`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { ChangeSourceInput, ItemLedger } from '../item-ledger/index.ts';
import type { Logging, LogValue } from '../logging/index.ts';
import type { Mailbox } from '../mailbox/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { DbHandle, GameTx, Pass, RequestCtx, Storage } from '../storage/index.ts';
import { alphabet_error, code_bound_after, generate_code, is_valid_code, normalize_code, type CodeRules } from './code.ts';

export { normalize_code } from './code.ts';

/** The `storage` operations coupon calls. */
export type CouponStorage = Pick<Storage, 'register_table' | 'db' | 'lock_game_row' | 'run_user_transaction' | 'with_hook_change_source' | 'after_commit'>;

/** The `server-time` operations coupon calls. */
export type CouponServerTime = Pick<ServerTimeApi, 'is_reached' | 'is_reached_strict' | 'clock_now' | 'get_window_start'>;

/** The `item-ledger` operation coupon calls: the input check of `create_coupon` `items`. */
export type CouponItemLedger = Pick<ItemLedger, 'check_add_items'>;

/** The `mailbox` operations coupon calls. */
export type CouponMailbox = Pick<Mailbox, 'grant_or_mail' | 'send_mail'>;

/** The `logging` operation coupon calls. */
export type CouponLogging = Pick<Logging, 'write'>;

/** An admin operation input field type (`admin-api` `## API`). */
export type AdminFieldType =
  | { readonly kind: 'int64' | 'int32' | 'bool' | 'string' | 'json' }
  | { readonly kind: 'enum'; readonly elements: readonly string[] }
  | { readonly kind: 'array'; readonly element: AdminFieldType }
  | { readonly kind: 'object'; readonly fields: Readonly<Record<string, AdminField>> };

export interface AdminField {
  readonly type: AdminFieldType;
  readonly optional: boolean;
}

export type AdminFailure = 'bad_request' | 'not_found' | 'conflict' | 'external_failed' | 'internal';

/** An admin operation object (`admin-api` `## API`). coupon's take a JSON body and a game tx. */
export interface AdminOperation<I> {
  readonly name: string;
  readonly role: 'read' | 'economy';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, AdminField>>;
  readonly user_target: null;
  readonly handler: (input: I, tx: GameTx, prepare: unknown, body: Uint8Array | null) => Record<string, unknown> | AdminFailure;
  readonly prepare: null;
  readonly audit_args: null;
}

/** An admin input `items` element after the body check. */
export interface AdminItem {
  readonly item_id: number;
  readonly amount: bigint;
  readonly big_amount?: string;
}

export interface CreateCouponInput {
  readonly operation_id: string;
  readonly kind: 'shared' | 'unique';
  readonly code: string;
  readonly count: number;
  readonly max_uses: number;
  readonly start_at: bigint;
  readonly end_at: bigint;
  readonly items: readonly AdminItem[];
  readonly extra_id: number;
  readonly memo: string;
}

export interface GetCouponInput {
  readonly coupon_id?: bigint;
  readonly code?: string;
}

export interface ListCouponCodesInput {
  readonly coupon_id: bigint;
  readonly after_code: string;
  readonly limit: number;
}

export interface DisableCouponInput {
  readonly coupon_id: bigint;
}

/** The after hook `on_coupon_redeemed`. */
export type OnCouponRedeemed = (ctx: RequestCtx, coupon_id: bigint) => void;

/** The module input (`server-core` `## module`). coupon reads nothing of `server`. */
export interface CouponInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server?: unknown;
}

/** The `coupon` module object: the core rpc handler, the internal operation, the admin operations and the hook slot. */
export interface CouponModule {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  RedeemCoupon(ctx: RequestCtx, request: CoreContract.RedeemCouponRequest, prepare: Pass): CoreContract.RedeemCouponResponse | CoreContract.CoreError;
  count_redeem_attempt(user_id: bigint, request: CoreContract.RedeemCouponRequest, client_ip: string, request_id: string): Promise<Pass | CoreContract.CoreError>;
  readonly create_coupon: AdminOperation<CreateCouponInput>;
  readonly get_coupon: AdminOperation<GetCouponInput>;
  readonly list_coupon_codes: AdminOperation<ListCouponCodesInput>;
  readonly disable_coupon: AdminOperation<DisableCouponInput>;
  readonly hook_slots: { on_coupon_redeemed: OnCouponRedeemed | null };
}

type SettingKey =
  | 'coupon.codeAlphabet'
  | 'coupon.minCodeLength'
  | 'coupon.maxCodeLength'
  | 'coupon.generatedCodeLength'
  | 'coupon.maxCodeInputBytes'
  | 'coupon.maxBatchCount'
  | 'coupon.maxRewardItems'
  | 'mailbox.maxAttachments'
  | 'coupon.attemptWindowMs'
  | 'coupon.maxAttemptsPerWindow';

const INTEGER_KEYS: readonly SettingKey[] = [
  'coupon.minCodeLength',
  'coupon.maxCodeLength',
  'coupon.generatedCodeLength',
  'coupon.maxCodeInputBytes',
  'coupon.maxBatchCount',
  'coupon.maxRewardItems',
  'mailbox.maxAttachments',
  'coupon.attemptWindowMs',
  'coupon.maxAttemptsPerWindow',
];

interface CouponSettings {
  readonly rules: CodeRules;
  readonly generated_code_length: number;
  readonly max_batch_count: number;
  readonly max_reward_items: number;
  readonly max_attachments: number;
  readonly attempt_window_ms: bigint;
  readonly max_attempts_per_window: bigint;
}

const COUPON_TABLE = 'coupon_coupon';
const CODE_TABLE = 'coupon_code';
const REDEMPTION_TABLE = 'coupon_redemption';
const ATTEMPT_TABLE = 'coupon_attempt';

const REDEEM_REQUEST = 'core/RedeemCoupon';
const COUPON_COLUMNS = 'coupon_id, kind, code, count, max_uses, used_count, start_at, end_at, items, extra_id, memo, disabled';
const SELECT_COUPON = `SELECT ${COUPON_COLUMNS} FROM ${COUPON_TABLE} WHERE coupon_id = $1`;
const SELECT_CODE = `SELECT coupon_id, redeemed_by FROM ${CODE_TABLE} WHERE code = $1`;
const SELECT_REDEMPTION = `SELECT coupon_id FROM ${REDEMPTION_TABLE} WHERE user_id = $1 AND coupon_id = $2`;
const SELECT_LAST_ID = `SELECT coupon_id FROM ${COUPON_TABLE} ORDER BY coupon_id DESC LIMIT 1`;
// `storage` string columns compare in byte order on both DBs (PostgreSQL `COLLATE "C"`, SQLite `BINARY`), so `ORDER BY code`
// and `>=` give the byte order `list_coupon_codes` returns.
const SELECT_CODES_OF = `SELECT code, redeemed_by, redeemed_at FROM ${CODE_TABLE} WHERE coupon_id = $1 AND code >= $2 ORDER BY code LIMIT $3`;
const COUNT_REDEEMED_CODES = `SELECT COUNT(*) AS used FROM ${CODE_TABLE} WHERE coupon_id = $1 AND redeemed_by IS NOT NULL`;
const INSERT_COUPON =
  `INSERT INTO ${COUPON_TABLE} (${COUPON_COLUMNS}, created_at) ` + 'VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, false, $11)';
const INSERT_REDEMPTION = `INSERT INTO ${REDEMPTION_TABLE} (user_id, coupon_id, redeemed_at) VALUES ($1, $2, $3)`;
const ADD_USE = `UPDATE ${COUPON_TABLE} SET used_count = used_count + 1 WHERE coupon_id = $1`;
const REDEEM_CODE = `UPDATE ${CODE_TABLE} SET redeemed_by = $2, redeemed_at = $3 WHERE code = $1`;
const DISABLE = `UPDATE ${COUPON_TABLE} SET disabled = true WHERE coupon_id = $1`;
// One statement: a row of another window starts again from 1 (`storage` `### expiry`).
const COUNT_ATTEMPT =
  `INSERT INTO ${ATTEMPT_TABLE} (user_id, window_start, count, expires_at) VALUES ($1, $2, 1, $3) ` +
  `ON CONFLICT (user_id) DO UPDATE SET count = CASE WHEN ${ATTEMPT_TABLE}.window_start = $2 THEN ${ATTEMPT_TABLE}.count + 1 ELSE 1 END, ` +
  'window_start = $2, expires_at = $3 RETURNING count';

/** Codes per `IN (...)` lookup and rows per multi-row insert of `unique` codes. */
const LOOKUP_CHUNK = 500;
const INSERT_CHUNK = 200;
/** Picks of one `unique` code before `create_coupon` gives up with `conflict`. */
const MAX_CODE_PICKS = 100;

const ITEM_FIELDS: Readonly<Record<string, AdminField>> = {
  item_id: { type: { kind: 'int32' }, optional: false },
  amount: { type: { kind: 'int64' }, optional: false },
  big_amount: { type: { kind: 'string' }, optional: true },
};

function field(kind: 'int64' | 'int32' | 'bool' | 'string', optional = false): AdminField {
  return { type: { kind }, optional };
}

/** A stored `coupon_coupon` row. */
interface CouponRow {
  readonly coupon_id: bigint;
  readonly kind: 'shared' | 'unique';
  readonly code: string;
  readonly count: number;
  readonly max_uses: number;
  readonly used_count: bigint;
  readonly start_at: bigint;
  readonly end_at: bigint;
  readonly items: CoreContract.ItemAmount[];
  readonly extra_id: number;
  readonly memo: string;
  readonly disabled: boolean;
}

function read_settings(settings: Readonly<Record<string, unknown>>): CouponSettings {
  const alphabet = settings['coupon.codeAlphabet'];
  if (typeof alphabet !== 'string') throw new TypeError('coupon: setting coupon.codeAlphabet is not a string');
  const values = new Map<SettingKey, number>();
  for (const key of INTEGER_KEYS) {
    const value = settings[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`coupon: setting ${key} is not an integer`);
    values.set(key, value);
  }
  const get = (key: SettingKey): number => values.get(key) ?? 0;
  return {
    rules: { alphabet, min_length: get('coupon.minCodeLength'), max_length: get('coupon.maxCodeLength') },
    generated_code_length: get('coupon.generatedCodeLength'),
    max_batch_count: get('coupon.maxBatchCount'),
    max_reward_items: get('coupon.maxRewardItems'),
    max_attachments: get('mailbox.maxAttachments'),
    attempt_window_ms: BigInt(get('coupon.attemptWindowMs')),
    max_attempts_per_window: BigInt(get('coupon.maxAttemptsPerWindow')),
  };
}

function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): unknown {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`coupon: modules has no ${name}`);
  return module;
}

function to_item_amount(item: AdminItem): CoreContract.ItemAmount {
  const amount = new CoreContract.ItemAmount();
  amount.item_id = item.item_id;
  amount.amount = item.amount;
  amount.big_amount = item.big_amount ?? '';
  return amount;
}

/** `items` column text: `[{item_id, amount, big_amount}]` with `amount` as a decimal string. */
function items_text(items: readonly CoreContract.ItemAmount[]): string {
  return JSON.stringify(items.map((item) => ({ item_id: item.item_id, amount: String(item.amount), big_amount: item.big_amount })));
}

function items_of(text: unknown): CoreContract.ItemAmount[] {
  if (typeof text !== 'string') throw new Error('coupon: items column is not text');
  const parsed = JSON.parse(text) as { item_id: number; amount: string; big_amount: string }[];
  return parsed.map((item) => to_item_amount({ item_id: item.item_id, amount: BigInt(item.amount), big_amount: item.big_amount }));
}

function bigint_of(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  throw new Error(`coupon: ${String(value)} is not an integer column value`);
}

/** A `COUNT(*)` value: a number or bigint on SQLite, a decimal string on PostgreSQL. */
function count_of(value: unknown): bigint {
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  return bigint_of(value);
}

function coupon_row(row: Readonly<Record<string, unknown>>): CouponRow {
  return {
    coupon_id: bigint_of(row['coupon_id']),
    kind: row['kind'] === 'unique' ? 'unique' : 'shared',
    code: String(row['code']),
    count: Number(row['count']),
    max_uses: Number(row['max_uses']),
    used_count: bigint_of(row['used_count']),
    start_at: bigint_of(row['start_at']),
    end_at: bigint_of(row['end_at']),
    items: items_of(row['items']),
    extra_id: Number(row['extra_id']),
    memo: String(row['memo']),
    disabled: row['disabled'] === true,
  };
}

function find_coupon(db: DbHandle, coupon_id: bigint): CouponRow | null {
  const row = db.query(SELECT_COUPON, [coupon_id])[0];
  return row === undefined ? null : coupon_row(row);
}

function find_code(db: DbHandle, code: string): { coupon_id: bigint; redeemed_by: bigint | null } | null {
  const row = db.query(SELECT_CODE, [code])[0];
  if (row === undefined) return null;
  const redeemed_by = row['redeemed_by'];
  return { coupon_id: bigint_of(row['coupon_id']), redeemed_by: redeemed_by === null || redeemed_by === undefined ? null : bigint_of(redeemed_by) };
}

function admin_operation<I>(
  name: string,
  role: 'read' | 'economy',
  input: Readonly<Record<string, AdminField>>,
  handler: (input: I, tx: GameTx) => Record<string, unknown> | AdminFailure,
): AdminOperation<I> {
  return { name, role, body: 'json', max_body_bytes: null, input, user_target: null, handler: (value, tx) => handler(value, tx), prepare: null, audit_args: null };
}

/** Makes `coupon` for one server instance. A missing setting or dependency throws. */
export function create_coupon(input: CouponInput): CouponModule {
  const storage = module_of(input.modules, 'storage', 'register_table') as CouponStorage;
  const server_time = module_of(input.modules, 'server-time', 'clock_now') as CouponServerTime;
  const item_ledger = module_of(input.modules, 'item-ledger', 'check_add_items') as CouponItemLedger;
  const mailbox = module_of(input.modules, 'mailbox', 'grant_or_mail') as CouponMailbox;
  const logging = module_of(input.modules, 'logging', 'write') as CouponLogging;
  const settings = read_settings(input.settings);
  const hook_slots: { on_coupon_redeemed: OnCouponRedeemed | null } = { on_coupon_redeemed: null };

  const write_error = (message: string, user_id: bigint, request_id: string | null, error: unknown): void => {
    logging.write({
      kind: 'error',
      level: 'error',
      message,
      user_id,
      request_id,
      request: REDEEM_REQUEST,
      fields: { stack_trace: error instanceof Error ? (error.stack ?? error.message) : null },
    });
  };

  /** Step 5: the reward. The received `ItemAmount` list, or null when the grant failed. */
  const grant = (ctx: RequestCtx, coupon: CouponRow): CoreContract.ItemAmount[] | null => {
    const template_id = ctx.data.ReservedId.coupon_reward_mail();
    const once_key = `coupon:${String(coupon.coupon_id)}`;
    if (coupon.extra_id === 0) {
      const source: ChangeSourceInput = { source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_COUPON, ref: String(coupon.coupon_id), once_key };
      const granted = mailbox.grant_or_mail(ctx, coupon.items, source, template_id, []);
      if (granted.result === 'Granted') return coupon.items;
      return granted.result === 'AlreadyApplied' || granted.result === 'Mailed' ? [] : null;
    }
    const sent = mailbox.send_mail(ctx, { template_id, args: [], attachments: coupon.items, extra_id: coupon.extra_id, expire_ms: 0n, no_expiry: false, once_key });
    return sent.result === 'OK' || sent.result === 'ALREADY_SENT' ? [] : null;
  };

  /** Step 7: the after hook. False when it threw or handed back a value. */
  const run_hook = (ctx: RequestCtx, coupon_id: bigint): boolean => {
    const hook: ((ctx: RequestCtx, coupon_id: bigint) => unknown) | null = hook_slots.on_coupon_redeemed;
    if (hook === null) return true;
    try {
      const output = storage.with_hook_change_source(ctx, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_COUPON, String(coupon_id), () => hook(ctx, coupon_id));
      if (output === undefined || output === null) return true;
      write_error('on_coupon_redeemed handed back a value', ctx.user_id, ctx.request_id, null);
    } catch (error) {
      write_error('on_coupon_redeemed threw', ctx.user_id, ctx.request_id, error);
    }
    return false;
  };

  /** Steps 1 to 3: the coupon of the normalized code, active and not used by this user, or the error. */
  const find_redeemable = (ctx: RequestCtx, db: DbHandle, code: string): CouponRow | CoreContract.CoreError => {
    const found = is_valid_code(code, settings.rules) ? find_code(db, code) : null;
    const coupon = found === null ? null : find_coupon(db, found.coupon_id);
    if (coupon === null || coupon.disabled) return CoreContract.CoreError.CORE_ERROR_COUPON_INVALID;
    if (!server_time.is_reached(ctx, coupon.start_at) || server_time.is_reached_strict(ctx, coupon.end_at)) {
      return CoreContract.CoreError.CORE_ERROR_COUPON_NOT_ACTIVE;
    }
    if (db.query(SELECT_REDEMPTION, [ctx.user_id, coupon.coupon_id]).length > 0) return CoreContract.CoreError.CORE_ERROR_COUPON_ALREADY_REDEEMED;
    return coupon;
  };

  /** Step 4: locks the coupon row (`shared`) or the code row (`unique`) and reads the use limit again. Null when it is free. */
  const check_use_limit = (ctx: RequestCtx, db: DbHandle, coupon: CouponRow, code: string): CoreContract.CoreError | null => {
    if (coupon.kind === 'unique') {
      if (storage.lock_game_row(ctx, CODE_TABLE, [code]) === 'FAILED') return CoreContract.CoreError.CORE_ERROR_INTERNAL;
      return find_code(db, code)?.redeemed_by === null ? null : CoreContract.CoreError.CORE_ERROR_COUPON_USED_UP;
    }
    if (storage.lock_game_row(ctx, COUPON_TABLE, [coupon.coupon_id]) === 'FAILED') return CoreContract.CoreError.CORE_ERROR_INTERNAL;
    const locked = find_coupon(db, coupon.coupon_id);
    if (locked === null) return CoreContract.CoreError.CORE_ERROR_COUPON_INVALID;
    return locked.max_uses !== 0 && locked.used_count >= BigInt(locked.max_uses) ? CoreContract.CoreError.CORE_ERROR_COUPON_USED_UP : null;
  };

  /** Step 6: the use records. */
  const record_use = (ctx: RequestCtx, db: DbHandle, coupon: CouponRow, code: string): void => {
    if (coupon.kind === 'shared') db.query(ADD_USE, [coupon.coupon_id]);
    else db.query(REDEEM_CODE, [code, ctx.user_id, ctx.request_time]);
    db.query(INSERT_REDEMPTION, [ctx.user_id, coupon.coupon_id, ctx.request_time]);
  };

  const redeem = (ctx: RequestCtx, request: CoreContract.RedeemCouponRequest): CoreContract.RedeemCouponResponse | CoreContract.CoreError => {
    const db = storage.db(ctx);
    const code = normalize_code(request.code);
    const coupon = find_redeemable(ctx, db, code);
    if (typeof coupon === 'number') return coupon;
    const limited = check_use_limit(ctx, db, coupon, code);
    if (limited !== null) return limited;
    const received = grant(ctx, coupon);
    if (received === null) return CoreContract.CoreError.CORE_ERROR_INTERNAL;
    record_use(ctx, db, coupon, code);
    if (!run_hook(ctx, coupon.coupon_id)) return CoreContract.CoreError.CORE_ERROR_INTERNAL;
    const { user_id, request_id } = ctx;
    const args: LogValue = { coupon_id: String(coupon.coupon_id), code } as unknown as LogValue;
    storage.after_commit(ctx, () =>
      logging.write({ kind: 'audit', level: 'info', message: 'coupon redeemed', user_id, request_id, request: REDEEM_REQUEST, fields: { args } }),
    );
    const response = new CoreContract.RedeemCouponResponse();
    response.items = received;
    return response;
  };

  const count_redeem_attempt = async (
    user_id: bigint,
    _request: CoreContract.RedeemCouponRequest,
    client_ip: string,
    request_id: string,
  ): Promise<Pass | CoreContract.CoreError> => {
    const window_start = server_time.get_window_start(settings.attempt_window_ms, server_time.clock_now());
    const expires_at = window_start + settings.attempt_window_ms;
    let count = 0n;
    const result = await storage.run_user_transaction(user_id, (ctx) => {
      const row = storage.db(ctx).query(COUNT_ATTEMPT, [user_id, window_start, expires_at])[0];
      count = bigint_of(row?.['count']);
      return 'pass';
    });
    if (result === 'WITHDRAWN') return CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED;
    if (result !== 'COMMITTED') {
      write_error('coupon redeem attempt transaction failed', user_id, request_id, null);
      return CoreContract.CoreError.CORE_ERROR_INTERNAL;
    }
    if (count <= settings.max_attempts_per_window) return 'pass';
    logging.write({
      kind: 'security',
      level: 'warn',
      message: 'coupon redeem attempt limit',
      user_id,
      request_id,
      request: REDEEM_REQUEST,
      fields: { ip: client_ip, reason: 'rate_limited' },
    });
    return CoreContract.CoreError.CORE_ERROR_RATE_LIMITED;
  };

  /** The `create_coupon` input rules apart from the item input check: true when they hold. */
  const valid_create = (input: CreateCouponInput, code: string): boolean => {
    const kind_ok =
      input.kind === 'shared'
        ? is_valid_code(code, settings.rules) && input.count === 0 && input.max_uses >= 0
        : input.code === '' && input.count >= 1 && input.count <= settings.max_batch_count && input.max_uses === 0;
    const item_limit = input.extra_id === 0 ? settings.max_reward_items : Math.min(settings.max_reward_items, settings.max_attachments);
    const items_ok = input.items.length >= (input.extra_id === 0 ? 1 : 0) && input.items.length <= item_limit;
    return kind_ok && items_ok && input.extra_id >= 0 && input.start_at >= 0n && input.start_at < input.end_at;
  };

  /**
   * `count` new codes, unlike each other and every stored code, or null when one code overlapped on all its
   * `MAX_CODE_PICKS` picks.
   */
  const new_codes = (db: DbHandle, count: number): string[] | null => {
    const codes = new Set<string>();
    // the picks so far of each code still to find
    let pending: number[] = new Array<number>(count).fill(0);
    while (pending.length > 0) {
      const picked = new Map<string, number>();
      for (const done of pending) {
        let picks = done;
        let code: string;
        do {
          if (picks === MAX_CODE_PICKS) return null;
          code = generate_code(settings.rules.alphabet, settings.generated_code_length);
          picks += 1;
        } while (codes.has(code) || picked.has(code));
        picked.set(code, picks);
      }
      const batch = [...picked.keys()];
      const taken = new Set<string>();
      for (let i = 0; i < batch.length; i += LOOKUP_CHUNK) {
        const chunk = batch.slice(i, i + LOOKUP_CHUNK);
        const sql = `SELECT code FROM ${CODE_TABLE} WHERE code IN (${chunk.map((_, j) => `$${String(j + 1)}`).join(', ')})`;
        for (const row of db.query(sql, chunk)) taken.add(String(row['code']));
      }
      pending = [];
      for (const [code, picks] of picked) {
        if (taken.has(code)) pending.push(picks);
        else codes.add(code);
      }
    }
    return [...codes];
  };

  const insert_codes = (db: DbHandle, coupon_id: bigint, codes: readonly string[]): void => {
    for (let i = 0; i < codes.length; i += INSERT_CHUNK) {
      const chunk = codes.slice(i, i + INSERT_CHUNK);
      const values = chunk.map((_, j) => `($${String(j + 2)}, $1, NULL, NULL)`).join(', ');
      db.query(`INSERT INTO ${CODE_TABLE} (code, coupon_id, redeemed_by, redeemed_at) VALUES ${values}`, [coupon_id, ...chunk]);
    }
  };

  const create = (input: CreateCouponInput, tx: GameTx): Record<string, unknown> | AdminFailure => {
    const code = input.kind === 'shared' ? normalize_code(input.code) : '';
    if (!valid_create(input, code)) return 'bad_request';
    const items = input.items.map(to_item_amount);
    if (items.length > 0 && item_ledger.check_add_items(items) !== 'OK') return 'bad_request';
    const db = storage.db(tx);
    // create_coupon runs one at a time: code checks and ID choice come after this lock
    if (storage.lock_game_row(tx, COUPON_TABLE, [0n]) === 'FAILED') return 'internal';
    if (input.kind === 'shared' && find_code(db, code) !== null) return 'conflict';
    const codes = input.kind === 'shared' ? [code] : new_codes(db, input.count);
    if (codes === null) return 'conflict';
    const coupon_id = bigint_of(db.query(SELECT_LAST_ID)[0]?.['coupon_id'] ?? 0n) + 1n;
    db.query(INSERT_COUPON, [
      coupon_id,
      input.kind,
      code,
      input.count,
      input.max_uses,
      input.start_at,
      input.end_at,
      items_text(items),
      input.extra_id,
      input.memo,
      server_time.clock_now(),
    ]);
    insert_codes(db, coupon_id, codes);
    return { coupon_id };
  };

  const get = (input: GetCouponInput, tx: GameTx): Record<string, unknown> | AdminFailure => {
    if ((input.coupon_id === undefined) === (input.code === undefined)) return 'bad_request';
    const db = storage.db(tx);
    let coupon_id = input.coupon_id;
    if (input.code !== undefined) {
      const code = normalize_code(input.code);
      if (!is_valid_code(code, settings.rules)) return 'bad_request';
      coupon_id = find_code(db, code)?.coupon_id;
    }
    const coupon = coupon_id === undefined ? null : find_coupon(db, coupon_id);
    if (coupon === null) return 'not_found';
    // a `unique` coupon's used_count is its number of redeemed codes
    const used_count = coupon.kind === 'shared' ? coupon.used_count : count_of(db.query(COUNT_REDEEMED_CODES, [coupon.coupon_id])[0]?.['used']);
    return {
      coupon_id: coupon.coupon_id,
      kind: coupon.kind,
      code: coupon.code,
      count: coupon.count,
      max_uses: coupon.max_uses,
      start_at: coupon.start_at,
      end_at: coupon.end_at,
      items: coupon.items.map((item) => ({ item_id: item.item_id, amount: item.amount, big_amount: item.big_amount })),
      extra_id: coupon.extra_id,
      memo: coupon.memo,
      used_count,
      disabled: coupon.disabled,
    };
  };

  const list_codes = (input: ListCouponCodesInput, tx: GameTx): Record<string, unknown> | AdminFailure => {
    const db = storage.db(tx);
    if (find_coupon(db, input.coupon_id) === null) return 'not_found';
    const bound = code_bound_after(input.after_code);
    if (bound === null) return { codes: [] };
    const rows = db
      .query(SELECT_CODES_OF, [input.coupon_id, bound, input.limit])
      .map((row) => ({
        code: String(row['code']),
        redeemed_by: row['redeemed_by'] === null ? null : bigint_of(row['redeemed_by']),
        redeemed_at: row['redeemed_at'] === null ? null : bigint_of(row['redeemed_at']),
      }));
    return { codes: rows };
  };

  const disable = (input: DisableCouponInput, tx: GameTx): Record<string, unknown> | AdminFailure => {
    const db = storage.db(tx);
    if (find_coupon(db, input.coupon_id) === null) return 'not_found';
    db.query(DISABLE, [input.coupon_id]);
    return {};
  };

  return {
    begin_start() {
      storage.register_table(
        COUPON_TABLE,
        'game',
        [
          { name: 'coupon_id', type: 'int64' },
          { name: 'kind', type: 'string' },
          { name: 'code', type: 'string' },
          { name: 'count', type: 'int32' },
          { name: 'max_uses', type: 'int32' },
          { name: 'used_count', type: 'int64' },
          { name: 'start_at', type: 'int64' },
          { name: 'end_at', type: 'int64' },
          { name: 'items', type: 'string' },
          { name: 'extra_id', type: 'int32' },
          { name: 'memo', type: 'string' },
          { name: 'disabled', type: 'bool' },
          { name: 'created_at', type: 'int64' },
        ],
        ['coupon_id'],
        null,
        null,
      );
      storage.register_table(
        CODE_TABLE,
        'game',
        [
          { name: 'code', type: 'string' },
          { name: 'coupon_id', type: 'int64' },
          { name: 'redeemed_by', type: 'int64?' },
          { name: 'redeemed_at', type: 'int64?' },
        ],
        ['code'],
        null,
        null,
        null,
        [['coupon_id', 'code']],
      );
      storage.register_table(
        REDEMPTION_TABLE,
        'user',
        [
          { name: 'user_id', type: 'int64' },
          { name: 'coupon_id', type: 'int64' },
          { name: 'redeemed_at', type: 'int64' },
        ],
        ['user_id', 'coupon_id'],
        null,
        true,
      );
      storage.register_table(
        ATTEMPT_TABLE,
        'user',
        [
          { name: 'user_id', type: 'int64' },
          { name: 'window_start', type: 'int64' },
          { name: 'count', type: 'int64' },
          { name: 'expires_at', type: 'int64' },
        ],
        ['user_id'],
        'expires_at',
        false,
      );
    },
    complete_start: () => alphabet_error(settings.rules.alphabet),
    stop() {},
    RedeemCoupon: (ctx, request) => redeem(ctx, request),
    count_redeem_attempt,
    create_coupon: admin_operation<CreateCouponInput>(
      'create_coupon',
      'economy',
      {
        operation_id: field('string'),
        kind: { type: { kind: 'enum', elements: ['shared', 'unique'] }, optional: false },
        code: field('string'),
        count: field('int32'),
        max_uses: field('int32'),
        start_at: field('int64'),
        end_at: field('int64'),
        items: { type: { kind: 'array', element: { kind: 'object', fields: ITEM_FIELDS } }, optional: false },
        extra_id: field('int32'),
        memo: field('string'),
      },
      create,
    ),
    get_coupon: admin_operation<GetCouponInput>('get_coupon', 'read', { coupon_id: field('int64', true), code: field('string', true) }, get),
    list_coupon_codes: admin_operation<ListCouponCodesInput>(
      'list_coupon_codes',
      'read',
      { coupon_id: field('int64'), after_code: field('string'), limit: field('int32') },
      list_codes,
    ),
    disable_coupon: admin_operation<DisableCouponInput>('disable_coupon', 'economy', { coupon_id: field('int64') }, disable),
    hook_slots,
  };
}
