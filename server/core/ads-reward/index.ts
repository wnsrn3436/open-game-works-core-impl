/**
 * ads-reward: verifies the rewards of rewarded ads with the ad network callback and grants them as out-of-request
 * changes, which reach the client as pending delta.
 */
import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type { RequestCtx } from '../storage/index.ts';
import type { AdsAdapter, KeySource } from './adapter.ts';
import { admob_key_source, create_admob_adapter } from './adapters/admob.ts';
import { handle_callback, KeyCache, type RouteRequest, type RouteResponse } from './callback.ts';
import { read_modules, read_settings, type AdsRewardInput } from './deps.ts';
import { get_reward_count, grant, PASS, type AdsRewardCore, type AdsRewardHookSlots } from './grant.ts';
import { claim_ticket, count_claimed, issue_ticket, read_ticket, register_tables } from './tickets.ts';

export type { AdsAdapter, KeySource, ParsedCallback } from './adapter.ts';
export type { AdsRewardInput, AdsRewardServer } from './deps.ts';
export type { AdsRewardHookSlots } from './grant.ts';
export type { RouteRequest, RouteResponse } from './callback.ts';

const { CoreError } = CoreContract;

/** The UTF-8 bytes of a reward notify ID: a UUID. */
const NOTIFY_ID_BYTES = 36;

/** `FakeAdCallback` without its response message: done, or `AD_REWARD_NOT_FOUND`. */
export type FakeCallbackResult = 'OK' | CoreContract.CoreError;

/** The `ads-reward` module object (`server-core` `## module`, `routing` `## API`). */
export interface AdsReward {
  /** Core rpc `core/BeginAdReward`. */
  BeginAdReward(ctx: RequestCtx, request: CoreContract.BeginAdRewardRequest): CoreContract.BeginAdRewardResponse | number;
  /** Core rpc `core/ClaimAdReward`. Its prepare value is the output of `wait_ad_reward`. */
  ClaimAdReward(ctx: RequestCtx, request: CoreContract.ClaimAdRewardRequest, prepare?: null): CoreContract.ClaimAdRewardResponse | number;
  /**
   * Request prepare of `ClaimAdReward`. `routing` passes the request message, whose `notify_id` is the reward
   * notify ID.
   */
  wait_ad_reward(user_id: bigint, notify_id: string | CoreContract.ClaimAdRewardRequest): Promise<null>;
  /** The route of the ad network callback. */
  'GET /ads/callback/<network>'(request: RouteRequest, client_ip: string): Promise<RouteResponse>;
  get_reward_count(ctx: RequestCtx, placement_id: number): number;
  readonly hook_slots: AdsRewardHookSlots;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** Called by the DEV code only: sets the fake adapter when `fake` is selected and no override was given. */
  use_fake_adapter(make: (adapter_key: string) => { adapter: AdsAdapter }): void;
  /** Called by the DEV code only: `FakeAdCallback` in the cheat's ctx. */
  fake_callback(ctx: RequestCtx, notify_id: string): FakeCallbackResult;
}

function is_adapter(value: unknown): value is AdsAdapter {
  const object = value as Partial<AdsAdapter> | null;
  return typeof object === 'object' && object !== null && typeof object.parse === 'function' && typeof object.fetch_keys === 'function' && typeof object.verify === 'function';
}

/** The adapter of `environments.<ENV>.adapters.ads`, or null for none or for a fake adapter the DEV code makes. */
function select_adapter(core: AdsRewardCore, input: AdsRewardInput): AdsAdapter | null {
  const name = core.settings.adapter_name;
  const { server } = input;
  if (name === null) return null;
  if (name === 'fake') {
    const fake = server.fake_adapters?.ads;
    return is_adapter(fake) ? fake : null;
  }
  if (name === 'ads-admob') {
    const override = server.key_sources?.ads;
    const source: KeySource =
      override ??
      admob_key_source({
        fetch: server.fetch ?? globalThis.fetch,
        time_limit: () => core.m.time.network_time_limit(core.settings.key_fetch_timeout_ms),
        max_response_bytes: core.settings.external_max_response_bytes,
      });
    return create_admob_adapter(source);
  }
  core.start_errors.push(`ads-reward: environments.<ENV>.adapters.ads ${name} is not fake or ads-admob`);
  return null;
}

function begin_ad_reward(core: AdsRewardCore, ctx: RequestCtx, request: CoreContract.BeginAdRewardRequest): CoreContract.BeginAdRewardResponse | number {
  const { storage, time } = core.m;
  const placement_id = request.placement_id;
  const row = core.data.AdPlacementTable.get_row(placement_id);
  if (!core.data.AdPlacementTable.has_row(placement_id) || row.type !== GameData.AdType.Rewarded) return CoreError.CORE_ERROR_INVALID_REQUEST;
  const db = storage.db(ctx);
  const now = time.clock_now();
  if (row.limit_count > 0 && get_reward_count(core, ctx, placement_id) + count_claimed(db, ctx.user_id, placement_id, now) >= row.limit_count) {
    return CoreError.CORE_ERROR_AD_LIMIT_REACHED;
  }
  const hook = core.hook_slots.validate_ad_reward;
  if (hook !== null) {
    const out = storage.check_hook_output('validate_ad_reward', hook(ctx, placement_id));
    if (out !== PASS) return out;
  }
  const notify_id = randomUUID();
  issue_ticket(db, ctx.user_id, notify_id, placement_id, now, core.settings.ticket_ttl_ms);
  const response = new CoreContract.BeginAdRewardResponse();
  response.notify_id = notify_id;
  return response;
}

