// Operator authentication, the IP steps, roles and what the `audit` log keeps.
import { sha256_hex } from '../json.ts';
import type { AdminOperation, FieldType } from '../types.ts';
import {
  admin,
  admin_binary,
  admin_open_body,
  advance,
  audits,
  GOLD,
  has_module,
  items,
  login,
  logs,
  notice_mail,
  peer,
  start,
  stop,
  type AdminReply,
  type Register,
  type Server,
} from './helpers.ts';

/** Admin operations other modules export (`## API` collected operation table), with their roles, by module. */
const COLLECTED: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  'auth': [['withdraw_user', 'ops'], ['find_user_by_social_account', 'read'], ['find_user_by_public_code', 'read']],
  'logging': [['list_client_errors', 'read'], ['list_client_events', 'read'], ['list_server_events', 'read']],
  'game-update': [['get_deploy_list', 'read'], ['get_update_signing_key', 'read'], ['put_update_file', 'release'], ['publish_deploy_list', 'release'], ['prune_update_files', 'release']],
  'push': [['get_push', 'read'], ['list_pushes', 'read'], ['schedule_push', 'ops'], ['cancel_scheduled_push', 'ops']],
  'migration': [['get_migration_batch', 'read'], ['start_migration_batch', 'release'], ['stop_migration_batch', 'release']],
  'user-snapshot-clone': [
    ['export_user_snapshot', 'read'], ['sample_user_ids', 'read'], ['list_clones', 'read'], ['export_game_state', 'read'], ['sample_game_state', 'read'],
    ['import_user_snapshot', 'ops'], ['wipe_clone', 'ops'], ['import_game_state', 'ops'],
  ],
  'coupon': [['get_coupon', 'read'], ['list_coupon_codes', 'read'], ['create_coupon', 'economy'], ['disable_coupon', 'economy']],
  'notice': [['list_notices', 'read'], ['put_notice', 'ops'], ['delete_notice', 'ops']],
  'remote-config': [['list_remote_config', 'read'], ['set_config_value', 'ops'], ['clear_config_value', 'ops'], ['put_experiment', 'ops'], ['stop_experiment', 'ops']],
  'nickname': [['find_user_by_nickname', 'read'], ['rename_user', 'ops']],
  'gacha': [['list_gacha_history', 'read']],
  'iap': [['revoke_test_grant', 'economy']],
  'block-report': [['list_reports', 'read'], ['resolve_report', 'ops']],
  'guild': [
    ['get_guild', 'read'], ['rename_guild', 'ops'], ['set_guild_description', 'ops'], ['set_guild_member_role', 'ops'], ['kick_guild_member', 'ops'],
    ['disband_guild', 'ops'], ['import_guild', 'ops'],
  ],
  'chat': [['list_chat_messages', 'read'], ['delete_chat_message', 'ops'], ['mute_chat_user', 'ops'], ['unmute_chat_user', 'ops']],
};

/** admin-api's own admin operations and their roles, by the module they need (`admin-api` for none). */
const OWN: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  'admin-api': [
    ['get_user', 'read'], ['list_item_history', 'read'], ['get_switches', 'read'], ['export_personal_data', 'privacy'], ['ban_user', 'ops'], ['unban_user', 'ops'],
    ['set_maintenance', 'ops'], ['set_kill_switch', 'ops'], ['grant_items', 'economy'], ['revoke_items', 'economy'], ['send_mail', 'economy'],
    ['broadcast_mail', 'economy'], ['cancel_broadcast', 'economy'],
  ],
  'iap': [['list_payments', 'read']],
  'ranking': [['remove_ranking_user', 'ops']],
};

/** The test server's single-role operators are named by their role; `ogw` has every role. */
function holder(role: string): string {
  return role === 'privacy' ? 'ogw' : role;
}

function outsider(role: string): string {
  return role === 'read' ? 'ops' : 'read';
}

/** A collected admin operation as routing handed it to admin-api, and how many times its prepare or handler function ran. */
interface Spied {
  readonly operation: AdminOperation;
  calls: number;
}

