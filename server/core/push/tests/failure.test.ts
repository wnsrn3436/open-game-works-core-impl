/**
 * `push` `### send` failures: a `FAILED` batch result or finish game transaction is written again within the lease,
 * a record whose message is not in the server build data ends `FAILED`, an adapter's failure reason is logged, and job
 * `push_send` does not log a failure after the module's `stop()` began.
 */
import { lock_holder, stop_all as stop_lock_holders } from '../../storage/tests/helpers.ts';
import {
  HOUR, LEASE_MS, POLL_MS, RETRY_MS, START_AT, advance, db_target, device, fail_statements, fake, fake_adapter, held, logs, message, push_module, queue,
  record, schedule, sends_to, set_push_consent, start, stop_all, testing, type Device, type TestServer,
} from './helpers.ts';

afterEach(async () => {
  stop_lock_holders();
  await stop_all();
});

const ONE_PER_BATCH = { 'push.sendBatchSize': 1 };
const BATCH_WRITE = /^UPDATE push_record SET cursor_user_id/;
const FINISH_WRITE = /^UPDATE push_record SET status = \$1, finished_at/;
/** A message ID value that no core test data `push_message` row has. */
const NO_MESSAGE = 2_000_000_000;

async function two_devices(server: TestServer): Promise<[Device, Device]> {
  return [await device(server, { device_token: 'fake:first' }), await device(server, { device_token: 'fake:second' })];
}

function push_to(server: TestServer, users: readonly bigint[], message_name = '[push_plain]'): Promise<bigint> {
  return schedule(server, { message_id: message(message_name), send_at: START_AT, target: { user_ids: users } });
}

function error_logs(server: TestServer, text: string): Record<string, unknown>[] {
  return logs(server, 'error').filter((l) => l.message === text);
}

/** The `error` logs of `push`: other modules' jobs may log their own at server start. */
function push_errors(server: TestServer): Record<string, unknown>[] {
  return logs(server, 'error').filter((l) => typeof l.message === 'string' && /^(push |job push_send )/.test(l.message));
}

/** Writes `push_record.message_id` as a data update between `queue_push` and the send would leave it. */
async function set_message_id(server: TestServer, push_id: bigint, message_id: number): Promise<void> {
  const holder = await lock_holder(db_target(server));
  await holder.ok('UPDATE push_record SET message_id = $2 WHERE push_id = $1', [push_id, message_id]);
}

