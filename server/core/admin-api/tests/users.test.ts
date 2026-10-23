// get_user: its JSON, a withdrawn user, and rows of a lower contract version.
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { admin, claim_all, get_user, GOLD, grant, id_value, items, login, MISSING_USER, notice_mail, start, stop, withdraw, type Register, type Server } from './helpers.ts';

const COLUMNS = new Set([...CoreContract.KINDS, ...GameContract.KINDS].map((kind) => kind.column));
const DECIMAL = /^(0|-?[1-9][0-9]*)$/;
const LOWER = GameContract.CONTRACT_VERSION - 1;

describe('get_user', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('answers kind names in snake_case, proto field names and int64 as decimal strings', async () => {
    server = await start();
    const { user_id } = await login(server, 'shape');
    await grant(server, user_id, 'g', items(GOLD, 5n));
    await admin(server, 'send_mail', { operation_id: 'm', user_id, mail: notice_mail('hi') });
    const reply = await get_user(server, user_id);
    expect(reply.status).toBe(200);
    const json = reply.json;
    expect(Object.keys(json).sort()).toEqual(['ban', 'created_at', 'server_state', 'user_id', 'user_state', 'withdrawn_at']);
    expect(json.user_id).toBe(user_id);
    expect(json.created_at).toMatch(DECIMAL);
    expect(json.withdrawn_at).toBeNull();
    expect(json.ban).toBeNull();
    const state = json.user_state as Record<string, unknown>;
    for (const key of Object.keys(state)) expect(COLUMNS.has(key)).toBe(true);
    const balances = state.item_balance_user_state as Record<string, unknown>[];
    expect(balances).toEqual([{ id: String(id_value(GOLD)), amount: '5' }]);
    const mails = state.mail_user_state as Record<string, unknown>[];
    expect(mails).toHaveLength(1);
    expect(mails[0]?.id).toMatch(DECIMAL);
    expect(mails[0]?.sent_at).toMatch(DECIMAL);
    expect(mails[0]?.args).toEqual([{ name: 'text', kind: 'MAIL_ARG_KIND_TEXT', text_value: 'hi' }]);
    expect(typeof json.server_state).toBe('object');
  });

  it('answers 200 with withdrawn_at and empty user_state and server_state for a withdrawn user, and 404 for a user that does not exist', async () => {
    server = await start();
    const { user_id } = await login(server, 'gone');
    await grant(server, user_id, 'g', items(GOLD, 5n));
    await withdraw(server, user_id);
    const reply = await get_user(server, user_id);
    expect(reply.status).toBe(200);
    expect(reply.json.withdrawn_at).toMatch(DECIMAL);
    expect(reply.json.user_state).toEqual({});
    expect(reply.json.server_state).toEqual({});
    expect((await get_user(server, MISSING_USER)).status).toBe(404);
  });

  it('answers a converted value for rows of a lower contract version without changing the stored rows, their contract version or making a pending delta', async () => {
    // Two content admin operations as the test's DB access: one stores the user's rows at a lower contract version,
    // one reads the stored rows as they are.
    const register: Register = (core) => {
      core.routing.register_admin_operation({
        name: 'game_downgrade',
        role: 'ops',
        body: 'json',
        max_body_bytes: null,
        input: { user_id: { type: { kind: 'int64' }, optional: false } },
        user_target: 'user_id',
        handler: (input, tx) => {
          core.storage.db(tx).query('UPDATE user_state SET contract_version = $1 WHERE user_id = $2', [BigInt(LOWER), input.user_id as bigint]);
          return {};
        },
        prepare: null,
        audit_args: null,
      });
      core.routing.register_admin_operation({
        name: 'game_rows',
        role: 'read',
        body: 'json',
        max_body_bytes: null,
        input: { user_id: { type: { kind: 'int64' }, optional: false } },
        user_target: 'user_id',
        handler: (input, tx) => ({
          rows: core.storage.db(tx).query('SELECT kind, item_id, contract_version, value FROM user_state WHERE user_id = $1 ORDER BY kind, item_id', [input.user_id as bigint]),
        }),
        prepare: null,
        audit_args: null,
      });
    };
    server = await start({ register });
    const { session, user_id } = await login(server, 'old');
    await grant(server, user_id, 'g', items(GOLD, 5n));
    // The grant's pending delta goes out first.
    expect((await claim_all(session)).code).toBe(0);
    expect((await admin(server, 'game_downgrade', { user_id })).status).toBe(200);
    const before = (await admin(server, 'game_rows', { user_id })).json.rows as Record<string, unknown>[];
    expect(before.length).toBeGreaterThan(0);
    for (const row of before) expect(row.contract_version).toBe(String(LOWER));
    // No converter is registered: the converted value is the stored value read with this contract.
    const state = (await get_user(server, user_id)).json.user_state as Record<string, unknown>;
    expect(state.item_balance_user_state).toEqual([{ id: String(id_value(GOLD)), amount: '5' }]);
    expect((await admin(server, 'game_rows', { user_id })).json.rows).toEqual(before);
    expect((await claim_all(session)).envelope.pending_user_state?.entries ?? []).toEqual([]);
  });
});
