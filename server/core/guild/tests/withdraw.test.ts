import {
  E,
  JoinType,
  Role,
  T,
  advance_time,
  create_guild,
  guild_row,
  guild_with,
  join_guild,
  leave,
  member,
  member_ids,
  on_user,
  requests,
  rows,
  set_role,
  start,
  stop_servers,
  users,
  withdraw,
  withdrawn_at,
  type Kit,
} from './kit.ts';
import { lock_key } from '../../storage/tx.ts';
import { hold_lock_key, start_peer_process, stop_peer_processes, until_blocked_by, type PeerProcess, type TestSession } from '../../testing/dev/index.ts';
import { joined_gate } from './peer.ts';

afterEach(stop_servers);

/** The guild's `leader_id` has a `Leader` row in the guild, and `member_count` is its member row count. */
function consistent(kit: Kit, guild_id: bigint): void {
  const guild = guild_row(kit, guild_id);
  if (guild === null) return;
  expect(member(kit, guild.leader_id)).toMatchObject({ guild_id, role: Role.GUILD_ROLE_LEADER });
  expect(guild.member_count).toBe(member_ids(kit, guild_id).length);
  expect(rows(kit, 'SELECT user_id FROM guild_member WHERE guild_id = $1 AND role = $2', [guild_id, Role.GUILD_ROLE_LEADER])).toHaveLength(1);
}

