import { connect } from 'node:net';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { SetTimeOffsetRequest } from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import {
  call_dev,
  code,
  E,
  echo,
  envelope_of,
  game_register,
  login,
  logs,
  new_calls,
  plain_headers,
  raw,
  read_user_state,
  send,
  start,
  stop,
  url_of,
  type TestServer,
} from './support.ts';

vi.mock('../../../generated/contract/game_contract.ts', async (import_original) => (await import('./game_contract_mock.ts')).mock_game_contract(await import_original()));

const servers: TestServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await stop(server);
});

async function server_with(options: Parameters<typeof start>[0] = {}): Promise<TestServer> {
  const server = await start({ register: game_register(new_calls()), ...options });
  servers.push(server);
  return server;
}

/** Sends request bytes on a raw TCP connection and returns the bytes the server sends until it closes. */
function raw_tcp(port: number, head: string, body: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    socket.on('error', reject);
    socket.on('close', () => {
      resolve(Buffer.concat(chunks));
    });
    socket.write(head);
    socket.write(body);
  });
}

/** The body of a raw HTTP response, chunked transfer encoding decoded. */
function response_body(bytes: Buffer): Uint8Array {
  const split = bytes.indexOf('\r\n\r\n');
  const head = bytes.subarray(0, split).toString('latin1').toLowerCase();
  let rest = bytes.subarray(split + 4);
  if (!head.includes('transfer-encoding: chunked')) return new Uint8Array(rest);
  const parts: Buffer[] = [];
  for (;;) {
    const line_end = rest.indexOf('\r\n');
    const size = parseInt(rest.subarray(0, line_end).toString('latin1'), 16);
    if (!(size > 0)) return new Uint8Array(Buffer.concat(parts));
    parts.push(rest.subarray(line_end + 2, line_end + 2 + size));
    rest = rest.subarray(line_end + 2 + size + 2);
  }
}

describe('dev', () => {
  it('throws for a ctx operation without a user ID or with a withdrawn user, and gives back a failure value with the saved state unchanged', async () => {
    const server = await server_with();
    const session = await login(server, 'dev_ops');
    await expect(call_dev(server, 'item-ledger', 'set_balance', [1, 10n])).rejects.toThrow();
    const before = await read_user_state(server, session.user_id);
    const failure = await call_dev(server, 'item-ledger', 'set_balance', [999999, 10n], session.user_id);
    expect(failure).toBe('UNKNOWN_ITEM');
    expect(await read_user_state(server, session.user_id)).toEqual(before);
    // An operation that writes and then gives back a failure value: the write does not stay.
    const gold = GameDataDev.find_id_value('[gold]');
    const instance = (server as unknown as { running(): { instance: { dev_objects: Map<string, Record<string, unknown>> } } }).running().instance;
    const dev = instance.dev_objects.get('item-ledger') as { set_balance: (ctx: unknown, item_id: number, balance: bigint) => unknown };
    const set_balance = dev.set_balance;
    dev.set_balance = (ctx, _item_id, balance) => {
      expect(set_balance(ctx, gold, balance)).toBe('OK');
      return 'INVALID_AMOUNT';
    };
    expect(await call_dev(server, 'item-ledger', 'set_balance', [gold, 7n], session.user_id)).toBe('INVALID_AMOUNT');
    expect(await read_user_state(server, session.user_id)).toEqual(before);
    dev.set_balance = set_balance;
    // The same write that commits changes the saved state.
    expect(await call_dev(server, 'item-ledger', 'set_balance', [gold, 7n], session.user_id)).toBe('OK');
    expect(await read_user_state(server, session.user_id)).not.toEqual(before);
    const gone = await login(server, 'dev_gone');
    expect(code(await send(gone, 'core/Withdraw', new CoreContract.WithdrawRequest()))).toBe(0);
    await expect(call_dev(server, 'item-ledger', 'set_balance', [1, 10n], gone.user_id)).rejects.toThrow();
  });
});

describe('cheat paths of STG and PROD', () => {
  it('answers UNAUTHORIZED without reading the body and leaves a security log cheat_path_closed', async () => {
    const server = await server_with({ env: 'STG' });
    const response = await raw(server, 'POST', '/core/cheat/SetTimeOffset', plain_headers(), new SetTimeOffsetRequest().encode());
    expect(response.status).toBe(200);
    expect(envelope_of(response).error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(logs(server, 'security').some((line) => line.reason === 'cheat_path_closed')).toBe(true);
  });
});

describe('client IP', () => {
  const xff = '1.2.3.4, 5.6.7.8, 9.9.9.9';

  it('takes the value second from the right of X-Forwarded-For with 2 trusted proxies, and the TCP peer with one value', async () => {
    const server = await server_with({ env: 'STG', overrides: { 'environments.STG.trustedProxyCount': 2 } });
    const session = await login(server, 'proxy');
    await send(session, 'Echo', echo(), { headers: { Authorization: 'Bearer wrong', 'X-Forwarded-For': xff } });
    await send(session, 'Echo', echo(), { headers: { Authorization: 'Bearer wrong2', 'X-Forwarded-For': '9.9.9.9' } });
    const ips = logs(server, 'security').map((line) => line.ip);
    expect(ips).toContain('5.6.7.0');
    expect(ips).toContain('127.0.0.0');
  });

  it('takes the TCP peer on LOCAL whatever X-Forwarded-For says', async () => {
    const server = await server_with();
    const session = await login(server, 'proxy_local');
    await send(session, 'Echo', echo(), { headers: { Authorization: 'Bearer wrong', 'X-Forwarded-For': xff } });
    expect(logs(server, 'security').map((line) => line.ip)).toEqual(['127.0.0.0']);
  });
});

describe('body limit', () => {
  it('cuts a body over routing.maxBodyBytes and a body read over routing.bodyReadTimeoutMs, whatever Content-Length says', async () => {
    const server = await server_with({ overrides: { 'routing.maxBodyBytes': 16, 'routing.bodyReadTimeoutMs': 300 } });
    const port = Number(url_of(server).port);
    const headers = Object.entries(plain_headers()).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    // No Content-Length (chunked): the received bytes are counted.
    const chunked = `POST /core/Resync HTTP/1.1\r\nHost: 127.0.0.1\r\n${headers}Transfer-Encoding: chunked\r\n\r\n20\r\n`;
    const over = await raw_tcp(port, chunked, new Uint8Array(32));
    expect(CoreContract.ResponseEnvelope.decode(response_body(over))?.error?.code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    const slow = `POST /core/Resync HTTP/1.1\r\nHost: 127.0.0.1\r\n${headers}Content-Length: 10\r\n\r\n`;
    const timed_out = await raw_tcp(port, slow, new Uint8Array(2));
    expect(CoreContract.ResponseEnvelope.decode(response_body(timed_out))?.error?.code).toBe(E.CORE_ERROR_INVALID_REQUEST);
  });
});