function claim_ad_reward(core: AdsRewardCore, ctx: RequestCtx, request: CoreContract.ClaimAdRewardRequest): CoreContract.ClaimAdRewardResponse | number {
  const ticket = read_ticket(core.m.storage.db(ctx), ctx.user_id, request.notify_id, core.m.time.clock_now());
  switch (ticket?.state) {
    case 'Granted': {
      const response = new CoreContract.ClaimAdRewardResponse();
      response.items = ticket.items;
      return response;
    }
    case 'Issued':
    case 'Claimed':
      return CoreError.CORE_ERROR_AD_REWARD_PENDING;
    case 'Failed':
      return CoreError.CORE_ERROR_INTERNAL;
    default:
      return CoreError.CORE_ERROR_AD_REWARD_NOT_FOUND;
  }
}

function ticket_state(core: AdsRewardCore, user_id: bigint, notify_id: string): string | null {
  return read_ticket(core.m.storage.read_db(), user_id, notify_id, core.m.time.clock_now())?.state ?? null;
}

/** `wait_ad_reward`: claims an `Issued` ticket, then polls it until it is no longer `Claimed` or the wait ends. */
async function wait_ad_reward(core: AdsRewardCore, user_id: bigint, notify_id: string): Promise<null> {
  const { storage, time } = core.m;
  const { claim_wait_ms, claim_poll_interval_ms } = core.settings;
  const start = time.clock_now();
  await storage.run_user_transaction(user_id, (ctx) => {
    claim_ticket(storage.db(ctx), ctx.user_id, notify_id, time.clock_now());
    return PASS;
  });
  while (ticket_state(core, user_id, notify_id) === 'Claimed') {
    const left = start + claim_wait_ms - time.clock_now();
    if (left <= 0n) break;
    await time.sleep(claim_poll_interval_ms > 0n && claim_poll_interval_ms < left ? claim_poll_interval_ms : left);
  }
  return null;
}

function fake_callback(core: AdsRewardCore, ctx: RequestCtx, notify_id: string): FakeCallbackResult {
  const { storage, time, idempotency } = core.m;
  const ticket = read_ticket(storage.db(ctx), ctx.user_id, notify_id, time.clock_now());
  if (ticket === null || (ticket.state !== 'Issued' && ticket.state !== 'Claimed')) return CoreError.CORE_ERROR_AD_REWARD_NOT_FOUND;
  if (idempotency.claim_notify(ctx, 'fake', notify_id) === 'FIRST') grant(core, ctx, notify_id, ticket.placement_id);
  return 'OK';
}

function complete_start(core: AdsRewardCore): string | null {
  if (core.settings.max_notify_id_bytes < NOTIFY_ID_BYTES) {
    core.start_errors.push(`ads-reward: idempotency.maxNotifyIdBytes ${String(core.settings.max_notify_id_bytes)} is below ${String(NOTIFY_ID_BYTES)}, the bytes of a reward notify ID`);
  }
  if (core.settings.adapter_name === 'fake' && core.adapter === null) core.start_errors.push('ads-reward: the fake ads adapter needs DEV code');
  const extra = core.data.AdPlacementTable.all_rows().filter((row) => row.extra_grant);
  if (extra.length > 0 && core.hook_slots.grant_ad_extra === null) {
    core.start_errors.push(`ads-reward: ad_placement ${extra.map((row) => String(row.id)).join(', ')} has extra_grant and grant_ad_extra is not registered`);
  }
  return core.start_errors.length > 0 ? core.start_errors.join('; ') : null;
}

/** The `ads-reward` module of one server instance (`server-core` `## module`). */
export function create_ads_reward(input: AdsRewardInput): AdsReward {
  const core: AdsRewardCore = {
    settings: read_settings(input.settings),
    m: read_modules(input.modules),
    data: input.server.data,
    hook_slots: { validate_ad_reward: null, grant_ad_extra: null, on_ad_rewarded: null },
    adapter: null,
    start_errors: [],
  };
  core.adapter = select_adapter(core, input);
  const keys = new KeyCache(core);
  return {
    BeginAdReward: (ctx, request) => begin_ad_reward(core, ctx, request),
    ClaimAdReward: (ctx, request) => claim_ad_reward(core, ctx, request),
    wait_ad_reward: (user_id, notify_id) => wait_ad_reward(core, user_id, typeof notify_id === 'string' ? notify_id : notify_id.notify_id),
    'GET /ads/callback/<network>': (request, client_ip) => handle_callback(core, keys, request, client_ip),
    get_reward_count: (ctx, placement_id) => get_reward_count(core, ctx, placement_id),
    hook_slots: core.hook_slots,
    begin_start: () => {
      register_tables(core.m.storage);
    },
    complete_start: () => complete_start(core),
    stop: () => undefined,
    use_fake_adapter: (make) => {
      if (core.settings.adapter_name === 'fake' && core.adapter === null) core.adapter = make('ads').adapter;
    },
    fake_callback: (ctx, notify_id) => fake_callback(core, ctx, notify_id),
  };
}
