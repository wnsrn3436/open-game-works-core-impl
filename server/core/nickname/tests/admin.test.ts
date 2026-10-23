import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { send_admin, stop_test_server, type TestServer } from '../../testing/dev/index.ts';
import { gems, in_user_transaction, nickname_state, set_gems, set_nickname, start, users, withdraw } from './helpers.ts';

async function rename(server: TestServer, operation_id: string, user_id: bigint, nickname: string): Promise<{ status: number; json: unknown }> {
  const { status, json } = await send_admin(server, 'rename_user', { operation_id, user_id: user_id.toString(), nickname, reason: 'test' });
  return { status, json };
}

async function find(server: TestServer, nickname: string): Promise<{ status: number; json: unknown }> {
  const { status, json } = await send_admin(server, 'find_user_by_nickname', { nickname });
  return { status, json };
}

/** The `NicknameUserState` upserts of a response's `pending_user_state`. */
function pending_nicknames(envelope: CoreContract.ResponseEnvelope): CoreContract.NicknameUserState[] {
  const entries = envelope.pending_user_state?.entries ?? [];
  return entries.filter((e) => e.kind === 'NicknameUserState' && !e.deleted).map((e) => CoreContract.NicknameUserState.decode(e.value)).filter((v) => v !== null);
}

describe('rename_user', () => {
  it('changes the nickname without the banned word check, the cooldown and the cost, and makes a pending delta with forced true', async () => {
    const h = await start(true, { 'nickname.changeCooldownMs': 1_000_000 });
    try {
      const [a] = await users(h.server, ['a']);
      expect((await set_nickname(a, 'Before')).code).toBe(0);
      expect(await rename(h.server, 'op-1', a.user_id, 'BadWord')).toEqual({ status: 200, json: {} });
      expect(await nickname_state(h.server, a.user_id)).toMatchObject({ nickname: 'BadWord', change_count: 0, forced: true });
      expect(await gems(h.server, a.user_id)).toBe(0n);
      const next = await set_nickname(a, 'BadWord');
      expect(next.code).toBe(0);
      expect(pending_nicknames(next.envelope)).toEqual([expect.objectContaining({ nickname: 'BadWord', forced: true })]);
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('is bad_request for a character rule violation and conflict for a nickname another user has with nicknameUnique true', async () => {
    const h = await start(true);
    try {
      const [a, b] = await users(h.server, ['a', 'b']);
      expect((await set_nickname(a, 'Owner')).code).toBe(0);
      expect((await rename(h.server, 'op-1', b.user_id, 'a')).status).toBe(400);
      expect((await rename(h.server, 'op-2', b.user_id, 'ab  c')).status).toBe(400);
      expect((await rename(h.server, 'op-3', b.user_id, 'OWNER')).status).toBe(409);
      expect(await nickname_state(h.server, b.user_id)).toBeNull();
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('moves the nickname_name row: with nicknameUnique true the new name finds the user and is NICKNAME_TAKEN for another user, and the old name is free', async () => {
    const h = await start(true);
    try {
      const [a, b] = await users(h.server, ['a', 'b']);
      expect((await set_nickname(a, 'Before')).code).toBe(0);
      expect(await rename(h.server, 'op-1', a.user_id, 'After')).toEqual({ status: 200, json: {} });
      const rows = h.core().storage.read_db().query('SELECT user_id, normalized, nickname FROM nickname_name WHERE user_id = $1', [a.user_id]);
      expect(rows).toEqual([{ user_id: a.user_id, normalized: 'after', nickname: 'After' }]);
      expect(await find(h.server, 'after')).toEqual({ status: 200, json: { users: [{ user_id: a.user_id.toString(), nickname: 'After' }] } });
      expect(await find(h.server, 'before')).toEqual({ status: 200, json: { users: [] } });
      const names = await in_user_transaction(h.core(), b.user_id, (ctx) => h.nickname().get_nicknames(ctx, [a.user_id]));
      expect(names).toEqual([{ user_id: a.user_id, nickname: 'After' }]);
      expect((await set_nickname(b, 'after')).code).toBe(CoreContract.CoreError.CORE_ERROR_NICKNAME_TAKEN);
      expect((await set_nickname(b, 'before')).code).toBe(0);
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('a first nickname from rename_user has change_count 0, and the next SetNickname has no cooldown, pays the change_number 1 cost and has change_count 1; rename_user keeps an existing change_count', async () => {
    const h = await start(false, { 'nickname.changeCooldownMs': 1_000_000 });
    try {
      const [fresh, named] = await users(h.server, ['fresh', 'named']);
      expect((await rename(h.server, 'op-1', fresh.user_id, 'Given')).status).toBe(200);
      expect(await nickname_state(h.server, fresh.user_id)).toMatchObject({ nickname: 'Given', change_count: 0, forced: true });
      await set_gems(h.server, fresh.user_id, 100n);
      expect((await set_nickname(fresh, 'Chosen')).code).toBe(0);
      expect(await nickname_state(h.server, fresh.user_id)).toMatchObject({ nickname: 'Chosen', change_count: 1, forced: false });
      expect(await gems(h.server, fresh.user_id)).toBe(90n);
      // The forced change is used up: the change right after it is in the cooldown again.
      expect((await set_nickname(fresh, 'Again')).code).toBe(CoreContract.CoreError.CORE_ERROR_NICKNAME_COOLDOWN);

      expect((await set_nickname(named, 'Mine')).code).toBe(0);
      await set_gems(h.server, named.user_id, 100n);
      expect((await rename(h.server, 'op-2', named.user_id, 'Forced')).status).toBe(200);
      expect((await set_nickname(named, 'Mine2')).code).toBe(0);
      expect(await nickname_state(h.server, named.user_id)).toMatchObject({ nickname: 'Mine2', change_count: 1 });
      expect((await rename(h.server, 'op-3', named.user_id, 'Forced2')).status).toBe(200);
      expect(await nickname_state(h.server, named.user_id)).toMatchObject({ nickname: 'Forced2', change_count: 1, forced: true });
    } finally {
      await stop_test_server(h.server);
    }
  });
});

describe('find_user_by_nickname', () => {
  it('finds the user for an input that differs in case, full width or spaces, in user ID order; withdrawn users and unknown nicknames give an empty list', async () => {
    const h = await start(true, { 'nickname.maxLength': 12 });
    try {
      const [a, b] = await users(h.server, ['a', 'b']);
      expect((await set_nickname(a, 'Echo One')).code).toBe(0);
      expect((await set_nickname(b, 'Other')).code).toBe(0);
      for (const input of ['Echo One', 'echoone', 'ＥＣＨＯ ＯＮＥ']) {
        expect(await find(h.server, input)).toEqual({ status: 200, json: { users: [{ user_id: a.user_id.toString(), nickname: 'Echo One' }] } });
      }
      expect(await find(h.server, 'Nobody')).toEqual({ status: 200, json: { users: [] } });
      expect((await find(h.server, '')).status).toBe(400);
      expect((await find(h.server, 'x'.repeat(13))).status).toBe(400);
      expect(await withdraw(a)).toBe(0);
      expect(await find(h.server, 'Echo One')).toEqual({ status: 200, json: { users: [] } });
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('with nicknameUnique false returns every user of the same normalized nickname', async () => {
    const h = await start(false);
    try {
      const [a, b, c] = await users(h.server, ['a', 'b', 'c']);
      expect((await set_nickname(b, 'echo')).code).toBe(0);
      expect((await set_nickname(a, 'Echo')).code).toBe(0);
      expect((await set_nickname(c, 'E C H O')).code).toBe(0);
      const ids = [a, b, c].map((s) => s.user_id).sort((x, y) => (x < y ? -1 : 1));
      const names = new Map([[a.user_id, 'Echo'], [b.user_id, 'echo'], [c.user_id, 'E C H O']]);
      expect(await find(h.server, 'ECHO')).toEqual({ status: 200, json: { users: ids.map((id) => ({ user_id: id.toString(), nickname: names.get(id) })) } });
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('returns at most admin-api.maxSearchRows users, the first in user ID order', async () => {
    const h = await start(false, { 'admin-api.maxSearchRows': 2 });
    try {
      const sessions = await users(h.server, ['a', 'b', 'c']);
      for (const s of sessions) expect((await set_nickname(s, 'Delta')).code).toBe(0);
      const ids = sessions.map((s) => s.user_id).sort((x, y) => (x < y ? -1 : 1));
      expect(await find(h.server, 'delta')).toEqual({ status: 200, json: { users: ids.slice(0, 2).map((id) => ({ user_id: id.toString(), nickname: 'Delta' })) } });
    } finally {
      await stop_test_server(h.server);
    }
  });
});
