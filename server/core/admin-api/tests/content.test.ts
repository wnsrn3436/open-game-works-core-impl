// Module and content admin operations: the `operation_id` rule, user-targeted operations, prepare functions,
// read-only role `read`, and start failures.
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import type { AdminOperation } from '../types.ts';
import {
  admin,
  audits,
  balance,
  claim_all,
  gold,
  GOLD,
  id_value,
  login,
  MISSING_USER,
  start,
  stop,
  withdraw,
  type Core,
  type Register,
  type Server,
} from './helpers.ts';

function registering(...operations: ((core: Core) => AdminOperation)[]): Register {
  return (core) => {
    for (const make of operations) core.routing.register_admin_operation(make(core));
  };
}

describe('operation_id of module and content admin operations', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('keeps no record of a request whose handler function threw or returned a failure reason, so a retry calls it again', async () => {
    let mode: 'throw' | 'fail' | 'ok' = 'throw';
    let calls = 0;
    server = await start({
      register: registering(() => ({
        name: 'game_flaky',
        role: 'economy',
        body: 'json',
        input: { operation_id: { type: { kind: 'string' } } },
        user_target: null,
        handler: () => {
          calls += 1;
          if (mode === 'throw') throw new Error('flaky handler');
          if (mode === 'fail') return 'conflict';
          return { calls };
        },
      })),
    });
    expect((await admin(server, 'game_flaky', { operation_id: 'a' })).status).toBe(500);
    mode = 'fail';
    expect((await admin(server, 'game_flaky', { operation_id: 'a' })).status).toBe(409);
    mode = 'ok';
    const done = await admin(server, 'game_flaky', { operation_id: 'a' });
    expect(done.status).toBe(200);
    expect(done.json).toEqual({ calls: 3 });
    const again = await admin(server, 'game_flaky', { operation_id: 'a' });
    expect(again.text).toBe(done.text);
    expect(calls).toBe(3);
  });

  it('calls the handler function for only one of two concurrent requests with the same operation_id', async () => {
    let calls = 0;
    server = await start({
      register: registering(() => ({
        name: 'game_once',
        role: 'economy',
        body: 'json',
        input: { operation_id: { type: { kind: 'string' } } },
        user_target: null,
        handler: () => {
          calls += 1;
          return { calls };
        },
      })),
    });
    const [a, b] = await Promise.all([admin(server, 'game_once', { operation_id: 'c' }), admin(server, 'game_once', { operation_id: 'c' })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.text).toBe(b.text);
    expect(calls).toBe(1);
  });
});

describe('user-targeted operations', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('answers 404 for a missing user and a withdrawn user of an operation with user_target, without calling the handler function', async () => {
    let calls = 0;
    server = await start({
      register: registering(() => ({
        name: 'game_target',
        role: 'ops',
        body: 'json',
        input: { user_id: { type: { kind: 'int64' } } },
        user_target: 'user_id',
        handler: () => {
          calls += 1;
          return {};
        },
      })),
    });
    const { user_id } = await login(server, 'target');
    const { user_id: leaver } = await login(server, 'target_leaver');
    await withdraw(server, leaver);
    expect((await admin(server, 'game_target', { user_id: MISSING_USER })).status).toBe(404);
    expect((await admin(server, 'game_target', { user_id: leaver })).status).toBe(404);
    expect(calls).toBe(0);
    expect((await admin(server, 'game_target', { user_id })).status).toBe(200);
    expect(calls).toBe(1);
  });

  it('runs a game_ content admin operation through the processing order, authentication, operation_id and audit log, with add_items recorded as source Admin and the operation name', async () => {
    server = await start({
      register: registering((core) => ({
        name: 'game_grant',
        role: 'economy',
        body: 'json',
        input: { operation_id: { type: { kind: 'string' } }, user_id: { type: { kind: 'int64' } } },
        user_target: 'user_id',
        handler: (_input, tx) => {
          core['item-ledger'].add_items(tx as RequestCtx, gold(3n));
          return { granted: 3 };
        },
      })),
    });
    const { session, user_id } = await login(server, 'content');
    expect((await admin(server, 'game_grant', { operation_id: 'g', user_id }, 'ogw', 'wrong')).status).toBe(401);
    expect((await admin(server, 'game_grant', { operation_id: 'g', user_id }, 'read')).status).toBe(403);
    expect((await admin(server, 'game_grant', { operation_id: 'g', user_id, other: 1 })).status).toBe(400);
    const first = await admin(server, 'game_grant', { operation_id: 'g', user_id });
    const second = await admin(server, 'game_grant', { operation_id: 'g', user_id });
    expect(first.status).toBe(200);
    expect(second.text).toBe(first.text);
    expect((await admin(server, 'game_grant', { operation_id: 'g', user_id: MISSING_USER })).status).toBe(404);
    expect(await balance(server, user_id, GOLD)).toBe(3n);
    const change = (await claim_all(session)).envelope.item_changes.find((c) => c.item_id === id_value(GOLD));
    expect(change?.source).toBe(CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ADMIN);
    expect(change?.ref).toBe('game_grant');
    const lines = audits(server, 'game_grant');
    expect(lines).toHaveLength(6);
    expect(lines[3]).toMatchObject({ actor: 'ogw', status: 200, error: null, args: { operation_id: 'g', user_id } });
    expect(String(lines[3]?.user_id)).toBe(user_id);
  });
});

