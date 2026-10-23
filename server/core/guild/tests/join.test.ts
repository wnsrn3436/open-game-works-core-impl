import {
  E,
  JoinType,
  REJECTED,
  Role,
  T,
  START_AT,
  advance_time,
  cancel_request,
  create_guild,
  get_my_guild,
  guild_row,
  guild_with,
  join_guild,
  leave,
  member,
  member_ids,
  on_user,
  requests,
  set_role,
  start,
  stop_servers,
  update_guild,
  users,
} from './kit.ts';

afterEach(stop_servers);

describe('JoinGuild', () => {
  it('joins an Open guild with joined true, is GUILD_FULL at max_members, and GUILD_CLOSED for a Closed guild', async () => {
    const kit = await start({ settings: { 'guild.maxMembers': 2 } });
    const [l, a, b, c] = await users(kit, 4);
    const open = await create_guild(l, 'Open');
    expect(await join_guild(a, open.guild_id)).toEqual({ code: 0, joined: true });
    expect(member(kit, a.user_id)).toMatchObject({ guild_id: open.guild_id, role: Role.GUILD_ROLE_MEMBER });
    expect(guild_row(kit, open.guild_id)?.member_count).toBe(2);
    expect((await join_guild(b, open.guild_id)).code).toBe(E.CORE_ERROR_GUILD_FULL);
    const closed = await create_guild(c, 'Closed', JoinType.GUILD_JOIN_TYPE_CLOSED);
    expect((await join_guild(b, closed.guild_id)).code).toBe(E.CORE_ERROR_GUILD_CLOSED);
    expect(member(kit, b.user_id)).toBeNull();
  }, T);

  it('ends with the GameError of validate_guild_join, which gets the guild ID and join_value', async () => {
    const kit = await start();
    const [l, a] = await users(kit, 2);
    const { guild_id } = await create_guild(l, 'Open', JoinType.GUILD_JOIN_TYPE_OPEN, '', 40n);
    const seen: bigint[][] = [];
    kit.content.validate_guild_join = (_ctx, id, value) => {
      seen.push([id, value]);
      return REJECTED;
    };
    expect((await join_guild(a, guild_id)).code).toBe(REJECTED);
    expect(seen).toEqual([[guild_id, 40n]]);
    expect(member(kit, a.user_id)).toBeNull();
  }, T);

  it('writes a join request with joined false in an Approval guild; an Officer accepts it and the applicant loses its other join requests; a Member gets GUILD_PERMISSION', async () => {
    const kit = await start();
    const [l, o, m, a, b, l2] = await users(kit, 6);
    const guild_id = await guild_with(l, 'Approval', [o, m], [o]);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_APPROVAL)).toBe(0);
    const other = await create_guild(l2, 'Other', JoinType.GUILD_JOIN_TYPE_APPROVAL);
    expect(await join_guild(a, guild_id)).toEqual({ code: 0, joined: false });
    expect(await join_guild(a, other.guild_id)).toEqual({ code: 0, joined: false });
    expect(await join_guild(b, guild_id)).toEqual({ code: 0, joined: false });
    expect(member(kit, a.user_id)).toBeNull();
    expect(requests(kit)).toHaveLength(3);
    expect(await on_user(m, 'AcceptGuildJoinRequest', b.user_id)).toBe(E.CORE_ERROR_GUILD_PERMISSION);
    expect(await on_user(o, 'AcceptGuildJoinRequest', a.user_id)).toBe(0);
    expect(member(kit, a.user_id)).toMatchObject({ guild_id, role: Role.GUILD_ROLE_MEMBER });
    expect(guild_row(kit, guild_id)?.member_count).toBe(4);
    expect(requests(kit)).toEqual([{ guild_id, user_id: b.user_id }]);
    expect(await on_user(o, 'AcceptGuildJoinRequest', a.user_id)).toBe(E.CORE_ERROR_GUILD_REQUEST_NOT_FOUND);
    expect(await on_user(o, 'RejectGuildJoinRequest', b.user_id)).toBe(0);
    expect(requests(kit)).toEqual([]);
    expect(member(kit, b.user_id)).toBeNull();
  }, T);

  it('is GUILD_REQUEST_LIMIT at guild.maxJoinRequestsPerUser and guild.maxJoinRequestsPerGuild; CancelGuildJoinRequest deletes the request', async () => {
    const kit = await start({ settings: { 'guild.maxJoinRequestsPerUser': 1, 'guild.maxJoinRequestsPerGuild': 1 } });
    const [l1, l2, a, b] = await users(kit, 4);
    const g1 = await create_guild(l1, 'First', JoinType.GUILD_JOIN_TYPE_APPROVAL);
    const g2 = await create_guild(l2, 'Second', JoinType.GUILD_JOIN_TYPE_APPROVAL);
    expect((await join_guild(a, g1.guild_id)).code).toBe(0);
    expect((await join_guild(a, g1.guild_id)).code).toBe(0);
    expect((await join_guild(a, g2.guild_id)).code).toBe(E.CORE_ERROR_GUILD_REQUEST_LIMIT);
    expect((await join_guild(b, g1.guild_id)).code).toBe(E.CORE_ERROR_GUILD_REQUEST_LIMIT);
    expect(await cancel_request(b, g1.guild_id)).toBe(E.CORE_ERROR_GUILD_REQUEST_NOT_FOUND);
    expect(await cancel_request(a, g1.guild_id)).toBe(0);
    expect(requests(kit)).toEqual([]);
    expect((await join_guild(b, g1.guild_id)).code).toBe(0);
  }, T);

  it('calls on_guild_join_requested once with the applicant ctx and guild ID for a new join request, and not for a repeated JoinGuild or an Open join', async () => {
    const kit = await start();
    const [l, l2, a] = await users(kit, 3);
    const approval = await create_guild(l, 'Approval', JoinType.GUILD_JOIN_TYPE_APPROVAL);
    const open = await create_guild(l2, 'Open');
    expect((await join_guild(a, approval.guild_id)).code).toBe(0);
    expect((await join_guild(a, approval.guild_id)).code).toBe(0);
    expect(kit.content.requested).toEqual([{ ctx_user: a.user_id, guild_id: approval.guild_id }]);
    expect((await join_guild(a, open.guild_id)).code).toBe(0);
    expect(kit.content.requested).toHaveLength(1);
    expect(requests(kit)).toEqual([]);
  }, T);

  it('keeps an applicant in one guild when it joins another guild while its join request is accepted', async () => {
    const kit = await start();
    const [l1, l2, a] = await users(kit, 3);
    const approval = await create_guild(l1, 'Approval', JoinType.GUILD_JOIN_TYPE_APPROVAL);
    const open = await create_guild(l2, 'Open');
    expect((await join_guild(a, approval.guild_id)).code).toBe(0);
    const [accepted, joined] = await Promise.all([on_user(l1, 'AcceptGuildJoinRequest', a.user_id), join_guild(a, open.guild_id)]);
    expect([accepted, joined.code].filter((code) => code === 0)).toHaveLength(1);
    const in_approval = member_ids(kit, approval.guild_id).includes(a.user_id);
    const in_open = member_ids(kit, open.guild_id).includes(a.user_id);
    expect(Number(in_approval) + Number(in_open)).toBe(1);
    expect(requests(kit)).toEqual([]);
    for (const id of [approval.guild_id, open.guild_id]) expect(guild_row(kit, id)?.member_count).toBe(member_ids(kit, id).length);
  }, T);

  it('makes one of two accepts at once GUILD_FULL in a guild one below max_members', async () => {
    const kit = await start({ settings: { 'guild.maxMembers': 3 } });
    const [l, o, a, b] = await users(kit, 4);
    const guild_id = await guild_with(l, 'Approval', [o], [o]);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_APPROVAL)).toBe(0);
    expect((await join_guild(a, guild_id)).code).toBe(0);
    expect((await join_guild(b, guild_id)).code).toBe(0);
    const codes = await Promise.all([on_user(l, 'AcceptGuildJoinRequest', a.user_id), on_user(o, 'AcceptGuildJoinRequest', b.user_id)]);
    expect([...codes].sort((x, y) => x - y)).toEqual([0, E.CORE_ERROR_GUILD_FULL]);
    expect(guild_row(kit, guild_id)?.member_count).toBe(3);
    expect(member_ids(kit, guild_id)).toHaveLength(3);
  }, T);

  it('is GUILD_COOLDOWN for a user who left or was kicked until guild.rejoinCooldownMs passes', async () => {
    const kit = await start({ settings: { 'guild.rejoinCooldownMs': 1000 } });
    const [l, a, b, l2] = await users(kit, 4);
    const guild_id = await guild_with(l, 'Home', [a, b]);
    const other = await create_guild(l2, 'Other');
    expect(await leave(a)).toBe(0);
    expect(await on_user(l, 'KickGuildMember', b.user_id)).toBe(0);
    advance_time(kit.server, 999n);
    expect((await join_guild(a, other.guild_id)).code).toBe(E.CORE_ERROR_GUILD_COOLDOWN);
    expect((await join_guild(b, guild_id)).code).toBe(E.CORE_ERROR_GUILD_COOLDOWN);
    expect((await create_guild(a, 'Mine')).code).toBe(E.CORE_ERROR_GUILD_COOLDOWN);
    expect((await get_my_guild(b)).response?.cooldown_ends_at).toBe(START_AT + 1000n);
    advance_time(kit.server, 1n);
    expect((await join_guild(a, other.guild_id)).code).toBe(0);
    expect((await join_guild(b, guild_id)).code).toBe(0);
    expect((await get_my_guild(b)).response?.cooldown_ends_at).toBe(0n);
  }, T);

  it('is GUILD_ALREADY_MEMBER for a member and GUILD_NOT_FOUND for a guild that does not exist', async () => {
    const kit = await start();
    const [l, a] = await users(kit, 2);
    const guild_id = await guild_with(l, 'Home', [a]);
    expect((await join_guild(a, guild_id)).code).toBe(E.CORE_ERROR_GUILD_ALREADY_MEMBER);
    expect((await create_guild(a, 'Second')).code).toBe(E.CORE_ERROR_GUILD_ALREADY_MEMBER);
    expect((await join_guild(a, guild_id + 100n)).code).toBe(E.CORE_ERROR_GUILD_NOT_FOUND);
    expect(await set_role(a, l.user_id, Role.GUILD_ROLE_MEMBER)).toBe(E.CORE_ERROR_GUILD_PERMISSION);
  }, T);
});
