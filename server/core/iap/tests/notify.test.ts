import { createHmac, randomBytes } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import {
  account_token,
  APPLE,
  balance,
  CAPPED,
  core_events,
  DAY,
  exported_rows,
  has_pending,
  id,
  item_changes,
  list_payments,
  logs_with_reason,
  mails,
  payment,
  purchase_count_of,
  purchase_row,
  receipt,
  recover,
  register_hooks,
  RETENTION_MS,
  set_balance,
  start,
  START,
  State,
  Status,
  status_of,
  subscription_row,
  verify,
  withdraw,
  type Session,
  type TestServer,
  fake_store,
  start_default_revoke,
  GEM,
  data,
} from './helpers.ts';
import type { StoreAdapter } from '../adapter.ts';
import { create_fake_adapter, parse_fake_notification, sign_fake_notification } from '../dev/index.ts';
import type { Iap } from '../index.ts';
import type { IapContext } from '../context.ts';
import type { IapModules } from '../deps.ts';
import { handle_notify, type RouteRequest } from '../notify.ts';
import type { IapSettings } from '../settings.ts';
import type { PaymentRow } from '../tables.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';

const IAP_REFUND = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_IAP_REFUND;

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function refund(server: TestServer, store: CoreContract.IapStore, transaction_id: string, notification_id?: string): Promise<unknown> {
  return testing.call_dev(server, 'iap', 'send_fake_refund', notification_id === undefined ? [store, transaction_id] : [store, transaction_id, notification_id]);
}

function notify(server: TestServer, store: CoreContract.IapStore, original: string, snapshot: Record<string, unknown> | null, notification_id?: string): Promise<unknown> {
  return testing.call_dev(server, 'iap', 'send_fake_subscription_notify', notification_id === undefined ? [store, original, snapshot] : [store, original, snapshot, notification_id]);
}

/**
 * Makes the server instance's `iap` read fake notifications signed with a key the test knows, and gives a sender of
 * any fake notification body (kind `OTHER` too) through `POST /iap/notify/<store>`. `send_fake_*` no longer pass the
 * signature check of that server instance after this.
 */
function own_notify_key(server: TestServer): (store: CoreContract.IapStore, json: Readonly<Record<string, string>>) => Promise<number> {
  const iap = server.running().instance.modules().get('iap') as unknown as Iap;
  const key = randomBytes(32);
  iap.include_dev_code({ create_fake_adapter: (adapter_key) => create_fake_adapter(adapter_key).adapter, parse_fake_notification: (headers, body) => parse_fake_notification(key, headers, body) });
  return async (store, json) => {
    const body = bytes(JSON.stringify(json));
    const path = `/iap/notify/${store === APPLE ? 'apple' : 'google'}`;
    return (await testing.send_raw(server, 'POST', path, { 'content-type': 'application/json', 'x-ogw-fake-signature': sign_fake_notification(key, body) }, body)).status;
  };
}

const A = 1001n;
const B = 1002n;
const PAYMENT_COLUMNS = ['store', 'transaction_id', 'original_transaction_id', 'user_id', 'sku', 'product_id', 'spend_amount', 'purchased_at', 'verified_at', 'result', 'test', 'reset_at', 'event_round', 'transfer_count', 'delete_at'];

/**
 * The store notification handler over dependencies the test controls: payment records in memory, and user
 * transactions that start only when the test opens them, so a change can commit between the handler's read outside
 * the transaction and its record recheck. User B holds the `GRANTED` `NonConsumable` store transaction `race-1`.
 */
