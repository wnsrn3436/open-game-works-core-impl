import {
  E,
  JoinType,
  Role,
  START_AT,
  T,
  admin,
  commit_while_row_locked,
  create_guild,
  get_guild,
  get_my_guild,
  guild_row,
  guild_with,
  hold_guild,
  hold_row,
  join_guild,
  member,
  member_ids,
  name_rows,
  requests,
  search,
  set_time,
  snapshot,
  start,
  stop_servers,
  update_guild,
  users,
  withdraw,
  withdrawn_at,
  type Kit,
} from './kit.ts';

afterEach(stop_servers);

/** `storage.userLockWaitMs` of the lock wait tests. */
const WAIT_MS = 300;

function import_body(name: string, members: readonly (readonly [bigint, string])[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation_id: `import-${name}-${members.map(([id, role]) => `${String(id)}${role}`).join('-')}`,
    name,
    description: 'imported',
    join_type: 'Approval',
    join_value: '25',
    max_members: 10,
    members: members.map(([user_id, role]) => ({ user_id: String(user_id), role })),
    ...extra,
  };
}

function imported_id(response: { json: unknown }): bigint {
  return BigInt((response.json as { guild_id: string }).guild_id);
}

describe('get_guild', () => {
  it('returns the guild row columns and the members with element names and decimal strings', async () => {
    const kit = await start();
    const [l, o] = await users(kit, 2);
    const guild_id = await guild_with(l, 'Home', [o], [o]);
    const response = await admin(kit, 'get_guild', { guild_id: String(guild_id) });
    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      guild_id: String(guild_id),
      name: 'Home',
      normalized_name: 'home',
      description: '',
      join_type: 'Open',
      join_value: '0',
      leader_id: String(l.user_id),
      member_count: 2,
      max_members: 30,
      joinable: true,
      created_at: String(START_AT),
      updated_at: String(START_AT),
      members: [
        { user_id: String(l.user_id), role: 'Leader', joined_at: String(START_AT), active_at: String(START_AT) },
        { user_id: String(o.user_id), role: 'Officer', joined_at: String(START_AT), active_at: String(START_AT) },
      ],
    });
    expect((await admin(kit, 'get_guild', { guild_id: String(guild_id + 3n) })).status).toBe(404);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_CLOSED)).toBe(0);
    expect((await admin(kit, 'get_guild', { guild_id: String(guild_id) })).json).toMatchObject({ joinable: false });
  }, T);
});

describe('disband_guild', () => {
  it('calls Kicked for each non-Leader member in user ID order, then Disbanded, and deletes the guild, name, join request and member rows', async () => {
    const kit = await start();
    const [l, a, b, c, x, y] = await users(kit, 6);
    const guild_id = await guild_with(l, 'Home', [b, a, c]);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_APPROVAL)).toBe(0);
    expect((await admin(kit, 'set_guild_member_role', { operation_id: 'r', guild_id: String(guild_id), user_id: String(b.user_id), role: 'Officer' })).status).toBe(200);
    expect((await admin(kit, 'set_guild_description', { operation_id: 'd', guild_id: String(guild_id), description: 'x' })).status).toBe(200);
    const other = (await create_guild(x, 'Other', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    expect(await join_guild(y, guild_id)).toEqual({ code: 0, joined: false });
    expect(requests(kit)).toEqual([{ guild_id, user_id: y.user_id }]);
    const before = snapshot(kit);
    expect((await admin(kit, 'disband_guild', { operation_id: 'bad', guild_id: String(guild_id), user_id: String(a.user_id) })).status).toBe(400);
    expect(snapshot(kit)).toBe(before);
    kit.content.changed.length = 0;
    const response = await admin(kit, 'disband_guild', { operation_id: 'good', guild_id: String(guild_id), user_id: String(l.user_id) });
    expect(response.status).toBe(200);
    expect(kit.content.changed.map((call) => [call.user_id, call.change])).toEqual([
      [a.user_id, 'Kicked'],
      [b.user_id, 'Kicked'],
      [c.user_id, 'Kicked'],
      [l.user_id, 'Disbanded'],
    ]);
    expect(guild_row(kit, guild_id)).toBeNull();
    expect(member_ids(kit, guild_id)).toEqual([]);
    expect(name_rows(kit).map((r) => r.guild_id)).toEqual([other]);
    expect(requests(kit)).toEqual([]);
    expect((await get_my_guild(y)).response?.my_join_requests).toEqual([]);
    expect((await join_guild(a, other)).code).toBe(0);
    expect((await admin(kit, 'disband_guild', { operation_id: 'gone', guild_id: String(guild_id), user_id: String(l.user_id) })).status).toBe(404);
  }, T);
});

