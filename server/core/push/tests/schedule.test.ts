/** `push` `### schedule`: `queue_push`, `cancel_push`, the admin operations, and the server start checks. */
import { PG_LOCK_SQL, lock_holder, stop_all as stop_lock_holders } from '../../storage/tests/helpers.ts';
import type { HolderResult } from '../../storage/tests/lock_holder.ts';
import { lock_key } from '../../storage/tx.ts';
import {
  GAME_ERROR_CORE_TEST, HOUR, POLL_MS, START_AT, admin, advance, cancel, db_target, device, logs, message, new_user, queue, record, records,
  run_core_test, schedule, sends_to, start, stop_all, type TestServer, type TestSession,
} from './helpers.ts';

afterEach(async () => {
  stop_lock_holders();
  await stop_all();
});

const scheduled = (rows: Record<string, unknown>[]): Record<string, unknown>[] => rows.filter((r) => r.status === 'SCHEDULED');

describe('queue_push', () => {
  it('the push ID queue_push returns is the push_id of the stored record', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:id' });
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]', after_ms: 1000n });
    expect(push_id).toBeGreaterThan(0n);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({
      push_id, status: 'SCHEDULED', source: 'handler', target_user_id: d.user_id, message_id: BigInt(message('[push_plain]')),
    }));
  });

  it('queue_push of a request whose handler returns a GameError is not scheduled', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:rollback' });
    const { code, value } = await run_core_test(d.session, (ctx, push) => {
      const push_id = push.queue_push(ctx, d.user_id, message('[push_plain]'), [], ctx.request_time, '');
      return push_id > 0n ? GAME_ERROR_CORE_TEST : 0n;
    });
    expect(code).toBe(GAME_ERROR_CORE_TEST);
    expect(value).toBe(GAME_ERROR_CORE_TEST);
    expect(await records(server)).toEqual([]);
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:rollback')).toEqual([]);
  });

  it('an unknown message, args whose names differ, and a send_at out of range are 0 and leave no record', async () => {
    const server = await start();
    const session = await new_user(server);
    const user = session.user_id;
    const { code, value } = await run_core_test(session, (ctx, push) => {
      const now = ctx.request_time;
      const info = message('[push_info]');
      const name = { name: 'name', text_value: 'Sam' };
      const count = { name: 'count', int_value: 3n };
      return [
        push.queue_push(ctx, user, 987_654, [], now, ''),
        push.queue_push(ctx, user, info, [name], now, ''),
        push.queue_push(ctx, user, info, [name, count, { name: 'extra', int_value: 1n }], now, ''),
        push.queue_push(ctx, user, info, [name, count, count], now, ''),
        push.queue_push(ctx, user, info, [name, count], now - 1n, ''),
        push.queue_push(ctx, user, info, [name, count], now + 2_592_000_001n, ''),
        push.queue_push(ctx, user, info, [name, count], now + 2_592_000_000n, ''),
      ];
    });
    expect(code).toBe(0);
    expect(value.slice(0, 6)).toEqual([0n, 0n, 0n, 0n, 0n, 0n]);
    expect(value[6]).toBeGreaterThan(0n);
    expect(await records(server)).toHaveLength(1);
    expect(logs(server, 'error').filter((l) => l.message === 'queue_push is not scheduled')).toHaveLength(6);
  });

  it('a PushArg kind the formatter does not take is 0 and leaves no record; schedule_push is bad_request', async () => {
    const server = await start();
    const session = await new_user(server);
    const args = [{ name: 'name', text_value: 'Sam' }, { name: 'count', text_value: '5' }];
    expect(await queue(session, session.user_id, { message: '[push_info]', args })).toBe(0n);
    const reply = await admin(server, 'schedule_push', {
      operation_id: 'kind', message_id: message('[push_info]'), send_at: START_AT, target: { user_ids: [session.user_id] },
      args: [{ name: 'name', value: { text_value: 'Sam' } }, { name: 'count', value: { text_value: '5' } }],
    });
    expect(reply.status).toBe(400);
    expect(await records(server)).toEqual([]);
  });

  it('a compact string PushArg that is not a big integer is 0 and leaves no record', async () => {
    const server = await start();
    const session = await new_user(server);
    for (const text_value of ['12a', '007', '', '-0', '+5']) {
      expect(await queue(session, session.user_id, { message: '[push_compact]', args: [{ name: 'amount', text_value }] })).toBe(0n);
    }
    expect(await records(server)).toEqual([]);
    expect(await queue(session, session.user_id, { message: '[push_compact]', args: [{ name: 'amount', text_value: '123456789012345678901' }] })).toBeGreaterThan(0n);
    expect(await queue(session, session.user_id, { message: '[push_compact]', args: [{ name: 'amount', int_value: 5n }] })).toBeGreaterThan(0n);
  });

  it('a second queue_push with the same dedupe_key cancels the first, and the push goes once', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:dedupe' });
    const first = await queue(d.session, d.user_id, { message: '[push_plain]', after_ms: 1000n, dedupe_key: 'daily' });
    const second = await queue(d.session, d.user_id, { message: '[push_plain]', after_ms: 1000n, dedupe_key: 'daily' });
    expect((await record(server, first))?.status).toBe('CANCELED');
    expect((await record(server, second))?.status).toBe('SCHEDULED');
    await advance(server, POLL_MS);
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:dedupe').map((s) => s.payload.data.push_id)).toEqual([second.toString()]);
  });

  it('after cancel_push, the push does not go', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:cancel' });
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]', after_ms: 1000n, dedupe_key: 'later' });
    const other = await queue(d.session, d.user_id, { message: '[push_plain]', after_ms: 1000n, dedupe_key: 'other' });
    await cancel(d.session, d.user_id, 'later');
    expect((await record(server, push_id))?.status).toBe('CANCELED');
    await advance(server, POLL_MS);
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:cancel').map((s) => s.payload.data.push_id)).toEqual([other.toString()]);
  });

  it('a dedupe_key over push.maxDedupeKeyBytes is 0', async () => {
    const server = await start({ settings: { 'push.maxDedupeKeyBytes': 4 } });
    const session = await new_user(server);
    expect(await queue(session, session.user_id, { message: '[push_plain]', dedupe_key: 'abcd' })).toBeGreaterThan(0n);
    expect(await queue(session, session.user_id, { message: '[push_plain]', dedupe_key: 'abcde' })).toBe(0n);
  });

  /**
   * Another user's transaction, like one on another server instance: it holds what `queue_push` locks for the
   * target (on SQLite, the write transaction holds the whole database) and writes the record its own `queue_push`
   * would, then commits after `delay_ms` while this server's `queue_push` waits for the lock.
   */
  async function other_queue_push(server: TestServer, target: bigint, dedupe_key: string, delay_ms: number): Promise<{ committed: Promise<HolderResult> }> {
    const postgresql = server.shared.database.kind === 'postgresql';
    const holder = await lock_holder(db_target(server));
    await holder.ok(postgresql ? 'BEGIN' : 'BEGIN IMMEDIATE');
    if (postgresql) await holder.ok(PG_LOCK_SQL, [lock_key('push_target_lock', [target])]);
    await holder.ok(
      `INSERT INTO push_record (push_id, source, message_id, args, send_at, target, target_user_id, dedupe_key, status, device_count, sent_count,
         invalid_count, failed_count, consent_skipped_count, held_count, cursor_user_id, lease_owner, lease_until, created_at)
       VALUES ($1, 'handler', $2, '[]', $3, $4, $5, $6, 'SCHEDULED', 0, 0, 0, 0, 0, 0, 0, '', 0, $7)`,
      [7n, message('[push_plain]'), START_AT + HOUR, `{"user_ids":["${String(target)}"]}`, target, dedupe_key, START_AT],
    );
    return { committed: holder.run('COMMIT', [], delay_ms) };
  }

  it('two users\' transactions that queue_push to one target with one dedupe_key at once leave one SCHEDULED record of it', async () => {
    const server = await start();
    const a = await new_user(server);
    const target = (await new_user(server)).user_id;
    const { committed } = await other_queue_push(server, target, 'gift', 300);
    const ours = await queue(a, target, { message: '[push_plain]', after_ms: 60_000n, dedupe_key: 'gift' });
    expect(await committed).toEqual({ ok: true, rows: [] });
    expect(ours).toBeGreaterThan(0n);
    const of_target = scheduled(await records(server)).filter((r) => r.target_user_id === target && r.dedupe_key === 'gift');
    expect(of_target.map((r) => r.push_id)).toEqual([ours]);
    expect((await record(server, 7n))?.status).toBe('CANCELED');
  });

  it('with push.maxScheduledPerUser − 1 SCHEDULED records, of two concurrent queue_push one is scheduled and the other is 0', async () => {
    const server = await start();
    const a = await new_user(server);
    const target: TestSession = await new_user(server);
    for (let n = 0; n < 4; n++) expect(await queue(target, target.user_id, { message: '[push_plain]', after_ms: 60_000n })).toBeGreaterThan(0n);
    const { committed } = await other_queue_push(server, target.user_id, '', 300);
    const ours = await queue(a, target.user_id, { message: '[push_plain]', after_ms: 60_000n });
    expect(await committed).toEqual({ ok: true, rows: [] });
    expect(ours).toBe(0n);
    expect(scheduled(await records(server)).filter((r) => r.target_user_id === target.user_id)).toHaveLength(5);
    expect(logs(server, 'warn').filter((l) => l.message === 'queue_push is over the scheduled push limit of the user')).toHaveLength(1);
  });

  it('with push.maxScheduledPerUser SCHEDULED records, queue_push with the dedupe_key of one of them is 0 and that record stays', async () => {
    const server = await start({ settings: { 'push.maxScheduledPerUser': 1 } });
    const d = await device(server, { device_token: 'fake:limit-dedupe' });
    const first = await queue(d.session, d.user_id, { message: '[push_plain]', after_ms: 60_000n, dedupe_key: 'k' });
    expect(first).toBeGreaterThan(0n);
    expect(await queue(d.session, d.user_id, { message: '[push_plain]', after_ms: 60_000n, dedupe_key: 'k' })).toBe(0n);
    expect(scheduled(await records(server)).map((r) => r.push_id)).toEqual([first]);
    expect(logs(server, 'warn').filter((l) => l.message === 'queue_push is over the scheduled push limit of the user')).toHaveLength(1);
  });

  it('queue_push and cancel_push of one target in one transaction lock push_target_lock once each and go on', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:same-tx' });
    const { code, value } = await run_core_test(d.session, (ctx, push) => {
      const at = ctx.request_time + 1000n;
      const first = push.queue_push(ctx, d.user_id, message('[push_plain]'), [], at, 'k');
      push.cancel_push(ctx, d.user_id, 'k');
      return [first, push.queue_push(ctx, d.user_id, message('[push_plain]'), [], at, 'k')];
    });
    expect(code).toBe(0);
    expect(value.every((id) => id > 0n)).toBe(true);
    expect(scheduled(await records(server))).toHaveLength(1);
  });
});