/** Wraps every admin operation routing hands to admin-api so that the test sees its form and counts its calls. */
function spy_collected(spied: Map<string, Spied>): Register {
  return (core) => {
    const api = core['admin-api'];
    const register = api.register_admin_operation.bind(api);
    api.register_admin_operation = (module, operation) => {
      const spy: Spied = { operation, calls: 0 };
      spied.set(operation.name, spy);
      const prepare = operation.prepare ?? null;
      register(module, {
        ...operation,
        handler: (input, transaction, prepare_value, body) => {
          spy.calls += 1;
          return operation.handler(input, transaction, prepare_value, body);
        },
        prepare:
          prepare === null
            ? null
            : (input, body) => {
                spy.calls += 1;
                return prepare(input, body);
              },
      });
    };
  };
}

/** A value of the field type that passes the body rules; query string values are strings. */
function sample(name: string, type: FieldType, query: boolean): unknown {
  switch (type.kind) {
    case 'int64':
      return name === 'from_at' || name === 'after_seq' ? '0' : '1';
    case 'int32':
      return query ? '1' : 1;
    case 'bool':
      return false;
    case 'string':
      return name === 'big_amount' ? '' : 'x';
    case 'enum':
      return type.elements[0];
    case 'array':
      return [];
    case 'object':
      return Object.fromEntries(Object.entries(type.fields).filter(([, spec]) => spec.optional !== true).map(([key, spec]) => [key, sample(key, spec.type, query)]));
    case 'object_union': {
      const [key, field] = Object.entries(type.fields)[0] ?? ['', { kind: 'json' } as const];
      return { [key]: sample(key, field, query) };
    }
    case 'json':
      return {};
  }
}

/** A body of admin-api's own operation that it answers with 200 for an existing user. */
function own_body(operation: string, user_id: string, broadcast_id: string): Record<string, unknown> {
  const mail = notice_mail('role check');
  const bodies: Readonly<Record<string, Record<string, unknown>>> = {
    get_user: { user_id },
    list_item_history: { user_id, from_at: '0', to_at: '1', after_seq: '0', limit: 1 },
    get_switches: {},
    export_personal_data: { user_id },
    ban_user: { user_id, until_at: '0', reason: 'role check' },
    unban_user: { user_id },
    set_maintenance: { enabled: false },
    set_kill_switch: { request_name: 'MATCH_REQUEST', enabled: false },
    grant_items: { operation_id: 'role-grant', user_id, items: items(GOLD, 1n) },
    revoke_items: { operation_id: 'role-revoke', user_id, items: items(GOLD, 1n) },
    send_mail: { operation_id: 'role-mail', user_id, mail },
    broadcast_mail: { operation_id: 'role-broadcast', mail, start_at: '4000000000000' },
    cancel_broadcast: { broadcast_id },
    list_payments: { user_id },
    remove_ranking_user: { user_id },
  };
  return bodies[operation] ?? {};
}

function probe(calls: { n: number }): Register {
  return (core) => {
    core.routing.register_admin_operation({
      name: 'game_probe',
      role: 'read',
      body: 'json',
      max_body_bytes: null,
      input: {},
      user_target: null,
      handler: () => {
        calls.n += 1;
        return {};
      },
      prepare: null,
      audit_args: null,
    });
  };
}

