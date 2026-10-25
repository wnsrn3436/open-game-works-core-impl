import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { E, P, admin, call, guest, logs, probe, social, start, testing, withdraw, type TestServer } from './helpers.ts';

let server: TestServer;
beforeAll(async () => {
  server = await start({ settings: { 'auth.deletionAttemptsPerMinute': 1000 } });
});
afterAll(async () => {
  await testing.stop_test_server(server);
});

describe('find_user_by_public_code', () => {
  it('gives the user_id and withdrawn_at of a user and of a withdrawn user, not_found for a code no user has and bad_request for a text that is not a public code input', async () => {
    const user = await guest(server);
    const found = await admin(server, 'find_user_by_public_code', { public_code: user.result.public_code.toLowerCase().replace(/(.{4})/, '$1-') }, 'read');
    expect(found.status).toBe(200);
    expect(found.body.user_id).toBe(user.result.user_id.toString());
    expect(found.body.withdrawn_at).toBeNull();

    const gone = await guest(server);
    expect(await withdraw(gone.session)).toBe(0);
    const withdrawn = await admin(server, 'find_user_by_public_code', { public_code: gone.result.public_code }, 'read');
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.user_id).toBe(gone.result.user_id.toString());
    expect(typeof withdrawn.body.withdrawn_at).toBe('string');

    expect((await admin(server, 'find_user_by_public_code', { public_code: 'ZZZZZZZZ' }, 'read')).status).toBe(404);
    for (const bad of ['ZZZZZZZ', 'ZZZZZZZU', 'ZZZZZZZZZ', '']) expect((await admin(server, 'find_user_by_public_code', { public_code: bad }, 'read')).status).toBe(400);
  });
});

interface LookupStorage {
  find_user_by_public_code(db: unknown, public_code: string): bigint | null;
  read_db(): { query(sql: string, params: readonly unknown[]): unknown };
}

describe('POST /account/deletion', () => {
  it('is 500 [auth_deletion_retry] with one error log when the read_db lookup of the public code fails, and deletes nothing', async () => {
    const user = await guest(server);
    const issued = await call<CoreContract.IssueDeletionCodeResponse>(user.session, 'core/IssueDeletionCode', new CoreContract.IssueDeletionCodeRequest());
    expect(issued.code).toBe(0);
    const storage = server.running().instance.modules().get('storage') as unknown as LookupStorage;
    const original = storage.find_user_by_public_code.bind(storage);
    storage.find_user_by_public_code = () => {
      throw new Error('the read connection is gone');
    };
    const errors_before = logs(server, 'error').length;
    const send = (): Promise<{ status: number; body: Uint8Array }> =>
      testing.send_raw(
        server,
        'POST',
        '/account/deletion',
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        new TextEncoder().encode(new URLSearchParams({ method: 'code', confirm: 'yes', public_code: user.result.public_code, code: issued.response.code }).toString()),
      );
    let failed: { status: number; body: Uint8Array };
    try {
      failed = await send();
    } finally {
      storage.find_user_by_public_code = original;
    }
    expect(failed.status).toBe(500);
    const errors = logs(server, 'error').slice(errors_before);
    expect(errors).toHaveLength(1);
    // The same result page as another [auth_deletion_retry]: a POST during maintenance.
    expect((await admin(server, 'set_maintenance', { enabled: true })).status).toBe(200);
    const retry = await send();
    expect((await admin(server, 'set_maintenance', { enabled: false })).status).toBe(200);
    expect(retry.status).toBe(503);
    const text = (body: Uint8Array): string => new TextDecoder().decode(body).replace(/nonce="[^"]*"/g, 'nonce=""');
    expect(text(failed.body)).toBe(text(retry.body));
    // Nothing was deleted: the same code still deletes the account.
    expect((await send()).status).toBe(200);
  });

  it('is 500 [auth_deletion_retry] with one error log when the read_db read of the auth_social_link row of the google method fails, and deletes nothing', async () => {
    const user = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'deletion-lookup-google');
    const storage = server.running().instance.modules().get('storage') as unknown as LookupStorage;
    const original = storage.read_db.bind(storage);
    // Only the query of auth_social_link on the read handle fails.
    storage.read_db = () => {
      const db = original();
      return new Proxy(db, {
        get(target, key, receiver) {
          if (key !== 'query') return Reflect.get(target, key, receiver) as unknown;
          return (sql: string, params: readonly unknown[]) => {
            if (sql.includes('auth_social_link')) throw new Error('the read connection is gone');
            return target.query(sql, params);
          };
        },
      });
    };
    const errors_before = logs(server, 'error').length;
    const send = (): Promise<{ status: number; body: Uint8Array }> =>
      testing.send_raw(
        server,
        'POST',
        '/account/deletion',
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        new TextEncoder().encode(new URLSearchParams({ method: 'google', confirm: 'yes', credential: 'fake:deletion-lookup-google' }).toString()),
      );
    let failed: { status: number; body: Uint8Array };
    try {
      failed = await send();
    } finally {
      storage.read_db = original;
    }
    expect(failed.status).toBe(500);
    const errors = logs(server, 'error').slice(errors_before);
    expect(errors).toHaveLength(1);
    // The same result page as another [auth_deletion_retry]: a POST during maintenance.
    expect((await admin(server, 'set_maintenance', { enabled: true })).status).toBe(200);
    const retry = await send();
    expect((await admin(server, 'set_maintenance', { enabled: false })).status).toBe(200);
    expect(retry.status).toBe(503);
    const text = (body: Uint8Array): string => new TextDecoder().decode(body).replace(/nonce="[^"]*"/g, 'nonce=""');
    expect(text(failed.body)).toBe(text(retry.body));
    // Nothing was deleted: the session still works, and the same credential then deletes the account.
    expect(await probe(user.session)).toBe(0);
    expect((await send()).status).toBe(200);
    expect(await probe(user.session)).toBe(E.CORE_ERROR_UNAUTHORIZED);
  });
});