describe('admin operations', () => {
  it('schedule_push makes an operator record; get_push and list_pushes read it', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:admin' });
    const send_at = START_AT + 1000n;
    const push_id = await schedule(server, {
      message_id: message('[push_info]'), send_at, target: { user_ids: [d.user_id] },
      args: [{ name: 'name', value: { text_value: 'Sam' } }, { name: 'count', value: { int_value: 2n } }],
    });
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ source: 'operator', status: 'SCHEDULED', target_user_id: d.user_id }));
    const got = await admin(server, 'get_push', { push_id });
    expect(got.status).toBe(200);
    expect(got.json).toEqual(expect.objectContaining({ push_id: push_id.toString(), status: 'SCHEDULED', send_at: send_at.toString(), target: { user_ids: [d.user_id.toString()] } }));
    expect(got.json).not.toHaveProperty('lease_owner');
    expect(got.json).not.toHaveProperty('expires_at');
    const listed = await admin(server, 'list_pushes', { from_at: send_at, to_at: send_at + 1n, limit: 10 });
    expect((listed.json as { pushes: { push_id: string }[] }).pushes.map((p) => p.push_id)).toEqual([push_id.toString()]);
    expect((await admin(server, 'get_push', { push_id: 12_345n })).status).toBe(404);
    await advance(server, POLL_MS);
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:admin').map((s) => s.payload.body)).toEqual(['2 gems arrived']);
  });

  it('schedule_push checks: send_at, user_ids count and active_within_ms out of range are bad_request', async () => {
    const server = await start({ settings: { 'push.maxTargetUserIds': 2 } });
    const base = { message_id: message('[push_plain]'), args: [] };
    const status = async (body: Record<string, unknown>): Promise<number> => (await admin(server, 'schedule_push', { operation_id: `op-${String(Math.random())}`, ...base, ...body })).status;
    expect(await status({ send_at: START_AT - 1n, target: { user_ids: [1n] } })).toBe(400);
    expect(await status({ send_at: START_AT, target: { user_ids: [] } })).toBe(400);
    expect(await status({ send_at: START_AT, target: { user_ids: [1n, 2n, 3n] } })).toBe(400);
    expect(await status({ send_at: START_AT, target: { filter: { platforms: [], languages: [], active_within_ms: -1n } } })).toBe(400);
    expect(await status({ message_id: 987_654, send_at: START_AT, target: { user_ids: [1n] } })).toBe(400);
    expect(await records(server)).toEqual([]);
    const two = await schedule(server, { ...base, send_at: START_AT, target: { user_ids: [1n, 2n] } });
    expect((await record(server, two))?.target_user_id).toBeNull();
    const all = await schedule(server, { ...base, send_at: START_AT, target: { filter: { platforms: [], languages: [], active_within_ms: 0n } } });
    expect((await record(server, all))?.target_user_id).toBeNull();
  });

  it('cancel_scheduled_push of a record that is not SCHEDULED is conflict', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:conflict' });
    const later = await queue(d.session, d.user_id, { message: '[push_plain]', after_ms: HOUR });
    const canceled = await admin(server, 'cancel_scheduled_push', { push_id: later });
    expect([canceled.status, canceled.json]).toEqual([200, {}]);
    expect((await record(server, later))?.status).toBe('CANCELED');
    expect((await admin(server, 'cancel_scheduled_push', { push_id: later })).status).toBe(409);
    const at_once = await queue(d.session, d.user_id, { message: '[push_plain]' });
    await advance(server, POLL_MS);
    expect((await record(server, at_once))?.status).toBe('SENT');
    expect((await admin(server, 'cancel_scheduled_push', { push_id: at_once })).status).toBe(409);
    expect((await admin(server, 'cancel_scheduled_push', { push_id: 12_345n })).status).toBe(404);
  });

  it('cancel_scheduled_push while a claim of another server instance turns the record SENDING is conflict, and the record is not canceled', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:claimed' });
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]', after_ms: HOUR });
    // Another server instance's claim: it holds the record row (on SQLite, the whole database) and commits SENDING later.
    const holder = await lock_holder(db_target(server));
    await holder.ok(server.shared.database.kind === 'postgresql' ? 'BEGIN' : 'BEGIN IMMEDIATE');
    await holder.ok(`UPDATE push_record SET status = 'SENDING', lease_owner = 'other', lease_until = $2 WHERE push_id = $1`, [push_id, START_AT + HOUR]);
    const committed = holder.run('COMMIT', [], 300);
    const canceled = await admin(server, 'cancel_scheduled_push', { push_id });
    expect(await committed).toEqual({ ok: true, rows: [] });
    expect(canceled.status).toBe(409);
    expect((await record(server, push_id))?.status).toBe('SENDING');
  });
});

describe('server start', () => {
  /** The reason of a failed `start_test_server`. */
  async function start_failure(options: Parameters<typeof start>[0]): Promise<string> {
    try {
      await start(options);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error('the test server started');
  }

  it('push.leaseMs not above push.retryMaxAttempts × (push.sendTimeoutMs + push.retryIntervalMs) fails server start', async () => {
    expect(await start_failure({ settings: { 'push.leaseMs': 6000 } })).toContain('push.leaseMs');
    await start({ settings: { 'push.leaseMs': 6001 } });
  });

  it('pushConsent.nightStartMinute equal to pushConsent.nightEndMinute fails server start', async () => {
    expect(await start_failure({ settings: { 'pushConsent.nightStartMinute': 480 } })).toContain('nightStartMinute');
  });

  it('an adapter that is not a push adapter name of its key fails server start', async () => {
    expect(await start_failure({ real: { 'push-fcm': 'push-apns' } })).toContain('adapters.push-fcm');
  });
});
