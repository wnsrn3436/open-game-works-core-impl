/**
 * The ad network callback route `GET /ads/callback/<network>` and the signing key cache.
 */
import type { AdsAdapter, KeyFetchFailure, KeyList, ParsedCallback } from './adapter.ts';
import { FORMAT_ERROR, network_name, NOTIFY_ID, parse_user_id, timeout_on_abort } from './adapter.ts';
import { grant, PASS, type AdsRewardCore } from './grant.ts';
import { bump_ip_count, read_ip_count, read_ticket } from './tickets.ts';

/** A route request (`routing` `## API`). */
export interface RouteRequest {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** A route response (`routing` `## API`). */
export interface RouteResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array | string;
}

const PATH_PREFIX = '/ads/callback/';
const MINUTE_MS = 60_000n;

/**
 * The key cache of a server instance (`### callback`): the last key list and when it came, one fetch at a time.
 */
export class KeyCache {
  private list: { readonly keys: KeyList<unknown>; readonly at: bigint } | null = null;
  private last_start: bigint | null = null;
  private running: Promise<void> | null = null;
  private readonly core: AdsRewardCore;

  constructor(core: AdsRewardCore) {
    this.core = core;
  }

  private now(): bigint {
    return this.core.m.time.clock_now();
  }

  private usable(): KeyList<unknown> | null {
    const list = this.list;
    return list !== null && list.at + this.core.settings.key_cache_ms > this.now() ? list.keys : null;
  }

  private async fetch_once(adapter: AdsAdapter): Promise<void> {
    const { time, logging } = this.core.m;
    let result: KeyList<unknown> | KeyFetchFailure;
    try {
      const signal = time.network_time_limit(this.core.settings.key_fetch_timeout_ms);
      result = await Promise.race([adapter.fetch_keys(signal), timeout_on_abort(signal)]);
    } catch {
      result = 'communication_failure';
    }
    if (typeof result === 'string') {
      const fields = { stack_trace: null };
      logging.write({ kind: 'error', level: 'error', message: `ads signing key fetch of ${adapter.name} failed: ${result}`, user_id: null, request_id: null, request: null, fields });
      return;
    }
    this.list = { keys: result, at: this.now() };
  }

  private fetch(adapter: AdsAdapter): Promise<void> {
    if (this.running === null) {
      this.last_start = this.now();
      const running = this.fetch_once(adapter).finally(() => {
        if (this.running === running) this.running = null;
      });
      this.running = running;
    }
    return this.running;
  }

  /** The usable key list for a key ID, fetched when needed; null when there is no usable list. */
  async keys_for(adapter: AdsAdapter, key_id: string): Promise<KeyList<unknown> | null> {
    if (this.running !== null) {
      await this.running;
      return this.usable();
    }
    const keys = this.usable();
    if (keys === null) {
      await this.fetch(adapter);
      return this.usable();
    }
    const refetch_at = (this.last_start ?? 0n) + this.core.settings.key_refetch_interval_ms;
    if (keys.has(key_id) || refetch_at > this.now()) return keys;
    await this.fetch(adapter);
    return this.usable();
  }
}

function security_log(core: AdsRewardCore, ip: string, reason: string, user_id: bigint | null): void {
  core.m.logging.write({ kind: 'security', level: 'warn', message: `ad callback rejected: ${reason}`, user_id, request_id: null, request: null, fields: { ip, reason } });
}

function error_log(core: AdsRewardCore, message: string, user_id: bigint | null, error?: unknown): void {
  const stack = error instanceof Error ? (error.stack ?? error.message) : null;
  core.m.logging.write({ kind: 'error', level: 'error', message, user_id, request_id: null, request: null, fields: { stack_trace: stack } });
}

function warn_log(core: AdsRewardCore, message: string, user_id: bigint | null): void {
  core.m.logging.write({ kind: 'core', level: 'warn', message, user_id, request_id: null, request: null, fields: { module: 'ads-reward' } });
}

/**
 * Counts a callback that failed at its format or signature step (`### callback`), then answers its status. A DB
 * failure of the count is HTTP 500 (`## error`).
 */
async function counted(core: AdsRewardCore, ip: string, status: number): Promise<RouteResponse> {
  const { storage, time } = core.m;
  const now = time.clock_now();
  const window_start = time.get_window_start(MINUTE_MS, now);
  let result: string;
  try {
    result = await storage.run_game_transaction((tx) => {
      bump_ip_count(storage.db(tx), ip, window_start, window_start + MINUTE_MS);
      return PASS;
    });
  } catch (error) {
    error_log(core, 'ad callback IP counter update failed', null, error);
    return { status: 500 };
  }
  if (result === 'FAILED') {
    error_log(core, 'ad callback IP counter update failed', null);
    return { status: 500 };
  }
  return { status };
}

type Outcome = 'duplicate' | 'unusable' | 'Granted' | 'Failed';

