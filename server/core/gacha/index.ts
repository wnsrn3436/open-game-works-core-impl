/**
 * gacha: draws a banner defined in data. It takes the cost, rolls with `loot-table`, grants with `item-ledger` through
 * `mailbox.grant_or_mail`, and keeps pity, rate-up guarantee, `MULTI` guarantee, the disclosed rates computed from the
 * judging data, and the draw records.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameContract from '../../generated/contract/game_contract.ts';
import type { Logging, ParamList } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import { change_failure_code, type ItemChangeResult } from '../item-ledger/index.ts';
import type { RequestCtx, Storage } from '../storage/index.ts';
import { next_pity, pick_table, pity_owner, rate_sections, reaches, substitutions_of, tier_of, type PityState, type Substitution } from './draw.ts';
import { admin_entry, history_entry, insert_record, list_latest, list_range, register_record_table } from './records.ts';

export { RECORD_TABLE } from './records.ts';

const CoreError = CoreContract.CoreError;
type CoreErrorValue = CoreContract.CoreError;
const Mode = CoreContract.GachaDrawMode;
const SOURCE = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_GACHA;
const ONCE_KEY_PREFIX = 'gacha:';

/** A `GameError` value of the game contract: content's failure code. */
export type GameErrorValue = GameContract.GameError;

/** One roll result of `loot-table` (`LootResult`). */
export interface LootResult {
  readonly tables: readonly number[];
  readonly entries: readonly CoreContract.LootPathEntry[];
  readonly items: readonly CoreContract.ItemAmount[];
}

/** The `loot-table` operations gacha calls. A failure is the `LootRollResult` failure element name. */
export interface GachaLootTable {
  roll(ctx: RequestCtx, table_id: number, count: number, substitutions?: readonly Substitution[]): { readonly result: 'OK'; readonly results: readonly LootResult[] } | string;
  sum_items(results: readonly LootResult[]): readonly CoreContract.ItemAmount[] | string;
  get_rates(ctx: RequestCtx, table_id: number, substitutions?: readonly Substitution[]): readonly CoreContract.LootRate[];
}

/** An `item-ledger` change source. */
export interface ChangeSource {
  readonly source: CoreContract.ItemChangeSource;
  readonly ref: string;
  readonly once_key: string;
}

/** The `item-ledger` operation gacha calls: `OK`, an `ItemChangeResult` failure element, or the hook's `GameError`. */
export interface GachaItemLedger {
  subtract_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: ChangeSource): ItemChangeResult | GameErrorValue;
}

/** The `mailbox` operation gacha calls. */
export interface GachaMailbox {
  grant_or_mail(
    ctx: RequestCtx,
    items: readonly CoreContract.ItemAmount[],
    source: ChangeSource,
    template_id: number,
    args: readonly never[],
  ): { readonly result: string; readonly mail_ids?: readonly bigint[] };
}

/** The `live-event` operation gacha calls. A value that is none is `null`. */
export interface GachaLiveEvent {
  is_in_active_window(ctx: RequestCtx, start_at: bigint | null, end_at: bigint | null, live_event: number | null): boolean;
}

/** The `validation` operations gacha calls. */
export interface GachaValidation {
  has_table_id(table: string, id: number): boolean;
  evaluate_requirement(ctx: RequestCtx, requirement_id: number): { readonly passed: boolean; readonly failed_requirement_id: number };
}

export type GachaStorage = Pick<Storage, 'register_table' | 'get_state' | 'put_core_state' | 'db' | 'with_hook_change_source' | 'check_hook_output'>;
export type GachaServerTime = Pick<ServerTimeApi, 'clock_now'>;
export type GachaLogging = Pick<Logging, 'write' | 'track_core_event'>;

/** Hook `validate_gacha_draw`: `pass` or a `GameError`. */
export type ValidateGachaDrawHook = (ctx: RequestCtx, banner_id: number, count: number) => 'pass' | GameErrorValue;
/** Hook `grant_gacha_result`: the `ItemAmount` list to grant (`pass`), or a `GameError`. */
export type GrantGachaResultHook = (ctx: RequestCtx, banner_id: number, results: readonly LootResult[]) => readonly CoreContract.ItemAmount[] | GameErrorValue;
/** After hook `on_gacha_drawn`. Its output is none. */
export type OnGachaDrawnHook = (ctx: RequestCtx, banner_id: number, mode: CoreContract.GachaDrawMode, results: readonly CoreContract.GachaDrawResult[]) => null | undefined;

