import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { SetTimeOffsetRequest } from '../../../dev/generated/contract/core_cheat_contract.ts';
import { E, echo, envelope_of, game_register, login, new_calls, plain_headers, raw, signed_raw, start, stop, type TestServer } from './support.ts';

vi.mock('../../../generated/contract/game_contract.ts', async (import_original) => (await import('./game_contract_mock.ts')).mock_game_contract(await import_original()));

const ALLOWED = 'http://localhost:5173';
const DENIED = 'https://evil.example';

const servers: TestServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await stop(server);
});

async function local(): Promise<TestServer> {
  const server = await start({ register: game_register(new_calls()) });
  servers.push(server);
  return server;
}

describe('CORS', () => {
  it('answers an allowed origin\'s rpc path preflight with the allowed headers, and another origin\'s with 403 and no CORS header', async () => {
    const server = await local();
    for (const path of ['/Echo', '/core/Resync']) {
      const allowed = await raw(server, 'OPTIONS', path, { Origin: ALLOWED, 'Access-Control-Request-Method': 'POST' });
      expect(allowed.status).toBe(204);
      expect(allowed.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(allowed.headers['access-control-allow-methods']).toBe('POST');
      expect(allowed.headers['access-control-allow-headers']).toContain('X-Ogw-Signature');
      expect(allowed.headers['access-control-allow-headers']).not.toContain('X-Ogw-Dev-Access');
      expect(allowed.headers['access-control-max-age']).toBe(String(Math.floor(600000 / 1000)));
      expect(allowed.headers['vary']).toBe('Origin');
      const denied = await raw(server, 'OPTIONS', path, { Origin: DENIED });
      expect(denied.status).toBe(403);
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('puts the allowed origin on rpc path POST responses, success and INVALID_REQUEST alike', async () => {
    const server = await local();
    const session = await login(server, 'cors');
    const success = await signed_raw(server, session, 'Echo', echo().encode(), { Origin: ALLOWED });
    expect(envelope_of(success).error).toBeNull();
    expect(success.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(success.headers['vary']).toBe('Origin');
    const invalid = await raw(server, 'POST', '/Echo', plain_headers({ Origin: ALLOWED, 'X-Ogw-Request-Id': 'bad' }), echo().encode());
    expect(envelope_of(invalid).error?.code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(invalid.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(invalid.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('gives a DEV code server\'s cheat path preflight X-Ogw-Dev-Access, and its POST responses the allowed origin', async () => {
    const server = await local();
    const preflight = await raw(server, 'OPTIONS', '/core/cheat/SetTimeOffset', { Origin: ALLOWED });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-headers']).toContain('X-Ogw-Dev-Access');
    const cheat = await raw(server, 'POST', '/core/cheat/SetTimeOffset', plain_headers({ Origin: ALLOWED }), new SetTimeOffsetRequest().encode());
    expect(envelope_of(cheat).error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect(cheat.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  it('answers an STG server\'s cheat path OPTIONS with 404 and no CORS header', async () => {
    const server = await start({ env: 'STG', register: game_register(new_calls()) });
    servers.push(server);
    const preflight = await raw(server, 'OPTIONS', '/core/cheat/SetTimeOffset', { Origin: ALLOWED });
    expect(preflight.status).toBe(404);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('puts the allowed origin and Vary on update route GET responses of any status, not on another origin\'s, and answers their OPTIONS with 404', async () => {
    const server = await local();
    for (const path of ['/update/deploy_list.json', `/update/files/${'0'.repeat(64)}`]) {
      const allowed = await raw(server, 'GET', path, { Origin: ALLOWED });
      expect([200, 404]).toContain(allowed.status);
      expect(allowed.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(allowed.headers['vary']).toBe('Origin');
      const denied = await raw(server, 'GET', path, { Origin: DENIED });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
      expect((await raw(server, 'OPTIONS', path, { Origin: ALLOWED })).status).toBe(404);
    }
    const missing = await raw(server, 'GET', `/update/files/${'0'.repeat(64)}`, { Origin: ALLOWED });
    expect(missing.status).toBe(404);
  });

  it('answers 403 without CORS header and without a body to a disallowed origin\'s POST', async () => {
    const server = await local();
    const denied = await raw(server, 'POST', '/core/Resync', plain_headers({ Origin: DENIED }), new CoreContract.ResyncRequest().encode());
    expect(denied.status).toBe(403);
    expect(denied.body.length).toBe(0);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
