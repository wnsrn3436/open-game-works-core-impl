import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import * as testing from '../../testing/dev/index.ts';
import { BINDING, SUBSCRIPTION } from '../tables.ts';
import {
  account_token,
  APPLE,
  balance,
  CAPPED,
  claim_daily,
  code_of,
  DAY,
  default_like_revoke,
  exported_rows,
  GOOGLE,
  has_pending,
  history_once_keys,
  item_changes,
  link_social,
  list_payments,
  logs_with_reason,
  mails,
  payment,
  purchase_count_of,
  receipt,
  recover,
  register_hooks,
  RETENTION_MS,
  revoke_test_grant,
  set_balance,
  set_time_offset,
  SOCIAL,
  start,
  START,
  Status,
  status_of,
  stored_purchased_at,
  subscription_row,
  verify,
  withdraw,
  without_purchase_time,
  type Session,
  type TestServer,
  fake_store,
  start_default_revoke,
} from './helpers.ts';

const IAP_TRANSFER = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_IAP_TRANSFER;

/** A success request of the session that carries its pending delta. */
function next_response(session: Session) {
  return testing.send(session, 'core/SyncSubscriptions', new CoreContract.SyncSubscriptionsRequest());
}

/** A test server whose hook `revoke_iap` can hold the functions iap registers with `after_commit` after it. */
interface Gated {
  readonly server: TestServer;
  /**
   * The next transaction that calls `revoke_iap` registers with `after_commit`, before iap registers anything after
   * the hook, a function that ends when the returned function is called. Until then the change of another user's
   * subscription that the transaction registers does not start.
   */
  hold(): () => void;
  /** The `iap_subscription` and `iap_binding` rows of an `APPLE` original transaction ID, as stored. */
  rows(original: string): { subscription: Record<string, unknown> | undefined; binding: Record<string, unknown> | undefined };
}

async function start_gated(settings: Readonly<Record<string, unknown>> = {}): Promise<Gated> {
  let gate: Promise<void> | null = null;
  // `after_commit` and `read_db` are on the `storage` module object; content `register(core)` gets only its member `content`.
  let storage: Storage | null = null;
  const server = await start({
    settings,
    register: (core) => {
      const revoke = default_like_revoke(core);
      register_hooks({
        revoke_iap: (ctx: RequestCtx, product_id: number, transaction_id: string, reason: string, items: readonly CoreContract.ItemAmount[]) => {
          const held = gate;
          gate = null;
          if (held !== null) {
            if (storage === null) throw new Error('the server did not start');
            storage.after_commit(ctx, () => held);
          }
          return revoke(ctx, product_id, transaction_id, reason, items);
        },
      })(core);
    },
  });
  const db = storage_module(server);
  storage = db;
  const read = (table: string, original: string): Record<string, unknown> | undefined =>
    db.read_db().query(`SELECT * FROM ${table} WHERE store = $1 AND original_transaction_id = $2`, ['IAP_STORE_APPLE', original])[0];
  return {
    server,
    hold: () => {
      let open = (): void => undefined;
      gate = new Promise((resolve) => {
        open = resolve;
      });
      return () => {
        open();
      };
    },
    rows: (original) => ({ subscription: read(SUBSCRIPTION, original), binding: read(BINDING, original) }),
  };
}

/** The two transactions that register the change of another user's subscription after their commit and call `revoke_iap` before. */
const OTHER_CHANGES = ['revoke', 'apply'] as const;

/**
 * B buys the Subscription `original` and A takes it by ownership transfer. Then B's transaction registers A's change
 * after its commit, held by the gate: `revoke_test_grant` of `original` (`revoke`), or the `REFUND` of `original` with
 * snapshot `REVOKED` (`apply`). Returns the sessions and the gate's opener.
 */
