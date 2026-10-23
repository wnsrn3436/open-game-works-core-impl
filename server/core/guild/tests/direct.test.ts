/**
 * `register_disband_listener`, which only core modules call during server start, and the PROD rule of `import_guild`.
 * These run on server instances made with `routing.create_server`, since a test server neither hands `register` the
 * `guild` module object nor runs as PROD.
 */
import type { GameTx, RequestCtx } from '../../storage/index.ts';
import { read_logs } from '../../testing/dev/index.ts';
import { E, T, create_guild, guild_row, leave, member, rows, snapshot, start, start_direct, stop_servers, users, type Direct } from './kit.ts';

afterEach(stop_servers);

async function direct(listeners: readonly ((ctx_or_tx: RequestCtx | GameTx, guild_id: bigint) => void)[]): Promise<Direct> {
  const started = await start_direct({ env: 'LOCAL', listeners });
  if (typeof started === 'string') throw new Error(`server start failed: ${started}`);
  return started;
}

describe('register_disband_listener', () => {
  it('calls the function once inside the disband transaction; a throw is INTERNAL and keeps the guild', async () => {
    const calls: { guild_id: bigint; visible: number }[] = [];
    let fail = false;
    let server: Direct | null = null;
    const listener = (ctx_or_tx: RequestCtx | GameTx, guild_id: bigint): void => {
      const visible = server?.storage().db(ctx_or_tx).query('SELECT guild_id FROM guild_guild WHERE guild_id = $1', [guild_id]).length ?? -1;
      calls.push({ guild_id, visible });
      if (fail) throw new Error('listener failure');
    };
    server = await direct([listener]);
    const [a, b] = await users(server, 2);
    const first = (await create_guild(a, 'First')).guild_id;
    const second = (await create_guild(b, 'Second')).guild_id;
    server.content.changed.length = 0;
    expect(await leave(a)).toBe(0);
    expect(calls).toEqual([{ guild_id: first, visible: 1 }]);
    expect(server.content.changed.map((c) => c.change)).toEqual(['Disbanded']);
    expect(guild_row(server, first)).toBeNull();
    fail = true;
    expect(await leave(b)).toBe(E.CORE_ERROR_INTERNAL);
    expect(calls).toHaveLength(2);
    expect(guild_row(server, second)).not.toBeNull();
    expect(member(server, b.user_id)?.guild_id).toBe(second);
    expect(rows(server, 'SELECT guild_id FROM guild_name WHERE guild_id = $1', [second])).toHaveLength(1);
  }, T);

  it('fails server start for the same function registered twice and writes an error log', async () => {
    const listener = (): void => undefined;
    const logs: Record<string, unknown>[] = [];
    const started = await start_direct({ env: 'LOCAL', listeners: [listener, listener], logs });
    expect(started).toEqual(expect.stringMatching(/registered twice/));
    expect(logs.some((line) => line.kind === 'error' && line.level === 'error' && line.module === 'guild' && line.message === 'register_disband_listener: the same function is registered twice')).toBe(true);
  }, T);

  it('throws for a registration after server start and writes an error log', async () => {
    const kit = await start();
    expect(() => kit.module().register_disband_listener(() => undefined)).toThrow(/after server start/);
    expect(read_logs(kit.server, 'error', 'error').some((line) => line.module === 'guild' && line.message === 'register_disband_listener: called after server start')).toBe(true);
  }, T);
});

describe('import_guild in PROD', () => {
  it('is conflict and changes nothing', async () => {
    const started = await start_direct({ env: 'PROD' });
    if (typeof started === 'string') throw new Error(`server start failed: ${started}`);
    const user_id = await started.storage().run_game_transaction((tx: GameTx) => started.storage().create_user(tx));
    if (typeof user_id !== 'bigint') throw new Error('create_user failed');
    const before = snapshot(started);
    const input = { operation_id: 'p', name: 'Prod', description: '', join_type: 'Open', join_value: '0', max_members: 5, members: [{ user_id: String(user_id), role: 'Leader' }] };
    expect((await started.admin('import_guild', input)).status).toBe(409);
    expect(snapshot(started)).toBe(before);
    expect(rows(started, 'SELECT guild_id FROM guild_guild')).toEqual([]);
  }, T);
});