describe('batch result and finish writes', () => {
  it('a batch write whose game transaction waits on a lock past storage.userLockWaitMs is FAILED, logged, and written again after push.retryIntervalMs; no device gets the push twice', async () => {
    const server = await start({ settings: { ...ONE_PER_BATCH, 'storage.userLockWaitMs': 300 } });
    const [first, second] = await two_devices(server);
    const push_id = await push_to(server, [first.user_id, second.user_id]);
    // Another transaction locks the record while the first batch is sent, so the batch write waits for it.
    const holder = await lock_holder(db_target(server));
    const adapter = fake_adapter(server, 'push-fcm');
    const send = adapter.send.bind(adapter);
    let locked = false;
    adapter.send = async (tokens, payload, signal) => {
      const results = await send(tokens, payload, signal);
      if (!locked && tokens.includes(first.token)) {
        locked = true;
        if (server.shared.database.kind === 'postgresql') {
          await holder.ok('BEGIN');
          await holder.ok('SELECT push_id FROM push_record WHERE push_id = $1 FOR UPDATE', [push_id]);
        } else {
          await holder.ok('BEGIN IMMEDIATE');
        }
      }
      return results;
    };
    await advance(server, POLL_MS);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENDING', cursor_user_id: 0n, device_count: 0n, sent_count: 0n }));
    expect(error_logs(server, 'push batch write failed').map((l) => [l.push_id, l.attempt, l.retry])).toEqual([[push_id.toString(), 1, true]]);
    await holder.ok('ROLLBACK');
    await advance(server, RETRY_MS);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENT', device_count: 2n, sent_count: 2n, cursor_user_id: second.user_id }));
    await advance(server, LEASE_MS);
    expect(sends_to(server, first.token)).toHaveLength(1);
    expect(sends_to(server, second.token)).toHaveLength(1);
    expect(error_logs(server, 'push batch write failed')).toHaveLength(1);
  });

  it('a batch write that is FAILED push.retryMaxAttempts times stops the record as on a lost lease: no next batch until the lease ends, then the next lease holder goes on from the cursor', async () => {
    const server = await start({ settings: ONE_PER_BATCH });
    const [first, second] = await two_devices(server);
    const push_id = await push_to(server, [first.user_id, second.user_id]);
    const failed = fail_statements(server, BATCH_WRITE, 2);
    await advance(server, POLL_MS);
    await advance(server, RETRY_MS);
    expect(failed()).toBe(2);
    expect(error_logs(server, 'push batch write failed').map((l) => [l.attempt, l.retry])).toEqual([[1, true], [2, false]]);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENDING', cursor_user_id: 0n, sent_count: 0n }));
    await advance(server, POLL_MS);
    expect(sends_to(server, second.token)).toEqual([]);
    expect(sends_to(server, first.token)).toHaveLength(1);
    await advance(server, LEASE_MS);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENT', device_count: 2n, sent_count: 2n }));
    expect(sends_to(server, second.token)).toHaveLength(1);
  });

  it('a FAILED batch write is not written again when clock_now + push.retryIntervalMs is not before lease_until', async () => {
    const server = await start({ settings: { ...ONE_PER_BATCH, 'push.retryMaxAttempts': 3 } });
    const [first, second] = await two_devices(server);
    const push_id = await push_to(server, [first.user_id, second.user_id]);
    // The lease is taken at START_AT + POLL_MS until LEASE_MS later. While the first batch is sent the clock moves
    // LEASE_MS − RETRY_MS on, so a retry after RETRY_MS would reach lease_until.
    const adapter = fake_adapter(server, 'push-fcm');
    const send = adapter.send.bind(adapter);
    adapter.send = async (tokens, payload, signal) => {
      const results = await send(tokens, payload, signal);
      if (tokens.includes(first.token)) testing.advance_time(server, LEASE_MS - RETRY_MS);
      return results;
    };
    const failed = fail_statements(server, BATCH_WRITE, 1);
    await advance(server, POLL_MS);
    expect(failed()).toBe(1);
    expect(error_logs(server, 'push batch write failed').map((l) => [l.attempt, l.retry])).toEqual([[1, false]]);
    await advance(server, RETRY_MS - 1n);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENDING', cursor_user_id: 0n }));
    expect(sends_to(server, second.token)).toEqual([]);
    await advance(server, 1n);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENT', device_count: 2n, sent_count: 2n }));
  });

  it('a FAILED finish write is logged and written again; the record ends once and each device got the push once', async () => {
    const server = await start({ settings: ONE_PER_BATCH });
    const [first, second] = await two_devices(server);
    const push_id = await push_to(server, [first.user_id, second.user_id]);
    const failed = fail_statements(server, FINISH_WRITE, 1);
    await advance(server, POLL_MS);
    expect(failed()).toBe(1);
    expect(error_logs(server, 'push finish write failed').map((l) => [l.attempt, l.retry])).toEqual([[1, true]]);
    expect((await record(server, push_id))?.status).toBe('SENDING');
    await advance(server, RETRY_MS);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENT', device_count: 2n, sent_count: 2n }));
    await advance(server, LEASE_MS);
    expect(sends_to(server, first.token)).toHaveLength(1);
    expect(sends_to(server, second.token)).toHaveLength(1);
    expect(logs(server).filter((l) => l.message === 'push sent')).toHaveLength(1);
  });

  it('a batch write FAILED on every attempt logs one error at the first failure and one when the send stops, not one per attempt', async () => {
    const server = await start({ settings: { ...ONE_PER_BATCH, 'push.retryMaxAttempts': 4, 'push.leaseMs': 20_000 } });
    const [first, second] = await two_devices(server);
    const push_id = await push_to(server, [first.user_id, second.user_id]);
    const failed = fail_statements(server, BATCH_WRITE, 4);
    await advance(server, POLL_MS);
    for (let i = 0; i < 3; i++) await advance(server, RETRY_MS);
    expect(failed()).toBe(4);
    expect(error_logs(server, 'push batch write failed').map((l) => [l.push_id, l.attempt, l.retry])).toEqual([[push_id.toString(), 1, true], [push_id.toString(), 4, false]]);
    expect(push_errors(server)).toHaveLength(2);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENDING', cursor_user_id: 0n }));
  });

  it('a batch write FAILED on all but the last attempt logs one error at the first failure only', async () => {
    const server = await start({ settings: { ...ONE_PER_BATCH, 'push.retryMaxAttempts': 4, 'push.leaseMs': 20_000 } });
    const [first, second] = await two_devices(server);
    const push_id = await push_to(server, [first.user_id, second.user_id]);
    const failed = fail_statements(server, BATCH_WRITE, 3);
    await advance(server, POLL_MS);
    for (let i = 0; i < 3; i++) await advance(server, RETRY_MS);
    expect(failed()).toBe(3);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENT', device_count: 2n, sent_count: 2n }));
    expect(error_logs(server, 'push batch write failed').map((l) => [l.attempt, l.retry])).toEqual([[1, true]]);
    expect(push_errors(server)).toHaveLength(1);
    expect(sends_to(server, first.token)).toHaveLength(1);
    expect(sends_to(server, second.token)).toHaveLength(1);
  });

  it('a finish write FAILED on every attempt logs one error at the first failure and one when the send stops', async () => {
    const server = await start({ settings: { 'push.retryMaxAttempts': 3 } });
    const d = await device(server, { device_token: 'fake:finish-stops' });
    const push_id = await push_to(server, [d.user_id]);
    const failed = fail_statements(server, FINISH_WRITE, 3);
    await advance(server, POLL_MS);
    for (let i = 0; i < 2; i++) await advance(server, RETRY_MS);
    expect(failed()).toBe(3);
    expect(error_logs(server, 'push finish write failed').map((l) => [l.attempt, l.retry])).toEqual([[1, true], [3, false]]);
    expect(push_errors(server)).toHaveLength(2);
    expect((await record(server, push_id))?.status).toBe('SENDING');
  });
});

