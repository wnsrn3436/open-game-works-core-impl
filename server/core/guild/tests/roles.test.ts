import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import {
  E,
  JoinType,
  Role,
  T,
  START_AT,
  admin,
  advance_time,
  cooldown,
  create_guild,
  get_my_guild,
  guild_row,
  guild_with,
  join_guild,
  leave,
  member,
  member_ids,
  name_rows,
  on_user,
  requests,
  run_core_test,
  set_role,
  start,
  stop_servers,
  test_state,
  update_guild,
  users,
  type TestSession,
} from './kit.ts';

afterEach(stop_servers);

describe('LeaveGuild and KickGuildMember', () => {
  it('is GUILD_LEADER_CANNOT_LEAVE for a Leader with other members; a Leader alone disbands, calls Disbanded once, deletes the join requests to the guild, and frees the name', async () => {
    const kit = await start();
    const [l, a, b] = await users(kit, 3);
    const guild_id = await guild_with(l, 'Home', [a]);
    expect(await leave(l)).toBe(E.CORE_ERROR_GUILD_LEADER_CANNOT_LEAVE);
    expect(await leave(a)).toBe(0);
    expect(member(kit, a.user_id)).toBeNull();
    expect(guild_row(kit, guild_id)?.member_count).toBe(1);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_APPROVAL)).toBe(0);
    expect(await join_guild(b, guild_id)).toEqual({ code: 0, joined: false });
    expect(requests(kit)).toEqual([{ guild_id, user_id: b.user_id }]);
    kit.content.changed.length = 0;
    expect(await leave(l)).toBe(0);
    expect(kit.content.changed).toEqual([{ ctx_user: l.user_id, guild_id, user_id: l.user_id, change: 'Disbanded' }]);
    expect(guild_row(kit, guild_id)).toBeNull();
    expect(member_ids(kit, guild_id)).toEqual([]);
    expect(name_rows(kit)).toEqual([]);
    expect(requests(kit)).toEqual([]);
    expect((await get_my_guild(b)).response?.my_join_requests).toEqual([]);
    expect(cooldown(kit, l.user_id)).toBeNull();
    expect((await create_guild(b, 'home')).code).toBe(0);
    expect(await leave(a)).toBe(E.CORE_ERROR_GUILD_NOT_MEMBER);
  }, T);

  it('is GUILD_PERMISSION when an Officer kicks an Officer; an Officer kicks a Member and the Leader kicks an Officer', async () => {
    const kit = await start();
    const [l, o1, o2, m] = await users(kit, 4);
    const guild_id = await guild_with(l, 'Home', [o1, o2, m], [o1, o2]);
    expect(await on_user(o1, 'KickGuildMember', o2.user_id)).toBe(E.CORE_ERROR_GUILD_PERMISSION);
    expect(await on_user(o1, 'KickGuildMember', l.user_id)).toBe(E.CORE_ERROR_GUILD_PERMISSION);
    expect(await on_user(o1, 'KickGuildMember', o1.user_id)).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(member_ids(kit, guild_id)).toHaveLength(4);
    kit.content.changed.length = 0;
    expect(await on_user(o1, 'KickGuildMember', m.user_id)).toBe(0);
    expect(kit.content.changed).toEqual([{ ctx_user: o1.user_id, guild_id, user_id: m.user_id, change: 'Kicked' }]);
    expect(await on_user(l, 'KickGuildMember', o2.user_id)).toBe(0);
    expect(await on_user(l, 'KickGuildMember', o2.user_id)).toBe(E.CORE_ERROR_GUILD_NOT_MEMBER);
    expect(member_ids(kit, guild_id)).toEqual([l.user_id, o1.user_id].sort((x, y) => (x < y ? -1 : 1)));
    expect(guild_row(kit, guild_id)?.member_count).toBe(2);
    expect(cooldown(kit, m.user_id)).toBe(START_AT + 86_400_000n);
  }, T);
});