/** A signed callback's reward notify ID and user ID, both checked. */
interface SignedCallback {
  readonly notify_id: string;
  readonly user_id: bigint;
}

/** After the signature: the claim, the ticket and the grant order in the ticket user's transaction. */
async function process(core: AdsRewardCore, adapter: AdsAdapter, parsed: SignedCallback): Promise<RouteResponse> {
  const { storage, time, idempotency } = core.m;
  const seen: { outcome: Outcome; state: string } = { outcome: 'unusable', state: 'none' };
  let result: string;
  try {
    result = await storage.run_user_transaction(parsed.user_id, (ctx) => {
      if (idempotency.claim_notify(ctx, adapter.name, parsed.notify_id) === 'DUPLICATE') {
        seen.outcome = 'duplicate';
        return PASS;
      }
      const ticket = read_ticket(storage.db(ctx), ctx.user_id, parsed.notify_id, time.clock_now());
      seen.state = ticket?.state ?? 'none';
      if (ticket === null || (ticket.state !== 'Issued' && ticket.state !== 'Claimed')) return PASS;
      seen.outcome = grant(core, ctx, parsed.notify_id, ticket.placement_id);
      return PASS;
    });
  } catch (error) {
    error_log(core, `ad callback ${parsed.notify_id} failed`, parsed.user_id, error);
    return { status: 500 };
  }
  if (result === 'FAILED') {
    error_log(core, `ad callback ${parsed.notify_id}: the user transaction failed`, parsed.user_id);
    return { status: 500 };
  }
  if (result === 'WITHDRAWN') warn_log(core, `ad callback ${parsed.notify_id}: no user or a withdrawn user`, parsed.user_id);
  else if (seen.outcome === 'unusable') warn_log(core, `ad callback ${parsed.notify_id}: no usable ticket (${seen.state})`, parsed.user_id);
  return { status: 200 };
}

/**
 * The checks of a callback whose signature matched, before its transaction: the reward notify ID, the user ID and, for
 * `ads-admob`, the ad unit. Null when the callback ends there with HTTP 200, without a count.
 */
function check_signed(core: AdsRewardCore, adapter: AdsAdapter, parsed: ParsedCallback, ip: string): SignedCallback | null {
  // The client sets the reward notify ID and the user ID, so a bad value in a signed callback is not counted.
  if (!NOTIFY_ID.test(parsed.notify_id)) {
    warn_log(core, 'ad callback: the reward notify ID is not a lower-case UUID v4', parse_user_id(parsed.user_id));
    return null;
  }
  const user_id = parse_user_id(parsed.user_id);
  if (user_id === null) {
    warn_log(core, `ad callback ${parsed.notify_id}: the user ID is not a decimal from 1 to 2^63 - 1`, null);
    return null;
  }
  // AdMob signs the callbacks of every publisher with the same keys: only an ad unit of this game grants.
  if (adapter.name === 'ads-admob' && (parsed.ad_unit === '' || !core.settings.ad_units.has(parsed.ad_unit))) {
    security_log(core, ip, 'ad_callback_ad_unit', user_id);
    return null;
  }
  return { notify_id: parsed.notify_id, user_id };
}

/** The callback processing order of the route `GET /ads/callback/<network>`. */
export async function handle_callback(core: AdsRewardCore, keys: KeyCache, request: RouteRequest, ip: string): Promise<RouteResponse> {
  const adapter = core.adapter;
  const network = request.path.startsWith(PATH_PREFIX) ? request.path.slice(PATH_PREFIX.length) : '';
  if (adapter === null || network !== network_name(adapter.name)) return { status: 404 };
  const { storage, time } = core.m;
  const now = time.clock_now();
  let count: bigint;
  try {
    count = read_ip_count(storage.read_db(), ip, time.get_window_start(MINUTE_MS, now), now);
  } catch (error) {
    error_log(core, 'ad callback IP counter read failed', null, error);
    return { status: 500 };
  }
  if (count >= BigInt(core.settings.callback_rate_limit_per_minute)) {
    security_log(core, ip, 'rate_limited_ip', null);
    return { status: 429 };
  }
  if (Buffer.byteLength(request.query, 'utf8') > core.settings.max_query_bytes) return counted(core, ip, 400);
  const parsed = adapter.parse(request.query);
  if (parsed === FORMAT_ERROR) return counted(core, ip, 400);
  const list = await keys.keys_for(adapter, parsed.key_id);
  if (list === null) return { status: 503 };
  const key = list.get(parsed.key_id);
  if (key === undefined || !adapter.verify(parsed.signed_text, parsed.signature, key)) {
    security_log(core, ip, 'ad_callback_signature', null);
    return counted(core, ip, 403);
  }
  const checked = check_signed(core, adapter, parsed, ip);
  return checked === null ? { status: 200 } : process(core, adapter, checked);
}
