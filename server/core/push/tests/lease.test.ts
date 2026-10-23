/**
 * `push` `### send` lease and cursor with two server instances on one DB: one lease at a time, another instance
 * goes on from `cursor_user_id` after the lease ends, and an instance whose lease was taken stops.
 */
import { lock_holder, stop_all as stop_lock_holders } from '../../storage/tests/helpers.ts';
import {
  HOUR, LEASE_MS, POLL_MS, RETRY_MS, START_AT, advance, db_target, device, fake, held, logs, message, now, peer, queue, record, restart, schedule,
  sends_to, set_push_consent, start, stop_all, testing, until, type Device, type TestServer,
} from './helpers.ts';

afterEach(async () => {
  stop_lock_holders();
  await stop_all();
});

const ONE_PER_BATCH = { 'push.sendBatchSize': 1 };

/** Two devices, users in ID order. */
async function two_devices(server: TestServer): Promise<[Device, Device]> {
  return [await device(server, { device_token: 'fake:first' }), await device(server, { device_token: 'fake:second' })];
}

function push_to(server: TestServer, users: readonly bigint[]): Promise<bigint> {
  return schedule(server, { message_id: message('[push_plain]'), send_at: START_AT, target: { user_ids: users } });
}

/**
 * The server instance sends the first batch, then waits on a retry of the second batch when it stops: the test
 * server restarts on a new server instance, which takes the record once the lease has ended.
 */
async function stopped_mid_send(settings: Record<string, number>): Promise<{ server: TestServer; push_id: bigint; first: string; second: string }> {
  const server = await start({ settings: { ...ONE_PER_BATCH, ...settings } });
  const [first, second] = await two_devices(server);
  const push_id = await push_to(server, [first.user_id, second.user_id]);
  fake(server, 'push-fcm').set_result('send', { [second.token]: 'FAILED' });
  await advance(server, POLL_MS);
  expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENDING', cursor_user_id: first.user_id, sent_count: 1n }));
  await restart(server);
  fake(server, 'push-fcm').set_result('send', {});
  await advance(server, LEASE_MS);
  return { server, push_id, first: first.token, second: second.token };
}