describe('SetGuildMemberRole', () => {
  it('makes the previous Leader an Officer and changes leader_id; GUILD_OFFICER_LIMIT at guild.maxOfficers', async () => {
    const kit = await start({ settings: { 'guild.maxOfficers': 1 } });
    const [l, a, b] = await users(kit, 3);
    const guild_id = await guild_with(l, 'Home', [a, b]);
    expect(await set_role(l, a.user_id, Role.GUILD_ROLE_OFFICER)).toBe(0);
    expect(await set_role(l, b.user_id, Role.GUILD_ROLE_OFFICER)).toBe(E.CORE_ERROR_GUILD_OFFICER_LIMIT);
    expect(member(kit, b.user_id)?.role).toBe(Role.GUILD_ROLE_MEMBER);
    expect(await set_role(l, a.user_id, Role.GUILD_ROLE_OFFICER)).toBe(0);
    expect(await set_role(l, b.user_id, Role.GUILD_ROLE_LEADER)).toBe(0);
    expect(guild_row(kit, guild_id)?.leader_id).toBe(b.user_id);
    expect(member(kit, b.user_id)?.role).toBe(Role.GUILD_ROLE_LEADER);
    expect(member(kit, l.user_id)?.role).toBe(Role.GUILD_ROLE_OFFICER);
    expect(member(kit, a.user_id)?.role).toBe(Role.GUILD_ROLE_OFFICER);
    expect(await set_role(l, a.user_id, Role.GUILD_ROLE_MEMBER)).toBe(E.CORE_ERROR_GUILD_PERMISSION);
    expect(await set_role(b, b.user_id, Role.GUILD_ROLE_MEMBER)).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await set_role(b, a.user_id, Role.GUILD_ROLE_UNSPECIFIED)).toBe(E.CORE_ERROR_INVALID_REQUEST);
  }, T);

  it('calls RoleChanged once for the target of Member to Officer, for the target then the previous Leader on a Leader change, and not when the role is already set', async () => {
    const kit = await start();
    const [l, a, b] = await users(kit, 3);
    const guild_id = await guild_with(l, 'Home', [a, b]);
    kit.content.changed.length = 0;
    expect(await set_role(l, a.user_id, Role.GUILD_ROLE_OFFICER)).toBe(0);
    expect(kit.content.changed).toEqual([{ ctx_user: l.user_id, guild_id, user_id: a.user_id, change: 'RoleChanged' }]);
    kit.content.changed.length = 0;
    expect(await set_role(l, a.user_id, Role.GUILD_ROLE_OFFICER)).toBe(0);
    expect(kit.content.changed).toEqual([]);
    expect(await set_role(l, b.user_id, Role.GUILD_ROLE_LEADER)).toBe(0);
    expect(kit.content.changed).toEqual([
      { ctx_user: l.user_id, guild_id, user_id: b.user_id, change: 'RoleChanged' },
      { ctx_user: l.user_id, guild_id, user_id: l.user_id, change: 'RoleChanged' },
    ]);
  }, T);
});

describe('set_member_role', () => {
  it('makes the previous Leader an Officer; another role for the Leader is false and changes nothing; the hooks match SetGuildMemberRole', async () => {
    const kit = await start();
    const [l, a, b] = await users(kit, 3);
    const guild_id = await guild_with(l, 'Home', [a, b]);
    const results: boolean[] = [];
    const set_member_role = (session: TestSession, id: bigint, user_id: bigint, role: CoreContract.GuildRole) =>
      run_core_test(
        session,
        (ctx) => {
          results.push(kit.guild().set_member_role(ctx, id, user_id, role));
        },
        kit,
      );
    kit.content.changed.length = 0;
    expect(await set_member_role(l, guild_id, a.user_id, Role.GUILD_ROLE_OFFICER)).toBe(0);
    expect(await set_member_role(l, guild_id, a.user_id, Role.GUILD_ROLE_OFFICER)).toBe(0);
    expect(kit.content.changed).toEqual([{ ctx_user: l.user_id, guild_id, user_id: a.user_id, change: 'RoleChanged' }]);
    kit.content.changed.length = 0;
    expect(await set_member_role(l, guild_id, b.user_id, Role.GUILD_ROLE_LEADER)).toBe(0);
    expect(kit.content.changed).toEqual([
      { ctx_user: l.user_id, guild_id, user_id: b.user_id, change: 'RoleChanged' },
      { ctx_user: l.user_id, guild_id, user_id: l.user_id, change: 'RoleChanged' },
    ]);
    expect(guild_row(kit, guild_id)?.leader_id).toBe(b.user_id);
    expect(member(kit, l.user_id)?.role).toBe(Role.GUILD_ROLE_OFFICER);
    kit.content.changed.length = 0;
    expect(await set_member_role(a, guild_id, b.user_id, Role.GUILD_ROLE_MEMBER)).toBe(0);
    expect(await set_member_role(a, guild_id + 50n, a.user_id, Role.GUILD_ROLE_MEMBER)).toBe(0);
    expect(results).toEqual([true, true, true, false, false]);
    expect(member(kit, b.user_id)?.role).toBe(Role.GUILD_ROLE_LEADER);
    expect(guild_row(kit, guild_id)?.leader_id).toBe(b.user_id);
    expect(kit.content.changed).toEqual([]);
  }, T);
});