async function held_change(g: Gated, kind: (typeof OTHER_CHANGES)[number], original: string): Promise<{ a: Session; b: Session; open: () => void }> {
  const a = await testing.login(g.server, `a_${original}`);
  const b = await testing.login(g.server, `b_${original}`);
  fake_store(g.server).set_result('lookup_subscription', null);
  const data = receipt('vip_apple', original, await account_token(b));
  expect(status_of(await verify(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
  expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
  await testing.wait_background(g.server);
  expect(g.rows(original).subscription).toMatchObject({ user_id: a.user_id, state: 'SUBSCRIPTION_STATE_ACTIVE' });
  const open = g.hold();
  if (kind === 'revoke') {
    expect((await revoke_test_grant(g.server, b.user_id, original, `op-${original}`)).status).toBe(200);
  } else {
    fake_store(g.server).set_result('lookup_subscription', { latest_transaction_id: original, state: 'REVOKED' });
    expect(await testing.call_dev(g.server, 'iap', 'send_fake_refund', [APPLE, original])).toBe(200);
  }
  expect((await payment(g.server, b.user_id, original))?.result).toBe('REFUNDED');
  return { a, b, open };
}

function other_user_change_errors(server: TestServer): Record<string, unknown>[] {
  return testing.read_logs(server, 'error').filter((l: Record<string, unknown>) => String(l.message).includes('of another user'));
}

/** Waits, for at most 10 s of real time, until `check` is true. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('store transactions of another user', () => {
  it('another user REFUNDED store transaction is INVALID with a security log', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    await verify(b, APPLE, receipt('gems_apple', 'rf-1', token_b));
    expect(await testing.call_dev(server, 'iap', 'send_fake_refund', [APPLE, 'rf-1'])).toBe(200);
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'rf-1', token_b)))).toBe(Status.PURCHASE_STATUS_INVALID);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect((await payment(server, b.user_id, 'rf-1'))?.result).toBe('REFUNDED');
    expect((await logs_with_reason(server, 'security', 'invalid')).length).toBeGreaterThan(0);
  });

  it('a GRANTED store transaction of a user with a social account link is ALREADY_GRANTED; a not granted one with their account token is OTHER_USER; neither grants nor changes the payment record', async () => {
    const server = await start({ settings: SOCIAL });
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    await link_social(b, 'b-google');
    const token_b = await account_token(b);
    await verify(b, APPLE, receipt('gems_apple', 'o-1', token_b));
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'o-1', token_b)))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'o-2', token_b)))).toBe(Status.PURCHASE_STATUS_OTHER_USER);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect(await balance(server, b.user_id)).toBe(100n);
    expect((await payment(server, b.user_id, 'o-1'))?.user_id).toBe(b.user_id.toString());
    expect(await payment(server, a.user_id, 'o-2')).toBeUndefined();
    expect(await logs_with_reason(server, 'security', 'already_granted')).toHaveLength(1);
    expect(await logs_with_reason(server, 'security', 'other_user')).toHaveLength(1);
  });

  it('a NonConsumable of B without a social account link moves to A by RecoverPurchase, and B loses it with a pending delta', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    const data = receipt('noads_apple', 'nc-1', token_b);
    expect(status_of(await verify(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    await testing.wait_background(server);
    expect((await payment(server, a.user_id, 'nc-1'))?.user_id).toBe(a.user_id.toString());
    expect(await purchase_count_of(server, a.user_id, '[iap_no_ads]')).toBe(1);
    expect(await purchase_count_of(server, b.user_id, '[iap_no_ads]')).toBe(0);
    expect(await balance(server, a.user_id)).toBe(50n);
    expect(await balance(server, b.user_id)).toBe(0n);
    const next = await next_response(b);
    expect(has_pending(next, 'IapPurchaseUserState')).toBe(true);
    expect(has_pending(next, 'ItemBalanceUserState')).toBe(true);
  });

  it('a NonConsumable of B without a social account link sent by A with a receipt that is not a device receipt is ALREADY_GRANTED and the payment record stays with B', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const data = receipt('noads_apple', 'nd-1', await account_token(b));
    expect(status_of(await verify(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    fake_store(server).set_result('verify', { result: 'VALID', device_receipt: false });
    expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    await testing.wait_background(server);
    expect((await payment(server, b.user_id, 'nd-1'))?.user_id).toBe(b.user_id.toString());
    expect(await balance(server, a.user_id)).toBe(0n);
    expect(await balance(server, b.user_id)).toBe(50n);
    expect(await logs_with_reason(server, 'audit', 'iap_transfer')).toHaveLength(0);
    fake_store(server).set_result('verify', 'VALID');
    expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
  });

  it('a NonConsumable of a withdrawn B moves to A without a change of B, and the moved record has no delete_at', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    const data = receipt('noads_apple', 'nc-2', token_b);
    await verify(b, APPLE, data);
    await withdraw(b);
    expect((await payment(server, b.user_id, 'nc-2'))?.delete_at).not.toBeNull();
    expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    await testing.wait_background(server);
    const moved = await payment(server, a.user_id, 'nc-2');
    expect(moved?.user_id).toBe(a.user_id.toString());
    expect(moved?.delete_at).toBeNull();
    expect(await balance(server, a.user_id)).toBe(50n);
    expect(testing.read_logs(server, 'error').filter((l: Record<string, unknown>) => String(l.message).includes('earlier owner'))).toHaveLength(0);
  });

  it('a Consumable of B with a GRANTED payment record is ALREADY_GRANTED and A gets nothing', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    await verify(b, APPLE, receipt('gems_apple', 'cg-1', token_b));
    expect(status_of(await recover(a, APPLE, receipt('gems_apple', 'cg-1', token_b)))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect(await balance(server, b.user_id)).toBe(100n);
  });

  it('revoke_iap of B in an ownership transfer gets reason transfer', async () => {
    const reasons: string[] = [];
    const server = await start({ register: register_hooks({ revoke_iap: (_ctx: unknown, _p: number, _t: string, reason: string) => void reasons.push(reason) }) });
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    await verify(b, APPLE, receipt('noads_apple', 'h-1', token_b));
    await recover(a, APPLE, receipt('noads_apple', 'h-1', token_b));
    await testing.wait_background(server);
    expect(reasons).toEqual(['transfer']);
  });

  it('the default revoke of an ownership transfer is an ItemChange with source IapTransfer and ref the transaction ID', async () => {
    const server = await start_default_revoke();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    await verify(b, APPLE, receipt('noads_apple', 'h-2', token_b));
    await recover(a, APPLE, receipt('noads_apple', 'h-2', token_b));
    await testing.wait_background(server);
    const next = await next_response(b);
    expect(item_changes(next).map((change) => [change.source, change.ref, change.delta])).toEqual([[IAP_TRANSFER, 'h-2', -50n]]);
  });

  it('A, B, A, B recover the same NonConsumable: each is GRANTED, the sender gets reward, the one before loses it, and the once keys go t1, t2, t3', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_a = await account_token(a);
    const data = receipt('noads_apple', 'abab', token_a);
    for (const [who, other] of [[a, b], [b, a], [a, b], [b, a]] as const) {
      expect(status_of(await recover(who, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
      await testing.wait_background(server);
      expect(await balance(server, who.user_id)).toBe(50n);
      expect(await balance(server, other.user_id)).toBe(0n);
    }
    expect((await payment(server, b.user_id, 'abab'))?.transfer_count).toBe(3);
    const base = 'iap:IAP_STORE_APPLE:abab';
    const granted = [...(await history_once_keys(server, a.user_id)), ...(await history_once_keys(server, b.user_id))].filter((key) => key.startsWith(base));
    expect(granted.sort()).toEqual([base, `${base}:t1`, `${base}:t2`, `${base}:t3`]);
  });

  it('a Consumable with the account token of B (no social link) and no payment record goes to A with one iap_transfer audit log and B stays; with a social link it is OTHER_USER and list_payments(A) shows the attempt', async () => {
    const server = await start({ settings: SOCIAL });
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    const b_before = await testing.read_user_state(server, b.user_id);
    expect(status_of(await recover(a, APPLE, receipt('gems_apple', 'tk-1', token_b)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    await testing.wait_background(server);
    expect(await balance(server, a.user_id)).toBe(100n);
    expect(await balance(server, b.user_id)).toBe(0n);
    expect(await testing.read_user_state(server, b.user_id)).toEqual(b_before);
    expect(await logs_with_reason(server, 'audit', 'iap_transfer')).toHaveLength(1);
    await link_social(b, 'b-link');
    expect(status_of(await recover(a, APPLE, receipt('gems_apple', 'tk-2', token_b)))).toBe(Status.PURCHASE_STATUS_OTHER_USER);
    const attempts = (await list_payments(server, a.user_id)).other_user_attempts;
    expect(attempts.map((r) => [r.transaction_id, r.owner_user_id])).toEqual([['tk-2', b.user_id.toString()]]);
  });

  it('a store transaction without an account token is granted only to the user that first bound its original transaction ID when that user has a social link', async () => {
    const server = await start({ settings: SOCIAL });
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    await link_social(a, 'a-link');
    for (const [store, sku] of [[APPLE, 'gems_apple'], [GOOGLE, 'gems_google']] as const) {
      const data = receipt(sku, `nt-${String(store)}`, '');
      expect(status_of(await verify(a, store, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
      expect(status_of(await verify(b, store, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    }
    expect(await balance(server, b.user_id)).toBe(0n);
  });

  it('a GOOGLE store transaction without an account token within its retention after purchase is GRANTED to the first sender with one payment record', async () => {
    const server = await start();
    const c = await testing.login(server, 'c');
    expect(status_of(await verify(c, GOOGLE, receipt('gems_google', 'nt-new', '')))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect((await list_payments(server, c.user_id)).payments).toHaveLength(1);
  });

  it('a pending GOOGLE subscription without an account token, for which the store gives no purchase time, takes the request time: PENDING, and its original transaction ID is bound to the sender', async () => {
    const server = await start();
    const c = await testing.login(server, 'c');
    fake_store(server, GOOGLE).set_result('verify', 'PENDING');
    without_purchase_time(server, GOOGLE, 'verify');
    expect(status_of(await verify(c, GOOGLE, receipt('vip_google', 'pending-1', '')))).toBe(Status.PURCHASE_STATUS_PENDING);
    expect((await exported_rows(server, c.user_id, BINDING)).map((r) => [r['original_transaction_id'], String(r['user_id'])])).toEqual([['pending-1', c.user_id.toString()]]);
  });

  it('two users with social links sending the same token-less store transaction at once: one GRANTED, the other OTHER_USER or ALREADY_GRANTED', async () => {
    const server = await start({ settings: SOCIAL });
    for (const [store, sku] of [[APPLE, 'gems_apple'], [GOOGLE, 'gems_google']] as const) {
      const a = await testing.login(server, `a_${String(store)}`);
      const b = await testing.login(server, `b_${String(store)}`);
      await link_social(a, `a-${String(store)}`);
      await link_social(b, `b-${String(store)}`);
      const data = receipt(sku, `race-${String(store)}`, '');
      const results = (await Promise.all([verify(a, store, data), verify(b, store, data)])).map(status_of);
      expect(results.filter((s) => s === Status.PURCHASE_STATUS_GRANTED)).toHaveLength(1);
      const other = results.find((s) => s !== Status.PURCHASE_STATUS_GRANTED);
      expect([Status.PURCHASE_STATUS_OTHER_USER, Status.PURCHASE_STATUS_ALREADY_GRANTED]).toContain(other);
      expect((await balance(server, a.user_id)) + (await balance(server, b.user_id))).toBe(100n);
    }
  });

  it('a subscription receipt bound to another user with a social link is OTHER_USER for a not granted transaction and ALREADY_GRANTED for a granted one, and the sender SubscriptionUserState stays', async () => {
    const server = await start({ settings: SOCIAL });
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    await link_social(b, 'b-sub');
    const token_b = await account_token(b);
    await verify(b, APPLE, receipt('vip_apple', 'sb-1', token_b));
    expect(status_of(await verify(a, APPLE, receipt('vip_apple', 'sb-2', '', 'sb-1')))).toBe(Status.PURCHASE_STATUS_OTHER_USER);
    expect(status_of(await verify(a, APPLE, receipt('vip_apple', 'sb-1', token_b)))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    expect(await subscription_row(server, a.user_id, '[iap_vip]')).toBeNull();
  });

  it('after a Subscription of B moves to A, RecoverPurchase of it by B grants the renewal to A, and the REFUND of B revokes the subscription of A after the commit', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    const data = receipt('vip_apple', 'so-1', token_b);
    expect(status_of(await verify(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    await testing.wait_background(server);
    expect(await subscription_row(server, b.user_id, '[iap_vip]')).toBeNull();
    const ends_at = (await subscription_row(server, a.user_id, '[iap_vip]'))?.ends_at;
    const b_balance = await balance(server, b.user_id);
    expect(status_of(await recover(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    // The store renewed the subscription with so-2: B's RecoverPurchase of so-1 applies it to A, the subscription's user, after the commit.
    const a_balance = await balance(server, a.user_id);
    fake_store(server).set_result('lookup_subscription', { latest_transaction_id: 'so-2' });
    expect(status_of(await recover(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    await testing.wait_background(server);
    expect(await subscription_row(server, b.user_id, '[iap_vip]')).toBeNull();
    expect(await subscription_row(server, a.user_id, '[iap_vip]')).toMatchObject({ state: CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE, ends_at });
    expect(await balance(server, b.user_id)).toBe(b_balance);
    expect(await payment(server, b.user_id, 'so-2')).toBeUndefined();
    expect((await payment(server, a.user_id, 'so-2'))?.result).toBe('GRANTED');
    expect(await balance(server, a.user_id)).toBeGreaterThan(a_balance);
    // The REFUND of so-1 (B's payment record) with snapshot REVOKED revokes A's subscription record and SubscriptionUserState after the commit.
    fake_store(server).set_result('lookup_subscription', { latest_transaction_id: 'so-1', state: 'REVOKED' });
    expect(await testing.call_dev(server, 'iap', 'send_fake_refund', [APPLE, 'so-1'])).toBe(200);
    await testing.wait_background(server);
    expect((await payment(server, b.user_id, 'so-1'))?.result).toBe('REFUNDED');
    expect(await subscription_row(server, b.user_id, '[iap_vip]')).toBeNull();
    expect((await subscription_row(server, a.user_id, '[iap_vip]'))?.state).toBe(CoreContract.SubscriptionState.SUBSCRIPTION_STATE_REVOKED);
    expect((await exported_rows(server, a.user_id, 'iap_subscription')).find((row) => row['original_transaction_id'] === 'so-1')?.['state']).toBe('SUBSCRIPTION_STATE_REVOKED');
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBe(CoreContract.CoreError.CORE_ERROR_IAP_DAILY_INACTIVE);
  });

  it('a renewal whose snapshot has no store purchase time, applied to the subscription of A after the commit of a RecoverPurchase by B, gets the request time of A\'s change as its purchase time, with the cheat time offset of A', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const data = receipt('vip_apple', 'pt-1', await account_token(b));
    expect(status_of(await verify(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    await testing.wait_background(server);
    await set_time_offset(a, DAY);
    await set_time_offset(b, 2n * DAY);
    without_purchase_time(server, APPLE, 'lookup_subscription');
    fake_store(server).set_result('lookup_subscription', { latest_transaction_id: 'pt-2', ends_at: (START + 10n * DAY).toString() });
    expect(status_of(await recover(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    await testing.wait_background(server);
    expect(await stored_purchased_at(server, b.user_id, 'pt-2')).toBeUndefined();
    expect(await stored_purchased_at(server, a.user_id, 'pt-2')).toEqual({ result: 'GRANTED', purchased_at: (START + DAY).toString() });
  });

  it('A that got the Subscription of B by ownership transfer RecoverPurchases a renewal transaction with the account token of B: GRANTED with no OTHER_USER record and no new iap_transfer log', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    const first = receipt('vip_apple', 'rn-1', token_b);
    expect(status_of(await verify(b, APPLE, first))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await recover(a, APPLE, first))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    await testing.wait_background(server);
    const transfer_logs = (await logs_with_reason(server, 'audit', 'iap_transfer')).length;
    const security_logs = (await logs_with_reason(server, 'security', 'iap_transfer')).length;
    expect(transfer_logs).toBe(1);
    fake_store(server).set_result('lookup_subscription', { latest_transaction_id: 'rn-2' });
    expect(status_of(await recover(a, APPLE, receipt('vip_apple', 'rn-2', token_b, 'rn-1')))).toBe(Status.PURCHASE_STATUS_GRANTED);
    await testing.wait_background(server);
    expect((await payment(server, a.user_id, 'rn-2'))?.result).toBe('GRANTED');
    expect((await list_payments(server, a.user_id)).other_user_attempts).toEqual([]);
    expect(await logs_with_reason(server, 'audit', 'iap_transfer')).toHaveLength(transfer_logs);
    expect(await logs_with_reason(server, 'security', 'iap_transfer')).toHaveLength(security_logs);
    expect(await logs_with_reason(server, 'security', 'other_user')).toHaveLength(0);
  });

  it('after a Subscription of B moves to A and B withdraws, the REFUND of B applies the snapshot to the subscription record and SubscriptionUserState of A after the commit and leaves the binding of A', async () => {
    const server = await start();
    for (const [name, snapshot] of [
      ['revoked', { state: 'REVOKED' }],
      ['active', { state: 'ACTIVE', ends_at: (START + 90n * DAY).toString() }],
    ] as const) {
      const a = await testing.login(server, `a_${name}`);
      const b = await testing.login(server, `b_${name}`);
      const original = `wt-${name}`;
      const data = receipt('vip_apple', original, await account_token(b));
      fake_store(server).set_result('lookup_subscription', null);
      expect(status_of(await verify(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
      expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
      await testing.wait_background(server);
      const a_state = await subscription_row(server, a.user_id, '[iap_vip]');
      expect(a_state?.state).toBe(CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE);
      const a_record = (await exported_rows(server, a.user_id, 'iap_subscription')).find((row) => row['original_transaction_id'] === original);
      const a_binding = (await exported_rows(server, a.user_id, 'iap_binding')).find((row) => row['original_transaction_id'] === original);
      expect(a_record).toBeDefined();
      expect(a_binding).toBeDefined();
      await withdraw(b);
      fake_store(server).set_result('lookup_subscription', { latest_transaction_id: original, ...snapshot });
      expect(await testing.call_dev(server, 'iap', 'send_fake_refund', [APPLE, original])).toBe(200);
      await testing.wait_background(server);
      expect((await payment(server, b.user_id, original))?.result).toBe('REFUNDED');
      const state = name === 'revoked' ? CoreContract.SubscriptionState.SUBSCRIPTION_STATE_REVOKED : CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE;
      expect((await exported_rows(server, a.user_id, 'iap_subscription')).find((row) => row['original_transaction_id'] === original)).toMatchObject({ user_id: a_record?.['user_id'], state: `SUBSCRIPTION_STATE_${snapshot.state}`, delete_at: null });
      expect((await exported_rows(server, a.user_id, 'iap_binding')).find((row) => row['original_transaction_id'] === original)).toEqual(a_binding);
      expect((await subscription_row(server, a.user_id, '[iap_vip]'))?.state).toBe(state);
      if (name === 'active') expect((await subscription_row(server, a.user_id, '[iap_vip]'))?.ends_at).toBe(START + 90n * DAY);
      else expect(code_of(await claim_daily(a, '[iap_vip]'))).toBe(CoreContract.CoreError.CORE_ERROR_IAP_DAILY_INACTIVE);
    }
  });

  it('deleted APPLE and GOOGLE store transactions sent without an account token by another user are INVALID', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    for (const [store, sku] of [[APPLE, 'gems_apple'], [GOOGLE, 'gems_google']] as const) {
      fake_store(server, store).set_result('verify', { result: 'VALID', purchased_at: (START - RETENTION_MS).toString() });
      expect(status_of(await verify(a, store, receipt(sku, `old-${String(store)}`, '')))).toBe(Status.PURCHASE_STATUS_INVALID);
    }
    expect(await balance(server, a.user_id)).toBe(0n);
  });

  it('an ownership transfer cancels the unclaimed grant mail of B, and the balance of B stays', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    await set_balance(server, b.user_id, CAPPED(), 100n);
    const data = receipt('capped_unlock_apple', 'mx-1', token_b);
    expect(status_of(await verify(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(await mails(server, b.user_id)).toHaveLength(1);
    expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    await testing.wait_background(server);
    expect(await mails(server, b.user_id)).toHaveLength(0);
    expect(await balance(server, b.user_id, CAPPED())).toBe(100n);
    expect(await balance(server, a.user_id, CAPPED())).toBe(100n);
  });
});

describe('the change of another user\'s subscription after the commit', () => {
  it('when the subscription record and binding moved from C to another user before C\'s change, C\'s change of revoke_test_grant and of subscription apply changes nothing for C or the new owner', async () => {
    const g = await start_gated();
    for (const kind of OTHER_CHANGES) {
      const original = `om_${kind}`;
      const { a, open } = await held_change(g, kind, original);
      // C2 takes the subscription from A by ownership transfer with a renewal transaction while A's change waits.
      const c2 = await testing.login(g.server, `c2_${original}`);
      fake_store(g.server).set_result('lookup_subscription', null);
      expect(status_of(await recover(c2, APPLE, receipt('vip_apple', `${original}-2`, await account_token(a), original)))).toBe(Status.PURCHASE_STATUS_GRANTED);
      const moved = g.rows(original);
      expect(moved.subscription).toMatchObject({ user_id: c2.user_id, state: 'SUBSCRIPTION_STATE_ACTIVE' });
      expect(moved.binding).toMatchObject({ user_id: c2.user_id });
      const c2_state = await subscription_row(g.server, c2.user_id, '[iap_vip]');
      expect(c2_state?.state).toBe(CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE);
      open();
      await testing.wait_background(g.server);
      expect(g.rows(original)).toEqual(moved);
      expect(await subscription_row(g.server, c2.user_id, '[iap_vip]')).toEqual(c2_state);
      expect(await subscription_row(g.server, a.user_id, '[iap_vip]')).toBeNull();
    }
    expect(other_user_change_errors(g.server)).toHaveLength(0);
  });

  it('when C withdrew before C\'s change, C\'s change of revoke_test_grant and of subscription apply is WITHDRAWN: C\'s rows stay as they are and there is no error log', async () => {
    const g = await start_gated();
    for (const kind of OTHER_CHANGES) {
      const original = `ow_${kind}`;
      const { a, open } = await held_change(g, kind, original);
      await withdraw(a);
      const before = g.rows(original);
      expect(before.subscription).toMatchObject({ user_id: a.user_id, state: 'SUBSCRIPTION_STATE_ACTIVE' });
      expect(before.binding).toMatchObject({ user_id: a.user_id });
      open();
      await testing.wait_background(g.server);
      expect(g.rows(original)).toEqual(before);
    }
    expect(other_user_change_errors(g.server)).toHaveLength(0);
  });

  it('a failure of C\'s change of revoke_test_grant and of subscription apply leaves one error log, C\'s rows as they were and the commit that registered the change', async () => {
    const g = await start_gated({ 'storage.userLockWaitMs': 300 });
    for (const kind of OTHER_CHANGES) {
      const original = `of_${kind}`;
      const { a, b, open } = await held_change(g, kind, original);
      const before = g.rows(original);
      const a_state = await subscription_row(g.server, a.user_id, '[iap_vip]');
      expect(a_state?.state).toBe(CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE);
      const errors = other_user_change_errors(g.server).length;
      // Another connection holds the binding row past storage.userLockWaitMs, so C's change cannot lock it.
      const release = await testing.hold_game_row_lock(g.server, BINDING, ['IAP_STORE_APPLE', original]);
      try {
        open();
        await until(() => other_user_change_errors(g.server).length > errors);
      } finally {
        await release();
      }
      await testing.wait_background(g.server);
      const logged = other_user_change_errors(g.server).slice(errors);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ level: 'error', message: 'iap change of the subscription of another user failed', change: kind, user_id: String(a.user_id) });
      expect(g.rows(original)).toEqual(before);
      expect(await subscription_row(g.server, a.user_id, '[iap_vip]')).toEqual(a_state);
      expect((await payment(g.server, b.user_id, original))?.result).toBe('REFUNDED');
    }
  });
});
