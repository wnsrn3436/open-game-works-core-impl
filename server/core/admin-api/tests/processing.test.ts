// Processing order: each step's failure, the body rules, and `object union` and `enum` fields.
import * as testing from '../../testing/dev/index.ts';
import { admin, audits, balance, claim_all, get_user, GOLD, grant, id_value, items, login, MISSING_USER, notice_mail, restart, start, stop, type Register, type Server } from './helpers.ts';

describe('processing order', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('ends a request failing at each step with its status, no state change and one audit line', async () => {
    server = await start({ settings: { 'admin-api.maxBodyBytes': 512, 'admin-api.authFailuresPerMinute': 2 } });
    const { user_id } = await login(server, 'steps');
    const before = await balance(server, user_id, GOLD);
    const cases: [string, () => Promise<{ status: number; json: Record<string, unknown> }>, number, string][] = [
      ['wrong secret', () => admin(server, 'grant_items', { operation_id: 's3', user_id, items: items(GOLD, 1n) }, 'ogw', 'wrong'), 401, 'unauthorized'],
      ['role', () => admin(server, 'grant_items', { operation_id: 's4', user_id, items: items(GOLD, 1n) }, 'read'), 403, 'forbidden'],
      ['body limit', () => grant(server, user_id, 'big', items(GOLD, 1n).concat(new Array(40).fill(items(GOLD, 1n)[0]))), 400, 'bad_request'],
      ['body rules', () => admin(server, 'grant_items', { operation_id: 's5', user_id, items: items(GOLD, 1n), extra: 1 }), 400, 'bad_request'],
      ['target user', () => grant(server, MISSING_USER, 's6', items(GOLD, 1n)), 404, 'not_found'],
      ['handler failure', () => grant(server, user_id, 's7', [{ item_id: 999999, amount: '1' }]), 409, 'conflict'],
    ];
    let lines = audits(server, 'grant_items').length;
    for (const [label, call, status, error] of cases) {
      const reply = await call();
      expect([label, reply.status, reply.json.error]).toEqual([label, status, error]);
      const after = audits(server, 'grant_items').length;
      expect([label, after - lines]).toEqual([label, 1]);
      lines = after;
    }
    expect(await balance(server, user_id, GOLD)).toBe(before);
    // Step 3: an operation name that is not registered.
    const unknown = await admin(server, 'grant_items_x', { operation_id: 's10', user_id, items: items(GOLD, 1n) });
    expect([unknown.status, unknown.json.error]).toEqual([404, 'not_found']);
    expect(audits(server, 'grant_items_x')).toHaveLength(1);
    // IP limit: one auth failure so far; the second reaches admin-api.authFailuresPerMinute 2.
    await admin(server, 'grant_items', { operation_id: 's8', user_id, items: items(GOLD, 1n) }, 'ogw', 'wrong');
    const limited = await grant(server, user_id, 's9', items(GOLD, 1n));
    expect(limited.status).toBe(429);
    expect(audits(server, 'grant_items').length - lines).toBe(2);
    expect(await balance(server, user_id, GOLD)).toBe(before);
  });

  it('ends a request from an IP outside adminAllowedCidrs at step 1 with no state change and one audit line', async () => {
    server = await start({ settings: { 'environments.<ENV>.adminAllowedCidrs': ['10.0.0.0/8'] } });
    const reply = await admin(server, 'set_maintenance', { enabled: true });
    expect(reply.status).toBe(403);
    expect(audits(server, 'set_maintenance')).toHaveLength(1);
    // The switch stays off: a new server instance on the same DB reads no maintenance row.
    server = await restart(server);
    const { session } = await login(server, 'cidr');
    expect((await claim_all(session)).code).toBe(0);
  });

  it('answers the failure as {"error": reason}', async () => {
    server = await start();
    const reply = await admin(server, 'get_user', { user_id: MISSING_USER });
    expect(reply.status).toBe(404);
    expect(reply.json).toEqual({ error: 'not_found' });
  });
});

