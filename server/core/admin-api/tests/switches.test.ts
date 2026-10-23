// Ban, maintenance and kill switch: their effect on game requests, the switch cache, and persistence.
import { admin, advance, claim_all, CoreError, get_user, login, read_mail, restart, peer, start, stop, wait_background, type Server } from './helpers.ts';

describe('ban, maintenance and kill switch', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('keeps ban_user, set_maintenance and set_kill_switch across restart_test_server and a server restart, and removes the rows on unban_user and enabled false', async () => {
    server = await start();
    const { user_id } = await login(server, 'kept');
    expect((await admin(server, 'ban_user', { user_id, until_at: '0', reason: 'cheating' })).status).toBe(200);
    expect((await admin(server, 'set_maintenance', { enabled: true })).status).toBe(200);
    expect((await admin(server, 'set_kill_switch', { request_name: 'core/ClaimAllMail', enabled: true })).status).toBe(200);
    server = await restart(server);
    const ban = (await get_user(server, user_id)).json.ban as Record<string, unknown>;
    expect(ban).toMatchObject({ until_at: '0', reason: 'cheating' });
    expect(typeof ban.banned_at).toBe('string');
    expect((await admin(server, 'get_switches')).json).toEqual({ maintenance: true, kill_switches: ['core/ClaimAllMail'] });
    expect((await admin(server, 'unban_user', { user_id })).status).toBe(200);
    expect((await admin(server, 'set_maintenance', { enabled: false })).status).toBe(200);
    expect((await admin(server, 'set_kill_switch', { request_name: 'core/ClaimAllMail', enabled: false })).status).toBe(200);
    server = await restart(server);
    expect((await get_user(server, user_id)).json.ban).toBeNull();
    expect((await admin(server, 'get_switches')).json).toEqual({ maintenance: false, kill_switches: [] });
  });

  it('answers BANNED to a banned user\'s game request, processes it once until_at passed, and right after unban_user', async () => {
    server = await start();
    const { session, user_id } = await login(server, 'banned');
    const now = (await claim_all(session)).envelope.server_time_at;
    await admin(server, 'ban_user', { user_id, until_at: String(now + 60000n), reason: 'r' });
    const refused = await claim_all(session);
    expect(refused.code).toBe(CoreError.CORE_ERROR_BANNED);
    expect(refused.envelope.error?.ban?.until_at).toBe(now + 60000n);
    expect((await get_user(server, user_id)).json.ban).toMatchObject({ until_at: String(now + 60000n), reason: 'r' });
    advance(server, 60000n);
    expect((await claim_all(session)).code).toBe(0);
    // The expired ban row stays, but the user is no ban target: `get_user` answers ban null.
    expect((await get_user(server, user_id)).json.ban).toBeNull();
    await admin(server, 'ban_user', { user_id, until_at: '0', reason: 'r' });
    expect((await claim_all(session)).code).toBe(CoreError.CORE_ERROR_BANNED);
    await admin(server, 'unban_user', { user_id });
    expect((await claim_all(session)).code).toBe(0);
  });

  it('has every server instance answer MAINTENANCE within admin-api.switchCacheMs of set_maintenance, and process again within it after turning it off', async () => {
    server = await start({ settings: { 'admin-api.switchCacheMs': 1000 } });
    const other = await peer(server);
    try {
      const here = await login(server, 'here');
      const there = await login(other, 'there');
      await admin(server, 'set_maintenance', { enabled: true });
      expect((await claim_all(here.session)).code).toBe(CoreError.CORE_ERROR_MAINTENANCE);
      advance(server, 1000n);
      await wait_background(other);
      expect((await claim_all(there.session)).code).toBe(CoreError.CORE_ERROR_MAINTENANCE);
      await admin(server, 'set_maintenance', { enabled: false });
      expect((await claim_all(here.session)).code).toBe(0);
      advance(server, 1000n);
      await wait_background(other);
      expect((await claim_all(there.session)).code).toBe(0);
    } finally {
      await stop(other);
    }
  });

  it('answers FEATURE_DISABLED to a kill switched request and processes the others; refuses NoAccessTokenRpc with 409 and an unknown name with 404; takes MATCH_REQUEST', async () => {
    server = await start();
    const { session } = await login(server, 'killed');
    expect((await admin(server, 'set_kill_switch', { request_name: 'core/ClaimAllMail', enabled: true })).status).toBe(200);
    expect((await claim_all(session)).code).toBe(CoreError.CORE_ERROR_FEATURE_DISABLED);
    expect((await read_mail(session, 1n)).code).toBe(CoreError.CORE_ERROR_MAIL_NOT_FOUND);
    for (const name of ['core/Login', 'core/GetNotices']) {
      const reply = await admin(server, 'set_kill_switch', { request_name: name, enabled: true });
      expect([name, reply.status, reply.json.error]).toEqual([name, 409, 'conflict']);
    }
    expect((await admin(server, 'set_kill_switch', { request_name: 'MATCH_REQUEST', enabled: true })).status).toBe(200);
    expect((await admin(server, 'set_kill_switch', { request_name: 'cheat/AddGold', enabled: true })).status).toBe(404);
    expect((await admin(server, 'set_kill_switch', { request_name: 'core/cheat/SetItemBalance', enabled: true })).status).toBe(404);
    expect((await admin(server, 'set_kill_switch', { request_name: 'core/NoSuchRpc', enabled: true })).status).toBe(404);
    expect((await admin(server, 'get_switches')).json).toEqual({ maintenance: false, kill_switches: ['MATCH_REQUEST', 'core/ClaimAllMail'] });
  });
});
