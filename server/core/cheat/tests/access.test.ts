import type { InstanceState } from '../../routing/context.ts';
import { dev_access_inputs, passes_dev_access } from '../../routing/dev/index.ts';
import * as testing from '../../testing/dev/index.ts';
import { Mode, SetModeRequest } from './game_cheat_contract_mock.ts';
import {
  E,
  START_AT,
  STEP,
  cheat_audits,
  code,
  dev_login_request,
  envelope_of,
  gold,
  logs,
  new_calls,
  plain_headers,
  raw_cheat,
  raw_dev_login,
  set_time_offset,
  set_user_state,
  start,
  stop_all,
  user_time,
} from './served.ts';

vi.mock('../../../dev/generated/contract/game_cheat_contract.ts', async () => (await import('./game_cheat_contract_mock.ts')).mock_game_cheat_contract());

afterEach(stop_all);

const SET_TIME_OFFSET = 'core/cheat/SetTimeOffset';

describe('dev access', () => {
  it('answers a cheat path POST on STG with UNAUTHORIZED and a security line', async () => {
    const server = await start({ env: 'STG' });
    for (const path of ['/core/cheat/SetTimeOffset', '/core/cheat/DevLogin', '/cheat/Touch']) {
      const sent = await testing.send_raw(server, 'POST', path, plain_headers({ 'X-Ogw-Dev-Access': 'any' }), set_time_offset(STEP).encode());
      expect(envelope_of(sent).error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    }
    // logging writes the first line of a repeated user, IP and reason in its window and counts the others.
    expect(logs(server, 'security').map((line) => [line['request'], line['reason']])).toEqual([['core/cheat/SetTimeOffset', 'cheat_path_closed']]);
    expect(cheat_audits(server)).toEqual([]);
  });

  it('refuses a LOCAL cheat request and DevLogin without the dev access value, and processes it with the value', async () => {
    const calls = new_calls(gold());
    const server = await start({ calls });
    const session = await testing.login(server, 'qa');
    for (const header of [null, 'wrong', `${server.dev_access}x`]) {
      expect((await raw_cheat(server, session, 'cheat/Touch', set_time_offset(STEP), { dev_access: header })).error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
      expect((await raw_cheat(server, session, SET_TIME_OFFSET, set_time_offset(STEP), { dev_access: header })).error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
      expect((await raw_dev_login(server, `new-${String(header)}`, header)).error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    }
    expect(calls.count.get('Touch')).toBeUndefined();
    expect(await user_time(session)).toBe(START_AT);
    expect(logs(server, 'security').filter((line) => line['reason'] === 'dev_access').map((line) => line['request'])).toEqual(['cheat/Touch']);
    expect(cheat_audits(server).filter((line) => line['request'] === 'core/cheat/DevLogin')).toHaveLength(1);

    expect(code(await testing.send_cheat(session, 'cheat/Touch', set_time_offset(0n)))).toBe(0);
    expect(code(await testing.send_cheat(session, SET_TIME_OFFSET, set_time_offset(STEP)))).toBe(0);
    expect((await raw_dev_login(server, 'second')).error).toBeNull();
    expect(calls.count.get('Touch')).toBe(1);
    expect(await user_time(session)).toBe(START_AT + STEP);
    expect(JSON.stringify(testing.read_logs(server))).not.toContain(server.dev_access);
  });

  it('takes a DEV client IP only in environments.DEV.devAllowedCidrs, and every IP when it is null or not DEV', () => {
    const cidrs = ['10.0.0.0/24', 'fd00::/64'];
    expect(passes_dev_access('DEV', 'v', 'v', '10.0.0.9', cidrs)).toBe(true);
    expect(passes_dev_access('DEV', 'v', 'v', 'fd00::1', cidrs)).toBe(true);
    expect(passes_dev_access('DEV', 'v', 'v', '10.1.3.4', cidrs)).toBe(false);
    expect(passes_dev_access('DEV', 'v', 'v', 'fd01::1', cidrs)).toBe(false);
    expect(passes_dev_access('DEV', 'v', 'v', '10.1.3.4', null)).toBe(true);
    expect(passes_dev_access('LOCAL', 'v', 'v', '10.1.3.4', cidrs)).toBe(true);
    expect(passes_dev_access('DEV', 'v', 'w', '10.0.0.9', cidrs)).toBe(false);
    expect(passes_dev_access('DEV', 'v', null, '10.0.0.9', null)).toBe(false);
    expect(passes_dev_access('DEV', null, 'v', '10.0.0.9', null)).toBe(false);
    expect(passes_dev_access('DEV', 'v', 'v', '10.0.0.9', ['10.0.0.9'])).toBe(false);
  });

  it('reads the DEV dev access value from the secret named by environments.DEV.secrets.devAccess and passes devAllowedCidrs through', () => {
    const secrets: Record<string, string> = { devAccess: 'local-value', 'dev-access-dev': 'dev-value' };
    const read: string[] = [];
    const state = (env: string, values: Record<string, unknown>): Pick<InstanceState, 'server' | 'values'> =>
      ({
        server: {
          env,
          read_secret: (name: string) => {
            read.push(name);
            return secrets[name] ?? null;
          },
        },
        values,
      }) as unknown as Pick<InstanceState, 'server' | 'values'>;
    const cidrs = ['10.0.0.0/24', 'fd00::/64'];
    const dev = { 'environments.<ENV>.secrets.devAccess': 'dev-access-dev', 'environments.<ENV>.devAllowedCidrs': cidrs };
    expect(dev_access_inputs(state('DEV', dev))).toEqual({ expected: 'dev-value', allowed_cidrs: cidrs });
    expect(read).toEqual(['dev-access-dev']);
    expect(dev_access_inputs(state('DEV', { 'environments.<ENV>.secrets.devAccess': 'missing' })).expected).toBeNull();
    read.length = 0;
    for (const name of [null, '', undefined, 3]) {
      expect(dev_access_inputs(state('DEV', { 'environments.<ENV>.secrets.devAccess': name, 'environments.<ENV>.devAllowedCidrs': null }))).toEqual({ expected: null, allowed_cidrs: null });
    }
    expect(read).toEqual([]);
    expect(dev_access_inputs(state('LOCAL', { 'environments.<ENV>.secrets.devAccess': 'dev-access-dev' }))).toEqual({ expected: 'local-value', allowed_cidrs: null });
    expect(read).toEqual(['devAccess']);
    // A null dev access value refuses every request.
    const inputs = dev_access_inputs(state('DEV', { 'environments.<ENV>.devAllowedCidrs': cidrs }));
    expect(passes_dev_access('DEV', inputs.expected, 'local-value', '10.0.0.9', inputs.allowed_cidrs)).toBe(false);
    expect(passes_dev_access('DEV', inputs.expected, '', '10.0.0.9', inputs.allowed_cidrs)).toBe(false);
  });
});

describe('audit log', () => {
  it('writes one audit line per cheat request past dev access and authentication, and none for refused ones', async () => {
    const server = await start({ calls: new_calls(gold()) });
    const session = await testing.login(server, 'qa');
    expect(code(await testing.send_cheat(session, SET_TIME_OFFSET, set_time_offset(STEP)))).toBe(0);
    const bad = await testing.send_cheat(session, 'core/cheat/SetUserState', set_user_state('ItemBalanceUserState', 1n, '{"id": "1"}'));
    expect(code(bad)).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await raw_cheat(server, session, SET_TIME_OFFSET, set_time_offset(2n * STEP), { dev_access: 'wrong' })).error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect((await raw_cheat(server, session, SET_TIME_OFFSET, set_time_offset(3n * STEP), { access_token: 'wrong' })).error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect((await raw_cheat(server, session, 'cheat/NoSuchCheat', set_time_offset(4n * STEP))).error?.code).toBe(E.CORE_ERROR_INVALID_REQUEST);

    expect(cheat_audits(server).map((l) => [l['request'], String(l['user_id']), l['args'], l['result']])).toEqual([
      ['core/cheat/DevLogin', String(session.user_id), { account_name: 'qa' }, 0],
      [SET_TIME_OFFSET, String(session.user_id), { offset_ms: String(STEP) }, 0],
      ['core/cheat/SetUserState', String(session.user_id), { kind: 'ItemBalanceUserState', item_id: '1', value_json: '{"id": "1"}' }, E.CORE_ERROR_INVALID_REQUEST],
    ]);
    const reasons = logs(server, 'security').map((l) => l['reason']);
    expect(reasons).toContain('dev_access');
    expect(reasons).toContain('unauthorized');
    expect(await user_time(session)).toBe(START_AT + STEP);
  });

  it('writes args as the request to_json(): enum value names, int64 as decimal strings, default fields left out', async () => {
    const calls = new_calls(gold());
    const server = await start({ calls });
    const session = await testing.login(server, 'qa');
    const request = new SetModeRequest();
    request.mode = Mode.MODE_FAST;
    request.count = 9007199254740993n;
    expect(code(await testing.send_cheat(session, 'cheat/SetMode', request))).toBe(0);
    expect(code(await testing.send_cheat(session, 'cheat/SetMode', new SetModeRequest()))).toBe(0);
    expect(code(await testing.send_cheat(session, SET_TIME_OFFSET, set_time_offset(0n)))).toBe(0);
    expect(calls.count.get('SetMode')).toBe(2);
    expect(cheat_audits(server).slice(1).map((l) => [l['request'], l['args']])).toEqual([
      ['cheat/SetMode', { mode: 'MODE_FAST', count: '9007199254740993' }],
      ['cheat/SetMode', {}],
      [SET_TIME_OFFSET, {}],
    ]);
  });

  it('writes the DevLogin audit line for a DevLogin past dev access whose body or header is refused', async () => {
    const server = await start({ calls: new_calls(gold()), settings: { 'routing.maxBodyBytes': 64 } });
    const big = await raw_dev_login(server, 'x'.repeat(200));
    expect(big.error?.code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    const header = await raw_dev_login(server, 'qa', server.dev_access, { 'X-Ogw-Platform': 'ps5' });
    expect(header.error?.code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    const refused = await raw_dev_login(server, 'qa', 'wrong');
    expect(refused.error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect(cheat_audits(server).map((l) => [l['request'], String(l['user_id']), l['args'], l['result']])).toEqual([
      ['core/cheat/DevLogin', '0', null, E.CORE_ERROR_INVALID_REQUEST],
      ['core/cheat/DevLogin', '0', { account_name: 'qa' }, E.CORE_ERROR_INVALID_REQUEST],
    ]);
    expect(dev_login_request('qa').encode().length).toBeLessThan(64);
  });
});

describe('request signature', () => {
  it('refuses a cheat request whose signature name drops cheat/', async () => {
    const calls = new_calls(gold());
    const server = await start({ calls });
    const session = await testing.login(server, 'qa');
    expect((await raw_cheat(server, session, SET_TIME_OFFSET, set_time_offset(STEP), { sign_name: 'core/SetTimeOffset' })).error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect((await raw_cheat(server, session, 'cheat/Touch', set_time_offset(STEP), { sign_name: 'Touch' })).error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect((await raw_cheat(server, session, SET_TIME_OFFSET, set_time_offset(STEP))).error).toBeNull();
    expect(calls.count.get('Touch')).toBeUndefined();
    expect(await user_time(session)).toBe(START_AT + STEP);
  });
});