/** The hook slots `routing` fills after `register` (`routing` `## API`). An empty slot is `null`. */
export interface GachaHookSlots {
  validate_gacha_draw: ValidateGachaDrawHook | null;
  grant_gacha_result: GrantGachaResultHook | null;
  on_gacha_drawn: OnGachaDrawnHook | null;
}

type AdminInputType = { readonly kind: 'int64' } | { readonly kind: 'int32' };

/** An admin operation object (`admin-api`): `routing` hands it to `admin-api.register_admin_operation`. */
export interface GachaAdminOperation {
  readonly name: string;
  readonly role: 'read';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, { readonly type: AdminInputType; readonly optional: boolean }>>;
  readonly user_target: string;
  readonly handler: (input: Readonly<Record<string, unknown>>, ctx: RequestCtx, prepare_value: unknown, body: Uint8Array | null) => Record<string, unknown> | 'bad_request' | 'not_found';
  readonly prepare: null;
  readonly audit_args: null;
}

/** The module input (`server-core` `## module`). gacha reads nothing of `server`. */
export interface GachaInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server?: unknown;
}

/** The `## API` operations, the admin operation, the hook slots and the lifecycle of `gacha`. */
export interface Gacha {
  DrawGacha(ctx: RequestCtx, request: CoreContract.DrawGachaRequest): CoreContract.DrawGachaResponse | CoreErrorValue | GameErrorValue;
  GetGachaRates(ctx: RequestCtx, request: CoreContract.GetGachaRatesRequest): CoreContract.GetGachaRatesResponse | CoreErrorValue;
  ListGachaHistory(ctx: RequestCtx, request: CoreContract.ListGachaHistoryRequest): CoreContract.ListGachaHistoryResponse | CoreErrorValue;
  get_pity(ctx: RequestCtx, banner_id: number): PityState;
  readonly list_gacha_history: GachaAdminOperation;
  readonly hook_slots: GachaHookSlots;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`gacha: setting ${key} is not an integer`);
  return value;
}

function module_of<T>(modules: Readonly<Record<string, unknown>>, name: string, member: keyof T & string): T {
  const value = modules[name] as Record<string, unknown> | undefined | null;
  if (value === undefined || value === null || typeof value[member] !== 'function') throw new TypeError(`gacha: module ${name} is missing`);
  return value as T;
}

function optional<T extends number | bigint>(value: T): T | null {
  return value === 0 || value === 0n ? null : value;
}

function item_amount(item_id: number, amount: bigint): CoreContract.ItemAmount {
  const item = new CoreContract.ItemAmount();
  item.item_id = item_id;
  item.amount = amount;
  return item;
}

/** The output list of `grant_gacha_result` as `ItemAmount` messages, or null when it is not an `ItemAmount` list. */
function granted_items(value: unknown): CoreContract.ItemAmount[] | null {
  if (!Array.isArray(value)) return null;
  const out: CoreContract.ItemAmount[] = [];
  for (const entry of value as unknown[]) {
    const { item_id, amount, big_amount } = (entry ?? {}) as Partial<Record<string, unknown>>;
    if (typeof item_id !== 'number' || !Number.isSafeInteger(item_id) || typeof amount !== 'bigint') return null;
    if (big_amount !== undefined && typeof big_amount !== 'string') return null;
    const item = item_amount(item_id, amount);
    item.big_amount = big_amount ?? '';
    out.push(item);
  }
  return out;
}

const INT64 = { kind: 'int64' } as const;

/** A `gacha_banner` row. */
type GachaBanner = ReturnType<RequestCtx['data']['GachaBannerTable']['get_row']>;

/** The draws of one `DrawGacha`: loot results, draw results, the pity count before each draw and the pity state after. */
interface Draws {
  readonly rolled: LootResult[];
  readonly results: CoreContract.GachaDrawResult[];
  readonly pity_before: number[];
  pity: PityState;
}