describe('import_guild', () => {
  it('in STG makes the guild from the input without calling after hooks', async () => {
    const kit = await start({ environment: 'STG' });
    const [l, o, m] = await users(kit, 3);
    const response = await admin(kit, 'import_guild', import_body('Copied', [[m.user_id, 'Member'], [l.user_id, 'Leader'], [o.user_id, 'Officer']]));
    expect(response.status).toBe(200);
    const guild_id = imported_id(response);
    expect(guild_row(kit, guild_id)).toMatchObject({
      name: 'Copied',
      description: 'imported',
      join_type: JoinType.GUILD_JOIN_TYPE_APPROVAL,
      leader_id: l.user_id,
      member_count: 3,
      max_members: 10,
      joinable: true,
    });
    expect(member(kit, o.user_id)?.role).toBe(Role.GUILD_ROLE_OFFICER);
    expect(member(kit, m.user_id)?.role).toBe(Role.GUILD_ROLE_MEMBER);
    expect(kit.content.changed).toEqual([]);
  }, T);

  it('fails without a change for a guild member, a Leader count other than one, and broken input', async () => {
    const kit = await start({ environment: 'STG' });
    const [l, a, b, c] = await users(kit, 4);
    await create_guild(c, 'Taken');
    const before = snapshot(kit);
    expect((await admin(kit, 'import_guild', import_body('One', [[l.user_id, 'Leader'], [c.user_id, 'Member']]))).status).toBe(409);
    expect((await admin(kit, 'import_guild', import_body('Two', [[l.user_id, 'Leader'], [a.user_id, 'Leader']]))).status).toBe(400);
    expect((await admin(kit, 'import_guild', import_body('Three', [[l.user_id, 'Member'], [a.user_id, 'Member']]))).status).toBe(400);
    expect((await admin(kit, 'import_guild', import_body('Four', [[l.user_id, 'Leader'], [l.user_id, 'Member']]))).status).toBe(400);
    expect((await admin(kit, 'import_guild', import_body('Five', [[l.user_id, 'Leader'], [a.user_id, 'Member'], [b.user_id, 'Member']], { max_members: 2 }))).status).toBe(400);
    expect((await admin(kit, 'import_guild', import_body('Six', [[l.user_id, 'Leader']], { join_value: String(2n ** 53n) }))).status).toBe(400);
    expect((await admin(kit, 'import_guild', import_body('taken', [[l.user_id, 'Leader']]))).status).toBe(409);
    expect((await admin(kit, 'import_guild', import_body('Seven', [[l.user_id, 'Leader'], [l.user_id + 1000n, 'Member']]))).status).toBe(404);
    expect(snapshot(kit)).toBe(before);
  }, T);

  it('is bad_request for too many Officers, max_members out of range, and a name or description breaking its rule, and not_found for a withdrawn user, without a change', async () => {
    const kit = await start({ environment: 'STG', settings: { 'guild.maxOfficers': 1, 'guild.maxMembersLimit': 40 } });
    const [l, a, b, w] = await users(kit, 4);
    expect(await withdraw(w)).toBe(0);
    const before = snapshot(kit);
    const status = async (name: string, members: readonly (readonly [bigint, string])[], extra: Record<string, unknown> = {}) =>
      (await admin(kit, 'import_guild', import_body(name, members, extra))).status;
    expect(await status('Officers', [[l.user_id, 'Leader'], [a.user_id, 'Officer'], [b.user_id, 'Officer']])).toBe(400);
    expect(await status('Officer', [[l.user_id, 'Leader'], [a.user_id, 'Officer']], { max_members: 0 })).toBe(400);
    expect(await status('Officer', [[l.user_id, 'Leader'], [a.user_id, 'Officer']], { max_members: 41, operation_id: 'max-41' })).toBe(400);
    expect(await status('X', [[l.user_id, 'Leader']])).toBe(400);
    expect(await status('Two\nLines', [[l.user_id, 'Leader']])).toBe(400);
    expect(await status('Described', [[l.user_id, 'Leader']], { description: 'bell\u0007' })).toBe(400);
    expect(await status('Withdrawn', [[l.user_id, 'Leader'], [w.user_id, 'Member']])).toBe(404);
    expect(snapshot(kit)).toBe(before);
    expect(await status('Fine', [[l.user_id, 'Leader'], [a.user_id, 'Officer']], { max_members: 40 })).toBe(200);
  }, T);

  it('writes created_at, updated_at, joined_at and active_at as the clock_now of the operation', async () => {
    const kit = await start();
    const [l, m] = await users(kit, 2);
    set_time(kit.server, START_AT + 777n);
    const response = await admin(kit, 'import_guild', import_body('Timed', [[l.user_id, 'Leader'], [m.user_id, 'Member']]));
    expect(response.status).toBe(200);
    const guild_id = imported_id(response);
    expect(guild_row(kit, guild_id)).toMatchObject({ created_at: START_AT + 777n, updated_at: START_AT + 777n });
    for (const user of [l, m]) expect(member(kit, user.user_id)).toMatchObject({ guild_id, joined_at: START_AT + 777n, active_at: START_AT + 777n });
  }, T);

  it('is not_found without a change for a member whose Withdraw commits while import_guild waits for the member row lock (PostgreSQL)', async () => {
    const kit = await start({ db: 'postgresql', settings: { 'storage.userLockWaitMs': 20_000 } });
    const [l, w] = await users(kit, 2);
    const before = snapshot(kit);
    // The Withdraw holds the member row lock remove_user takes on a user with no guild and commits withdrawn_at only
    // after import_guild waits for that lock.
    const withdrawal = await commit_while_row_locked(kit, 'guild_member', [w.user_id], [
      { sql: 'UPDATE "user" SET withdrawn_at = $1 WHERE user_id = $2', params: [START_AT + 1n, w.user_id] },
    ]);
    const committed = withdrawal();
    expect((await admin(kit, 'import_guild', import_body('Raced', [[l.user_id, 'Leader'], [w.user_id, 'Member']]))).status).toBe(404);
    expect(await committed).toBe('committed');
    expect(withdrawn_at(kit, w.user_id)).toBe(START_AT + 1n);
    expect(member(kit, l.user_id)).toBeNull();
    expect(member(kit, w.user_id)).toBeNull();
    expect(snapshot(kit)).toBe(before);
  }, T);
});

