/** `push` `### device registration`: `RegisterPushToken`, session checks at send, consent, `remove_user`. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { lock_holder, stop_all as stop_lock_holders } from '../../storage/tests/helpers.ts';
import {
  INVALID_REQUEST, POLL_MS, START_AT, admin, advance, call, data, db_target, device, devices, login_again, message, new_user, queue, record, records,
  register, schedule, sends_to, set_push_consent, start, stop_all,
} from './helpers.ts';

afterEach(async () => {
  stop_lock_holders();
  await stop_all();
});

const pairs = async (server: Awaited<ReturnType<typeof start>>): Promise<[unknown, unknown][]> => (await devices(server)).map((r) => [r.user_id, r.device_token]);

describe('RegisterPushToken', () => {
  it('a user who registers another device_token has one row, the new token', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:old' });
    expect(await register(d.session, { device_token: 'fake:new' })).toBe(0);
    expect(await pairs(server)).toEqual([[d.user_id, 'fake:new']]);
  });

  it('two users who register one device_token at once leave one row of that token, of one of the two', async () => {
    const server = await start();
    const a = await new_user(server);
    const b = await new_user(server);
    // User b's RegisterPushToken in a transaction of another server instance, committed while a's waits.
    const holder = await lock_holder(db_target(server));
    await holder.ok(server.shared.database.kind === 'postgresql' ? 'BEGIN' : 'BEGIN IMMEDIATE');
    await holder.ok(
      `INSERT INTO push_device (user_id, device_token, session_id, provider, language, timezone_offset_ms, ad_allowed, night_allowed, updated_at)
       VALUES ($1, 'fake:shared', 's', 'fcm', 'en', 0, false, false, $2)`,
      [b.user_id, START_AT],
    );
    const committed = holder.run('COMMIT', [], 300);
    expect(await register(a, { device_token: 'fake:shared' })).toBe(0);
    expect(await committed).toEqual({ ok: true, rows: [] });
    const shared = (await devices(server)).filter((r) => r.device_token === 'fake:shared');
    expect(shared).toHaveLength(1);
    expect([a.user_id, b.user_id]).toContain(shared[0]?.user_id);
  });

  it('two users who register one device_token one after the other leave one row, of the later', async () => {
    const server = await start();
    const a = await new_user(server);
    const b = await new_user(server);
    expect(await register(a, { device_token: 'fake:shared' })).toBe(0);
    expect(await register(b, { device_token: 'fake:shared' })).toBe(0);
    expect(await pairs(server)).toEqual([[b.user_id, 'fake:shared']]);
  });

  it('another user who registers the same device_token takes the device: the previous user\'s push does not go to it', async () => {
    const server = await start();
    const a = await device(server, { device_token: 'fake:handed-over' });
    const b = await device(server, { device_token: 'fake:handed-over' });
    expect((await devices(server)).map((r) => r.user_id)).toEqual([b.user_id]);
    const for_a = await queue(a.session, a.user_id, { message: '[push_plain]' });
    const for_b = await queue(b.session, b.user_id, { message: '[push_plain]' });
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:handed-over').map((s) => s.payload.data.push_id)).toEqual([for_b.toString()]);
    expect((await record(server, for_a))?.device_count).toBe(0n);
  });

  it('after logout, the device of that session gets no push and its row is deleted', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:logged-out' });
    const other = await new_user(server);
    expect((await call(d.session, 'core/Logout', new CoreContract.LogoutRequest())).code).toBe(0);
    const push_id = await queue(other, d.user_id, { message: '[push_plain]' });
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:logged-out')).toEqual([]);
    expect(await devices(server)).toEqual([]);
    expect((await record(server, push_id))?.status).toBe('SENT');
  });

  it('after a login on another device, the previous device gets no push and its row is deleted', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:previous' });
    const again = await login_again(d.session, d.account);
    expect(again.user_id).toBe(d.user_id);
    await queue(again, d.user_id, { message: '[push_plain]' });
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:previous')).toEqual([]);
    expect(await devices(server)).toEqual([]);
  });

  it('RegisterPushToken from web, windows, macos and linux is INVALID_REQUEST', async () => {
    const server = await start();
    const session = await new_user(server);
    for (const platform of ['web', 'windows', 'macos', 'linux']) {
      expect(await register(session, { device_token: `fake:${platform}`, platform })).toBe(INVALID_REQUEST);
    }
    expect(await devices(server)).toEqual([]);
    expect(await register(session, { device_token: 'fake:ios', platform: 'ios' })).toBe(0);
    expect((await devices(server)).map((r) => r.provider)).toEqual(['apns']);
  });

  it('ios RegisterPushToken where adapters.push-apns is null is INVALID_REQUEST and makes no row', async () => {
    const server = await start({ settings: { 'environments.<ENV>.adapters.push-apns': null } });
    const session = await new_user(server);
    expect(await register(session, { device_token: 'fake:ios', platform: 'ios' })).toBe(INVALID_REQUEST);
    expect(await devices(server)).toEqual([]);
    expect(await register(session, { device_token: 'fake:android', platform: 'android' })).toBe(0);
  });

  it('a timezone_offset_ms out of range, an empty device_token and an unsupported language are INVALID_REQUEST', async () => {
    const server = await start();
    const session = await new_user(server);
    expect(await register(session, { device_token: 'fake:tz', timezone_offset_ms: 86_400_000n })).toBe(INVALID_REQUEST);
    expect(await register(session, { device_token: 'fake:tz', timezone_offset_ms: -86_400_000n })).toBe(INVALID_REQUEST);
    expect(await register(session, { device_token: '' })).toBe(INVALID_REQUEST);
    expect(await register(session, { device_token: 'fake:lang', language: 'xx' })).toBe(INVALID_REQUEST);
    expect(await devices(server)).toEqual([]);
    expect(await register(session, { device_token: 'fake:tz', timezone_offset_ms: -86_399_999n })).toBe(0);
    expect(await register(session, { device_token: 'fake:tz', timezone_offset_ms: 86_399_999n })).toBe(0);
  });

  it('the generated field validator of RegisterPushTokenRequest rejects an out of range timezone_offset_ms', () => {
    const rpc = CoreContract.RPCS.find((r) => r.name === 'core/RegisterPushToken');
    const request = Object.assign(new CoreContract.RegisterPushTokenRequest(), { device_token: 'fake:v', language: 'en', timezone_offset_ms: 86_400_000n });
    expect(rpc?.validate).toBeTypeOf('function');
    expect(rpc?.validate?.(request, data().data)).not.toBeNull();
    request.timezone_offset_ms = 86_399_999n;
    expect(rpc?.validate?.(request, data().data)).toBeNull();
  });
});

describe('consent and withdrawal', () => {
  it('after UpdatePushConsent, the user\'s device rows have the new ad_allowed and night_allowed', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:consent' });
    const flags = async (): Promise<unknown[]> => (await devices(server)).map((r) => [r.ad_allowed, r.night_allowed]);
    expect(await flags()).toEqual([[false, false]]);
    await set_push_consent(d.session, true, false);
    expect(await flags()).toEqual([[true, false]]);
    await set_push_consent(d.session, false, true);
    expect(await flags()).toEqual([[false, true]]);
    expect(await register(d.session, { device_token: 'fake:consent-2' })).toBe(0);
    expect(await flags()).toEqual([[false, true]]);
  });

  it('after remove_user (Withdraw), the user has no device row, records only for the user are CANCELED, and records for others too stay', async () => {
    const server = await start();
    const a = await device(server, { device_token: 'fake:a' });
    const b = await device(server, { device_token: 'fake:b' });
    const only_a = await queue(b.session, a.user_id, { message: '[push_plain]', after_ms: 60_000n });
    const both = await schedule(server, { message_id: message('[push_plain]'), send_at: START_AT + 60_000n, target: { user_ids: [a.user_id, b.user_id] } });
    expect((await call(a.session, 'core/Withdraw', new CoreContract.WithdrawRequest())).code).toBe(0);
    expect((await devices(server)).map((r) => r.user_id)).toEqual([b.user_id]);
    expect((await record(server, only_a))?.status).toBe('CANCELED');
    expect((await record(server, both))?.status).toBe('SCHEDULED');
    expect(await records(server)).toHaveLength(2);
  });

  it('export_user_rows has the user\'s device registration row', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:export', language: 'en', timezone_offset_ms: 3_600_000n });
    await device(server, { device_token: 'fake:other' });
    const reply = await admin(server, 'export_personal_data', { user_id: d.user_id.toString() });
    expect(reply.status).toBe(200);
    const tables = (reply.json as { tables?: Record<string, Record<string, unknown>[]> }).tables ?? {};
    expect(tables.push_device).toEqual([expect.objectContaining({ device_token: 'fake:export', timezone_offset_ms: '3600000' })]);
  });
});