describe('active_at', () => {
  it('is set to the request time by GetMyGuild and UpdateGuild', async () => {
    const kit = await start();
    const [l, a] = await users(kit, 2);
    await guild_with(l, 'Home', [a]);
    advance_time(kit.server, 5000n);
    expect((await get_my_guild(a)).code).toBe(0);
    expect(member(kit, a.user_id)?.active_at).toBe(START_AT + 5000n);
    expect(member(kit, l.user_id)?.active_at).toBe(START_AT);
    advance_time(kit.server, 5000n);
    expect(await update_guild(l, CoreContract.GuildJoinType.GUILD_JOIN_TYPE_CLOSED, 'new')).toBe(0);
    expect(member(kit, l.user_id)?.active_at).toBe(START_AT + 10_000n);
    expect(member(kit, a.user_id)?.active_at).toBe(START_AT + 5000n);
    expect(await update_guild(a, CoreContract.GuildJoinType.GUILD_JOIN_TYPE_OPEN)).toBe(E.CORE_ERROR_GUILD_PERMISSION);
    expect(member(kit, a.user_id)?.active_at).toBe(START_AT + 5000n);
  }, T);
});

describe('admin role and kick', () => {
  it('fails set_guild_member_role and kick_guild_member as each failure condition says; kick_guild_member calls Kicked once and writes the cooldown', async () => {
    const kit = await start({ settings: { 'guild.maxOfficers': 1 } });
    const [l, o, m, outsider] = await users(kit, 4);
    const guild_id = await guild_with(l, 'Home', [o, m], [o]);
    const role = (user_id: bigint, value: string, id: bigint = guild_id) =>
      admin(kit, 'set_guild_member_role', { operation_id: `role-${String(user_id)}-${value}-${String(id)}`, guild_id: String(id), user_id: String(user_id), role: value });
    expect((await role(outsider.user_id, 'Officer')).status).toBe(400);
    expect((await role(l.user_id, 'Member')).status).toBe(400);
    expect((await role(m.user_id, 'Officer')).status).toBe(409);
    expect((await role(m.user_id, 'Officer', guild_id + 9n)).status).toBe(404);
    expect(member(kit, m.user_id)?.role).toBe(Role.GUILD_ROLE_MEMBER);
    kit.content.changed.length = 0;
    expect((await role(o.user_id, 'Officer')).status).toBe(200);
    expect(kit.content.changed).toEqual([]);
    expect((await role(m.user_id, 'Leader')).status).toBe(200);
    expect(guild_row(kit, guild_id)?.leader_id).toBe(m.user_id);
    expect(member(kit, l.user_id)?.role).toBe(Role.GUILD_ROLE_OFFICER);
    expect(kit.content.changed.map((c) => [c.user_id, c.change])).toEqual([
      [m.user_id, 'RoleChanged'],
      [l.user_id, 'RoleChanged'],
    ]);
    const kick = (user_id: bigint, id: bigint = guild_id) => admin(kit, 'kick_guild_member', { operation_id: `kick-${String(user_id)}-${String(id)}`, guild_id: String(id), user_id: String(user_id) });
    expect((await kick(outsider.user_id)).status).toBe(400);
    expect((await kick(m.user_id)).status).toBe(400);
    expect((await kick(o.user_id, guild_id + 9n)).status).toBe(404);
    advance_time(kit.server, 10n);
    kit.content.changed.length = 0;
    expect((await kick(o.user_id)).status).toBe(200);
    expect(kit.content.changed).toEqual([{ ctx_user: o.user_id, guild_id, user_id: o.user_id, change: 'Kicked' }]);
    expect(member(kit, o.user_id)).toBeNull();
    expect(guild_row(kit, guild_id)?.member_count).toBe(2);
    expect(cooldown(kit, o.user_id)).toBe(START_AT + 10n + 86_400_000n);
    expect((await join_guild(o, guild_id)).code).toBe(E.CORE_ERROR_GUILD_COOLDOWN);
  }, T);

  it('lets the Kicked hook of kick_guild_member write the content UserState of the kicked user, whose user ID is the ctx user', async () => {
    const kit = await start();
    const [l, m] = await users(kit, 2);
    const guild_id = await guild_with(l, 'Home', [m]);
    kit.content.on_changed = (ctx, call) => {
      if (call.change !== 'Kicked') return;
      const state = new GameContract.GuildTestUserState();
      state.guild_id = call.guild_id;
      state.changes = 1n;
      kit.storage().put_state(ctx, state);
    };
    const response = await admin(kit, 'kick_guild_member', { operation_id: 'kick-1', guild_id: String(guild_id), user_id: String(m.user_id) });
    expect(response.status).toBe(200);
    expect(kit.content.changed.filter((c) => c.change === 'Kicked')).toEqual([{ ctx_user: m.user_id, guild_id, user_id: m.user_id, change: 'Kicked' }]);
    expect(member(kit, m.user_id)).toBeNull();
    expect((await test_state(kit, m.user_id))?.guild_id).toBe(guild_id);
  }, T);
});
