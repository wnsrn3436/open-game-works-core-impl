import * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  E,
  GOLD,
  JoinType,
  REJECTED,
  Role,
  START_AT,
  T,
  admin,
  create_guild,
  get_my_guild,
  gold,
  guild_row,
  guild_with,
  id_value,
  join_guild,
  leave,
  member,
  name_rows,
  read_logs,
  requests,
  rows,
  set_gold,
  snapshot,
  start,
  stop_servers,
  update_guild,
  users,
} from './kit.ts';

afterEach(stop_servers);

describe('CreateGuild', () => {
  it('makes the user Leader with member_count 1 and max_members guild.maxMembers, and calls Joined once', async () => {
    const kit = await start({ settings: { 'guild.maxMembers': 7 } });
    const [a] = await users(kit, 1);
    const { code, guild_id } = await create_guild(a, 'Alpha', JoinType.GUILD_JOIN_TYPE_APPROVAL, 'hello', 5n);
    expect(code).toBe(0);
    expect(guild_row(kit, guild_id)).toMatchObject({ name: 'Alpha', description: 'hello', leader_id: a.user_id, member_count: 1, max_members: 7, created_at: START_AT });
    expect(member(kit, a.user_id)).toEqual({ guild_id, role: Role.GUILD_ROLE_LEADER, joined_at: START_AT, active_at: START_AT });
    expect(kit.content.changed).toEqual([{ ctx_user: a.user_id, guild_id, user_id: a.user_id, change: 'Joined' }]);
  }, T);

  it('is GUILD_NAME_TAKEN for a name with the same normalized form, and one of two users creating one name at once succeeds', async () => {
    const kit = await start();
    const [a, b, c, d] = await users(kit, 4);
    expect((await create_guild(a, 'Alpha')).code).toBe(0);
    expect((await create_guild(b, 'ALPHA')).code).toBe(E.CORE_ERROR_GUILD_NAME_TAKEN);
    expect((await create_guild(b, 'Ａｌｐｈａ')).code).toBe(E.CORE_ERROR_GUILD_NAME_TAKEN);
    expect(member(kit, b.user_id)).toBeNull();
    const both = await Promise.all([create_guild(c, 'Beta'), create_guild(d, 'beta')]);
    expect(both.map((r) => r.code).sort((x, y) => x - y)).toEqual([0, E.CORE_ERROR_GUILD_NAME_TAKEN]);
    expect(name_rows(kit).filter((r) => r.normalized_name === 'beta')).toHaveLength(1);
    expect(rows(kit, 'SELECT guild_id FROM guild_guild')).toHaveLength(2);
  }, T);

  it('is TEXT_INVALID for a name of guild.minNameLength or more code points that are all Default_Ignorable_Code_Point, and rename_guild and import_guild are bad_request, without a change', async () => {
    const kit = await start({ settings: { 'guild.minNameLength': 2 } });
    const [a, b, c] = await users(kit, 3);
    const guild_id = (await create_guild(a, 'Home')).guild_id;
    const before = snapshot(kit);
    for (const name of ['\u200B\u200B', '\u2060\u200B\u00AD', '\uFE0F\u200B']) {
      expect((await create_guild(b, name)).code).toBe(E.CORE_ERROR_TEXT_INVALID);
      expect((await admin(kit, 'rename_guild', { operation_id: `rename-${name}`, guild_id: String(guild_id), name })).status).toBe(400);
      const imported = await admin(kit, 'import_guild', {
        operation_id: `import-${name}`,
        name,
        description: '',
        join_type: 'Open',
        join_value: '0',
        max_members: 10,
        members: [{ user_id: String(c.user_id), role: 'Leader' }],
      });
      expect(imported.status).toBe(400);
    }
    expect(snapshot(kit)).toBe(before);
    expect(guild_row(kit, guild_id)).toMatchObject({ name: 'Home', normalized_name: 'home' });
    expect(name_rows(kit)).toEqual([{ normalized_name: 'home', guild_id }]);
    expect(member(kit, b.user_id)).toBeNull();
    expect((await create_guild(b, 'H\u200Bi')).code).toBe(0);
  }, T);

  it('is TEXT_BANNED for a name with a banned word and TEXT_INVALID for a name with a newline; a description with a newline passes', async () => {
    const kit = await start();
    const [a] = await users(kit, 1);
    expect((await create_guild(a, 'myBadWord1')).code).toBe(E.CORE_ERROR_TEXT_BANNED);
    expect(read_logs(kit.server, 'core', 'info').some((line) => line.banned_word === id_value('[banned_en_1]'))).toBe(true);
    expect((await create_guild(a, 'Two\nLines')).code).toBe(E.CORE_ERROR_TEXT_INVALID);
    expect((await create_guild(a, 'X')).code).toBe(E.CORE_ERROR_TEXT_INVALID);
    expect((await create_guild(a, 'Gamma', JoinType.GUILD_JOIN_TYPE_OPEN, 'first\nsecond badword')).code).toBe(E.CORE_ERROR_TEXT_BANNED);
    const { code, guild_id } = await create_guild(a, 'Gamma', JoinType.GUILD_JOIN_TYPE_OPEN, 'first\nsecond');
    expect(code).toBe(0);
    expect(guild_row(kit, guild_id)?.description).toBe('first\nsecond');
  }, T);

  it('ends with the GameError of prepare_create_guild and makes no guild; a failure after the hook keeps no item change of the hook', async () => {
    const kit = await start();
    const [a, b] = await users(kit, 2);
    kit.content.prepare_create_guild = () => REJECTED;
    expect((await create_guild(a, 'Alpha')).code).toBe(REJECTED);
    expect(rows(kit, 'SELECT guild_id FROM guild_guild')).toHaveLength(0);
    expect(member(kit, a.user_id)).toBeNull();
    kit.content.prepare_create_guild = null;
    expect((await create_guild(a, 'Alpha')).code).toBe(0);
    await set_gold(kit, b.user_id, 100n);
    const cost = new CoreContract.ItemAmount();
    cost.item_id = id_value(GOLD);
    cost.amount = 30n;
    kit.content.prepare_create_guild = (ctx) => {
      const result = kit.core()['item-ledger'].subtract_items(ctx, [cost], { source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_REQUEST, ref: 'guild', once_key: '' });
      return result === 'OK' ? 'pass' : (result as number);
    };
    expect((await create_guild(b, 'alpha')).code).toBe(E.CORE_ERROR_GUILD_NAME_TAKEN);
    expect(await gold(kit, b.user_id)).toBe(100n);
    expect((await create_guild(b, 'Delta')).code).toBe(0);
    expect(await gold(kit, b.user_id)).toBe(70n);
  }, T);

  it('is INTERNAL with nothing saved when prepare_create_guild or validate_guild_join returns neither pass nor a GameError', async () => {
    const kit = await start();
    const [a, b] = await users(kit, 2);
    kit.content.prepare_create_guild = () => 999;
    expect((await create_guild(a, 'Alpha')).code).toBe(E.CORE_ERROR_INTERNAL);
    expect(rows(kit, 'SELECT guild_id FROM guild_guild')).toHaveLength(0);
    expect(member(kit, a.user_id)).toBeNull();
    kit.content.prepare_create_guild = null;
    const guild_id = (await create_guild(a, 'Alpha')).guild_id;
    kit.content.validate_guild_join = () => 'ok' as 'pass';
    expect((await join_guild(b, guild_id)).code).toBe(E.CORE_ERROR_INTERNAL);
    expect(member(kit, b.user_id)).toBeNull();
    expect(guild_row(kit, guild_id)?.member_count).toBe(1);
    const errors = read_logs(kit.server, 'error', 'error').map((line) => JSON.stringify(line));
    expect(errors.some((line) => line.includes('guild.prepare_create_guild'))).toBe(true);
    expect(errors.some((line) => line.includes('guild.validate_guild_join'))).toBe(true);
  }, T);

  it('gives two users creating at once different guild IDs, and a guild made after a disband an ID above the disbanded one', async () => {
    const kit = await start();
    const [a, b, c] = await users(kit, 3);
    const [x, y] = await Promise.all([create_guild(a, 'First'), create_guild(b, 'Second')]);
    expect(x.code).toBe(0);
    expect(y.code).toBe(0);
    expect(x.guild_id).not.toBe(y.guild_id);
    const top = x.guild_id > y.guild_id ? x.guild_id : y.guild_id;
    const leader = x.guild_id > y.guild_id ? a : b;
    expect(await leave(leader)).toBe(0);
    expect(guild_row(kit, top)).toBeNull();
    const z = await create_guild(c, 'Third');
    expect(z.code).toBe(0);
    expect(z.guild_id).toBeGreaterThan(top);
  }, T);

  it('writes the guild_name row with the guild_id of the guild_guild row, in CreateGuild and import_guild', async () => {
    const kit = await start();
    const [a, b, c] = await users(kit, 3);
    const made = await create_guild(a, 'Alpha');
    const imported = await admin(kit, 'import_guild', {
      operation_id: 'import-1',
      name: 'Imported',
      description: '',
      join_type: 'Open',
      join_value: '0',
      max_members: 10,
      members: [
        { user_id: String(b.user_id), role: 'Leader' },
        { user_id: String(c.user_id), role: 'Member' },
      ],
    });
    expect(imported.status).toBe(200);
    const imported_id = BigInt((imported.json as { guild_id: string }).guild_id);
    const names = name_rows(kit);
    expect(names).toEqual([
      { normalized_name: 'alpha', guild_id: made.guild_id },
      { normalized_name: 'imported', guild_id: imported_id },
    ]);
    for (const name of names) expect(guild_row(kit, name.guild_id)?.normalized_name).toBe(name.normalized_name);
  }, T);
});