describe('a message that is not in the server build data', () => {
  it('a due record whose message_id is not a push_message row is not sent and ends FAILED with one error log', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:no-message' });
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]' });
    await set_message_id(server, push_id, NO_MESSAGE);
    await advance(server, POLL_MS);
    await advance(server, POLL_MS);
    expect(sends_to(server, d.token)).toEqual([]);
    const row = await record(server, push_id);
    expect(row).toEqual(expect.objectContaining({ status: 'FAILED', finished_at: START_AT + POLL_MS, sent_count: 0n }));
    expect(row?.expires_at).toBe(START_AT + POLL_MS + 2_592_000_000n);
    expect(error_logs(server, 'push message is not in the server build data').map((l) => [l.push_id, l.message_id])).toEqual([[push_id.toString(), NO_MESSAGE]]);
    expect(error_logs(server, 'push text has an empty part')).toEqual([]);
  });

  it('a SENDING record taken again after its message went ends FAILED and its push_held rows are deleted without a send', async () => {
    const server = await start({ settings: ONE_PER_BATCH });
    const night = await device(server, { device_token: 'fake:held-night', timezone_offset_ms: 16n * HOUR });
    const day = await device(server, { device_token: 'fake:held-day' });
    for (const d of [night, day]) await set_push_consent(d.session, true, false);
    const id = await schedule(server, { message_id: message('[push_ad]'), args: [{ name: 'percent', value: { int_value: 5n } }], send_at: START_AT, target: { user_ids: [night.user_id, day.user_id] } });
    // The first batch holds the night device's push; the write of the second batch is FAILED on both attempts, so the
    // record stops SENDING after the first batch.
    fail_statements(server, BATCH_WRITE, 2, undefined, 1);
    await advance(server, POLL_MS);
    await advance(server, RETRY_MS);
    expect(await held(server)).toHaveLength(1);
    expect(await record(server, id)).toEqual(expect.objectContaining({ status: 'SENDING', cursor_user_id: night.user_id }));
    expect(sends_to(server, day.token)).toHaveLength(1);
    await set_message_id(server, id, NO_MESSAGE);
    await advance(server, LEASE_MS);
    expect(await record(server, id)).toEqual(expect.objectContaining({ status: 'FAILED', cursor_user_id: night.user_id }));
    expect(await held(server)).toEqual([]);
    expect(sends_to(server, day.token)).toHaveLength(1);
    await advance(server, 8n * HOUR);
    expect(sends_to(server, night.token)).toEqual([]);
    expect(error_logs(server, 'push message is not in the server build data')).toHaveLength(1);
  });

  it('a due push_held row of a SENDING record whose message went ends the record FAILED in that game transaction, with one error log for the record', async () => {
    const server = await start({ settings: ONE_PER_BATCH });
    const night = await device(server, { device_token: 'fake:due-night', timezone_offset_ms: 16n * HOUR });
    const day = await device(server, { device_token: 'fake:due-day' });
    for (const d of [night, day]) await set_push_consent(d.session, true, false);
    const id = await schedule(server, { message_id: message('[push_ad]'), args: [{ name: 'percent', value: { int_value: 5n } }], send_at: START_AT, target: { user_ids: [night.user_id, day.user_id] } });
    // The record stops SENDING after the first batch held the night device, and its lease runs on.
    fail_statements(server, BATCH_WRITE, 2, undefined, 1);
    await advance(server, POLL_MS);
    await advance(server, RETRY_MS);
    expect(await record(server, id)).toEqual(expect.objectContaining({ status: 'SENDING', cursor_user_id: night.user_id }));
    // The held row comes due while the lease holds, after a data update took the message away.
    const holder = await lock_holder(db_target(server));
    await holder.ok('UPDATE push_held SET send_at = $2 WHERE push_id = $1', [id, START_AT]);
    await set_message_id(server, id, NO_MESSAGE);
    await advance(server, POLL_MS);
    const ended = START_AT + 2n * POLL_MS + RETRY_MS;
    expect(await record(server, id)).toEqual(expect.objectContaining({ status: 'FAILED', finished_at: ended, expires_at: ended + 2_592_000_000n, lease_until: 0n }));
    expect(await held(server)).toEqual([]);
    await advance(server, LEASE_MS);
    await advance(server, 8n * HOUR);
    expect((await record(server, id))?.status).toBe('FAILED');
    expect(sends_to(server, night.token)).toEqual([]);
    expect(sends_to(server, day.token)).toHaveLength(1);
    expect(error_logs(server, 'push message is not in the server build data').map((l) => l.push_id)).toEqual([id.toString()]);
  });

  it('a batch write of the lease holder that adds a push_held row while the held rows are dropped: the record ends FAILED with no push_held row left and no send', async () => {
    const server = await start({ settings: ONE_PER_BATCH });
    const night = await device(server, { device_token: 'fake:race-night', timezone_offset_ms: 16n * HOUR });
    const day = await device(server, { device_token: 'fake:race-day' });
    for (const d of [night, day]) await set_push_consent(d.session, true, false);
    const id = await schedule(server, { message_id: message('[push_ad]'), args: [{ name: 'percent', value: { int_value: 5n } }], send_at: START_AT, target: { user_ids: [night.user_id, day.user_id] } });
    fail_statements(server, BATCH_WRITE, 2, undefined, 1);
    await advance(server, POLL_MS);
    await advance(server, RETRY_MS);
    expect(await record(server, id)).toEqual(expect.objectContaining({ status: 'SENDING', cursor_user_id: night.user_id }));
    const holder = await lock_holder(db_target(server));
    await holder.ok('UPDATE push_held SET send_at = $2 WHERE push_id = $1', [id, START_AT]);
    await set_message_id(server, id, NO_MESSAGE);
    // Another instance that still has the message is in the batch write of its lease: the record row is updated and a
    // push_held row added, not committed yet, when the job drops the due held rows; it commits while the drop waits.
    const later = START_AT + 4n * HOUR;
    await holder.ok('BEGIN');
    await holder.ok(`UPDATE push_record SET held_count = held_count + 1 WHERE push_id = $1 AND status = 'SENDING'`, [id]);
    await holder.ok('INSERT INTO push_held (push_id, user_id, send_at, expires_at) VALUES ($1, $2, $3, $4)', [id, day.user_id, later, later + HOUR]);
    const commit = holder.run('COMMIT', [], 300);
    await advance(server, POLL_MS);
    expect((await commit).ok).toBe(true);
    expect((await record(server, id))?.status).toBe('FAILED');
    expect(await held(server)).toEqual([]);
    await advance(server, LEASE_MS);
    await advance(server, 8n * HOUR);
    expect(sends_to(server, night.token)).toEqual([]);
    expect(sends_to(server, day.token)).toHaveLength(1);
    expect(error_logs(server, 'push message is not in the server build data').map((l) => l.push_id)).toEqual([id.toString()]);
  });

  it('the push_held rows of a sent record whose message went are deleted without a send when they are due, with one error log for the record', async () => {
    const server = await start({ settings: ONE_PER_BATCH });
    const nights = [
      await device(server, { device_token: 'fake:gone-0', timezone_offset_ms: 16n * HOUR }),
      await device(server, { device_token: 'fake:gone-1', timezone_offset_ms: 16n * HOUR }),
    ];
    for (const d of nights) await set_push_consent(d.session, true, false);
    const push_id = await schedule(server, {
      message_id: message('[push_ad]'), args: [{ name: 'percent', value: { int_value: 5n } }], send_at: START_AT, target: { user_ids: nights.map((d) => d.user_id) },
    });
    await advance(server, POLL_MS);
    expect(await held(server)).toHaveLength(2);
    const sent = await record(server, push_id);
    expect(sent?.status).toBe('SENT');
    await set_message_id(server, push_id, NO_MESSAGE);
    await advance(server, 8n * HOUR);
    expect(await held(server)).toEqual([]);
    expect(push_errors(server).map((l) => l.message)).toEqual(['push message is not in the server build data']);
    expect(fake(server, 'push-fcm').calls()).toEqual([]);
    // The ended record keeps its status and end time.
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENT', finished_at: sent?.finished_at, expires_at: sent?.expires_at, sent_count: 0n, failed_count: 0n }));
    expect(error_logs(server, 'push message is not in the server build data').map((l) => l.push_id)).toEqual([push_id.toString()]);
  });
});

