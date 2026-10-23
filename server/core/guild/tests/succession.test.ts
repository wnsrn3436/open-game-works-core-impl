import type { GameTx } from '../../storage/index.ts';
import { Role, START_AT, T, get_my_guild, guild_row, guild_with, member, read_logs, set_time, start, start_direct, stop_servers, users } from './kit.ts';

afterEach(stop_servers);

const L = 1000n;

/** A guild of a Leader, an Officer and a Member who all joined at `START_AT`. */
async function setup(inactive: bigint) {
  const kit = await start({ settings: { 'guild.leaderInactiveMs': Number(inactive) } });
  const [l, o, m] = await users(kit, 3);
  const guild_id = await guild_with(l, 'Home', [o, m], [o]);
  kit.content.changed.length = 0;
  return { kit, l, o, m, guild_id };
}

describe('leader succession', () => {
  it('does not happen at T + L − 1 and hands Leader to the Officer active within L at T + L, the previous Leader becoming a Member', async () => {
    const { kit, l, o, m, guild_id } = await setup(L);
    set_time(kit.server, START_AT + L - 1n);
    expect((await get_my_guild(o)).code).toBe(0);
    expect((await get_my_guild(m)).code).toBe(0);
    expect(guild_row(kit, guild_id)?.leader_id).toBe(l.user_id);
    expect(kit.content.changed).toEqual([]);
    set_time(kit.server, START_AT + L);
    const sent = await get_my_guild(m);
    expect(sent.code).toBe(0);
    expect(guild_row(kit, guild_id)?.leader_id).toBe(o.user_id);
    expect(member(kit, o.user_id)?.role).toBe(Role.GUILD_ROLE_LEADER);
    expect(member(kit, l.user_id)?.role).toBe(Role.GUILD_ROLE_MEMBER);
    expect(sent.response?.guild?.leader_id).toBe(o.user_id);
    expect(sent.response?.members.map((e) => [e.profile?.user_id, e.role])[0]).toEqual([o.user_id, Role.GUILD_ROLE_LEADER]);
    expect(kit.content.changed).toEqual([
      { ctx_user: m.user_id, guild_id, user_id: o.user_id, change: 'RoleChanged' },
      { ctx_user: m.user_id, guild_id, user_id: l.user_id, change: 'RoleChanged' },
    ]);
    const log = read_logs(kit.server, 'core', 'info').find((line) => line.message === 'guild leader succession');
    expect(log).toMatchObject({ guild_id: String(guild_id), previous_leader: String(l.user_id), new_leader: String(o.user_id) });
  }, T);

  it('hands Leader to the earliest active Member when no Officer was active within L', async () => {
    const { kit, l, m, guild_id } = await setup(L);
    set_time(kit.server, START_AT + L - 1n);
    expect((await get_my_guild(m)).code).toBe(0);
    set_time(kit.server, START_AT + L);
    expect((await get_my_guild(m)).code).toBe(0);
    expect(guild_row(kit, guild_id)?.leader_id).toBe(m.user_id);
    expect(member(kit, l.user_id)?.role).toBe(Role.GUILD_ROLE_MEMBER);
  }, T);

  it('does not happen when the Leader sends GetMyGuild at T + L, and that request makes the Leader active', async () => {
    const { kit, l, o, guild_id } = await setup(L);
    set_time(kit.server, START_AT + L - 1n);
    expect((await get_my_guild(o)).code).toBe(0);
    set_time(kit.server, START_AT + L);
    const sent = await get_my_guild(l);
    expect(sent.code).toBe(0);
    expect(sent.response?.guild?.leader_id).toBe(l.user_id);
    expect(guild_row(kit, guild_id)?.leader_id).toBe(l.user_id);
    expect(member(kit, l.user_id)).toMatchObject({ role: Role.GUILD_ROLE_LEADER, active_at: START_AT + L });
    expect(member(kit, o.user_id)?.role).toBe(Role.GUILD_ROLE_OFFICER);
    expect(kit.content.changed).toEqual([]);
  }, T);

  it('does not happen when no member was active within L', async () => {
    const { kit, l, m, guild_id } = await setup(L);
    set_time(kit.server, START_AT + 5n * L);
    expect((await get_my_guild(m)).code).toBe(0);
    expect(guild_row(kit, guild_id)?.leader_id).toBe(l.user_id);
    expect(member(kit, m.user_id)?.active_at).toBe(START_AT + 5n * L);
    expect(kit.content.changed).toEqual([]);
  }, T);

  it('does not happen when guild.leaderInactiveMs is null', async () => {
    // A test server takes no null settings override, so this runs on a server instance of its own (system clock).
    const server = await start_direct({ env: 'LOCAL', settings: { 'guild.leaderInactiveMs': null } });
    if (typeof server === 'string') throw new Error(`server start failed: ${server}`);
    const [l, o, m] = await users(server, 3);
    const guild_id = await guild_with(l, 'Home', [o, m], [o]);
    const storage = server.storage();
    expect(await storage.run_game_transaction((tx: GameTx) => storage.db(tx).query('UPDATE guild_member SET active_at = $2 WHERE user_id = $1', [l.user_id, 0n]))).toEqual([]);
    server.content.changed.length = 0;
    expect((await get_my_guild(m)).code).toBe(0);
    expect(guild_row(server, guild_id)?.leader_id).toBe(l.user_id);
    expect(member(server, l.user_id)).toMatchObject({ role: Role.GUILD_ROLE_LEADER, active_at: 0n });
    expect(server.content.changed).toEqual([]);
  }, T);
});
