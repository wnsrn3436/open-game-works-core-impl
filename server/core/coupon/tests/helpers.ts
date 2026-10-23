/**
 * Test servers for `coupon` through the `testing` test helpers: admin operations with `send_admin`, `RedeemCoupon`
 * with `send`, and hooks registered by the test's own `register`.
 */
import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import { register_false_judges, register_required_hooks } from '../../testing/dev/index.ts';
import type { RequestCtx } from '../../storage/index.ts';

export const START_AT = 1_800_000_000_000n;
export const DAY_MS = 86_400_000n;

type TestServer = Awaited<ReturnType<typeof testing.start_test_server>>;
type TestSession = Awaited<ReturnType<typeof testing.login>>;
export type { TestServer, TestSession };

/** An item change as `item-ledger` content code passes it. */
interface ContentLedger {
  add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: { source: number; ref: string; once_key: string }): unknown;
}

/** The `core` object of `register`: the module objects (or their `content` member) by module name. */
interface RegisterCore {
  readonly routing: { register_handler(name: string, handler: () => unknown): void; register_hook(module: string, hook: string, fn: unknown): void };
  readonly 'item-ledger': ContentLedger;
}

export interface Hooks {
  on_coupon_redeemed?: (ctx: RequestCtx, coupon_id: bigint, ledger: ContentLedger) => void;
  validate_item_change?: () => 'pass' | number;
  grant_mail_extra?: (ctx: RequestCtx, extra_id: number, mail_id: bigint) => 'pass' | number;
}

/**
 * A `register` that keeps the core test default (an empty handler per `service Game` `rpc`, a `false` judge per
 * `RequirementType`, the hooks data rows require) and adds the hooks.
 */
export function register_with(hooks: Hooks) {
  return (input: Readonly<Record<string, unknown>>): void => {
    const core = input as unknown as RegisterCore;
    for (const info of GameContract.RPCS) core.routing.register_handler(info.name, () => new info.response_class());
    register_false_judges(input);
    register_required_hooks(input);
    const ledger = core['item-ledger'];
    const redeemed = hooks.on_coupon_redeemed;
    if (redeemed !== undefined) {
      core.routing.register_hook('coupon', 'on_coupon_redeemed', (ctx: RequestCtx, coupon_id: bigint) => {
        redeemed(ctx, coupon_id, ledger);
      });
    }
    if (hooks.validate_item_change !== undefined) core.routing.register_hook('item-ledger', 'validate_item_change', hooks.validate_item_change);
    if (hooks.grant_mail_extra !== undefined) core.routing.register_hook('mailbox', 'grant_mail_extra', hooks.grant_mail_extra);
  };
}

/** A LOCAL test server at `START_AT`, with hooks and settings overrides when given. */
export async function start(hooks?: Hooks, settings?: Readonly<Record<string, unknown>>): Promise<TestServer> {
  return testing.start_test_server(START_AT, undefined, undefined, undefined, undefined, settings, hooks === undefined ? undefined : register_with(hooks));
}

let account = 0;

export async function user(server: TestServer): Promise<TestSession> {
  account += 1;
  return testing.login(server, `coupon_user_${String(account)}`);
}

export function item_id(name: string): number {
  return testing.load_data().dev.find_id_value(name);
}

export function gold(amount: bigint): { item_id: number; amount: string } {
  return { item_id: item_id('[coupon_gold]'), amount: String(amount) };
}

export function gem(amount: bigint): { item_id: number; amount: string } {
  return { item_id: item_id('[coupon_gem]'), amount: String(amount) };
}

export interface CouponBody {
  readonly kind?: 'shared' | 'unique';
  readonly code?: string;
  readonly count?: number;
  readonly max_uses?: number;
  readonly start_at?: bigint;
  readonly end_at?: bigint;
  readonly items?: readonly { item_id: number; amount: string; big_amount?: string }[];
  readonly extra_id?: number;
  readonly memo?: string;
  readonly operation_id?: string;
}

/** The `create_coupon` JSON body: a shared coupon active from `START_AT` for a day, giving 100 gold, unless overridden. */
export function coupon_body(body: CouponBody = {}): Record<string, unknown> {
  const kind = body.kind ?? 'shared';
  return {
    operation_id: body.operation_id ?? randomUUID(),
    kind,
    code: body.code ?? (kind === 'shared' ? 'WELCOME' : ''),
    count: body.count ?? (kind === 'unique' ? 1 : 0),
    max_uses: body.max_uses ?? 0,
    start_at: String(body.start_at ?? START_AT),
    end_at: String(body.end_at ?? START_AT + DAY_MS),
    items: body.items ?? [gold(100n)],
    extra_id: body.extra_id ?? 0,
    memo: body.memo ?? 'test coupon',
  };
}

export async function admin(server: TestServer, operation: string, body: unknown, operator?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const result = await testing.send_admin(server, operation, body, operator);
  return { status: result.status, json: (result.json ?? {}) as Record<string, unknown> };
}

/** Creates a coupon and returns its ID. */
export async function create(server: TestServer, body: CouponBody = {}): Promise<bigint> {
  const result = await admin(server, 'create_coupon', coupon_body(body));
  if (result.status !== 200) throw new Error(`create_coupon: ${String(result.status)} ${JSON.stringify(result.json)}`);
  return BigInt(String(result.json['coupon_id']));
}

export async function get_coupon(server: TestServer, coupon_id: bigint): Promise<Record<string, unknown>> {
  const result = await admin(server, 'get_coupon', { coupon_id: String(coupon_id) });
  if (result.status !== 200) throw new Error(`get_coupon: ${String(result.status)}`);
  return result.json;
}

/** All codes of a unique coupon through `list_coupon_codes`. */
export async function codes_of(server: TestServer, coupon_id: bigint): Promise<string[]> {
  const result = await admin(server, 'list_coupon_codes', { coupon_id: String(coupon_id), after_code: '', limit: 100 });
  return (result.json['codes'] as { code: string }[]).map((row) => row.code);
}

export interface Redeemed {
  readonly envelope: CoreContract.ResponseEnvelope;
  readonly response: CoreContract.RedeemCouponResponse | null;
  /** The error code; 0 on success. */
  readonly code: number;
}

export async function redeem(session: TestSession, code: string, request_id?: string): Promise<Redeemed> {
  const request = new CoreContract.RedeemCouponRequest();
  request.code = code;
  const { envelope, response } = await testing.send(session, 'core/RedeemCoupon', request, request_id);
  return { envelope, response: response as CoreContract.RedeemCouponResponse | null, code: envelope.error?.code ?? 0 };
}

/** The committed balance of an item. */
export async function balance(server: TestServer, session: TestSession, name: string): Promise<bigint> {
  const id = BigInt(item_id(name));
  const states = await testing.read_user_state(server, session.user_id);
  const entry = states.find((state) => state.kind === 'ItemBalanceUserState' && state.item_id === id);
  return entry === undefined ? 0n : (entry.value as CoreContract.ItemBalanceUserState).amount;
}

/** The committed mails of a user. */
export async function mails(server: TestServer, session: TestSession): Promise<CoreContract.MailUserState[]> {
  const states = await testing.read_user_state(server, session.user_id);
  return states.filter((state) => state.kind === 'MailUserState').map((state) => state.value as CoreContract.MailUserState);
}

export const E = CoreContract.CoreError;
