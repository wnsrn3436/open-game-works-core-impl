import * as CoreContract from '../../generated/contract/core_contract.ts';
import { code_points, is_int64_number, is_snake_case } from './fields.ts';

const Kind = CoreContract.AnalyticsParamKind;

/** One analytics event an adapter sends. `params` are in the order received. */
export interface AnalyticsSendEvent {
  readonly user_id: bigint;
  readonly name: string;
  readonly time_at: bigint;
  readonly params: readonly CoreContract.AnalyticsParam[];
}

/** The kind of an adapter failure: time limit exceeded, no answer, refused by the provider. */
export type AdapterFailure = 'timeout' | 'communication_failure' | 'rejected';

/**
 * An analytics adapter (adapter key `analytics`). `send` returns null on success or the kind of the failure;
 * `delete_user_data` returns the success flag. Both stop when `signal` aborts.
 */
export interface AnalyticsAdapter {
  send(events: readonly AnalyticsSendEvent[], signal: AbortSignal): Promise<AdapterFailure | null>;
  delete_user_data(user_id: bigint, signal: AbortSignal): Promise<boolean>;
}

/** A param value of `track` and `track_core_event`: an integer (`bigint`, or a `number` that is an integer), a real (`number`), a string or a bool. */
export type ParamValue = bigint | number | string | boolean;

export type ParamList = readonly (readonly [string, ParamValue])[];

type CoreParamType = 'integer' | 'string' | 'bool';

/** The core analytics events (`### server analytics event`): name to param name and type. */
const CORE_EVENTS: ReadonlyMap<string, Readonly<Record<string, CoreParamType>>> = new Map<string, Readonly<Record<string, CoreParamType>>>([
  ['core_user_created', { provider: 'string' }],
  ['core_session_started', { login: 'string' }],
  ['core_tutorial_step', { tutorial_id: 'integer', step: 'integer' }],
  ['core_iap_granted', { product_id: 'integer', store: 'string', spend_amount: 'integer', test: 'bool', renewal: 'bool' }],
  ['core_iap_refunded', { product_id: 'integer', store: 'string', spend_amount: 'integer', test: 'bool' }],
  ['core_ad_rewarded', { placement_id: 'integer' }],
  ['core_gacha_drawn', { banner_id: 'integer', count: 'integer', ticket: 'bool' }],
  ['core_shop_bought', { product_id: 'integer', quantity: 'integer' }],
  ['core_mission_claimed', { mission_id: 'integer' }],
  ['core_attendance_claimed', { calendar_id: 'integer', day: 'integer' }],
  ['core_offer_triggered', { offer_id: 'integer', trigger_count: 'integer' }],
]);

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** True when a param value is an integer: a `bigint`, or a `number` that is an integer. */
function is_integer(value: ParamValue): value is bigint | number {
  return typeof value === 'bigint' || (typeof value === 'number' && Number.isInteger(value));
}

/** The `AnalyticsParam` of a server param: the value's kind and its value field. */
export function to_param(key: string, value: ParamValue): CoreContract.AnalyticsParam {
  const param = new CoreContract.AnalyticsParam();
  param.key = key;
  if (is_integer(value)) {
    param.kind = Kind.ANALYTICS_PARAM_KIND_INT;
    param.int_value = BigInt(value);
  } else if (typeof value === 'number') {
    param.kind = Kind.ANALYTICS_PARAM_KIND_DOUBLE;
    param.double_value = value;
  } else if (typeof value === 'string') {
    param.kind = Kind.ANALYTICS_PARAM_KIND_STRING;
    param.string_value = value;
  } else {
    param.kind = Kind.ANALYTICS_PARAM_KIND_BOOL;
    param.bool_value = value;
  }
  return param;
}

/** The limits of a server analytics event. */
export interface EventLimits {
  readonly max_string_length: number;
  readonly max_event_params: number;
}

/** True for an array. A function of its own so that the checked list keeps its type. */
function is_list(value: unknown): boolean {
  return Array.isArray(value);
}

function name_problem(text: unknown, limits: EventLimits): boolean {
  return typeof text !== 'string' || !is_snake_case(text) || code_points(text) > limits.max_string_length;
}

/** The first rule the value of param `key` breaks, or null. */
function value_problem(key: string, value: unknown, limits: EventLimits): string | null {
  switch (typeof value) {
    case 'string':
      return code_points(value) > limits.max_string_length ? `param ${key} is longer than maxStringLength` : null;
    case 'number':
      if (!Number.isFinite(value)) return `param ${key} is NaN or infinite`;
      return Number.isInteger(value) && !is_int64_number(value) ? `param ${key} is outside int64` : null;
    case 'bigint':
      return value < INT64_MIN || value > INT64_MAX ? `param ${key} is outside int64` : null;
    case 'boolean':
      return null;
    default:
      return `param ${key} is not an integer, a real, a string or a bool`;
  }
}

