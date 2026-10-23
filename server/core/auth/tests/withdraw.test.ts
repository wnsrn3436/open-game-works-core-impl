import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { E, P, admin, auto_login, call, fake, guest, missing, personal_rows, probe, social, start, testing, user_record, withdraw, type TestServer, type TestSession } from './helpers.ts';

let server: TestServer;
beforeAll(async () => {
  server = await start({ settings: { 'environments.<ENV>.adapters.push-fcm': 'fake' } });
});
afterAll(async () => {
  await testing.stop_test_server(server);
});

const PERSONAL = ['auth_social_link', 'auth_terms_agreement', 'auth_age', 'auth_consent_record', 'auth_apple_token'];

async function personal_tables(user_id: bigint): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of PERSONAL) out[table] = await personal_rows(server, user_id, table);
  return out;
}

async function filled_user(): Promise<{ session: TestSession; result: CoreContract.AuthResult }> {
  const user = await social(server, P.LOGIN_PROVIDER_APPLE, `filled-${String(Math.random())}`);
  const age = Object.assign(new CoreContract.ConfirmAgeRequest(), { birth_year_month: 199001 });
  expect((await call(user.session, 'core/ConfirmAge', age)).code).toBe(0);
  const consent = Object.assign(new CoreContract.UpdateConsentRequest(), {
    privacy_version: 1,
    ad_personalization: CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED,
    tracking: CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE,
  });
  expect((await call(user.session, 'core/UpdateConsent', consent)).code).toBe(0);
  return user;
}