function notify_race() {
  const payments = new Map<string, PaymentRow>([
    [
      'race-1',
      {
        store: 'IAP_STORE_APPLE',
        transaction_id: 'race-1',
        original_transaction_id: 'race-1',
        user_id: B,
        sku: 'noads_apple',
        product_id: id('[iap_no_ads]'),
        spend_amount: 3000n,
        purchased_at: START,
        verified_at: START,
        result: 'GRANTED',
        test: false,
        reset_at: 0n,
        event_round: 0,
        transfer_count: 0,
        delete_at: null,
      },
    ],
  ]);
  const db = {
    query(sql: string, params: readonly unknown[]): Record<string, unknown>[] {
      if (sql.startsWith('SELECT') && sql.includes('FROM iap_payment WHERE store = $1 AND transaction_id = $2')) {
        const row = payments.get(String(params[1]));
        return row === undefined ? [] : [{ ...row }];
      }
      if (sql.startsWith('INSERT INTO iap_payment')) {
        const row = Object.fromEntries(PAYMENT_COLUMNS.map((name, i) => [name, params[i]])) as unknown as PaymentRow;
        payments.set(row.transaction_id, row);
        return [];
      }
      if (sql.startsWith('SELECT') && (sql.includes('FROM iap_binding') || sql.includes('FROM iap_subscription'))) return [];
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const opened: bigint[] = [];
  const claims: string[] = [];
  const revokes: unknown[] = [];
  const cancelled: unknown[] = [];
  const counts: unknown[] = [];
  const held: (() => void)[] = [];
  let on_hold: (() => void) | null = null;
  const storage = {
    read_db: () => db,
    db: () => db,
    lock_game_row: () => undefined,
    with_hook_change_source: (_ctx: RequestCtx, _source: number, _ref: string, fn: () => unknown) => fn(),
    get_state: () => {
      const row = new CoreContract.IapPurchaseUserState();
      row.id = BigInt(id('[iap_no_ads]'));
      row.count = 1;
      return row;
    },
    put_core_state: (ctx: RequestCtx, row: CoreContract.IapPurchaseUserState) => {
      counts.push([ctx.user_id, row.count]);
    },
    run_user_transaction: async (user_id: bigint, fn: (ctx: RequestCtx) => unknown) => {
      opened.push(user_id);
      await new Promise<void>((resolve) => {
        held.push(resolve);
        on_hold?.();
        on_hold = null;
      });
      const ctx = { user_id, data, request_id: '', request_name: '' } as unknown as RequestCtx;
      return fn(ctx) === 'pass' ? 'COMMITTED' : 'REJECTED';
    },
  };
  const m = {
    storage,
    time: { clock_now: () => START, now: () => START },
    logging: { write: () => undefined, track_core_event: () => undefined },
    // `[iap_no_ads]` has no offer.
    offer: {
      read_purchase_limit: (_ctx: RequestCtx, _offer: number, _reset: unknown, _live_event: number, count: number, reset_at: bigint, event_round: number) => ({
        count,
        reset_at,
        event_round,
        write_reset_at: reset_at,
      }),
    },
    idempotency: {
      claim_notify: (_ctx: RequestCtx, _source: string, notify_id: string) => {
        claims.push(notify_id);
        return 'FIRST';
      },
    },
    mailbox: {
      cancel_mail_by_once_key: (ctx: RequestCtx, once_key: string) => {
        cancelled.push([ctx.user_id, once_key]);
        return [];
      },
    },
  } as unknown as IapModules;
  const c: IapContext = {
    m,
    settings: { notify_max_body_bytes: 1024, notify_body_read_timeout_ms: 1000, max_notify_id_bytes: 64 } as unknown as IapSettings,
    data,
    hooks: {
      validate_iap_purchase: null,
      grant_iap_extra: null,
      revoke_iap: (ctx, _product_id, _transaction_id, reason, items) => {
        revokes.push([ctx.user_id, reason, items.map((item) => [item.item_id, item.amount])]);
      },
    },
    adapters: new Map([[APPLE, { name: 'fake', adapter: {} as StoreAdapter }]]),
    account_key: '',
    has_social_link: null,
    fake_notification: () => ({ notification_id: 'race-n', kind: 'REFUND', value: 'race-1' }),
  };
  const request: RouteRequest = { method: 'POST', path: '/iap/notify/apple', query: '', headers: {}, read_body: () => Promise.resolve(bytes('{}')), upgrade: null };
  return {
    c,
    request,
    payments,
    opened,
    claims,
    revokes,
    cancelled,
    counts,
    row: (transaction_id: string): PaymentRow => {
      const row = payments.get(transaction_id);
      if (row === undefined) throw new Error(`no payment record ${transaction_id}`);
      return row;
    },
    /** Resolves when a user transaction waits to start. */
    waiting: (): Promise<void> =>
      new Promise((resolve) => {
        if (held.length > 0) resolve();
        else on_hold = resolve;
      }),
    /** Starts the oldest waiting user transaction. */
    open: (): void => {
      held.shift()?.();
    },
  };
}

function next_response(session: Session) {
  return testing.send(session, 'core/SyncSubscriptions', new CoreContract.SyncSubscriptionsRequest());
}

describe('store notification', () => {
  it('a refund notification revokes reward by the default hook, marks the payment record REFUNDED and makes a pending delta', async () => {
    const server = await start_default_revoke();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'rf-1', token));
    expect(await refund(server, APPLE, 'rf-1')).toBe(200);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect((await payment(server, a.user_id, 'rf-1'))?.result).toBe('REFUNDED');
    expect(await purchase_count_of(server, a.user_id, '[iap_gems]')).toBe(0);
    const next = await next_response(a);
    expect(has_pending(next, 'ItemBalanceUserState')).toBe(true);
    expect(item_changes(next).map((c) => [c.source, c.ref, c.delta])).toEqual([[IAP_REFUND, 'rf-1', -100n]]);
  });

  it('the same notification ID sent twice is processed once; a wrong X-Ogw-Fake-Signature is HTTP 403 and a body that is not the JSON form is HTTP 400', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'dup-1', token));
    await verify(a, APPLE, receipt('gems_apple', 'dup-2', token));
    expect(await refund(server, APPLE, 'dup-1', 'same-id')).toBe(200);
    expect(await refund(server, APPLE, 'dup-2', 'same-id')).toBe(200);
    expect((await payment(server, a.user_id, 'dup-2'))?.result).toBe('GRANTED');
    expect(await balance(server, a.user_id)).toBe(100n);
    const body = JSON.stringify({ notification_id: 'x', kind: 'REFUND', transaction_id: 'dup-2' });
    const forged = await testing.send_raw(server, 'POST', '/iap/notify/apple', { 'content-type': 'application/json', 'x-ogw-fake-signature': createHmac('sha256', 'not-the-key').update(body).digest('hex') }, bytes(body));
    expect(forged.status).toBe(403);
    const unsigned = await testing.send_raw(server, 'POST', '/iap/notify/apple', { 'content-type': 'application/json' }, bytes(body));
    expect(unsigned.status).toBe(403);
    expect((await payment(server, a.user_id, 'dup-2'))?.result).toBe('GRANTED');
  });

  it('a notification body that is not the fake JSON form is HTTP 400, and a store path without an adapter is HTTP 404', async () => {
    const server = await start();
    for (const body of ['not json', '{"notification_id":"x","kind":"REFUND"}', '{"notification_id":"x","kind":"CANCEL","transaction_id":"t"}']) {
      expect((await testing.send_raw(server, 'POST', '/iap/notify/google', { 'content-type': 'application/json', 'x-ogw-fake-signature': '00' }, bytes(body))).status).toBe(400);
    }
    expect((await testing.send_raw(server, 'POST', '/iap/notify/amazon', { 'content-type': 'application/json' }, bytes('{}'))).status).toBe(404);
    const without = await start({ settings: { 'environments.<ENV>.adapters.iap-google': null } });
    expect((await testing.send_raw(without, 'POST', '/iap/notify/google', { 'content-type': 'application/json' }, bytes('{}'))).status).toBe(404);
  });

  it('a body over iap.notifyMaxBodyBytes or a read over iap.notifyBodyReadTimeoutMs is HTTP 400 and nothing is processed', async () => {
    const server = await start({ settings: { 'iap.notifyMaxBodyBytes': 72, 'iap.notifyBodyReadTimeoutMs': 50 } });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'big-1', token));
    const long = JSON.stringify({ notification_id: 'n'.repeat(80), kind: 'REFUND', transaction_id: 'big-1' });
    expect((await testing.send_raw(server, 'POST', '/iap/notify/apple', { 'content-type': 'application/json' }, bytes(long))).status).toBe(400);
    expect(await refund(server, APPLE, 'big-1', 'n'.repeat(80))).toBe(400);
    expect((await payment(server, a.user_id, 'big-1'))?.result).toBe('GRANTED');
    expect(await refund(server, APPLE, 'big-1', 'short')).toBe(200);
    expect((await payment(server, a.user_id, 'big-1'))?.result).toBe('REFUNDED');
  });

  it('a notification ID that is empty or over idempotency.maxNotifyIdBytes is HTTP 400 and nothing is processed', async () => {
    // 36 is the lowest value `ads-reward` lets the server start with.
    const server = await start({ settings: { 'idempotency.maxNotifyIdBytes': 36 } });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'nid-1', token));
    expect(await refund(server, APPLE, 'nid-1', '')).toBe(400);
    expect(await refund(server, APPLE, 'nid-1', 'n'.repeat(37))).toBe(400);
    expect((await payment(server, a.user_id, 'nid-1'))?.result).toBe('GRANTED');
    expect(await refund(server, APPLE, 'nid-1', 'n'.repeat(36))).toBe(200);
    expect((await payment(server, a.user_id, 'nid-1'))?.result).toBe('REFUNDED');
  });

  it('the REFUND of a GRANTED store transaction of a withdrawn user is HTTP 200 and marks it REFUNDED; the same notification ID again is not processed', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'wd-1', token));
    await verify(a, APPLE, receipt('gems_apple', 'wd-2', token));
    await withdraw(a);
    expect(await refund(server, APPLE, 'wd-1', 'wd-n')).toBe(200);
    expect((await payment(server, a.user_id, 'wd-1'))?.result).toBe('REFUNDED');
    expect(await refund(server, APPLE, 'wd-2', 'wd-n')).toBe(200);
    expect((await payment(server, a.user_id, 'wd-2'))?.result).toBe('GRANTED');
  });

  it('a SUBSCRIPTION notification of a withdrawn user writes the snapshot to the subscription record without grants or pending delta; EXPIRED keeps delete_at, ACTIVE moves delete_at of the record and binding', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'ws-1', token));
    await withdraw(a);
    const removed_at = (await payment(server, a.user_id, 'ws-1'))?.delete_at;
    expect(removed_at).toBe((START + RETENTION_MS).toString());
    testing.set_time(server, START + DAY);
    expect(await notify(server, APPLE, 'ws-1', { state: 'EXPIRED', ends_at: (START + DAY).toString(), auto_renew: false }, 'ws-n1')).toBe(200);
    let sub = (await exported_rows(server, a.user_id, 'iap_subscription'))[0];
    expect([sub?.state, sub?.ends_at, sub?.auto_renew, sub?.delete_at]).toEqual(['SUBSCRIPTION_STATE_EXPIRED', (START + DAY).toString(), false, removed_at]);
    expect(await notify(server, APPLE, 'ws-1', { state: 'ACTIVE', ends_at: (START + 90n * DAY).toString() }, 'ws-n1')).toBe(200);
    expect((await exported_rows(server, a.user_id, 'iap_subscription'))[0]?.state).toBe('SUBSCRIPTION_STATE_EXPIRED');
    testing.set_time(server, START + 2n * DAY);
    expect(await notify(server, APPLE, 'ws-1', { state: 'ACTIVE', latest_transaction_id: 'ws-2', ends_at: (START + 40n * DAY).toString() }, 'ws-n2')).toBe(200);
    sub = (await exported_rows(server, a.user_id, 'iap_subscription'))[0];
    const moved = (START + 2n * DAY + RETENTION_MS).toString();
    expect([sub?.state, sub?.ends_at, sub?.delete_at]).toEqual(['SUBSCRIPTION_STATE_ACTIVE', (START + 40n * DAY).toString(), moved]);
    expect((await exported_rows(server, a.user_id, 'iap_binding'))[0]?.delete_at).toBe(moved);
    expect(await payment(server, a.user_id, 'ws-2')).toBeUndefined();
    expect(await testing.read_user_state(server, a.user_id)).toEqual([]);
  });

  it('the REFUND of a Subscription store transaction looks up the subscription before claim_notify and applies it; a failed lookup is HTTP 500 and the records stay', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'sr-1', token));
    const fake = fake_store(server);
    fake.set_failure('lookup_subscription', 'timeout');
    expect(await refund(server, APPLE, 'sr-1', 'sr-n')).toBe(500);
    expect((await payment(server, a.user_id, 'sr-1'))?.result).toBe('GRANTED');
    expect((await subscription_row(server, a.user_id, '[iap_vip]'))?.state).toBe(State.SUBSCRIPTION_STATE_ACTIVE);
    fake.set_failure('lookup_subscription', null);
    fake.set_result('lookup_subscription', { state: 'REVOKED', ends_at: START.toString(), auto_renew: false });
    expect(await refund(server, APPLE, 'sr-1', 'sr-n')).toBe(200);
    expect((await payment(server, a.user_id, 'sr-1'))?.result).toBe('REFUNDED');
    expect((await subscription_row(server, a.user_id, '[iap_vip]'))?.state).toBe(State.SUBSCRIPTION_STATE_REVOKED);
    const calls = fake.calls().map((c) => [c.operation, c.input.original_transaction_id]);
    expect(calls.filter(([op]) => op === 'lookup_subscription').at(-1)).toEqual(['lookup_subscription', 'sr-1']);
  });

  it('the default revoke_iap of a refund is an ItemChange with source IapRefund and ref the transaction ID; revoke_iap gets reason refund for a refund and for revoke_test_grant', async () => {
    const reasons: string[] = [];
    const server = await start({ register: register_hooks({ revoke_iap: (_c: unknown, _p: number, _t: string, reason: string) => void reasons.push(reason) }) });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'hr-1', token));
    await verify(a, APPLE, receipt('gems_apple', 'hr-2', token));
    expect(await refund(server, APPLE, 'hr-1')).toBe(200);
    const revoked = await testing.send_admin(server, 'revoke_test_grant', { operation_id: 'op-hr', user_id: a.user_id.toString(), store: 'APPLE', transaction_id: 'hr-2' });
    expect(revoked.status).toBe(200);
    expect(reasons).toEqual(['refund', 'refund']);

    const plain = await start_default_revoke();
    const b = await testing.login(plain, 'b');
    const token_b = await account_token(b);
    await verify(b, APPLE, receipt('gems_apple', 'hr-3', token_b));
    expect(await refund(plain, APPLE, 'hr-3')).toBe(200);
    expect(item_changes(await next_response(b)).map((c) => [c.source, c.ref])).toEqual([[IAP_REFUND, 'hr-3']]);
  });

  it('a REFUND of a store transaction granted by an [iap_grant_mail] mail cancels the unclaimed mail and revoke_iap gets an empty list; after the mail is claimed, the REFUND keeps the mail and revoke_iap gets reward', async () => {
    const lists: number[][] = [];
    const server = await start({ register: register_hooks({ revoke_iap: (_c: unknown, _p: number, _t: string, _r: string, items: CoreContract.ItemAmount[]) => void lists.push(items.map((i) => Number(i.amount))) }) });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await set_balance(server, a.user_id, CAPPED(), 100n);
    await verify(a, APPLE, receipt('capped_apple', 'cm-1', token));
    expect(await mails(server, a.user_id)).toHaveLength(1);
    expect(await refund(server, APPLE, 'cm-1')).toBe(200);
    expect(await mails(server, a.user_id)).toHaveLength(0);
    expect(await balance(server, a.user_id, CAPPED())).toBe(100n);
    expect(lists).toEqual([[]]);

    await verify(a, APPLE, receipt('capped_apple', 'cm-2', token));
    const mail = (await mails(server, a.user_id))[0];
    await set_balance(server, a.user_id, CAPPED(), 0n);
    const claim = new CoreContract.ClaimMailRequest();
    claim.mail_id = mail?.id ?? 0n;
    expect((await testing.send(a, 'core/ClaimMail', claim)).envelope.error ?? null).toBeNull();
    expect(await balance(server, a.user_id, CAPPED())).toBe(100n);
    expect(await refund(server, APPLE, 'cm-2')).toBe(200);
    expect(lists.at(-1)).toEqual([100]);
  });

  it('two REFUND notifications of the same GRANTED store transaction with other notification IDs at once are both HTTP 200, and revoke, purchase count and core_iap_refunded happen once', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'cc-1', token));
    await verify(a, APPLE, receipt('gems_apple', 'cc-0', token));
    const results = await Promise.all([refund(server, APPLE, 'cc-1', 'n-a'), refund(server, APPLE, 'cc-1', 'n-b')]);
    expect(results).toEqual([200, 200]);
    expect(await balance(server, a.user_id)).toBe(100n);
    expect(await purchase_count_of(server, a.user_id, '[iap_gems]')).toBe(1);
    expect(await core_events(server, a.user_id, 'core_iap_refunded')).toHaveLength(1);
  });

  it('revoke_test_grant and the REFUND notification of the same store transaction at once revoke once', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'rt-1', token));
    const [admin, notified] = await Promise.all([
      testing.send_admin(server, 'revoke_test_grant', { operation_id: 'op-rt', user_id: a.user_id.toString(), store: 'APPLE', transaction_id: 'rt-1' }),
      refund(server, APPLE, 'rt-1', 'rt-n'),
    ]);
    expect(notified).toBe(200);
    expect([200, 409]).toContain(admin.status);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect(await core_events(server, a.user_id, 'core_iap_refunded')).toHaveLength(1);
    const again = await testing.send_admin(server, 'revoke_test_grant', { operation_id: 'op-rt-2', user_id: a.user_id.toString(), store: 'APPLE', transaction_id: 'rt-1' });
    expect(again.status).toBe(409);
  });

  it('a REFUND notification that read the NonConsumable record of B before an ownership transfer to A committed is HTTP 500 and changes nothing; the same notification again revokes from A', async () => {
    const race = notify_race();
    const first = handle_notify(race.c, race.request);
    await race.waiting();
    // The ownership transfer to A commits between the notification's read and its record recheck.
    race.payments.set('race-1', { ...race.row('race-1'), user_id: A, transfer_count: 1 });
    race.open();
    expect((await first).status).toBe(500);
    expect(race.opened).toEqual([B]);
    expect(race.claims).toEqual([]);
    expect(race.revokes).toEqual([]);
    expect(race.cancelled).toEqual([]);
    expect(race.counts).toEqual([]);
    expect(race.row('race-1')).toMatchObject({ user_id: A, result: 'GRANTED', transfer_count: 1 });
    const again = handle_notify(race.c, race.request);
    await race.waiting();
    race.open();
    expect((await again).status).toBe(200);
    expect(race.opened).toEqual([B, A]);
    expect(race.claims).toEqual(['race-n']);
    expect(race.cancelled).toEqual([[A, 'iap:IAP_STORE_APPLE:race-1:t1']]);
    expect(race.revokes).toEqual([[A, 'refund', [[GEM(), 50n]]]]);
    expect(race.counts).toEqual([[A, 0]]);
    expect(race.row('race-1')).toMatchObject({ user_id: A, result: 'REFUNDED' });
  });

  it('a SUBSCRIPTION notification that read the record of B before an ownership transfer to A committed is HTTP 500 and B stays; the same notification again updates A', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    await verify(b, APPLE, receipt('vip_apple', 'sx-1', token_b));
    const b_before = await subscription_row(server, b.user_id, '[iap_vip]');
    const fake = fake_store(server);
    const arrived = async (n: number): Promise<void> => {
      while (fake.calls().length < n) await new Promise((resolve) => setTimeout(resolve, 5));
    };
    const snapshot = { state: 'ACTIVE', ends_at: (START + 20n * DAY).toString() };
    const before = fake.calls().length;
    fake.hold(true);
    // The transfer waits in its subscription status lookup, after its verification.
    const transferred = recover(a, APPLE, receipt('vip_apple', 'sx-1', token_b));
    await arrived(before + 1);
    fake.release(1);
    await arrived(before + 2);
    // The notification reads the record of B, then waits in its lookup behind the transfer.
    const notified = notify(server, APPLE, 'sx-1', snapshot, 'sx-n');
    await arrived(before + 3);
    fake.release(1);
    expect(status_of(await transferred)).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    fake.hold(false);
    expect(await notified).toBe(500);
    await testing.wait_background(server);
    expect(await subscription_row(server, a.user_id, '[iap_vip]')).not.toBeNull();
    expect(b_before).not.toBeNull();
    fake.set_result('lookup_subscription', snapshot);
    expect(await notify(server, APPLE, 'sx-1', null, 'sx-n')).toBe(200);
    expect((await subscription_row(server, a.user_id, '[iap_vip]'))?.ends_at).toBe(START + 20n * DAY);
  });

  it('the record recheck of a Subscription REFUND locks the payment row, the snapshot latest transaction row and then the binding row, the order of grant order 4', async () => {
    const locks: string[] = [];
    let recording = false;
    const server = await start();
    // `iap` calls the `storage` module object; content `register(core)` gets only its member `content`.
    const storage = storage_module(server);
    const original = storage.lock_game_row.bind(storage);
    storage.lock_game_row = (ctx_or_tx, table, key) => {
      if (recording && (table === 'iap_payment' || table === 'iap_binding')) locks.push(`${table}:${key.join(':')}`);
      return original(ctx_or_tx, table, key);
    };
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'lk-1', token));
    expect(await notify(server, APPLE, 'lk-1', { state: 'ACTIVE', latest_transaction_id: 'lk-2', ends_at: (START + 60n * DAY).toString() }, 'lk-n1')).toBe(200);
    expect((await payment(server, a.user_id, 'lk-2'))?.result).toBe('GRANTED');
    fake_store(server).set_result('lookup_subscription', { state: 'ACTIVE', latest_transaction_id: 'lk-2', ends_at: (START + 60n * DAY).toString() });
    recording = true;
    expect(await refund(server, APPLE, 'lk-1', 'lk-n2')).toBe(200);
    recording = false;
    expect(locks.slice(0, 3)).toEqual(['iap_payment:IAP_STORE_APPLE:lk-1', 'iap_payment:IAP_STORE_APPLE:lk-2', 'iap_binding:IAP_STORE_APPLE:lk-1']);
    expect((await payment(server, a.user_id, 'lk-1'))?.result).toBe('REFUNDED');
  });

  it('the record recheck of revoke_test_grant locks the payment row and then the binding row of the reread original transaction ID, the order of grant order 4', async () => {
    const locks: string[] = [];
    let recording = false;
    const server = await start();
    const storage = storage_module(server);
    const original = storage.lock_game_row.bind(storage);
    storage.lock_game_row = (ctx_or_tx, table, key) => {
      if (recording && (table === 'iap_payment' || table === 'iap_binding')) locks.push(`${table}:${key.join(':')}`);
      return original(ctx_or_tx, table, key);
    };
    const a = await testing.login(server, 'a');
    await verify(a, APPLE, receipt('vip_apple', 'lr-1', await account_token(a), 'lr-0'));
    recording = true;
    const revoked = await testing.send_admin(server, 'revoke_test_grant', { operation_id: 'op-lr', user_id: a.user_id.toString(), store: 'APPLE', transaction_id: 'lr-1' });
    recording = false;
    expect(revoked.status).toBe(200);
    expect(locks.slice(0, 2)).toEqual(['iap_payment:IAP_STORE_APPLE:lr-1', 'iap_binding:IAP_STORE_APPLE:lr-0']);
    expect((await payment(server, a.user_id, 'lr-1'))?.result).toBe('REFUNDED');
    expect((await subscription_row(server, a.user_id, '[iap_vip]'))?.state).toBe(State.SUBSCRIPTION_STATE_REVOKED);
  });

  it('OTHER, a missing record and a REFUND of a store transaction that is not GRANTED are HTTP 200 without processing', async () => {
    const server = await start();
    const send = own_notify_key(server);
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const b = await testing.login(server, 'b');
    expect(status_of(await verify(b, APPLE, receipt('vip_apple', 'np-vip', await account_token(b))))).toBe(Status.PURCHASE_STATUS_GRANTED);
    const fake = fake_store(server);
    fake.set_result('verify', 'INVALID');
    await verify(a, APPLE, receipt('gems_apple', 'np-invalid', token));
    fake.set_result('verify', 'VALID');
    await verify(a, APPLE, receipt('gems_apple', 'np-refunded', token));
    expect(await send(APPLE, { notification_id: 'np-setup', kind: 'REFUND', transaction_id: 'np-refunded' })).toBe(200);
    for (const name of ['np-1', 'np-2', 'np-3', 'np-4', 'np-5']) await verify(a, APPLE, receipt('gems_apple', name, token));
    const before = { records: (await list_payments(server, a.user_id)).payments, balance: await balance(server, a.user_id), purchase: await purchase_row(server, a.user_id, '[iap_gems]') };
    expect(before.balance).toBe(500n);
    expect(before.records.find((p) => p.transaction_id === 'np-invalid')?.result).toBe('INVALID');
    expect(before.records.find((p) => p.transaction_id === 'np-refunded')?.result).toBe('REFUNDED');
    // The OTHER value is the original transaction ID of B's subscription record, so processing it as SUBSCRIPTION would claim it.
    const b_before = { record: await exported_rows(server, b.user_id, 'iap_subscription'), state: await subscription_row(server, b.user_id, '[iap_vip]') };
    expect(b_before.record.find((row) => row['original_transaction_id'] === 'np-vip')).toBeDefined();
    const ignored = [
      { notification_id: 'n-other', kind: 'OTHER', transaction_id: 'np-vip' },
      { notification_id: 'n-missing-refund', kind: 'REFUND', transaction_id: 'nothing' },
      { notification_id: 'n-missing-subscription', kind: 'SUBSCRIPTION', transaction_id: 'nothing' },
      { notification_id: 'n-invalid', kind: 'REFUND', transaction_id: 'np-invalid' },
      { notification_id: 'n-refunded', kind: 'REFUND', transaction_id: 'np-refunded' },
    ];
    for (const json of ignored) expect(await send(APPLE, json)).toBe(200);
    expect((await list_payments(server, a.user_id)).payments).toEqual(before.records);
    expect(await balance(server, a.user_id)).toBe(500n);
    expect(await purchase_row(server, a.user_id, '[iap_gems]')).toEqual(before.purchase);
    expect(await core_events(server, a.user_id, 'core_iap_refunded')).toHaveLength(1);
    expect(await exported_rows(server, b.user_id, 'iap_subscription')).toEqual(b_before.record);
    expect(await subscription_row(server, b.user_id, '[iap_vip]')).toEqual(b_before.state);
    // No notification ID above was claimed: each one is processed when it refunds a GRANTED store transaction.
    for (const [i, json] of ignored.entries()) expect(await send(APPLE, { notification_id: json.notification_id, kind: 'REFUND', transaction_id: `np-${String(i + 1)}` })).toBe(200);
    for (const name of ['np-1', 'np-2', 'np-3', 'np-4', 'np-5']) expect((await payment(server, a.user_id, name))?.result).toBe('REFUNDED');
    expect(await balance(server, a.user_id)).toBe(0n);
  });

  it('the REFUND of a withdrawn user changes only the payment record: no revoke, no purchase count change, no audit log of a revoke', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'wm-1', token));
    await withdraw(a);
    expect(await refund(server, APPLE, 'wm-1')).toBe(200);
    expect((await payment(server, a.user_id, 'wm-1'))?.result).toBe('REFUNDED');
    expect(await logs_with_reason(server, 'audit', 'iap_refund')).toHaveLength(0);
    expect(await core_events(server, a.user_id, 'core_iap_refunded')).toHaveLength(0);
  });

  it('the REFUND of a withdrawn user whose Subscription moved to another user by ownership transfer marks the payment record REFUNDED and, after the commit, applies the snapshot to that user\'s subscription record and SubscriptionUserState', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const data = receipt('vip_apple', 'wt-1', await account_token(b));
    expect(status_of(await verify(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    await testing.wait_background(server);
    const a_state = await subscription_row(server, a.user_id, '[iap_vip]');
    expect(a_state?.state).toBe(State.SUBSCRIPTION_STATE_ACTIVE);
    const a_record = (await exported_rows(server, a.user_id, 'iap_subscription')).find((row) => row['original_transaction_id'] === 'wt-1');
    expect(a_record).toBeDefined();
    await withdraw(b);
    fake_store(server).set_result('lookup_subscription', { latest_transaction_id: 'wt-1', state: 'REVOKED' });
    expect(await refund(server, APPLE, 'wt-1')).toBe(200);
    await testing.wait_background(server);
    expect((await payment(server, b.user_id, 'wt-1'))?.result).toBe('REFUNDED');
    expect((await exported_rows(server, a.user_id, 'iap_subscription')).find((row) => row['original_transaction_id'] === 'wt-1')).toMatchObject({ user_id: a_record?.['user_id'], state: 'SUBSCRIPTION_STATE_REVOKED' });
    expect((await subscription_row(server, a.user_id, '[iap_vip]'))?.state).toBe(State.SUBSCRIPTION_STATE_REVOKED);
    expect(testing.read_logs(server, 'error').filter((l: Record<string, unknown>) => String(l.message).includes('of another user'))).toHaveLength(0);
  });
});