describe('set_guild_description', () => {
  it('sets the description without the banned word check, is bad_request for a plain text breach and not_found for a missing guild, without a change', async () => {
    const kit = await start();
    const [a] = await users(kit, 1);
    const guild_id = (await create_guild(a, 'Home', JoinType.GUILD_JOIN_TYPE_OPEN, 'before')).guild_id;
    const describe_as = (id: bigint, description: string, operation_id: string) => admin(kit, 'set_guild_description', { operation_id, guild_id: String(id), description });
    const before = snapshot(kit);
    expect((await describe_as(guild_id, 'bell\u0007', 'd1')).status).toBe(400);
    expect((await describe_as(guild_id + 9n, 'after', 'd2')).status).toBe(404);
    expect(snapshot(kit)).toBe(before);
    expect((await describe_as(guild_id, 'a badword\nhere', 'd3')).status).toBe(200);
    expect(guild_row(kit, guild_id)?.description).toBe('a badword\nhere');
    expect((await describe_as(guild_id, '', 'd4')).status).toBe(200);
    expect(guild_row(kit, guild_id)?.description).toBe('');
  }, T);

  it('shares one description rule with CreateGuild, UpdateGuild and import_guild: empty passes, guild.maxDescriptionLength and newlines hold everywhere, the banned word check is rpc only', async () => {
    const kit = await start({ settings: { 'guild.maxDescriptionLength': 8 } });
    const [a, x, y, z] = await users(kit, 4);
    const too_long = '123456789';
    expect((await create_guild(a, 'Home', JoinType.GUILD_JOIN_TYPE_OPEN, too_long)).code).toBe(E.CORE_ERROR_TEXT_INVALID);
    expect((await admin(kit, 'import_guild', import_body('Long', [[x.user_id, 'Leader']], { description: too_long }))).status).toBe(400);
    const { code, guild_id } = await create_guild(a, 'Home', JoinType.GUILD_JOIN_TYPE_OPEN, '');
    expect(code).toBe(0);
    expect(await update_guild(a, JoinType.GUILD_JOIN_TYPE_OPEN, too_long)).toBe(E.CORE_ERROR_TEXT_INVALID);
    expect((await admin(kit, 'set_guild_description', { operation_id: 's1', guild_id: String(guild_id), description: too_long })).status).toBe(400);
    expect(guild_row(kit, guild_id)?.description).toBe('');
    expect(await update_guild(a, JoinType.GUILD_JOIN_TYPE_OPEN, 'ab\ncd')).toBe(0);
    expect(await update_guild(a, JoinType.GUILD_JOIN_TYPE_OPEN, 'badword')).toBe(E.CORE_ERROR_TEXT_BANNED);
    expect((await admin(kit, 'set_guild_description', { operation_id: 's2', guild_id: String(guild_id), description: 'badword' })).status).toBe(200);
    expect(guild_row(kit, guild_id)?.description).toBe('badword');
    expect(await update_guild(a, JoinType.GUILD_JOIN_TYPE_OPEN, '')).toBe(0);
    expect(guild_row(kit, guild_id)?.description).toBe('');
    for (const [user, name, description] of [[x, 'Empty', ''], [y, 'Lines', 'ab\ncd'], [z, 'Banned', 'badword']] as const) {
      const response = await admin(kit, 'import_guild', import_body(name, [[user.user_id, 'Leader']], { description }));
      expect(response.status).toBe(200);
      expect(guild_row(kit, imported_id(response))?.description).toBe(description);
    }
  }, T);
});