describe('Withdraw', () => {
  it('removes every user scope row and the next request is UNAUTHORIZED', async () => {
    const user = await filled_user();
    expect(Object.values(await personal_tables(user.result.user_id)).every((rows) => rows.length > 0)).toBe(true);
    expect(await withdraw(user.session)).toBe(0);
    expect(await probe(user.session)).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect((await auto_login(server, user.result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect(await personal_tables(user.result.user_id)).toEqual(Object.fromEntries(PERSONAL.map((t) => [t, []])));
    const record = await user_record(server, user.result.user_id);
    expect(record?.withdrawn_at).not.toBeNull();
    expect(record?.user_state).toEqual({});
  });

  it('leaves no auth_age or auth_consent_record rows', async () => {
    const user = await filled_user();
    expect(await withdraw(user.session)).toBe(0);
    expect(await personal_rows(server, user.result.user_id, 'auth_age')).toEqual([]);
    expect(await personal_rows(server, user.result.user_id, 'auth_consent_record')).toEqual([]);
  });

  // `friend`, `guild` and `chat` are not in this core yet.
  it.skipIf(missing('friend', 'guild', 'chat'))('removes the friend link rows, the guild member row and the chat messages of the user', async () => {
    const leaving = await guest(server);
    const staying = await guest(server);
    const friend = Object.assign(new CoreContract.SendFriendRequestRequest(), { user_id: staying.result.user_id });
    expect((await call(leaving.session, 'core/SendFriendRequest', friend)).code).toBe(0);
    const accept = Object.assign(new CoreContract.AcceptFriendRequestRequest(), { user_id: leaving.result.user_id });
    expect((await call(staying.session, 'core/AcceptFriendRequest', accept)).code).toBe(0);
    const created = await call<CoreContract.CreateGuildResponse>(
      staying.session,
      'core/CreateGuild',
      Object.assign(new CoreContract.CreateGuildRequest(), { name: `g${staying.result.user_id.toString()}`, description: '', join_type: CoreContract.GuildJoinType.GUILD_JOIN_TYPE_OPEN }),
    );
    expect(created.code).toBe(0);
    const join = Object.assign(new CoreContract.JoinGuildRequest(), { guild_id: created.response.guild_id });
    expect((await call(leaving.session, 'core/JoinGuild', join)).code).toBe(0);
    const message = Object.assign(new CoreContract.SendChatMessageRequest(), {
      channel_kind: CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_WORLD,
      message_kind: CoreContract.ChatMessageKind.CHAT_MESSAGE_KIND_TEXT,
      channel_key: 1n,
      text: 'hello from the leaving user',
    });
    expect((await call(leaving.session, 'core/SendChatMessage', message)).code).toBe(0);

    expect(await withdraw(leaving.session)).toBe(0);

    const friends = await call<CoreContract.GetFriendsResponse>(staying.session, 'core/GetFriends', new CoreContract.GetFriendsRequest());
    expect(friends.response.friends.map((f) => f.profile?.user_id)).not.toContain(leaving.result.user_id);
    const guild = await call<CoreContract.GetGuildResponse>(staying.session, 'core/GetGuild', Object.assign(new CoreContract.GetGuildRequest(), { guild_id: created.response.guild_id }));
    expect(guild.response.members.map((m) => m.profile?.user_id)).not.toContain(leaving.result.user_id);
    const chat = await call<CoreContract.GetChatMessagesResponse>(
      staying.session,
      'core/GetChatMessages',
      Object.assign(new CoreContract.GetChatMessagesRequest(), { channel_kind: CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_WORLD, channel_key: 1n }),
    );
    expect(chat.response.messages.map((m) => m.sender_id)).not.toContain(leaving.result.user_id);
  });

  it.skipIf(missing('ranking'))('after Withdraw the user is not in a ranking query result', async () => {
    const board_id = testing.load_data().dev.find_id_value('[rk_sum]');
    let ranking: { submit_score(ctx: unknown, board_id: number, score: bigint, display: string): string } | null = null;
    const submitted: string[] = [];
    let score = 0n;
    const own = await start({
      register: (core) => {
        ranking = core.ranking as typeof ranking;
      },
      core_test: (ctx) => {
        if (ranking !== null) submitted.push(ranking.submit_score(ctx, board_id, score, ''));
      },
    });
    try {
      const leaving = await guest(own);
      const staying = await guest(own);
      score = 20n;
      expect((await call(leaving.session, 'RunCoreTest', new GameContract.RunCoreTestRequest())).code).toBe(0);
      score = 10n;
      expect((await call(staying.session, 'RunCoreTest', new GameContract.RunCoreTestRequest())).code).toBe(0);
      expect(submitted).toEqual(['OK', 'OK']);
      const top = Object.assign(new CoreContract.GetRankingTopRequest(), { board_id, previous: false, offset: 0, limit: 10 });
      const before = await call<CoreContract.GetRankingTopResponse>(staying.session, 'core/GetRankingTop', top);
      expect(before.response.entries.map((e) => e.user_id)).toEqual([leaving.result.user_id, staying.result.user_id]);

      expect(await withdraw(leaving.session)).toBe(0);

      // A different offset so that the query is not the cached result of the first one.
      const after = await call<CoreContract.GetRankingTopResponse>(staying.session, 'core/GetRankingTop', Object.assign(top, { limit: 9 }));
      expect(after.response.entries.map((e) => [e.user_id, e.rank])).toEqual([[staying.result.user_id, 1]]);
      const around = await call<CoreContract.GetRankingAroundResponse>(
        staying.session,
        'core/GetRankingAround',
        Object.assign(new CoreContract.GetRankingAroundRequest(), { board_id, previous: false }),
      );
      expect(around.response.my_entry?.rank).toBe(1);
      expect(around.response.entries).toEqual([]);
    } finally {
      await testing.stop_test_server(own);
    }
  });
  it.skipIf(missing('guild'))('a guild.remove_user FAILED by a lock wait makes Withdraw and ConfirmAge INTERNAL, withdraw_user 500, POST /account/deletion 500 and keeps the guest of auth_guest_sweep, with no change and no revoke', async () => {
    const sweep_after = 1_000_000n;
    const locked = await start({
      settings: {
        'storage.userLockWaitMs': 200,
        'consent.minimumAge': 14,
        'consent.ageConfirmation': true,
        'auth.inactiveGuestDeleteAfterMs': Number(sweep_after),
        'auth.guestSweepIntervalMs': 1000,
        'auth.deletionAttemptsPerMinute': 1000,
      },
    });
    try {
      const leader = await social(locked, P.LOGIN_PROVIDER_GOOGLE, 'lock_leader');
      const member = await social(locked, P.LOGIN_PROVIDER_APPLE, 'lock_member');
      const idle = await guest(locked);
      const created = await call<CoreContract.CreateGuildResponse>(
        leader.session,
        'core/CreateGuild',
        Object.assign(new CoreContract.CreateGuildRequest(), { name: 'Locked Guild', description: '', join_type: CoreContract.GuildJoinType.GUILD_JOIN_TYPE_OPEN }),
      );
      expect(created.code).toBe(0);
      const guild_id = created.response.guild_id;
      for (const joiner of [member, idle]) {
        expect((await call(joiner.session, 'core/JoinGuild', Object.assign(new CoreContract.JoinGuildRequest(), { guild_id }))).code).toBe(0);
      }
      const issued = await call<CoreContract.IssueDeletionCodeResponse>(member.session, 'core/IssueDeletionCode', new CoreContract.IssueDeletionCodeRequest());
      expect(issued.code).toBe(0);
      const member_id = member.result.user_id;
      const before = { state: await testing.read_user_state(locked, member_id), links: await personal_rows(locked, member_id, 'auth_social_link') };
      const birth_below_minimum = Object.assign(new CoreContract.ConfirmAgeRequest(), { birth_year_month: 202601 });
      const form = new URLSearchParams({ method: 'code', confirm: 'yes', user_id: member_id.toString(), code: issued.response.code }).toString();

      const release = await testing.hold_game_row_lock(locked, 'guild_guild', [guild_id]);
      try {
        expect(await withdraw(member.session)).toBe(E.CORE_ERROR_INTERNAL);
        expect((await call(member.session, 'core/ConfirmAge', birth_below_minimum)).code).toBe(E.CORE_ERROR_INTERNAL);
        expect((await admin(locked, 'withdraw_user', { user_id: member_id.toString() })).status).toBe(500);
        const page = await testing.send_raw(locked, 'POST', '/account/deletion', { 'Content-Type': 'application/x-www-form-urlencoded' }, new TextEncoder().encode(form));
        expect(page.status).toBe(500);
        expect(new TextDecoder().decode(page.body)).toContain('<p>Auth deletion retry</p>');
        testing.advance_time(locked, sweep_after + 1000n);
        await testing.wait_background(locked);
      } finally {
        await release();
      }

      for (const user_id of [member_id, idle.result.user_id]) expect((await user_record(locked, user_id))?.withdrawn_at).toBeNull();
      expect(await testing.read_user_state(locked, member_id)).toEqual(before.state);
      expect(await personal_rows(locked, member_id, 'auth_social_link')).toEqual(before.links);
      expect(fake(locked, 'login-apple').calls().filter((c) => c.operation === 'revoke')).toEqual([]);
    } finally {
      await testing.stop_test_server(locked);
    }
  });
});

describe('withdraw_user', () => {
  it('removes the user scope rows; the next request is UNAUTHORIZED; a missing or withdrawn user is not_found', async () => {
    const user = await filled_user();
    const reply = await admin(server, 'withdraw_user', { user_id: user.result.user_id.toString() });
    expect(reply.status).toBe(200);
    expect(await probe(user.session)).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect(await personal_tables(user.result.user_id)).toEqual(Object.fromEntries(PERSONAL.map((t) => [t, []])));
    expect((await admin(server, 'withdraw_user', { user_id: user.result.user_id.toString() })).status).toBe(404);
    expect((await admin(server, 'withdraw_user', { user_id: '987654321' })).status).toBe(404);
  });

  it.skipIf(missing('push'))('removes the push device registration of the user', async () => {
    const user = await filled_user();
    const push = Object.assign(new CoreContract.RegisterPushTokenRequest(), { device_token: 'device-token-1', language: 'en', timezone_offset_ms: 0n });
    expect((await call(user.session, 'core/RegisterPushToken', push, { headers: { 'X-Ogw-Platform': 'android' } })).code).toBe(0);
    expect((await admin(server, 'withdraw_user', { user_id: user.result.user_id.toString() })).status).toBe(200);
    const exported = await admin(server, 'export_personal_data', { user_id: user.result.user_id.toString() });
    expect(JSON.stringify(exported.body)).not.toContain('device-token-1');
  });
});

describe('find_user_by_social_account', () => {
  it('gives an operator with only read the user ID and linked_at of a linked account and changes nothing', async () => {
    const user = await guest(server);
    const link = Object.assign(new CoreContract.LinkAccountRequest(), { provider: P.LOGIN_PROVIDER_GOOGLE, credential: 'fake:find-1' });
    expect((await call(user.session, 'core/LinkAccount', link)).code).toBe(0);
    const before = await testing.read_user_state(server, user.result.user_id);
    const found = await admin(server, 'find_user_by_social_account', { provider: 'GOOGLE', provider_account_id: 'find-1' }, 'read');
    expect(found.status).toBe(200);
    expect(found.body.user_id).toBe(user.result.user_id.toString());
    expect(typeof found.body.linked_at).toBe('string');
    expect(await testing.read_user_state(server, user.result.user_id)).toEqual(before);
  });

  it('is not_found for an account that is not linked or whose user withdrew, and bad_request for an empty ID or GUEST', async () => {
    expect((await admin(server, 'find_user_by_social_account', { provider: 'GOOGLE', provider_account_id: 'nobody' }, 'read')).status).toBe(404);
    const user = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'find-withdrawn');
    expect(await withdraw(user.session)).toBe(0);
    expect((await admin(server, 'find_user_by_social_account', { provider: 'GOOGLE', provider_account_id: 'find-withdrawn' }, 'read')).status).toBe(404);
    expect((await admin(server, 'find_user_by_social_account', { provider: 'GOOGLE', provider_account_id: '' }, 'read')).status).toBe(400);
    expect((await admin(server, 'find_user_by_social_account', { provider: 'GUEST', provider_account_id: 'x' }, 'read')).status).toBe(400);
  });
});
