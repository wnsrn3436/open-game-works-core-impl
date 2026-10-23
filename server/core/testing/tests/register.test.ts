import { readdirSync, readFileSync } from 'node:fs';
import { SETTING_TYPES } from '../dev/setting_types.ts';
import { advance_time, fake, login, restart_test_server, send_admin, start_test_server, stop_test_server } from '../dev/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import { RATE_LIMITED, error_code, missing, probe, real_wait, register_operations, resync, type ContentAdminOperation } from './helpers.ts';

describe('register and settings overrides', () => {
  it('the register of start_test_server handles requests; restart takes a new register or keeps the previous one', async () => {
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register_operations(probe('probe', 'first')));
    try {
      expect((await send_admin(server, 'game_probe', {})).json).toEqual({ from: 'first' });
      await restart_test_server(server, register_operations(probe('probe', 'second')));
      expect((await send_admin(server, 'game_probe', {})).json).toEqual({ from: 'second' });
      await restart_test_server(server);
      expect((await send_admin(server, 'game_probe', {})).json).toEqual({ from: 'second' });
    } finally {
      await stop_test_server(server);
    }
  });

  it('a core settings override is used by the module, survives restart, and is not used by another test server', async () => {
    const limited = await start_test_server(undefined, undefined, undefined, undefined, undefined, { 'routing.userRateLimitPerMinute': 2 });
    const other = await start_test_server();
    try {
      const a = await login(limited, 'limited');
      expect(error_code(await resync(a))).toBe(0);
      expect(error_code(await resync(a))).toBe(0);
      expect(error_code(await resync(a))).toBe(RATE_LIMITED);
      const b = await login(other, 'other');
      for (let i = 0; i < 3; i += 1) expect(error_code(await resync(b))).toBe(0);
      await restart_test_server(limited);
      advance_time(limited, 60_000n);
      expect(error_code(await resync(a))).toBe(0);
      expect(error_code(await resync(a))).toBe(0);
      expect(error_code(await resync(a))).toBe(RATE_LIMITED);
    } finally {
      await stop_test_server(limited);
      await stop_test_server(other);
    }
  });

  it('a settings override of a key that does not exist, or of another type, throws', async () => {
    await expect(start_test_server(undefined, undefined, undefined, undefined, undefined, { 'no-module.noKey': 1 })).rejects.toThrow(/no-module\.noKey/);
    await expect(start_test_server(undefined, undefined, undefined, undefined, undefined, { 'routing.userRateLimitPerMinute': '2' })).rejects.toThrow(/routing\.userRateLimitPerMinute/);
    await expect(start_test_server(undefined, undefined, undefined, undefined, undefined, { 'routing.userRateLimitPerMinute': null })).rejects.toThrow(/routing\.userRateLimitPerMinute/);
  });

  it('a settings override throws for a non-integer of an integer key, a wrong non-null value of a nullable key and a wrong array element', async () => {
    await expect(start_test_server(undefined, undefined, undefined, undefined, undefined, { 'routing.userRateLimitPerMinute': 1.5 })).rejects.toThrow(/routing\.userRateLimitPerMinute/);
    // `auth.inactiveGuestDeleteAfterMs` is an `integer?` key whose core settings value is null.
    await expect(start_test_server(undefined, undefined, undefined, undefined, undefined, { 'auth.inactiveGuestDeleteAfterMs': 'abc' })).rejects.toThrow(/auth\.inactiveGuestDeleteAfterMs/);
    await expect(start_test_server(undefined, undefined, undefined, undefined, undefined, { 'environments.<ENV>.updatePublicKeys': [1] })).rejects.toThrow(/updatePublicKeys/);
  });

  it('the settings type table holds the type of every settings row of the core spec files', () => {
    const dir = new URL('../../../../core-spec/', import.meta.url);
    const types: Record<string, string> = {};
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const spec = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as { settings: { key: string; type: string }[] };
      for (const row of spec.settings) types[row.key] = row.type;
    }
    expect(SETTING_TYPES).toEqual(types);
  });

  it('a testing.defaultStartAt override is the first clock of the test server', async () => {
    const start = 1_800_000_000_000;
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, { 'testing.defaultStartAt': start });
    try {
      const session = await login(server, 'start_at');
      expect((await resync(session)).envelope.server_time_at).toBe(BigInt(start));
    } finally {
      await stop_test_server(server);
    }
  });

  it('a whole environments.<ENV>.adapters override is the adapter choice of the test server', async () => {
    const none = await start_test_server(undefined, undefined, undefined, undefined, undefined, { 'environments.<ENV>.adapters': {} });
    try {
      expect(() => fake(none, 'login-google')).toThrow(/login-google/);
    } finally {
      await stop_test_server(none);
    }
    const google = await start_test_server(undefined, undefined, undefined, undefined, undefined, { 'environments.<ENV>.adapters': { 'login-google': 'fake' } });
    try {
      expect(fake(google, 'login-google')).toBeDefined();
      expect(() => fake(google, 'login-apple')).toThrow(/login-apple/);
    } finally {
      await stop_test_server(google);
    }
    await expect(start_test_server(undefined, undefined, undefined, undefined, undefined, { 'environments.<ENV>.adapters': { 'login-google': 'login-google' } })).rejects.toThrow(/real adapter list/);
  });

  // `guild.leaderInactiveMs` is an `integer?` key whose core settings value is not null.
  it.skipIf(missing('guild'))('a null override of a settings key whose spec type may be null starts the test server', async () => {
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, { 'guild.leaderInactiveMs': null });
    await stop_test_server(server);
  });

  it('a nested transaction of the same user in a test server is rejected', async () => {
    interface Storage {
      run_user_transaction(user_id: bigint, fn: (ctx: unknown) => unknown): unknown;
    }
    // The `storage` module object; content `register(core)` gets only its member `content`, which opens no transaction.
    let storage: Storage | null = null;
    const seen: { outcome: 'rejected' | 'opened' | null } = { outcome: null };
    const nested: ContentAdminOperation = {
      name: 'game_nested',
      role: 'ops',
      body: 'json',
      max_body_bytes: null,
      input: { user_id: { type: { kind: 'int64' }, optional: false } },
      user_target: 'user_id',
      prepare: null,
      audit_args: null,
      handler: (input) => {
        try {
          const opened = storage?.run_user_transaction(BigInt(String(input.user_id)), () => 'pass');
          if (opened instanceof Promise) {
            opened.then(() => (seen.outcome = 'opened'), () => (seen.outcome = 'rejected'));
          } else {
            seen.outcome = 'opened';
          }
        } catch {
          seen.outcome = 'rejected';
        }
        return {};
      },
    };
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register_operations(nested));
    storage = storage_module(server);
    try {
      const session = await login(server, 'nested');
      await send_admin(server, 'game_nested', { user_id: session.user_id.toString() });
      for (let i = 0; i < 50 && seen.outcome === null; i += 1) await real_wait(20);
      expect(seen.outcome).toBe('rejected');
    } finally {
      await stop_test_server(server);
    }
  });
});