function has_core_type(type: CoreParamType, value: ParamValue): boolean {
  if (type === 'integer') return is_integer(value);
  return typeof value === (type === 'string' ? 'string' : 'boolean');
}

/** The first rule the params of core analytics event `name` break, or null. */
function core_event_problem(name: string, params: ParamList): string | null {
  const types = CORE_EVENTS.get(name);
  if (types === undefined) return `event name ${name} is not a core analytics event`;
  if (params.length !== Object.keys(types).length) return `core analytics event ${name} does not have its params`;
  for (const [key, value] of params) {
    const type = Object.hasOwn(types, key) ? types[key] : undefined;
    if (type === undefined || !has_core_type(type, value)) return `param ${key} is not a ${type ?? 'param'} of core analytics event ${name}`;
  }
  return null;
}

/** The first rule a server analytics event breaks (`### server analytics event`), or null. */
export function server_event_problem(name: string, params: ParamList, limits: EventLimits, core: boolean): string | null {
  if (!is_list(params)) return `params of event ${name} are not a list`;
  if (name_problem(name, limits)) return `event name ${JSON.stringify(name)} is not snake_case within maxStringLength`;
  if (params.length > limits.max_event_params) return `event ${name} has more than maxEventParams params`;
  const keys = new Set<string>();
  for (const [key, value] of params) {
    if (name_problem(key, limits)) return `param key ${JSON.stringify(key)} is not snake_case within maxStringLength`;
    if (keys.has(key)) return `param key ${key} is repeated`;
    keys.add(key);
    const problem = value_problem(key, value, limits);
    if (problem !== null) return problem;
  }
  if (core) return core_event_problem(name, params);
  return name.startsWith('core_') ? `event name ${name} starts with core_` : null;
}

/** True when an event name or a param key a client sent is refused (`### client log collection`). */
export function client_name_refused(event: CoreContract.AnalyticsEvent): boolean {
  if (!is_snake_case(event.name) || event.name.startsWith('core_')) return true;
  return event.params.some((param) => !is_snake_case(param.key));
}

/** True when a param holds a value other than its kind's value field, or a NaN or infinite `DOUBLE`. */
function param_mismatch(param: CoreContract.AnalyticsParam): boolean {
  const set = {
    [Kind.ANALYTICS_PARAM_KIND_INT]: param.int_value !== 0n,
    [Kind.ANALYTICS_PARAM_KIND_DOUBLE]: param.double_value !== 0 || Object.is(param.double_value, -0),
    [Kind.ANALYTICS_PARAM_KIND_STRING]: param.string_value !== '',
    [Kind.ANALYTICS_PARAM_KIND_BOOL]: param.bool_value,
  };
  if (!(param.kind in set) || param.kind === Kind.ANALYTICS_PARAM_KIND_UNSPECIFIED) return true;
  if (param.kind === Kind.ANALYTICS_PARAM_KIND_DOUBLE && !Number.isFinite(param.double_value)) return true;
  return Object.entries(set).some(([kind, has]) => Number(kind) !== param.kind && has);
}

/** The params of a client event that are kept, and how many were dropped: mismatched, NaN or infinite, repeated keys after the first. */
export function filter_params(params: readonly CoreContract.AnalyticsParam[]): { kept: CoreContract.AnalyticsParam[]; dropped: number } {
  const kept: CoreContract.AnalyticsParam[] = [];
  const keys = new Set<string>();
  for (const param of params) {
    if (param_mismatch(param) || keys.has(param.key)) continue;
    keys.add(param.key);
    kept.push(param);
  }
  return { kept, dropped: params.length - kept.length };
}

/** The protobuf bytes of an `AnalyticsEvent` with only `params` set: the `params` column. */
export function params_bytes(params: readonly CoreContract.AnalyticsParam[]): Uint8Array {
  const event = new CoreContract.AnalyticsEvent();
  event.params = [...params];
  return event.encode();
}

/** Runs `run` until `signal` aborts; then the result is `aborted`. A throw is `thrown`. */
export function within<T>(signal: AbortSignal, run: () => Promise<T>, aborted: T, thrown: T): Promise<T> {
  if (signal.aborted) return Promise.resolve(aborted);
  return new Promise<T>((resolve) => {
    const on_abort = (): void => {
      resolve(aborted);
    };
    signal.addEventListener('abort', on_abort, { once: true });
    const done = (value: T): void => {
      signal.removeEventListener('abort', on_abort);
      resolve(value);
    };
    run().then(done, () => {
      done(thrown);
    });
  });
}