describe('rename_guild', () => {
  async function renamed(kit: Kit, guild_id: bigint, name: string, id: string) {
    return admin(kit, 'rename_guild', { operation_id: id, guild_id: String(guild_id), name });
  }

  it('renames without the banned word check, is conflict for a name of another guild, and frees the old name', async () => {
    const kit = await start();
    const [a, b, c] = await users(kit, 3);
    const guild_id = (await create_guild(a, 'Oldname')).guild_id;
    await create_guild(b, 'Other');
    expect((await renamed(kit, guild_id, 'OTHER', 'r1')).status).toBe(409);
    expect((await renamed(kit, guild_id, 'X', 'r2')).status).toBe(400);
    expect((await renamed(kit, guild_id + 9n, 'Fresh', 'r3')).status).toBe(404);
    set_time(kit.server, START_AT + 5n);
    expect((await renamed(kit, guild_id, 'Badword Hall', 'r4')).status).toBe(200);
    expect(guild_row(kit, guild_id)).toMatchObject({ name: 'Badword Hall', normalized_name: 'badwordhall', updated_at: START_AT + 5n });
    expect((await get_guild(c, guild_id)).response?.guild?.name).toBe('Badword Hall');
    expect(await search(c, 'badword h')).toEqual([guild_id]);
    expect(await search(c, 'Oldname')).toEqual([]);
    expect((await create_guild(c, 'oldname')).code).toBe(0);
  }, T);

  it('keeps one name row when the new name has the same normalized form, and changes the shown name', async () => {
    const kit = await start();
    const [a, c] = await users(kit, 2);
    const guild_id = (await create_guild(a, 'Hall')).guild_id;
    expect((await renamed(kit, guild_id, 'HALL', 'r1')).status).toBe(200);
    expect((await get_guild(c, guild_id)).response?.guild?.name).toBe('HALL');
    expect(name_rows(kit)).toEqual([{ normalized_name: 'hall', guild_id }]);
    expect((await renamed(kit, guild_id, 'Hallway', 'r2')).status).toBe(200);
    expect(await search(c, 'Hall')).toEqual([guild_id]);
    expect(name_rows(kit)).toEqual([{ normalized_name: 'hallway', guild_id }]);
  }, T);
});

describe('admin operation lock wait', () => {
  it('is internal past the lock wait limit of the guild row or a member row, without a change', async () => {
    const kit = await start({ settings: { 'storage.userLockWaitMs': WAIT_MS } });
    const [l, o, m, x] = await users(kit, 4);
    const guild_id = await guild_with(l, 'Home', [o, m], [o]);
    const before = snapshot(kit);
    const id = String(guild_id);
    const status = async (operation: string, body: Record<string, unknown>): Promise<number> => (await admin(kit, operation, body)).status;
    const user_operations = (tag: string): [string, Record<string, unknown>][] => [
      ['set_guild_member_role', { operation_id: `${tag}-role`, guild_id: id, user_id: String(m.user_id), role: 'Officer' }],
      ['kick_guild_member', { operation_id: `${tag}-kick`, guild_id: id, user_id: String(m.user_id) }],
      ['disband_guild', { operation_id: `${tag}-disband`, guild_id: id, user_id: String(l.user_id) }],
    ];

    const guild_lock = await hold_guild(kit, guild_id);
    const guild_row_operations: [string, Record<string, unknown>][] = [
      ['rename_guild', { operation_id: 'guild-rename', guild_id: id, name: 'Renamed' }],
      ['set_guild_description', { operation_id: 'guild-description', guild_id: id, description: 'new' }],
      ...user_operations('guild'),
    ];
    for (const [operation, body] of guild_row_operations) {
      expect(await status(operation, body), operation).toBe(500);
      expect(snapshot(kit), operation).toBe(before);
    }
    await guild_lock();

    const member_lock = await hold_row(kit, 'guild_member', [m.user_id]);
    for (const [operation, body] of user_operations('member')) {
      expect(await status(operation, body), operation).toBe(500);
      expect(snapshot(kit), operation).toBe(before);
    }
    await member_lock();

    const import_lock = await hold_row(kit, 'guild_member', [x.user_id]);
    expect(await status('import_guild', import_body('Imported', [[x.user_id, 'Leader']]))).toBe(500);
    expect(snapshot(kit)).toBe(before);
    await import_lock();

    expect(member(kit, m.user_id)).toMatchObject({ guild_id, role: Role.GUILD_ROLE_MEMBER });
    expect(member(kit, x.user_id)).toBeNull();
    expect(guild_row(kit, guild_id)).toMatchObject({ name: 'Home', description: '', member_count: 3 });
  }, T);
});
