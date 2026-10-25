import * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  E,
  JoinType,
  Role,
  START_AT,
  T,
  advance_time,
  create_guild,
  get_guild,
  get_my_guild,
  guild_row,
  guild_with,
  join_guild,
  joinable,
  leave,
  member_ids,
  on_user,
  read_logs,
  rpc,
  run_core_test,
  search,
  set_role,
  snapshot,
  start,
  stop_servers,
  update_guild,
  users,
} from './kit.ts';

afterEach(stop_servers);

describe('GetGuild', () => {
  it('lists members by role, then joined_at, then user ID, with their profiles', async () => {
    const kit = await start();
    const [l, a, b, c, d] = await users(kit, 5);
    const { guild_id } = await create_guild(l, 'Home');
    advance_time(kit.server, 10n);
    expect((await join_guild(b, guild_id)).code).toBe(0);
    expect((await join_guild(a, guild_id)).code).toBe(0);
    advance_time(kit.server, 10n);
    expect((await join_guild(c, guild_id)).code).toBe(0);
    expect((await join_guild(d, guild_id)).code).toBe(0);
    expect(await set_role(l, d.user_id, Role.GUILD_ROLE_OFFICER)).toBe(0);
    const sent = await get_guild(a, guild_id);
    expect(sent.code).toBe(0);
    expect(sent.response?.guild).toMatchObject({ guild_id, name: 'Home', leader_id: l.user_id, member_count: 5 });
    expect(sent.response?.members.map((m) => [m.profile?.user_id, m.role])).toEqual([
      [l.user_id, Role.GUILD_ROLE_LEADER],
      [d.user_id, Role.GUILD_ROLE_OFFICER],
      // `a` and `b` joined at the same time: user ID ascending.
      ...[a.user_id, b.user_id].sort((x, y) => (x < y ? -1 : 1)).map((user_id) => [user_id, Role.GUILD_ROLE_MEMBER]),
      [c.user_id, Role.GUILD_ROLE_MEMBER],
    ]);
    expect((await get_guild(a, guild_id + 7n)).code).toBe(E.CORE_ERROR_GUILD_NOT_FOUND);
  }, T);

  it('leaves out a member and an applicant without a public profile from GetGuild members and GetMyGuild join_requests', async () => {
    const kit = await start();
    const [l, m, a] = await users(kit, 3);
    const guild_id = await guild_with(l, 'Home', [m]);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_APPROVAL)).toBe(0);
    expect((await join_guild(a, guild_id)).code).toBe(0);
    // User IDs without a `user` row, so `public-profile.get_public_profiles` gives no profile for them.
    const ghost_member = a.user_id + 1000n;
    const ghost_applicant = a.user_id + 1001n;
    const storage = kit.storage();
    await storage.run_game_transaction((tx) => {
      const db = storage.db(tx);
      db.query('INSERT INTO guild_member (user_id, guild_id, role, joined_at, active_at) VALUES ($1, $2, $3, $4, $4)', [ghost_member, guild_id, Role.GUILD_ROLE_MEMBER, START_AT]);
      db.query('UPDATE guild_guild SET member_count = member_count + 1 WHERE guild_id = $1', [guild_id]);
      db.query('INSERT INTO guild_join_request (guild_id, user_id, created_at) VALUES ($1, $2, $3)', [guild_id, ghost_applicant, START_AT]);
    });
    const sent = await get_guild(m, guild_id);
    expect(sent.response?.guild?.member_count).toBe(3);
    expect(sent.response?.members.map((e) => e.profile?.user_id)).toEqual([l.user_id, m.user_id]);
    const mine = await get_my_guild(l);
    expect(mine.response?.members.map((e) => e.profile?.user_id)).toEqual([l.user_id, m.user_id]);
    expect(mine.response?.join_requests.map((p) => p.user_id)).toEqual([a.user_id]);
  }, T);
});