describe('operator authentication', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('answers 401 for an unknown operator and a wrong secret, and 429 even for the right secret once the IP reached the limit in that minute window', async () => {
    server = await start({ settings: { 'admin-api.authFailuresPerMinute': 3 } });
    expect((await admin(server, 'get_switches', {}, 'nobody', 'secret')).status).toBe(401);
    expect((await admin(server, 'get_switches', {}, 'ogw', 'wrong')).status).toBe(401);
    expect((await admin(server, 'get_switches')).status).toBe(200);
    const third = await admin(server, 'get_switches', {}, 'ogw', 'wrong');
    expect(third.status).toBe(401);
    expect(third.json).toEqual({ error: 'unauthorized' });
    const limited = await admin(server, 'get_switches');
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({ error: 'rate_limited' });
    advance(server, 60000n);
    expect((await admin(server, 'get_switches')).status).toBe(200);
  });

  it('answers 403 outside adminAllowedCidrs even for the right secret, without calling the handler function', async () => {
    const calls = { n: 0 };
    server = await start({ settings: { 'environments.<ENV>.adminAllowedCidrs': ['10.0.0.0/8'] }, register: probe(calls) });
    const reply = await admin(server, 'game_probe');
    expect(reply.status).toBe(403);
    expect(reply.json).toEqual({ error: 'forbidden' });
    expect(calls.n).toBe(0);
    expect(logs(server, 'security').some((line) => line.reason === 'forbidden')).toBe(true);
  });

  it('does not refuse any IP at step 1 when adminAllowedCidrs is null', async () => {
    const calls = { n: 0 };
    server = await start({ settings: { 'environments.<ENV>.adminAllowedCidrs': null }, register: probe(calls) });
    expect((await admin(server, 'game_probe')).status).toBe(200);
    expect(calls.n).toBe(1);
  });

  it('lets in an IP inside adminAllowedCidrs', async () => {
    const calls = { n: 0 };
    server = await start({ settings: { 'environments.<ENV>.adminAllowedCidrs': ['127.0.0.0/8', '::1/128'] }, register: probe(calls) });
    expect((await admin(server, 'game_probe')).status).toBe(200);
    expect(calls.n).toBe(1);
  });

  it('answers 403 when adminAllowedCidrs holds the client IP without a prefix', async () => {
    const calls = { n: 0 };
    server = await start({ settings: { 'environments.<ENV>.adminAllowedCidrs': ['127.0.0.1', '::1', '::ffff:127.0.0.1'] }, register: probe(calls) });
    const reply = await admin(server, 'game_probe');
    expect(reply.status).toBe(403);
    expect(reply.json).toEqual({ error: 'forbidden' });
    expect(calls.n).toBe(0);
  });

  it('puts actor on every audit log line: null before step 2 passed, the operator name on the lines of requests that passed it', async () => {
    server = await start();
    await admin(server, 'get_switches', {}, 'ogw', 'wrong');
    await admin(server, 'get_switches');
    await admin(server, 'grant_items', { operation_id: 'a', user_id: '1', items: [] }, 'read');
    await admin(server, 'no_such_operation');
    const lines = audits(server);
    expect(lines).toHaveLength(4);
    for (const line of lines) expect(Object.hasOwn(line, 'actor')).toBe(true);
    expect(lines[0]?.actor).toBeNull();
    expect(lines.slice(1).map((line) => line.actor)).toEqual(['ogw', 'read', 'ogw']);
    expect(lines.map((line) => line.status)).toEqual([401, 200, 403, 404]);
  });

  it('answers 401 to a request without Authorization without reading its body, even past admin-api.maxBodyBytes', async () => {
    server = await start({ settings: { 'admin-api.maxBodyBytes': 16, 'admin-api.bodyReadTimeoutMs': 60000 } });
    const json = { 'Content-Type': 'application/json' };
    const over = await admin_open_body(server, 'get_user', json, new TextEncoder().encode(`{"user_id":"1","padding":"${'x'.repeat(64)}`), 2000);
    expect([over.status, over.json, over.before_body_end]).toEqual([401, { error: 'unauthorized' }, true]);
    // Under the limit, an unfinished body is not waited for either.
    const under = await admin_open_body(server, 'get_user', json, new TextEncoder().encode('{"user'), 2000);
    expect([under.status, under.before_body_end]).toEqual([401, true]);
    expect(audits(server, 'get_user').map((line) => [line.status, line.actor, line.args])).toEqual([
      [401, null, null],
      [401, null, null],
    ]);
  });

  it('answers 403 outside adminAllowedCidrs and 429 at the IP limit without reading the body', async () => {
    server = await start({ settings: { 'environments.<ENV>.adminAllowedCidrs': ['10.0.0.0/8'], 'admin-api.bodyReadTimeoutMs': 60000 } });
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ogw.${server.admin_secret('ogw') ?? ''}` };
    const outside = await admin_open_body(server, 'get_switches', headers, new TextEncoder().encode('{'), 2000);
    expect([outside.status, outside.before_body_end]).toEqual([403, true]);
    await stop(server);
    server = await start({ settings: { 'admin-api.authFailuresPerMinute': 1, 'admin-api.bodyReadTimeoutMs': 60000 } });
    await admin(server, 'get_switches', {}, 'ogw', 'wrong');
    const right = { 'Content-Type': 'application/json', 'Authorization': `Bearer ogw.${server.admin_secret('ogw') ?? ''}` };
    const limited = await admin_open_body(server, 'get_switches', right, new TextEncoder().encode('{'), 2000);
    expect([limited.status, limited.before_body_end]).toEqual([429, true]);
  });

  it('counts auth failures of one IP sent to two server instances on one counter', async () => {
    server = await start({ settings: { 'admin-api.authFailuresPerMinute': 4 } });
    const other = await peer(server);
    try {
      await admin(server, 'get_switches', {}, 'ogw', 'wrong');
      await admin(other, 'get_switches', {}, 'ogw', 'wrong');
      await admin(server, 'get_switches', {}, 'ogw', 'wrong');
      expect((await admin(other, 'get_switches')).status).toBe(200);
      await admin(other, 'get_switches', {}, 'ogw', 'wrong');
      expect((await admin(server, 'get_switches')).status).toBe(429);
      expect((await admin(other, 'get_switches')).status).toBe(429);
    } finally {
      await stop(other);
    }
  });
});

describe('audit log', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('keeps no secret and no binary body, and the SHA-256 of a binary body', async () => {
    const register: Register = (core) => {
      core.routing.register_admin_operation({
        name: 'game_upload',
        role: 'release',
        body: 'binary',
        max_body_bytes: 1024,
        input: { name: { type: { kind: 'string' }, optional: false } },
        user_target: null,
        handler: () => ({}),
        prepare: null,
        audit_args: null,
      });
    };
    server = await start({ register });
    await admin(server, 'get_switches', {}, 'ogw', 'not-the-secret-7f3a');
    expect((await admin(server, 'get_switches')).status).toBe(200);
    const body = new TextEncoder().encode('BINARY-BODY-MARK-91c2');
    expect((await admin_binary(server, 'game_upload', body, { name: 'file' })).status).toBe(200);
    const text = JSON.stringify(audits(server));
    expect(text).not.toContain('not-the-secret-7f3a');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('BINARY-BODY-MARK-91c2');
    expect(text).not.toContain(Buffer.from(body).toString('base64'));
    const upload = audits(server, 'game_upload')[0];
    expect(upload?.args).toEqual({ name: 'file', body_sha256: sha256_hex(body) });
  });

  it('keeps the truncated IP', async () => {
    server = await start();
    await admin(server, 'get_switches');
    await admin(server, 'get_switches', {}, 'ogw', 'wrong');
    const lines = [...audits(server), ...logs(server, 'security')];
    expect(lines.length).toBeGreaterThanOrEqual(3);
    // The test client connects to 127.0.0.1.
    for (const line of lines) expect(line.ip).toBe('127.0.0.0');
  });

  it('keeps null args for a request that ended in steps 1 to 4, and the operator as actor once step 2 passed', async () => {
    server = await start({ settings: { 'admin-api.maxBodyBytes': 16 } });
    await admin(server, 'get_user', { user_id: '1234567890', padding: 'xxxxxxxxxxxxxxxx' });
    await admin(server, 'get_user', { user_id: '1' }, 'ogw', 'wrong');
    await admin(server, 'get_user', { user_id: '1' }, 'ops');
    const lines = audits(server, 'get_user');
    expect(lines.map((line) => [line.status, line.error, line.args, line.actor])).toEqual([
      [400, 'bad_request', null, 'ogw'],
      [401, 'unauthorized', null, null],
      [403, 'forbidden', null, 'ops'],
    ]);
  });

  it('keeps a null actor for a request refused at step 1', async () => {
    server = await start({ settings: { 'environments.<ENV>.adminAllowedCidrs': ['10.0.0.0/8'] } });
    expect((await admin(server, 'get_switches')).status).toBe(403);
    const lines = audits(server, 'get_switches');
    expect(lines.map((line) => [line.status, line.args])).toEqual([[403, null]]);
    expect(lines[0]?.actor).toBeNull();
  });
});

describe('roles', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  /** Steps 3 and 4 for each operation: a wrong secret is 401, an operator without the role is 403. */
  async function check_refusals(operation: string, role: string): Promise<void> {
    expect([operation, (await admin(server, operation, {}, holder(role), 'wrong')).status]).toEqual([operation, 401]);
    expect([operation, (await admin(server, operation, {}, outsider(role))).status]).toEqual([operation, 403]);
  }

  /**
   * Each collected operation with its role: a holder's request with input that passes the body rules reaches that
   * module's prepare or handler function, a wrong secret is 401 and an operator without the role is 403.
   */
  async function check_collected(operations: readonly (readonly [string, string])[]): Promise<void> {
    const spied = new Map<string, Spied>();
    server = await start({ settings: { 'admin-api.authFailuresPerMinute': 100000 }, register: spy_collected(spied) });
    for (const [operation, role] of operations) {
      const spy = spied.get(operation);
      expect([operation, spy === undefined ? 'not registered' : 'registered']).toEqual([operation, 'registered']);
      if (spy === undefined) continue;
      const target = spy.operation.user_target;
      const user_id = target === null ? null : (await login(server, `role_${operation}`)).user_id;
      const allowed = await send_valid(spy.operation, holder(role), user_id);
      // Whatever the module answers to the sample input, its own processing ran (steps 1 to 5 passed).
      expect([operation, allowed.status === 401 || allowed.status === 403, spy.calls > 0]).toEqual([operation, false, true]);
      await check_refusals(operation, role);
    }
  }

  async function send_valid(operation: AdminOperation, operator: string, user_id: string | null): Promise<AdminReply> {
    const input: Record<string, unknown> = {};
    const binary = operation.body === 'binary';
    for (const [name, spec] of Object.entries(operation.input)) {
      if (spec.optional === true) continue;
      input[name] = name === operation.user_target ? user_id : sample(name, spec.type, binary);
    }
    if (!binary) return admin(server, operation.name, input, operator);
    return admin_binary(server, operation.name, new TextEncoder().encode('role check'), input as Record<string, string>, operator);
  }

  for (const [module, operations] of Object.entries(COLLECTED)) {
    // A module that this core does not have yet (or that is not in the server module list) has nothing to collect.
    it.skipIf(!has_module(module))(`lets each role call the admin operations of ${module}, 401 for a wrong secret, 403 without the role`, async () => {
      await check_collected(operations);
    });
  }

  for (const [module, operations] of Object.entries(OWN)) {
    // list_payments needs iap and remove_ranking_user needs ranking: without them admin-api does not register them.
    it.skipIf(!has_module(module))(`lets each role call admin-api's operations that need ${module}, 401 for a wrong secret, 403 without the role`, async () => {
      server = await start({ settings: { 'admin-api.authFailuresPerMinute': 100000 } });
      const { user_id } = await login(server, 'role_own');
      let broadcast_id = '0';
      for (const [operation, role] of operations) {
        const allowed = await admin(server, operation, own_body(operation, user_id, broadcast_id), holder(role));
        expect([operation, allowed.status, allowed.text]).toEqual([operation, 200, expect.any(String)]);
        if (operation === 'broadcast_mail') broadcast_id = String(allowed.json.broadcast_id);
        await check_refusals(operation, role);
      }
    });
  }

  it('answers 404 for an operation that is not registered, after authentication', async () => {
    server = await start();
    expect((await admin(server, 'no_such_operation')).status).toBe(404);
    expect((await admin(server, 'no_such_operation', {}, 'ogw', 'wrong')).status).toBe(401);
  });
});