describe('Withdraw', () => {
  it('makes the Officer who joined first the Leader after the Leader withdraws, or the Member who joined first when there is no Officer; a Leader alone disbands', async () => {
    const kit = await start();
    const [l1, m1, o2, o1, l2, n2, n1, l3] = await users(kit, 8);
    const first = (await create_guild(l1, 'First')).guild_id;
    const second = (await create_guild(l2, 'Second')).guild_id;
    const third = (await create_guild(l3, 'Third')).guild_id;
    expect((await join_guild(m1, first)).code).toBe(0);
    advance_time(kit.server, 10n);
    expect((await join_guild(o1, first)).code).toBe(0);
    expect((await join_guild(n1, second)).code).toBe(0);
    advance_time(kit.server, 10n);
    expect((await join_guild(o2, first)).code).toBe(0);
    expect((await join_guild(n2, second)).code).toBe(0);
    expect(await set_role(l1, o2.user_id, Role.GUILD_ROLE_OFFICER)).toBe(0);
    expect(await set_role(l1, o1.user_id, Role.GUILD_ROLE_OFFICER)).toBe(0);
    expect(await withdraw(l1)).toBe(0);
    expect(guild_row(kit, first)?.leader_id).toBe(o1.user_id);
    expect(member(kit, o1.user_id)?.role).toBe(Role.GUILD_ROLE_LEADER);
    expect(member(kit, l1.user_id)).toBeNull();
    consistent(kit, first);
    expect(await withdraw(l2)).toBe(0);
    expect(guild_row(kit, second)?.leader_id).toBe(n1.user_id);
    consistent(kit, second);
    expect(await withdraw(l3)).toBe(0);
    expect(guild_row(kit, third)).toBeNull();
    expect(rows(kit, 'SELECT guild_id FROM guild_name WHERE guild_id = $1', [third])).toEqual([]);
  }, T);

  it('calls on_guild_member_changed once with the user ctx, the user ID and Left; RoleChanged of the new Leader comes first; a Leader alone gets only Disbanded', async () => {
    const kit = await start();
    const [l, m, o, solo] = await users(kit, 4);
    const guild_id = await guild_with(l, 'Home', [m, o], [o]);
    const lone = (await create_guild(solo, 'Lone')).guild_id;
    kit.content.changed.length = 0;
    expect(await withdraw(m)).toBe(0);
    expect(kit.content.changed).toEqual([{ ctx_user: m.user_id, guild_id, user_id: m.user_id, change: 'Left' }]);
    kit.content.changed.length = 0;
    expect(await withdraw(l)).toBe(0);
    expect(kit.content.changed).toEqual([
      { ctx_user: l.user_id, guild_id, user_id: o.user_id, change: 'RoleChanged' },
      { ctx_user: l.user_id, guild_id, user_id: l.user_id, change: 'Left' },
    ]);
    kit.content.changed.length = 0;
    expect(await withdraw(solo)).toBe(0);
    expect(kit.content.changed).toEqual([{ ctx_user: solo.user_id, guild_id: lone, user_id: solo.user_id, change: 'Disbanded' }]);
  }, T);

  it('deletes the join requests and cooldown of the withdrawn user', async () => {
    const kit = await start({ settings: { 'guild.rejoinCooldownMs': 1000 } });
    const [l1, l2, a] = await users(kit, 3);
    const home = await guild_with(l1, 'Home', [a]);
    const other = (await create_guild(l2, 'Other', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    expect(await leave(a)).toBe(0);
    expect(rows(kit, 'SELECT user_id FROM guild_cooldown WHERE user_id = $1', [a.user_id])).toHaveLength(1);
    advance_time(kit.server, 1000n);
    expect((await join_guild(a, other)).code).toBe(0);
    expect(await withdraw(a)).toBe(0);
    expect(requests(kit)).toEqual([]);
    expect(rows(kit, 'SELECT user_id FROM guild_cooldown WHERE user_id = $1', [a.user_id])).toEqual([]);
    expect(guild_row(kit, home)?.member_count).toBe(1);
  }, T);

  it('keeps leader_id and member_count consistent when the Leader withdraws while the successor Officer leaves', async () => {
    const kit = await start();
    const [l, o, m] = await users(kit, 3);
    const guild_id = await guild_with(l, 'Home', [o, m], [o]);
    const [withdrawn, left] = await Promise.all([withdraw(l), leave(o)]);
    expect(withdrawn).toBe(0);
    expect([0, E.CORE_ERROR_GUILD_LEADER_CANNOT_LEAVE]).toContain(left);
    expect(withdrawn_at(kit, l.user_id)).not.toBeNull();
    expect(member(kit, l.user_id)).toBeNull();
    consistent(kit, guild_id);
  }, T);

  it('after a Withdraw of an applicant and an AcceptGuildJoinRequest of its join request at once, a withdrawn applicant has no member row, no join request is left and member_count is the member row count; a Withdraw whose remove_user read no member row before the accept committed is INTERNAL and leaves the applicant a member', async () => {
    const kit = await start();
    const [l, a] = await users(kit, 2);
    const guild_id = (await create_guild(l, 'Approval', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    expect((await join_guild(a, guild_id)).code).toBe(0);
    const [withdrawn, accepted] = await Promise.all([withdraw(a), on_user(l, 'AcceptGuildJoinRequest', a.user_id)]);
    expect(requests(kit)).toEqual([]);
    consistent(kit, guild_id);
    // Which of the three orders ran depends on the transactions; the tests below force each one.
    if (withdrawn === 0) {
      expect([0, E.CORE_ERROR_GUILD_REQUEST_NOT_FOUND]).toContain(accepted);
      expect(withdrawn_at(kit, a.user_id)).not.toBeNull();
      expect(member(kit, a.user_id)).toBeNull();
    } else {
      // `### withdrawal` step 3: the row read again is in a guild that step 1 did not lock.
      expect(withdrawn).toBe(E.CORE_ERROR_INTERNAL);
      expect(accepted).toBe(0);
      expect(withdrawn_at(kit, a.user_id)).toBeNull();
      expect(member(kit, a.user_id)).toMatchObject({ guild_id, role: Role.GUILD_ROLE_MEMBER });
    }
  }, T);

  it('withdraws an applicant whose join request was accepted and committed before remove_user reads its member row, and leaves no member row', async () => {
    const kit = await start();
    const [l, a] = await users(kit, 2);
    const guild_id = (await create_guild(l, 'Approval', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    expect((await join_guild(a, guild_id)).code).toBe(0);
    expect(await on_user(l, 'AcceptGuildJoinRequest', a.user_id)).toBe(0);
    expect(await withdraw(a)).toBe(0);
    expect(withdrawn_at(kit, a.user_id)).not.toBeNull();
    expect(member(kit, a.user_id)).toBeNull();
    expect(requests(kit)).toEqual([]);
    expect(member_ids(kit, guild_id)).toEqual([l.user_id]);
    consistent(kit, guild_id);
  }, T);
});

describe('Withdraw of an applicant and AcceptGuildJoinRequest on two server instances (PostgreSQL)', () => {
  const PEER = { module: new URL('./peer.ts', import.meta.url), name: 'guild_peer' };

  afterEach(stop_peer_processes);

  /** The Leader of an Approval guild on one peer process and an applicant with a join request on another. */
  async function on_peers(): Promise<{ kit: Kit; accepting: PeerProcess; withdrawing: PeerProcess; l: TestSession; a: TestSession; guild_id: bigint }> {
    const kit = await start({ db: 'postgresql', settings: { 'storage.userLockWaitMs': 20_000 } });
    const accepting = await start_peer_process(kit.server, PEER);
    const withdrawing = await start_peer_process(kit.server, PEER);
    const [l] = await users({ server: accepting.remote }, 1, 'leader');
    const [a] = await users({ server: withdrawing.remote }, 1, 'applicant');
    const guild_id = (await create_guild(l, 'Approval', JoinType.GUILD_JOIN_TYPE_APPROVAL)).guild_id;
    expect((await join_guild(a, guild_id)).code).toBe(0);
    return { kit, accepting, withdrawing, l, a, guild_id };
  }

  it('makes the Withdraw INTERNAL when remove_user read no member row while the accept had added it and not committed, keeps the applicant a member and not withdrawn, and a later Withdraw takes it out', async () => {
    const { kit, accepting, l, a, guild_id } = await on_peers();
    const accepted = on_user(l, 'AcceptGuildJoinRequest', a.user_id);
    // The accept added the member row and waits in its transaction, holding the guild row and member row locks.
    const pid = Number(await accepting.reached(joined_gate(a.user_id)));
    const withdrawn = withdraw(a);
    // remove_user read no member row, so it locked only the applicant's member row, and waits for the accept.
    await until_blocked_by(kit.server, pid);
    accepting.open(joined_gate(a.user_id));
    expect(await accepted).toBe(0);
    // `### withdrawal` step 3: the row read again is in a guild that step 1 did not lock, so remove_user is FAILED.
    expect(await withdrawn).toBe(E.CORE_ERROR_INTERNAL);
    expect(withdrawn_at(kit, a.user_id)).toBeNull();
    expect(member(kit, a.user_id)).toMatchObject({ guild_id, role: Role.GUILD_ROLE_MEMBER });
    expect(member_ids(kit, guild_id)).toEqual([l.user_id, a.user_id]);
    expect(requests(kit)).toEqual([]);
    consistent(kit, guild_id);
    expect(await withdraw(a)).toBe(0);
    expect(member(kit, a.user_id)).toBeNull();
    expect(member_ids(kit, guild_id)).toEqual([l.user_id]);
    consistent(kit, guild_id);
  }, T);

  it('makes the accept that waits for the applicant member row lock behind the Withdraw GUILD_REQUEST_NOT_FOUND once the Withdraw commits', async () => {
    const { kit, l, a, guild_id } = await on_peers();
    const holder = await hold_lock_key(kit.server, lock_key('guild_member', [a.user_id]));
    // remove_user locks the applicant's member row first, then the accept waits for it too.
    const withdrawn = withdraw(a);
    await until_blocked_by(kit.server, holder.pid, 1);
    const accepted = on_user(l, 'AcceptGuildJoinRequest', a.user_id);
    await until_blocked_by(kit.server, holder.pid, 2);
    await holder.release();
    expect(await withdrawn).toBe(0);
    expect(await accepted).toBe(E.CORE_ERROR_GUILD_REQUEST_NOT_FOUND);
    expect(withdrawn_at(kit, a.user_id)).not.toBeNull();
    expect(member(kit, a.user_id)).toBeNull();
    expect(requests(kit)).toEqual([]);
    expect(member_ids(kit, guild_id)).toEqual([l.user_id]);
    consistent(kit, guild_id);
  }, T);
});