describe('body rules', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('answers 400 for an unknown field, a bool given as an integer, a fractional user_id and a limit out of range', async () => {
    server = await start({ settings: { 'admin-api.maxSearchRows': 10 } });
    const { user_id } = await login(server, 'rules');
    expect((await admin(server, 'get_user', `{"user_id":${user_id},"other":1}`)).status).toBe(400);
    expect((await admin(server, 'set_maintenance', '{"enabled":1}')).status).toBe(400);
    expect((await admin(server, 'get_user', '{"user_id":1.5}')).status).toBe(400);
    expect((await admin(server, 'get_user', `{"user_id":${user_id}.0}`)).status).toBe(400);
    const history = (limit: number): string => `{"user_id":${user_id},"from_at":0,"to_at":1000,"after_seq":0,"limit":${String(limit)}}`;
    expect((await admin(server, 'list_item_history', history(0))).status).toBe(400);
    expect((await admin(server, 'list_item_history', history(11))).status).toBe(400);
    expect((await admin(server, 'list_item_history', history(10))).status).toBe(200);
    expect((await admin(server, 'get_user', `{"user_id":"${user_id}"}`)).status).toBe(200);
  });

  it('answers 400 for grant_items whose operation_id holds U+0000 or is "\\ud800", with no balance change and one audit line each', async () => {
    server = await start();
    const { user_id } = await login(server, 'nul');
    for (const operation_id of ['a\\u0000b', '\\ud800']) {
      const lines = audits(server, 'grant_items').length;
      const reply = await admin(server, 'grant_items', `{"operation_id":"${operation_id}","user_id":"${user_id}","items":${JSON.stringify(items(GOLD, 1n))}}`);
      expect([operation_id, reply.status, reply.json.error]).toEqual([operation_id, 400, 'bad_request']);
      expect(audits(server, 'grant_items').length - lines).toBe(1);
      expect(await balance(server, user_id, GOLD)).toBe(0n);
    }
  });

  it('answers 400 for send_mail whose mail has expire_ms 1e3 or 1.5, and sends no mail', async () => {
    server = await start();
    const { user_id } = await login(server, 'expire');
    const mail = JSON.stringify(notice_mail('x'));
    for (const expire of ['1e3', '1.5']) {
      const text = `{"operation_id":"e${expire}","user_id":"${user_id}","mail":${mail.slice(0, -1)},"expire_ms":${expire}}}`;
      const reply = await admin(server, 'send_mail', text);
      expect([expire, reply.status, reply.json.error]).toEqual([expire, 400, 'bad_request']);
    }
    expect((await get_user(server, user_id)).json.user_state).not.toHaveProperty('mail_user_state');
    const sent = await admin(server, 'send_mail', `{"operation_id":"e","user_id":"${user_id}","mail":${mail.slice(0, -1)},"expire_ms":1000}}`);
    expect(sent.status).toBe(200);
  });

  it('answers 400 for send_mail whose mail holds U+0000 or an unpaired surrogate in a text_value or once_key, and sends no mail', async () => {
    server = await start();
    const { user_id } = await login(server, 'clean');
    for (const bad of ['a\\u0000b', '\\ud800']) {
      const text_mail = JSON.stringify(notice_mail('PLACEHOLDER')).replace('PLACEHOLDER', bad);
      const key_mail = JSON.stringify(notice_mail('x', { once_key: 'PLACEHOLDER' })).replace('PLACEHOLDER', `k${bad}`);
      for (const mail of [text_mail, key_mail]) {
        const lines = audits(server, 'send_mail').length;
        const reply = await admin(server, 'send_mail', `{"operation_id":"c","user_id":"${user_id}","mail":${mail}}`);
        expect([mail, reply.status, reply.json.error]).toEqual([mail, 400, 'bad_request']);
        expect(audits(server, 'send_mail').length - lines).toBe(1);
      }
    }
    expect((await get_user(server, user_id)).json.user_state).not.toHaveProperty('mail_user_state');
  });

  it('answers get_user with JSON integer user_id 9223372036854775807 with 404 and 9223372036854775808 with 400', async () => {
    server = await start();
    expect((await admin(server, 'get_user', '{"user_id":9223372036854775807}')).status).toBe(404);
    const over = await admin(server, 'get_user', '{"user_id":9223372036854775808}');
    expect([over.status, over.json.error]).toEqual([400, 'bad_request']);
  });

  it('answers 400 and changes nothing for grant_items with user_id twice and send_mail whose mail has template_id twice', async () => {
    server = await start();
    const { user_id } = await login(server, 'twice');
    const { user_id: other } = await login(server, 'twice_other');
    const list = JSON.stringify(items(GOLD, 5n));
    const grant_twice = await admin(server, 'grant_items', `{"operation_id":"t","user_id":"${user_id}","user_id":"${other}","items":${list}}`);
    expect([grant_twice.status, grant_twice.json.error]).toEqual([400, 'bad_request']);
    const template = id_value('[mail_admin_notice]');
    const mail_twice = await admin(server, 'send_mail', `{"operation_id":"m","user_id":"${user_id}","mail":{"template_id":${String(template)},"template_id":${String(template)},"args":[{"name":"text","value":{"text_value":"x"}}]}}`);
    expect([mail_twice.status, mail_twice.json.error]).toEqual([400, 'bad_request']);
    for (const id of [user_id, other]) {
      expect(await balance(server, id, GOLD)).toBe(0n);
      expect((await get_user(server, id)).json.user_state).not.toHaveProperty('mail_user_state');
    }
    // The same operation_id is free: nothing was recorded for it.
    expect((await admin(server, 'grant_items', `{"operation_id":"t","user_id":"${user_id}","items":${list}}`)).status).toBe(200);
    expect(await balance(server, user_id, GOLD)).toBe(5n);
  });

  it('reads the int32 and string query fields of a binary body operation as URLSearchParams decodes them', async () => {
    const got: unknown[] = [];
    const register: Register = (core) => {
      core.routing.register_admin_operation({
        name: 'game_counted',
        role: 'release',
        body: 'binary',
        max_body_bytes: 64,
        input: { count: { type: { kind: 'int32' } }, name: { type: { kind: 'string' }, optional: true } },
        user_target: null,
        handler: (input) => {
          got.push(input);
          return {};
        },
        prepare: null,
        audit_args: null,
      });
    };
    server = await start({ register });
    const secret = server.admin_secret('ogw') ?? '';
    const send = async (query: string): Promise<number> => {
      const headers = { Authorization: `Bearer ogw.${secret}`, 'Content-Type': 'application/octet-stream' };
      return (await testing.send_raw(server, 'POST', `/admin/game_counted?${query}`, headers, new Uint8Array([1, 2]))).status;
    };
    expect(await send('count=3')).toBe(200);
    expect(await send('count=%33')).toBe(200);
    for (const bad of ['count=3.0', 'count=abc', 'count=2147483648', 'count=03', 'count=+3', 'count=3&count=4']) expect([bad, await send(bad)]).toEqual([bad, 400]);
    expect(await send('count=1&name=a+b%2Bc')).toBe(200);
    expect(got).toEqual([{ count: 3 }, { count: 3 }, { count: 1, name: 'a b+c' }]);
  });

  it('answers 400 for an object union with two keys or none and for a value outside an enum', async () => {
    let calls = 0;
    const register: Register = (core) => {
      core.routing.register_admin_operation({
        name: 'game_union',
        role: 'ops',
        body: 'json',
        input: {
          value: { type: { kind: 'object_union', fields: { int_value: { kind: 'int64' }, text_value: { kind: 'string' } } } },
          color: { type: { kind: 'enum', elements: ['Red', 'Blue'] } },
        },
        user_target: null,
        handler: () => {
          calls += 1;
          return {};
        },
        prepare: null,
        audit_args: null,
      });
    };
    server = await start({ register });
    expect((await admin(server, 'game_union', { value: { int_value: '1', text_value: 'a' }, color: 'Red' })).status).toBe(400);
    expect((await admin(server, 'game_union', { value: {}, color: 'Red' })).status).toBe(400);
    expect((await admin(server, 'game_union', { value: { text_value: 'a' }, color: 'Green' })).status).toBe(400);
    expect(calls).toBe(0);
    expect((await admin(server, 'game_union', { value: { text_value: 'a' }, color: 'Blue' })).status).toBe(200);
    expect(calls).toBe(1);
  });
});
