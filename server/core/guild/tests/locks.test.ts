import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import {
  E,
  JoinType,
  REJECTED,
  Role,
  T,
  cancel_request,
  commit_while_locked,
  commit_while_row_locked,
  create_guild,
  guild_row,
  guild_with,
  hold_guild,
  join_guild,
  member,
  member_ids,
  on_user,
  requests,
  run_core_test,
  set_role,
  snapshot,
  start,
  stop_servers,
  test_state,
  update_guild,
  users,
  withdraw,
  withdrawn_at,
} from './kit.ts';

afterEach(stop_servers);

/** `storage.userLockWaitMs` of the lock tests. */
const WAIT_MS = 300;

describe('guild row lock', () => {
  it('makes another user\'s JoinGuild wait for the guild row lock lock_guild takes: past the wait limit it is INTERNAL, and after the lock ends it joins', async () => {
    const kit = await start({ settings: { 'storage.userLockWaitMs': WAIT_MS } });
    const [l, a] = await users(kit, 2);
    const { guild_id } = await create_guild(l, 'Home');
    const release = await hold_guild(kit, guild_id);
    const started = Date.now();
    expect((await join_guild(a, guild_id)).code).toBe(E.CORE_ERROR_INTERNAL);
    expect(Date.now() - started).toBeGreaterThanOrEqual(WAIT_MS - 50);
    expect(member(kit, a.user_id)).toBeNull();
    await release();
    expect(await join_guild(a, guild_id)).toEqual({ code: 0, joined: true });
    expect(member(kit, a.user_id)?.guild_id).toBe(guild_id);
  }, T);

  it('past the lock wait limit, lock_guild of a content handler throws and the request is INTERNAL with nothing saved; a member\'s Withdraw is INTERNAL and keeps its rows', async () => {
    const kit = await start({ settings: { 'storage.userLockWaitMs': WAIT_MS } });
    const [l, a] = await users(kit, 2);
    const guild_id = await guild_with(l, 'Home', [a]);
    const before = snapshot(kit);
    await hold_guild(kit, guild_id);
    let threw = false;
    const code = await run_core_test(
      l,
      (ctx) => {
        const state = new GameContract.GuildTestUserState();
        state.guild_id = guild_id;
        kit.storage().put_state(ctx, state);
        try {
          kit.guild().lock_guild(ctx, guild_id);
        } catch (error) {
          threw = true;
          throw error;
        }
      },
      kit,
    );
    expect(code).toBe(E.CORE_ERROR_INTERNAL);
    // On SQLite the held lock is the whole DB, so the request transaction fails before its handler writes.
    if (kit.db === 'postgresql') expect(threw).toBe(true);
    expect(await withdraw(a)).toBe(E.CORE_ERROR_INTERNAL);
    expect(await test_state(kit, l.user_id)).toBeNull();
    expect(member(kit, a.user_id)?.guild_id).toBe(guild_id);
    expect(withdrawn_at(kit, a.user_id)).toBeNull();
    expect(snapshot(kit)).toBe(before);
  }, T);

  it('past the lock wait limit, set_guild_max_members and set_member_role of a content handler throw and the request is INTERNAL with nothing saved', async () => {
    const kit = await start({ settings: { 'storage.userLockWaitMs': WAIT_MS } });
    const [l, a] = await users(kit, 2);
    const guild_id = await guild_with(l, 'Home', [a]);
    const before = snapshot(kit);
    await hold_guild(kit, guild_id);
    const calls: Record<string, (ctx: RequestCtx) => unknown> = {
      set_guild_max_members: (ctx) => kit.guild().set_guild_max_members(ctx, guild_id, 5),
      set_member_role: (ctx) => kit.guild().set_member_role(ctx, guild_id, a.user_id, Role.GUILD_ROLE_OFFICER),
    };
    for (const [name, call] of Object.entries(calls)) {
      let threw = false;
      const code = await run_core_test(
        l,
        (ctx) => {
          const state = new GameContract.GuildTestUserState();
          state.guild_id = guild_id;
          kit.storage().put_state(ctx, state);
          try {
            call(ctx);
          } catch (error) {
            threw = true;
            throw error;
          }
        },
        kit,
      );
      expect(code, name).toBe(E.CORE_ERROR_INTERNAL);
      // On SQLite the held lock is the whole DB, so the request transaction fails before its handler writes.
      if (kit.db === 'postgresql') expect(threw, name).toBe(true);
      expect(await test_state(kit, l.user_id)).toBeNull();
      expect(snapshot(kit)).toBe(before);
    }
    expect(guild_row(kit, guild_id)?.max_members).toBe(30);
    expect(member(kit, a.user_id)?.role).toBe(Role.GUILD_ROLE_MEMBER);
  }, T);

  it('makes lock_guild of the module object FAILED past the lock wait limit (PostgreSQL)', async () => {
    const kit = await start({ db: 'postgresql', settings: { 'storage.userLockWaitMs': WAIT_MS } });
    const [l] = await users(kit, 1);
    const { guild_id } = await create_guild(l, 'Home');
    const results: unknown[] = [];
    expect(
      await run_core_test(
        l,
        (ctx) => {
          results.push(kit.module().lock_guild(ctx, guild_id));
          return REJECTED;
        },
        kit,
      ),
    ).toBe(REJECTED);
    await hold_guild(kit, guild_id);
    expect(
      await run_core_test(
        l,
        (ctx) => {
          results.push(kit.module().lock_guild(ctx, guild_id));
          return REJECTED;
        },
        kit,
      ),
    ).toBe(REJECTED);
    expect(results).toEqual([expect.objectContaining({ guild_id, member_count: 1 }), 'FAILED']);
  }, T);

  it('lets the applicant\'s CancelGuildJoinRequest and Open join go on without waiting while another transaction locks the guild (PostgreSQL)', async () => {
    const kit = await start({ db: 'postgresql', settings: { 'storage.userLockWaitMs': WAIT_MS } });
    const [l, l2, a, b] = await users(kit, 4);
    const guild_id = (await create_guild(l, 'Approval', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    const open = (await create_guild(l2, 'Open')).guild_id;
    expect((await join_guild(a, guild_id)).code).toBe(0);
    expect((await join_guild(b, guild_id)).code).toBe(0);
    const release = await hold_guild(kit, guild_id);
    expect((await join_guild(l2, guild_id)).code).toBe(E.CORE_ERROR_INTERNAL);
    expect(await cancel_request(a, guild_id)).toBe(0);
    expect((await join_guild(b, open)).code).toBe(0);
    expect(requests(kit)).toEqual([]);
    await release();
    expect(member(kit, b.user_id)?.guild_id).toBe(open);
  }, T);

  it('keeps the changes of a lock_guild transaction and deletes the join requests when the applicants cancel and join another guild at the same time', async () => {
    const kit = await start();
    const [l, l2, a, b] = await users(kit, 4);
    const guild_id = (await create_guild(l, 'Approval', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    const open = (await create_guild(l2, 'Open')).guild_id;
    expect((await join_guild(a, guild_id)).code).toBe(0);
    expect((await join_guild(b, guild_id)).code).toBe(0);
    const [locked, cancelled, joined] = await Promise.all([
      run_core_test(
        l,
        (ctx) => {
          const info = kit.guild().lock_guild(ctx, guild_id);
          const state = new GameContract.GuildTestUserState();
          state.guild_id = info?.guild_id ?? 0n;
          state.changes = BigInt(info?.member_count ?? 0);
          kit.storage().put_state(ctx, state);
        },
        kit,
      ),
      cancel_request(a, guild_id),
      join_guild(b, open),
    ]);
    expect([locked, cancelled, joined.code]).toEqual([0, 0, 0]);
    expect(requests(kit)).toEqual([]);
    expect(await test_state(kit, l.user_id)).toMatchObject({ guild_id, changes: 1n });
    expect(member(kit, b.user_id)?.guild_id).toBe(open);
  }, T);

  it('makes an Officer\'s AcceptGuildJoinRequest processed after the kick of the Officer commits GUILD_NOT_MEMBER, and the applicant is not a member', async () => {
    const kit = await start();
    const [l, o, a] = await users(kit, 3);
    const guild_id = await guild_with(l, 'Home', [o], [o]);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_APPROVAL)).toBe(0);
    expect((await join_guild(a, guild_id)).code).toBe(0);
    expect(await on_user(l, 'KickGuildMember', o.user_id)).toBe(0);
    expect(await on_user(o, 'AcceptGuildJoinRequest', a.user_id)).toBe(E.CORE_ERROR_GUILD_NOT_MEMBER);
    expect(member(kit, a.user_id)).toBeNull();
    expect(member_ids(kit, guild_id)).toEqual([l.user_id]);
    expect(guild_row(kit, guild_id)?.member_count).toBe(1);
    expect(requests(kit)).toEqual([{ guild_id, user_id: a.user_id }]);
  }, T);

  it('makes the KickGuildMember of a former Officer processed after the change of its role to Member GUILD_PERMISSION', async () => {
    const kit = await start();
    const [l, o, m] = await users(kit, 3);
    const guild_id = await guild_with(l, 'Home', [o, m], [o]);
    expect(await set_role(l, o.user_id, Role.GUILD_ROLE_MEMBER)).toBe(0);
    expect(await on_user(o, 'KickGuildMember', m.user_id)).toBe(E.CORE_ERROR_GUILD_PERMISSION);
    expect(member(kit, m.user_id)?.guild_id).toBe(guild_id);
  }, T);

  it('makes an Officer\'s AcceptGuildJoinRequest that waits for the guild row lock of the kick of the Officer GUILD_NOT_MEMBER after the kick commits (PostgreSQL)', async () => {
    const kit = await start({ db: 'postgresql', settings: { 'storage.userLockWaitMs': 20_000 } });
    const [l, o, a] = await users(kit, 3);
    const guild_id = await guild_with(l, 'Home', [o], [o]);
    expect(await update_guild(l, JoinType.GUILD_JOIN_TYPE_APPROVAL)).toBe(0);
    expect((await join_guild(a, guild_id)).code).toBe(0);
    // The kick transaction holds the guild row and commits only after the request waits for that lock, so the request
    // read the Officer's row before the lock.
    const kick = await commit_while_locked(kit, guild_id, [
      { sql: 'DELETE FROM guild_member WHERE user_id = $1', params: [o.user_id] },
      { sql: 'UPDATE guild_guild SET member_count = member_count - 1 WHERE guild_id = $1', params: [guild_id] },
    ]);
    const committed = kick();
    expect(await on_user(o, 'AcceptGuildJoinRequest', a.user_id)).toBe(E.CORE_ERROR_GUILD_NOT_MEMBER);
    expect(await committed).toBe('committed');
    expect(member(kit, a.user_id)).toBeNull();
    expect(member_ids(kit, guild_id)).toEqual([l.user_id]);
    expect(guild_row(kit, guild_id)?.member_count).toBe(1);
    expect(requests(kit)).toEqual([{ guild_id, user_id: a.user_id }]);
  }, T);

  it('makes the KickGuildMember of an Officer that waits for the guild row lock of the change of its role to Member GUILD_PERMISSION after the change commits (PostgreSQL)', async () => {
    const kit = await start({ db: 'postgresql', settings: { 'storage.userLockWaitMs': 20_000 } });
    const [l, o, m] = await users(kit, 3);
    const guild_id = await guild_with(l, 'Home', [o, m], [o]);
    const demote = await commit_while_locked(kit, guild_id, [{ sql: 'UPDATE guild_member SET role = $2 WHERE user_id = $1', params: [o.user_id, Role.GUILD_ROLE_MEMBER] }]);
    const committed = demote();
    expect(await on_user(o, 'KickGuildMember', m.user_id)).toBe(E.CORE_ERROR_GUILD_PERMISSION);
    expect(await committed).toBe('committed');
    expect(member(kit, m.user_id)?.guild_id).toBe(guild_id);
    expect(member(kit, o.user_id)?.role).toBe(Role.GUILD_ROLE_MEMBER);
    expect(guild_row(kit, guild_id)?.member_count).toBe(3);
  }, T);

  it('makes the Withdraw of an applicant whose join request is accepted after remove_user reads its member row INTERNAL, and keeps its rows and withdrawn_at (PostgreSQL)', async () => {
    const kit = await start({ db: 'postgresql', settings: { 'storage.userLockWaitMs': 20_000 } });
    const [l, a] = await users(kit, 2);
    const guild_id = (await create_guild(l, 'Approval', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    expect((await join_guild(a, guild_id)).code).toBe(0);
    const joined_at = guild_row(kit, guild_id)?.created_at ?? 0n;
    // The accept holds the applicant's member row and commits only after remove_user waits for that lock, so
    // remove_user read no member row and locked no guild row.
    const accept = await commit_while_row_locked(kit, 'guild_member', [a.user_id], [
      {
        sql: 'INSERT INTO guild_member (user_id, guild_id, role, joined_at, active_at) VALUES ($1, $2, $3, $4, $4)',
        params: [a.user_id, guild_id, Role.GUILD_ROLE_MEMBER, joined_at],
      },
      { sql: 'UPDATE guild_guild SET member_count = member_count + 1 WHERE guild_id = $1', params: [guild_id] },
      { sql: 'DELETE FROM guild_join_request WHERE user_id = $1', params: [a.user_id] },
    ]);
    const committed = accept();
    expect(await withdraw(a)).toBe(E.CORE_ERROR_INTERNAL);
    expect(await committed).toBe('committed');
    expect(withdrawn_at(kit, a.user_id)).toBeNull();
    expect(member(kit, a.user_id)).toMatchObject({ guild_id, role: Role.GUILD_ROLE_MEMBER, joined_at });
    expect(member_ids(kit, guild_id)).toEqual([l.user_id, a.user_id].sort((x, y) => (x < y ? -1 : 1)));
    expect(guild_row(kit, guild_id)).toMatchObject({ leader_id: l.user_id, member_count: 2 });
    expect(requests(kit)).toEqual([]);
  }, T);

  it('makes the Withdraw of a member whose row moves to another guild after remove_user locks the first guild INTERNAL, and keeps the other guild\'s row and withdrawn_at (PostgreSQL)', async () => {
    const kit = await start({ db: 'postgresql', settings: { 'storage.userLockWaitMs': 20_000 } });
    const [l, h, a] = await users(kit, 3);
    const first = await guild_with(l, 'First', [a]);
    const other = (await create_guild(h, 'Other')).guild_id;
    const joined_at = guild_row(kit, other)?.created_at ?? 0n;
    // The move (a kick from the first guild, then a join of the other) holds the member's row and commits only after
    // remove_user, which read the row in the first guild and locked that guild row, waits for that lock.
    const move = await commit_while_row_locked(kit, 'guild_member', [a.user_id], [
      { sql: 'DELETE FROM guild_member WHERE user_id = $1', params: [a.user_id] },
      { sql: 'UPDATE guild_guild SET member_count = member_count - 1 WHERE guild_id = $1', params: [first] },
      {
        sql: 'INSERT INTO guild_member (user_id, guild_id, role, joined_at, active_at) VALUES ($1, $2, $3, $4, $4)',
        params: [a.user_id, other, Role.GUILD_ROLE_MEMBER, joined_at],
      },
      { sql: 'UPDATE guild_guild SET member_count = member_count + 1 WHERE guild_id = $1', params: [other] },
    ]);
    const committed = move();
    expect(await withdraw(a)).toBe(E.CORE_ERROR_INTERNAL);
    expect(await committed).toBe('committed');
    expect(withdrawn_at(kit, a.user_id)).toBeNull();
    expect(member(kit, a.user_id)).toMatchObject({ guild_id: other, role: Role.GUILD_ROLE_MEMBER, joined_at });
    expect(member_ids(kit, other)).toEqual([h.user_id, a.user_id].sort((x, y) => (x < y ? -1 : 1)));
    expect(guild_row(kit, other)).toMatchObject({ leader_id: h.user_id, member_count: 2 });
    expect(member_ids(kit, first)).toEqual([l.user_id]);
    expect(guild_row(kit, first)).toMatchObject({ leader_id: l.user_id, member_count: 1 });
  }, T);
});