describe('field validation', () => {
  it('is INVALID_REQUEST for guild_id 0, user_id 0 and max_join_value above 2^53−1, and keeps the saved state', async () => {
    const kit = await start();
    const [l, a] = await users(kit, 2);
    await guild_with(l, 'Home', [a]);
    const before = snapshot(kit);
    const zero_guild = (name: string, message: { guild_id: bigint; encode(): Uint8Array }) => {
      message.guild_id = 0n;
      return rpc(a, name, message);
    };
    const zero_user = (name: string, message: { user_id: bigint; encode(): Uint8Array }) => {
      message.user_id = 0n;
      return rpc(l, name, message);
    };
    expect((await zero_guild('GetGuild', new CoreContract.GetGuildRequest())).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await zero_guild('JoinGuild', new CoreContract.JoinGuildRequest())).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await zero_guild('CancelGuildJoinRequest', new CoreContract.CancelGuildJoinRequestRequest())).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await zero_user('AcceptGuildJoinRequest', new CoreContract.AcceptGuildJoinRequestRequest())).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await zero_user('RejectGuildJoinRequest', new CoreContract.RejectGuildJoinRequestRequest())).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    const list = new CoreContract.ListJoinableGuildsRequest();
    list.max_join_value = 2n ** 53n;
    expect((await rpc(a, 'ListJoinableGuilds', list)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    const create = new CoreContract.CreateGuildRequest();
    create.name = 'Unspecified';
    expect((await rpc(a, 'CreateGuild', create)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    const [b] = await users(kit, 1, 'other');
    expect((await rpc(b, 'CreateGuild', create)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(snapshot(kit)).toBe(before);
  }, T);
});

describe('GetMyGuild', () => {
  it('orders join_requests by created_at then user ID and my_join_requests by created_at then guild ID', async () => {
    const kit = await start();
    const [l1, l2, l3, x, u1, u2, u3] = await users(kit, 7);
    const g1 = (await create_guild(l1, 'First', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    const g2 = (await create_guild(l2, 'Second', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    const g3 = (await create_guild(l3, 'Third', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    expect((await join_guild(u3, g1)).code).toBe(0);
    expect((await join_guild(x, g3)).code).toBe(0);
    advance_time(kit.server, 100n);
    expect((await join_guild(u2, g1)).code).toBe(0);
    expect((await join_guild(u1, g1)).code).toBe(0);
    expect((await join_guild(x, g2)).code).toBe(0);
    expect((await join_guild(x, g1)).code).toBe(0);
    const leader = await get_my_guild(l1);
    expect(leader.response?.guild?.guild_id).toBe(g1);
    expect(leader.response?.join_requests.map((p) => p.user_id)).toEqual([u3.user_id, ...[x.user_id, u1.user_id, u2.user_id].sort((a, b) => (a < b ? -1 : 1))]);
    const mine = await get_my_guild(x);
    expect(mine.response?.guild?.guild_id).toBe(0n);
    expect(mine.response?.members).toEqual([]);
    expect(mine.response?.join_requests).toEqual([]);
    expect(mine.response?.my_join_requests).toEqual([g3, g1, g2]);
    const member_view = await get_my_guild(u3);
    expect(member_view.response?.my_join_requests).toEqual([g1]);
  }, T);

  it('gives join_requests only to a Leader or an Officer', async () => {
    const kit = await start();
    const [l, o, m, a] = await users(kit, 4);
    const guild_id = await guild_with(l, 'Home', [o, m], [o]);
    expect((await rpc(l, 'UpdateGuild', Object.assign(new CoreContract.UpdateGuildRequest(), { join_type: JoinType.GUILD_JOIN_TYPE_APPROVAL }))).code).toBe(0);
    expect((await join_guild(a, guild_id)).code).toBe(0);
    expect((await get_my_guild(o)).response?.join_requests.map((p) => p.user_id)).toEqual([a.user_id]);
    expect((await get_my_guild(m)).response?.join_requests).toEqual([]);
    expect((await get_my_guild(m)).response?.members).toHaveLength(3);
  }, T);
});

describe('SearchGuilds and ListJoinableGuilds', () => {
  it('returns the guilds whose normalized name starts with the normalized name, in byte order', async () => {
    const kit = await start();
    const [a, b, c, d, e] = await users(kit, 5);
    const alps = (await create_guild(a, 'Alps')).guild_id;
    const alpha = (await create_guild(b, 'ALPHA')).guild_id;
    await create_guild(c, 'Beta');
    const alpine = (await create_guild(d, 'al pine')).guild_id;
    expect(await search(e, 'Al')).toEqual([alpha, alpine, alps]);
    expect(await search(e, 'ａｌｐｈ')).toEqual([alpha]);
    expect(await search(e, 'Alpx')).toEqual([]);
    expect(await search(e, ' ')).toEqual([]);
  }, T);

  it('leaves out Closed and full guilds, and guilds whose join_value is above a non-zero max_join_value', async () => {
    const kit = await start({ settings: { 'guild.maxMembers': 2 } });
    const [a, b, c, d, e, f] = await users(kit, 6);
    const open = (await create_guild(a, 'Open', JoinType.GUILD_JOIN_TYPE_OPEN, '', 10n)).guild_id;
    await create_guild(b, 'Closed', JoinType.GUILD_JOIN_TYPE_CLOSED);
    const full = (await create_guild(c, 'Full')).guild_id;
    expect((await join_guild(f, full)).code).toBe(0);
    const approval = (await create_guild(d, 'Approval', JoinType.GUILD_JOIN_TYPE_APPROVAL, '', 50n)).guild_id;
    expect(await joinable(e, 0n)).toEqual([open, approval]);
    expect(await joinable(e, 20n)).toEqual([open]);
    expect(await joinable(e, 50n)).toEqual([open, approval]);
    expect(await joinable(e, 5n)).toEqual([]);
  }, T);

  it('ListJoinableGuilds orders by updated_at descending, then guild ID ascending', async () => {
    const kit = await start();
    const [a, b, c, d, x, y] = await users(kit, 6);
    const g1 = (await create_guild(a, 'First')).guild_id;
    advance_time(kit.server, 10n);
    const g2 = (await create_guild(b, 'Second')).guild_id;
    const g3 = (await create_guild(c, 'Third')).guild_id;
    advance_time(kit.server, 10n);
    const g4 = (await create_guild(d, 'Fourth')).guild_id;
    expect(await joinable(x, 0n)).toEqual([g4, g2, g3, g1]);
    advance_time(kit.server, 10n);
    expect((await join_guild(y, g1)).code).toBe(0);
    expect(await joinable(x, 0n)).toEqual([g1, g4, g2, g3]);
  }, T);

  it('returns at most guild.maxSearchResults guilds from SearchGuilds and ListJoinableGuilds', async () => {
    const kit = await start({ settings: { 'guild.maxSearchResults': 2 } });
    const [a, b, c, x] = await users(kit, 4);
    const g1 = (await create_guild(a, 'Team C')).guild_id;
    advance_time(kit.server, 10n);
    const g2 = (await create_guild(b, 'Team A')).guild_id;
    advance_time(kit.server, 10n);
    const g3 = (await create_guild(c, 'Team B')).guild_id;
    expect(await search(x, 'team')).toEqual([g2, g3]);
    expect(await joinable(x, 0n)).toEqual([g3, g2]);
    expect(await search(x, 'Team C')).toEqual([g1]);
  }, T);

  it('ListJoinableGuilds reads only the guild.maxSearchResults most recent joinable guilds, then drops join_value failures', async () => {
    const kit = await start({ settings: { 'guild.maxSearchResults': 2 } });
    const [a, b, c, d, x] = await users(kit, 5);
    const ga = (await create_guild(a, 'Alpha', JoinType.GUILD_JOIN_TYPE_OPEN, '', 10n)).guild_id;
    advance_time(kit.server, 10n);
    const gb = (await create_guild(b, 'Bravo', JoinType.GUILD_JOIN_TYPE_OPEN, '', 100n)).guild_id;
    advance_time(kit.server, 10n);
    const gc = (await create_guild(c, 'Charlie', JoinType.GUILD_JOIN_TYPE_OPEN, '', 100n)).guild_id;
    advance_time(kit.server, 10n);
    await create_guild(d, 'Delta', JoinType.GUILD_JOIN_TYPE_CLOSED, '', 1n);
    expect(await joinable(x, 0n)).toEqual([gc, gb]);
    expect(await joinable(x, 50n)).toEqual([]);
    expect(await joinable(x, 100n)).toEqual([gc, gb]);
    expect(guild_row(kit, ga)?.joinable).toBe(true);
  }, T);

  it('joinable follows CreateGuild, UpdateGuild join_type, joins, leaving, kicks and set_guild_max_members', async () => {
    const kit = await start({ settings: { 'guild.maxMembers': 2, 'guild.maxMembersLimit': 3 } });
    const [l, a, b, x] = await users(kit, 4);
    const guild_id = (await create_guild(l, 'Home')).guild_id;
    const closed = (await create_guild(x, 'Shut', JoinType.GUILD_JOIN_TYPE_CLOSED)).guild_id;
    const state = () => guild_row(kit, guild_id)?.joinable;
    const max_members = (value: number) =>
      run_core_test(
        l,
        (ctx) => {
          if (!kit.guild().set_guild_max_members(ctx, guild_id, value)) throw new Error('set_guild_max_members failed');
        },
        kit,
      );
    expect(state()).toBe(true);
    expect(guild_row(kit, closed)?.joinable).toBe(false);
    expect((await join_guild(a, guild_id)).code).toBe(0);
    expect(state()).toBe(false);
    expect(await leave(a)).toBe(0);
    expect(state()).toBe(true);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_APPROVAL)).toBe(0);
    expect(state()).toBe(true);
    expect((await join_guild(b, guild_id)).joined).toBe(false);
    expect(await on_user(l, 'AcceptGuildJoinRequest', b.user_id)).toBe(0);
    expect(state()).toBe(false);
    expect(await max_members(3)).toBe(0);
    expect(state()).toBe(true);
    expect(await max_members(2)).toBe(0);
    expect(state()).toBe(false);
    expect(await on_user(l, 'KickGuildMember', b.user_id)).toBe(0);
    expect(state()).toBe(true);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_CLOSED)).toBe(0);
    expect(state()).toBe(false);
    expect(await max_members(3)).toBe(0);
    expect(state()).toBe(false);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_OPEN)).toBe(0);
    expect(state()).toBe(true);
    expect(await max_members(1)).toBe(0);
    expect(state()).toBe(false);
    expect(await joinable(a, 0n)).toEqual([]);
  }, T);
});

describe('content operations', () => {
  it('set_guild_max_members is false for an out-of-range value and a missing guild, and a smaller max keeps the members', async () => {
    const kit = await start({ settings: { 'guild.maxMembersLimit': 40 } });
    const [l, a, b, c] = await users(kit, 4);
    const guild_id = await guild_with(l, 'Home', [a, b]);
    const results: boolean[] = [];
    const call = (id: bigint, value: number) =>
      run_core_test(
        l,
        (ctx) => {
          results.push(kit.guild().set_guild_max_members(ctx, id, value));
        },
        kit,
      );
    expect(await call(guild_id, 0)).toBe(0);
    expect(await call(guild_id, 41)).toBe(0);
    expect(await call(guild_id + 5n, 10)).toBe(0);
    expect(guild_row(kit, guild_id)?.max_members).toBe(30);
    expect(await call(guild_id, 2)).toBe(0);
    expect(results).toEqual([false, false, false, true]);
    const errors = read_logs(kit.server, 'error', 'error').filter((line) => line.module === 'guild' && String(line.message).startsWith('set_guild_max_members'));
    expect(errors.map((line) => [line.message, String(line.guild_id)])).toEqual([
      ['set_guild_max_members: max members out of range', String(guild_id)],
      ['set_guild_max_members: max members out of range', String(guild_id)],
      ['set_guild_max_members: no such guild', String(guild_id + 5n)],
    ]);
    expect(guild_row(kit, guild_id)).toMatchObject({ max_members: 2, member_count: 3 });
    expect(member_ids(kit, guild_id)).toHaveLength(3);
    expect((await join_guild(c, guild_id)).code).toBe(E.CORE_ERROR_GUILD_FULL);
  }, T);

  it('get_guild_infos returns the guilds that exist in guild ID order; get_member and list_member_ids read the members', async () => {
    const kit = await start();
    const [a, b, c] = await users(kit, 3);
    const g1 = (await create_guild(a, 'First')).guild_id;
    const g2 = await guild_with(b, 'Second', [c]);
    let infos: CoreContract.GuildInfo[] = [];
    let ids: bigint[] = [];
    let me: unknown = null;
    expect(
      await run_core_test(
        a,
        (ctx) => {
          infos = kit.guild().get_guild_infos(ctx, [g2, g2 + 100n, g1]);
          ids = kit.guild().list_member_ids(ctx, g2);
          me = kit.guild().get_member(ctx, c.user_id);
        },
        kit,
      ),
    ).toBe(0);
    expect(infos.map((i) => [i.guild_id, i.name])).toEqual([
      [g1, 'First'],
      [g2, 'Second'],
    ]);
    expect(ids).toEqual([b.user_id, c.user_id].sort((x, y) => (x < y ? -1 : 1)));
    expect(me).toMatchObject({ guild_id: g2, role: Role.GUILD_ROLE_MEMBER });
  }, T);
});