describe('lease', () => {
  it('when the instance holding the lease stops mid-send, another instance goes on from cursor_user_id and does not send the finished batch again', async () => {
    const { server, push_id, first, second } = await stopped_mid_send({});
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENT', device_count: 2n, sent_count: 2n, failed_count: 0n }));
    expect(sends_to(server, first)).toHaveLength(1);
    expect(sends_to(server, second)).toHaveLength(2);
  });

  it('an instance that takes the lease of a record whose failed_count another instance wrote does not log push adapter failed again', async () => {
    const server = await start({ settings: ONE_PER_BATCH });
    const [first, second] = await two_devices(server);
    const push_id = await push_to(server, [first.user_id, second.user_id]);
    const adapter_failures = (): number => logs(server, 'error').filter((l) => l.message === 'push adapter failed' && l.push_id === push_id.toString()).length;
    fake(server, 'push-fcm').set_result('send', { [first.token]: 'FAILED', [second.token]: 'FAILED' });
    await advance(server, POLL_MS);
    await advance(server, RETRY_MS);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENDING', cursor_user_id: first.user_id, failed_count: 1n }));
    expect(sends_to(server, second.token)).toHaveLength(1);
    expect(adapter_failures()).toBe(1);
    await restart(server);
    fake(server, 'push-fcm').set_result('send', { [second.token]: 'FAILED' });
    await advance(server, LEASE_MS);
    await advance(server, RETRY_MS);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'FAILED', device_count: 2n, failed_count: 2n }));
    expect(sends_to(server, second.token)).toHaveLength(3);
    expect(adapter_failures()).toBe(1);
  });

  it('a SENDING record whose lease ended is sent to the end from cursor_user_id by another instance even when send_at is more than push.maxDelayMs ago', async () => {
    const { server, push_id, second } = await stopped_mid_send({ 'push.maxDelayMs': 1000 });
    const row = await record(server, push_id);
    expect(now(server) - (row?.send_at as bigint)).toBeGreaterThan(1000n);
    expect(row?.status).toBe('SENT');
    expect(sends_to(server, second)).toHaveLength(2);
  });

  it('two instances that take the lease of one record at once: one takes it, and the device gets the push once', async () => {
    const a = await start();
    const b = await peer(a);
    const d = await device(a, { device_token: 'fake:race' });
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]' });
    await advance(a, POLL_MS, b);
    expect(sends_to(a, 'fake:race')).toHaveLength(1);
    expect(await record(a, push_id)).toEqual(expect.objectContaining({ status: 'SENT', sent_count: 1n, device_count: 1n }));
  });

  it('after the lease ends and another instance takes it, the first instance does not write cursor_user_id and stops sending the record', async () => {
    const settings = { ...ONE_PER_BATCH, 'push.sendTimeoutMs': 500, 'push.retryMaxAttempts': 1, 'push.retryIntervalMs': 100 };
    const a = await start({ settings });
    const b = await peer(a);
    const [first, second] = await two_devices(a);
    const push_id = await push_to(a, [first.user_id, second.user_id]);
    const fcm = fake(a, 'push-fcm');
    fcm.set_failure('send', 'timeout');
    // The instance that took the lease waits on its first send for push.sendTimeoutMs of real time.
    testing.advance_time(a, POLL_MS);
    await until(() => sends_to(a, first.token).length === 1, 'the first send');
    fcm.set_failure('send', null);
    testing.advance_time(a, LEASE_MS);
    await until(async () => (await record(a, push_id))?.status === 'SENT', 'the record to be SENT');
    await testing.wait_background(a);
    await testing.wait_background(b);
    expect(await record(a, push_id)).toEqual(expect.objectContaining({ status: 'SENT', device_count: 2n, sent_count: 2n, failed_count: 0n, cursor_user_id: second.user_id }));
    expect(sends_to(a, first.token)).toHaveLength(2);
    expect(sends_to(a, second.token)).toHaveLength(1);
  });

  it('a lease another instance takes while this instance waits to take it: the write of this instance does not take it, and nothing is sent', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:taken' });
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]' });
    // The other instance's claim: the conditional write of the lease, committed while this instance's claim waits.
    const holder = await lock_holder(db_target(server));
    await holder.ok(server.shared.database.kind === 'postgresql' ? 'BEGIN' : 'BEGIN IMMEDIATE');
    await holder.ok(`UPDATE push_record SET status = 'SENDING', lease_owner = 'other', lease_until = $2 WHERE push_id = $1 AND lease_owner = ''`, [push_id, START_AT + HOUR]);
    const committed = holder.run('COMMIT', [], 300);
    await advance(server, POLL_MS);
    expect(await committed).toEqual({ ok: true, rows: [] });
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENDING', lease_owner: 'other', sent_count: 0n }));
    expect(sends_to(server, 'fake:taken')).toEqual([]);
  });

  it('a push_held row another instance takes first is not sent by this instance', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:held-taken', timezone_offset_ms: 16n * HOUR });
    await set_push_consent(d.session, true, false);
    const push_id = await queue(d.session, d.user_id, { message: '[push_ad]', args: [{ name: 'percent', int_value: 5n }] });
    await advance(server, POLL_MS);
    expect(await held(server)).toHaveLength(1);
    const holder = await lock_holder(db_target(server));
    await holder.ok(server.shared.database.kind === 'postgresql' ? 'BEGIN' : 'BEGIN IMMEDIATE');
    await holder.ok('DELETE FROM push_held WHERE push_id = $1 AND user_id = $2', [push_id, d.user_id]);
    const committed = holder.run('COMMIT', [], 300);
    await advance(server, 8n * HOUR);
    expect(await committed).toEqual({ ok: true, rows: [] });
    expect(sends_to(server, 'fake:held-taken')).toEqual([]);
    expect((await record(server, push_id))?.sent_count).toBe(0n);
  });
});