describe('adapter failure reason', () => {
  it('the first failure log has the reason the adapter gave with FAILED, without the device token', async () => {
    const server = await start({ settings: { 'push.retryMaxAttempts': 1 } });
    const d = await device(server, { device_token: 'fake:reason-77' });
    fake_adapter(server, 'push-fcm').send = (tokens) => Promise.resolve(tokens.map((t) => ({ result: 'FAILED' as const, reason: `HTTP 503 UNAVAILABLE for ${t}` })));
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]' });
    await advance(server, POLL_MS);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'FAILED', failed_count: 1n }));
    expect(error_logs(server, 'push adapter failed').map((l) => l.reason)).toEqual(['HTTP 503 UNAVAILABLE for [redacted]']);
    expect(JSON.stringify(logs(server))).not.toContain('reason-77');
  });
});

describe('job push_send after stop', () => {
  it('a job failure that comes after push stop() began is not logged; the same failure before stop is', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:stopping' });
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]' });
    // Every batch write throws an error that is not a DB failure, as a transaction under a closed DB connection does.
    let stop = false;
    fail_statements(server, BATCH_WRITE, Number.MAX_SAFE_INTEGER, () => {
      if (stop) push_module(server).stop();
      throw new Error('the DB connection is closed');
    });
    await advance(server, POLL_MS);
    expect(error_logs(server, 'job push_send failed')).toHaveLength(1);
    expect((await record(server, push_id))?.status).toBe('SENDING');
    // Push stop() begins under the batch write of the next lease holder, which then throws.
    stop = true;
    await advance(server, LEASE_MS);
    expect(sends_to(server, d.token)).toHaveLength(2);
    expect(push_errors(server).map((l) => [l.message, l.error])).toEqual([['job push_send failed', 'the DB connection is closed']]);
  });

  it('a FAILED batch write after push stop() began is not logged and not written again', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:stopped-write' });
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]' });
    const failed = fail_statements(server, BATCH_WRITE, 2, () => {
      push_module(server).stop();
    });
    await advance(server, POLL_MS);
    await advance(server, RETRY_MS);
    expect(failed()).toBe(1);
    expect(push_errors(server)).toEqual([]);
    expect((await record(server, push_id))?.status).toBe('SENDING');
  });
});
