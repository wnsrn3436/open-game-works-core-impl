// Operators outside a LOCAL server and a test server (`environments.<ENV>.adminOperators`), their start failures, and
// `register_admin_operation` after server start. A test server always has `--db` and so the fixed operators; here
// admin-api is made directly with a `server` whose `db` is null, as in a DEV, STG or PROD server instance.
import { create_item_ledger } from '../../item-ledger/index.ts';
import { create_logging } from '../../logging/index.ts';
import { create_mailbox } from '../../mailbox/index.ts';
import { create_server_time } from '../../server-time/index.ts';
import { create_storage } from '../../storage/index.ts';
import { core_settings, new_db, test_server } from '../../storage/tests/helpers.ts';
import { create_admin_api } from '../index.ts';
import type { AdminApi, AdminOperation, RouteRequest } from '../types.ts';

interface Made {
  readonly api: AdminApi;
  /** Secret names admin-api read. */
  readonly read: string[];
  /** Server start: the start failure reason, or null. */
  readonly start: () => string | null;
  readonly stop: () => void;
}

const running: Made[] = [];

/**
 * admin-api of a server instance without `--db`, with `adminOperators` and a secret store, over real `server-time`,
 * `storage`, `logging`, `item-ledger` and `mailbox` on a test DB. Only admin-api's `server` lacks `--db`.
 */
async function make(operators: unknown, secrets: Readonly<Record<string, string>>): Promise<Made> {
  const read: string[] = [];
  const settings: Record<string, unknown> = {
    ...core_settings(),
    dailyResetOffsetMs: 0,
    'environments.<ENV>.adapters.analytics': null,
    'environments.<ENV>.adminOperators': operators,
    'environments.<ENV>.adminAllowedCidrs': null,
  };
  const server = test_server(await new_db(), { env: 'DEV', server_modules: ['server-time', 'storage', 'logging', 'item-ledger', 'mailbox', 'admin-api'] });
  const time = create_server_time({ settings, modules: {} });
  const storage = create_storage({ settings, modules: { 'server-time': time }, server });
  const logging = create_logging({ settings, modules: { storage, 'server-time': time }, server });
  const ledger = create_item_ledger({ settings, modules: { storage, 'server-time': time, logging }, server });
  const mailbox = create_mailbox({ settings, modules: { storage, 'item-ledger': ledger, 'server-time': time, logging }, server });
  const admin_server = {
    db: null,
    read_secret: (name: string): string | null => {
      read.push(name);
      return secrets[name] ?? null;
    },
  };
  const api = create_admin_api({ settings, modules: { storage, 'server-time': time, logging, 'item-ledger': ledger, mailbox }, server: admin_server });
  const modules = [time, storage, logging, ledger, mailbox, api];
  const made: Made = {
    api,
    read,
    start: () => {
      for (const module of modules) module.begin_start();
      let failure: string | null = null;
      for (const module of modules) failure ??= module.complete_start();
      // Server start ends: every job runs once.
      if (failure === null) time.end_start();
      return failure;
    },
    stop: () => {
      for (const module of [...modules].reverse()) module.stop();
    },
  };
  running.push(made);
  return made;
}

afterEach(() => {
  for (const made of running.splice(0)) made.stop();
});

function request(operation: string, authorization: string): RouteRequest {
  return {
    method: 'POST',
    path: `/admin/${operation}`,
    query: '',
    headers: { authorization },
    read_body: () => Promise.resolve(new TextEncoder().encode('{}')),
  };
}

async function status(api: AdminApi, operation: string, authorization: string): Promise<number> {
  return (await api['POST /admin/<operation>'](request(operation, authorization), '203.0.113.7')).status;
}

const PROBE: AdminOperation = {
  name: 'game_probe',
  role: 'read',
  body: 'json',
  max_body_bytes: null,
  input: {},
  user_target: null,
  handler: () => ({}),
  prepare: null,
  audit_args: null,
};

describe('adminOperators', () => {
  it('reads the operators and their secrets from adminOperators when the server has no --db', async () => {
    const { api, read, start } = await make(
      [
        { name: 'alice', roles: ['read'], secret: 'store-alice' },
        { name: 'bob', roles: ['ops', 'read'], secret: 'store-bob' },
      ],
      { 'store-alice': 'alice-secret', 'store-bob': 'bob-secret', 'adminSecret.ogw': 'ogw-secret' },
    );
    expect(start()).toBeNull();
    // The secret is read by its secret store name; the fixed LOCAL operators are not loaded.
    expect(read).toEqual(['store-alice', 'store-bob']);
    expect(await status(api, 'get_switches', 'Bearer alice.alice-secret')).toBe(200);
    expect(await status(api, 'get_switches', 'Bearer bob.bob-secret')).toBe(200);
    expect(await status(api, 'get_switches', 'Bearer alice.bob-secret')).toBe(401);
    expect(await status(api, 'get_switches', 'Bearer ogw.ogw-secret')).toBe(401);
    expect(await status(api, 'set_maintenance', 'Bearer alice.alice-secret')).toBe(403);
  });

  it('does not start when adminOperators has the same name twice', async () => {
    const { start } = await make(
      [
        { name: 'alice', roles: ['read'], secret: 'store-alice' },
        { name: 'alice', roles: ['ops'], secret: 'store-alice-2' },
      ],
      { 'store-alice': 'a', 'store-alice-2': 'b' },
    );
    expect(start()).toMatch(/alice twice/);
  });

  it("does not start when an operator's secret cannot be read", async () => {
    const { start } = await make(
      [
        { name: 'alice', roles: ['read'], secret: 'store-alice' },
        { name: 'bob', roles: ['ops'], secret: 'store-missing' },
      ],
      { 'store-alice': 'a' },
    );
    expect(start()).toMatch(/secret of operator bob cannot be read/);
  });
});

describe('register_admin_operation', () => {
  it('throws after server start', async () => {
    const { api, start } = await make([{ name: 'alice', roles: ['read'], secret: 'store-alice' }], { 'store-alice': 'a' });
    api.register_admin_operation('game', PROBE);
    expect(start()).toBeNull();
    expect(() => {
      api.register_admin_operation('game', { ...PROBE, name: 'game_late' });
    }).toThrow(/after server start/);
  });
});