/** Makes `gacha` for one server instance. A missing or non-integer setting, or a missing module, throws. */
export function create_gacha(input: GachaInput): Gacha {
  const { settings, modules } = input;
  const loot = module_of<GachaLootTable>(modules, 'loot-table', 'roll');
  const ledger = module_of<GachaItemLedger>(modules, 'item-ledger', 'subtract_items');
  const mailbox = module_of<GachaMailbox>(modules, 'mailbox', 'grant_or_mail');
  const live_event = module_of<GachaLiveEvent>(modules, 'live-event', 'is_in_active_window');
  const storage = module_of<GachaStorage>(modules, 'storage', 'get_state');
  const time = module_of<GachaServerTime>(modules, 'server-time', 'clock_now');
  const logging = module_of<GachaLogging>(modules, 'logging', 'write');
  const validation = module_of<GachaValidation>(modules, 'validation', 'has_table_id');
  const retention_ms = BigInt(integer_setting(settings, 'gacha.historyRetentionMs'));
  const max_history_rows = integer_setting(settings, 'gacha.maxHistoryRows');

  const hook_slots: GachaHookSlots = { validate_gacha_draw: null, grant_gacha_result: null, on_gacha_drawn: null };

  /** An `error` log for a hook output of the wrong form (`core` `## hook`); the request then ends with `INTERNAL`. */
  const internal = (ctx: RequestCtx, message: string, fields: Record<string, string | number | boolean>): CoreErrorValue => {
    logging.write({
      kind: 'error',
      level: 'error',
      message,
      user_id: ctx.user_id,
      request_id: ctx.request_id || null,
      request: ctx.request_name || null,
      fields: { ...fields, stack_trace: null },
    });
    return CoreError.CORE_ERROR_INTERNAL;
  };

  const read_pity = (ctx: RequestCtx, owner: number): PityState => {
    const row = storage.get_state(ctx, CoreContract.GachaPityUserState, BigInt(owner)) as CoreContract.GachaPityUserState | null;
    return row === null ? { count: 0, rate_up_guaranteed: false } : { count: row.count, rate_up_guaranteed: row.rate_up_guaranteed };
  };

  const write_pity = (ctx: RequestCtx, owner: number, state: PityState): void => {
    const row = new CoreContract.GachaPityUserState();
    row.id = BigInt(owner);
    row.count = state.count;
    row.rate_up_guaranteed = state.rate_up_guaranteed;
    storage.put_core_state(ctx, row);
  };

  /** Draw order 4: the cost list of the request, by ticket or by mode. */
  const cost_of = (banner: { single_cost: CoreContract.ItemAmount[]; multi_cost: CoreContract.ItemAmount[]; ticket_item: number }, multi: boolean, ticket: boolean, n: number) => {
    if (ticket) return [item_amount(banner.ticket_item, BigInt(n))];
    return multi ? banner.multi_cost : banner.single_cost;
  };

  /** Draw order 1 and 2: the sale condition and the count n, or the failure. */
  const draw_count = (ctx: RequestCtx, banner: GachaBanner, request: CoreContract.DrawGachaRequest): { readonly n: number } | CoreErrorValue => {
    if (!live_event.is_in_active_window(ctx, optional(banner.start_at), optional(banner.end_at), optional(banner.live_event))) {
      return CoreError.CORE_ERROR_GACHA_BANNER_UNAVAILABLE;
    }
    if (!validation.evaluate_requirement(ctx, banner.requirement).passed) return CoreError.CORE_ERROR_GACHA_BANNER_LOCKED;
    const multi = request.mode === Mode.GACHA_DRAW_MODE_MULTI;
    if (request.mode !== Mode.GACHA_DRAW_MODE_SINGLE && !multi) return CoreError.CORE_ERROR_INVALID_REQUEST;
    if (multi && banner.multi_count === 0) return CoreError.CORE_ERROR_INVALID_REQUEST;
    if (request.use_ticket && banner.ticket_item === 0) return CoreError.CORE_ERROR_INVALID_REQUEST;
    return { n: multi ? banner.multi_count : 1 };
  };

  /** Draw order 3: hook `validate_gacha_draw`; `pass` when it is not registered. A wrong output form throws (`INTERNAL`). */
  const validate_draw = (ctx: RequestCtx, banner_id: number, ref: string, n: number): 'pass' | CoreErrorValue | GameErrorValue => {
    const validate = hook_slots.validate_gacha_draw;
    if (validate === null) return 'pass';
    const verdict: unknown = storage.with_hook_change_source(ctx, SOURCE, ref, () => validate(ctx, banner_id, n));
    return storage.check_hook_output('validate_gacha_draw', verdict) as 'pass' | GameErrorValue;
  };

  /** Draw order 5 and 6: the draws from the pity state of the pity owner, or `INTERNAL` when `loot-table` fails. */
  const roll_draws = (ctx: RequestCtx, banner: GachaBanner, multi: boolean, n: number): Draws | CoreErrorValue => {
    let pity = read_pity(ctx, pity_owner(banner));
    const pity_tier = tier_of(ctx.data.LootTableTable, banner.pity_table);
    const multi_tier = tier_of(ctx.data.LootTableTable, banner.multi_guaranteed_table);
    const draws: Draws = { rolled: [], results: [], pity_before: [], pity };
    let reached_g = false;
    for (let index = 1; index <= n; index += 1) {
      const { table, kind } = pick_table(banner, multi, index, n, pity.count, reached_g);
      const roll = loot.roll(ctx, table, 1, substitutions_of(banner, pity.rate_up_guaranteed));
      // a loot-table failure is logged by loot-table
      const result = typeof roll === 'string' ? undefined : roll.results[0];
      if (result === undefined) return CoreError.CORE_ERROR_INTERNAL;
      const rate_up = banner.rate_up_table !== 0 && result.tables.includes(banner.rate_up_table);
      if (reaches(result.tables, multi_tier)) reached_g = true;
      draws.pity_before.push(pity.count);
      pity = next_pity(banner, pity, reaches(result.tables, pity_tier), rate_up);
      draws.rolled.push(result);
      const draw = new CoreContract.GachaDrawResult();
      draw.items = [...result.items];
      draw.kind = kind;
      draw.rate_up = rate_up;
      draws.results.push(draw);
    }
    draws.pity = pity;
    return draws;
  };

  /** Draw order 7: the output of hook `grant_gacha_result`, else the sum of the draws. */
  const grant_list = (ctx: RequestCtx, banner_id: number, ref: string, rolled: readonly LootResult[]): CoreContract.ItemAmount[] | CoreErrorValue | GameErrorValue => {
    const grant_hook = hook_slots.grant_gacha_result;
    if (grant_hook === null) {
      const summed = loot.sum_items(rolled);
      return typeof summed === 'string' ? CoreError.CORE_ERROR_INTERNAL : [...summed];
    }
    const output: unknown = storage.with_hook_change_source(ctx, SOURCE, ref, () => grant_hook(ctx, banner_id, rolled));
    // a GameError is checked as `check_hook_output` does; a wrong non-list output throws there (`INTERNAL`)
    if (!Array.isArray(output) && storage.check_hook_output('grant_gacha_result', output) !== 'pass') return output as GameErrorValue;
    const items = granted_items(output);
    if (items === null) return internal(ctx, 'hook grant_gacha_result returned neither an ItemAmount list nor a GameError', { banner_id });
    return items;
  };

  /**
   * Draw order 8: `mailbox.grant_or_mail` of a non-empty list; the granted `ItemAmount` list and whether it was mailed,
   * or `INTERNAL`. The list is the grant list only when it is `Granted`, and empty when `Mailed` or `AlreadyApplied`.
   */
  const grant_draws = (ctx: RequestCtx, ref: string, grant: readonly CoreContract.ItemAmount[]): { items: CoreContract.ItemAmount[]; mailed: boolean } | CoreErrorValue => {
    if (grant.length === 0) return { items: [], mailed: false };
    const source: ChangeSource = { source: SOURCE, ref, once_key: `${ONCE_KEY_PREFIX}${ctx.request_id}` };
    const granted = mailbox.grant_or_mail(ctx, grant, source, ctx.data.ReservedId.gacha_grant_mail(), []);
    // a grant failure is logged by item-ledger or mailbox
    if (granted.result === 'Granted') return { items: [...grant], mailed: false };
    if (granted.result === 'Mailed') return { items: [], mailed: true };
    return granted.result === 'AlreadyApplied' ? { items: [], mailed: false } : CoreError.CORE_ERROR_INTERNAL;
  };

  /** Draw order 9: the pity state, a draw record per draw and core analytics event `core_gacha_drawn`. */
  const save_draws = (ctx: RequestCtx, banner: GachaBanner, draws: Draws, cost: readonly CoreContract.ItemAmount[], ticket: boolean): void => {
    write_pity(ctx, pity_owner(banner), draws.pity);
    const db = storage.db(ctx);
    draws.results.forEach((draw, i) => {
      insert_record(db, {
        user_id: ctx.user_id,
        drawn_at: ctx.request_time,
        request_id: ctx.request_id,
        banner_id: banner.id,
        draw_index: i + 1,
        kind: draw.kind,
        rate_up: draw.rate_up,
        items: draw.items,
        pity_count_before: draws.pity_before[i] ?? 0,
        cost: i === 0 ? cost : [],
        data_version: ctx.data_version,
        expires_at: ctx.request_time + retention_ms,
      });
    });
    const params: ParamList = [
      ['banner_id', banner.id],
      ['count', draws.results.length],
      ['ticket', ticket],
    ];
    logging.track_core_event(ctx, 'core_gacha_drawn', params);
  };

  const DrawGacha: Gacha['DrawGacha'] = (ctx, request) => {
    const banners = ctx.data.GachaBannerTable;
    const banner_id = request.banner_id;
    if (!banners.has_row(banner_id)) return CoreError.CORE_ERROR_INVALID_REQUEST;
    const banner = banners.get_row(banner_id);
    const ref = String(banner_id);

    // 1. sale condition, 2. count
    const counted = draw_count(ctx, banner, request);
    if (typeof counted === 'number') return counted;
    const { n } = counted;
    const multi = request.mode === Mode.GACHA_DRAW_MODE_MULTI;

    // 3. hook validate_gacha_draw
    const verdict = validate_draw(ctx, banner_id, ref, n);
    if (verdict !== 'pass') return verdict;

    // 4. cost
    const cost = cost_of(banner, multi, request.use_ticket, n);
    if (cost.length > 0) {
      const outcome = ledger.subtract_items(ctx, cost, { source: SOURCE, ref, once_key: '' });
      if (outcome !== 'OK') return change_failure_code(outcome) as CoreErrorValue | GameErrorValue;
    }

    // 5. pity state, 6. draws
    const draws = roll_draws(ctx, banner, multi, n);
    if (typeof draws === 'number') return draws;

    // 7. grant list, 8. grant or mail
    const grant = grant_list(ctx, banner_id, ref, draws.rolled);
    if (typeof grant === 'number') return grant;
    const granted = grant_draws(ctx, ref, grant);
    if (typeof granted === 'number') return granted;

    // 9. pity state, draw records, core analytics event
    save_draws(ctx, banner, draws, cost, request.use_ticket);

    // 10. after hook on_gacha_drawn
    const drawn_hook = hook_slots.on_gacha_drawn;
    if (drawn_hook !== null) {
      const output: unknown = storage.with_hook_change_source(ctx, SOURCE, ref, () => drawn_hook(ctx, banner_id, request.mode, draws.results));
      // an after hook's output is none; a value is a wrong output form, so the request ends with `INTERNAL`
      if (output !== null && output !== undefined) return internal(ctx, 'hook on_gacha_drawn returned a value', { banner_id });
    }

    const response = new CoreContract.DrawGachaResponse();
    response.results = draws.results;
    response.items = granted.items;
    response.mailed = granted.mailed;
    return response;
  };

  const GetGachaRates: Gacha['GetGachaRates'] = (ctx, request) => {
    const banners = ctx.data.GachaBannerTable;
    if (!banners.has_row(request.banner_id)) return CoreError.CORE_ERROR_INVALID_REQUEST;
    const banner = banners.get_row(request.banner_id);
    const response = new CoreContract.GetGachaRatesResponse();
    response.sections = rate_sections(banner, (table, substitutions) => loot.get_rates(ctx, table, substitutions));
    response.pity_count = banner.pity_count;
    response.rate_up_guarantee = banner.rate_up_guarantee;
    response.multi_count = banner.multi_count;
    return response;
  };

  const ListGachaHistory: Gacha['ListGachaHistory'] = (ctx, request) => {
    if (request.banner_id !== 0 && !validation.has_table_id('gacha_banner', request.banner_id)) return CoreError.CORE_ERROR_INVALID_REQUEST;
    if (request.max_rows < 1 || request.max_rows > max_history_rows) return CoreError.CORE_ERROR_INVALID_REQUEST;
    const rows = list_latest(storage.db(ctx), ctx.user_id, time.clock_now(), request.banner_id, request.cursor_draw_seq, request.max_rows);
    const response = new CoreContract.ListGachaHistoryResponse();
    response.entries = rows.map(history_entry);
    return response;
  };

  const list_gacha_history: GachaAdminOperation = {
    name: 'list_gacha_history',
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: {
      user_id: { type: INT64, optional: false },
      from_at: { type: INT64, optional: false },
      to_at: { type: INT64, optional: false },
      after_seq: { type: INT64, optional: false },
      limit: { type: { kind: 'int32' }, optional: false },
    },
    user_target: 'user_id',
    handler: (fields, ctx) => {
      const rows = list_range(
        storage.db(ctx),
        ctx.user_id,
        time.clock_now(),
        fields.from_at as bigint,
        fields.to_at as bigint,
        fields.after_seq as bigint,
        fields.limit as number,
      );
      return { entries: rows.map(admin_entry) };
    },
    prepare: null,
    audit_args: null,
  };

  return {
    DrawGacha,
    GetGachaRates,
    ListGachaHistory,
    get_pity(ctx, banner_id) {
      const banners = ctx.data.GachaBannerTable;
      if (!banners.has_row(banner_id)) return { count: 0, rate_up_guaranteed: false };
      return read_pity(ctx, pity_owner(banners.get_row(banner_id)));
    },
    list_gacha_history,
    hook_slots,
    begin_start() {
      register_record_table(storage);
    },
    complete_start: () => null,
    stop() {},
  };
}