describe('UpdateGuild', () => {
  it('is GUILD_NOT_MEMBER, INVALID_REQUEST, TEXT_INVALID and TEXT_BANNED on each failure and keeps the guild row', async () => {
    const kit = await start();
    const [l, m, outsider] = await users(kit, 3);
    const guild_id = await guild_with(l, 'Home', [m]);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_APPROVAL, 'before', 5n)).toBe(0);
    const before = snapshot(kit);
    expect(await update_guild(outsider, JoinType.GUILD_JOIN_TYPE_OPEN, 'outsider')).toBe(E.CORE_ERROR_GUILD_NOT_MEMBER);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_UNSPECIFIED, 'unspecified')).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_OPEN, 'bell\u0007')).toBe(E.CORE_ERROR_TEXT_INVALID);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_OPEN, 'a badword here')).toBe(E.CORE_ERROR_TEXT_BANNED);
    expect(snapshot(kit)).toBe(before);
    expect(guild_row(kit, guild_id)).toMatchObject({ description: 'before', join_type: JoinType.GUILD_JOIN_TYPE_APPROVAL });
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_CLOSED, 'line one\nline two', 9n)).toBe(0);
    expect(guild_row(kit, guild_id)).toMatchObject({ description: 'line one\nline two', join_type: JoinType.GUILD_JOIN_TYPE_CLOSED });
  }, T);

  it('keeps the join request rows whatever the join_type, and the Leader\'s GetMyGuild still lists them', async () => {
    const kit = await start();
    const [l, a] = await users(kit, 2);
    const guild_id = (await create_guild(l, 'Home', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    expect(await join_guild(a, guild_id)).toEqual({ code: 0, joined: false });
    for (const join_type of [JoinType.GUILD_JOIN_TYPE_CLOSED, JoinType.GUILD_JOIN_TYPE_OPEN, JoinType.GUILD_JOIN_TYPE_APPROVAL]) {
      expect(await update_guild(l, join_type, 'changed')).toBe(0);
      expect(guild_row(kit, guild_id)?.join_type).toBe(join_type);
      expect(requests(kit)).toEqual([{ guild_id, user_id: a.user_id }]);
      expect((await get_my_guild(l)).response?.join_requests.map((p) => p.user_id)).toEqual([a.user_id]);
      expect((await get_my_guild(a)).response?.my_join_requests).toEqual([guild_id]);
    }
  }, T);
});