describe('prepare functions', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('calls the prepare function once before the handler function and passes its value; a failure reason ends the request without the handler function', async () => {
    const order: string[] = [];
    server = await start({
      register: registering(() => ({
        name: 'game_prepared',
        role: 'ops',
        body: 'json',
        input: { mode: { type: { kind: 'string' } } },
        user_target: null,
        prepare: async (input) => {
          order.push('prepare');
          await Promise.resolve();
          if (input.mode === 'external') return 'external_failed';
          if (input.mode === 'missing') return 'not_found';
          return { value: 7 };
        },
        handler: (_input, _tx, prepared) => {
          order.push('handler');
          return { got: (prepared as { value: number }).value };
        },
      })),
    });
    const ok = await admin(server, 'game_prepared', { mode: 'ok' });
    expect(ok.json).toEqual({ got: 7 });
    expect(order).toEqual(['prepare', 'handler']);
    order.length = 0;
    expect((await admin(server, 'game_prepared', { mode: 'external' })).status).toBe(502);
    expect((await admin(server, 'game_prepared', { mode: 'missing' })).status).toBe(404);
    expect(order).toEqual(['prepare', 'prepare']);
  });
});

describe('role read', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('answers 500 when a role read content admin operation writes, with and without user_target, and keeps the state', async () => {
    server = await start({
      register: registering(
        (core) => ({
          name: 'game_read_user',
          role: 'read',
          body: 'json',
          input: { user_id: { type: { kind: 'int64' } } },
          user_target: 'user_id',
          handler: (_input, tx) => {
            core['item-ledger'].add_items(tx as RequestCtx, gold(1n));
            return {};
          },
        }),
        (core) => ({
          name: 'game_read_game',
          role: 'read',
          body: 'json',
          input: {},
          user_target: null,
          handler: (_input, tx) => {
            core.storage.db(tx).query("INSERT INTO admin_api_switch (kind, target, updated_at) VALUES ('maintenance', '', 0)", []);
            return {};
          },
        }),
      ),
    });
    const { session, user_id } = await login(server, 'reader');
    expect((await admin(server, 'game_read_user', { user_id })).status).toBe(500);
    expect(await balance(server, user_id, GOLD)).toBe(0n);
    expect((await claim_all(session)).envelope.pending_user_state?.entries ?? []).toEqual([]);
    expect((await admin(server, 'game_read_game')).status).toBe(500);
    expect((await admin(server, 'get_switches')).json.maintenance).toBe(false);
  });

  it('does not start with a role read content admin operation that has an operation_id input field', async () => {
    const register = registering(() => ({
      name: 'game_read_once',
      role: 'read',
      body: 'json',
      input: { operation_id: { type: { kind: 'string' } } },
      user_target: null,
      handler: () => ({}),
    }));
    await expect(start({ register })).rejects.toThrow();
    server = await start();
  });

  it('does not start with a content admin operation whose name does not start with game_, or with a name another operation has', async () => {
    const plain = (name: string) => () => ({ name, role: 'ops' as const, body: 'json' as const, input: {}, user_target: null, handler: () => ({}) });
    await expect(start({ register: registering(plain('reset_all')) })).rejects.toThrow();
    await expect(start({ register: registering(plain('game_x'), plain('game_x')) })).rejects.toThrow();
    server = await start();
  });
});

describe('items of a user-targeted collected operation', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('commits the handler function\'s change as one out-of-request change of the target user', async () => {
    server = await start({
      register: registering((core) => ({
        name: 'game_gift',
        role: 'economy',
        body: 'json',
        input: { user_id: { type: { kind: 'int64' } } },
        user_target: 'user_id',
        handler: (_input, tx) => {
          core['item-ledger'].add_items(tx as RequestCtx, gold(2n));
          return {};
        },
      })),
    });
    const { session, user_id } = await login(server, 'gift');
    expect((await admin(server, 'game_gift', { user_id })).status).toBe(200);
    const next = await claim_all(session);
    expect(next.envelope.pending_user_state?.entries.some((e) => e.kind === 'ItemBalanceUserState') ?? false).toBe(true);
    expect(await balance(server, user_id, GOLD)).toBe(2n);
  });
});
