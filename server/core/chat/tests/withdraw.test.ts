/** Withdrawal: `remove_user` drops the user's sent messages and Direct channels, also when a send to them races it. */
import { stop_test_server, type TestSession } from '../../testing/dev/index.ts';
import {
  admin_list,
  channels,
  direct_key,
  E,
  end_other_txs,
  got,
  K,
  make_friends,
  other_tx,
  rows,
  send_chat,
  sent,
  seqs,
  start,
  START_AT,
  users,
  withdraw,
  type Harness,
} from './helpers.ts';
import type { RequestCtx } from '../../storage/index.ts';

let h: Harness;

afterEach(async () => {
  end_other_txs();
  await stop_test_server(h.server);
});

/** How long another transaction keeps its locks while a request of the test server waits for them. */
const HOLD_MS = 500;

/** The `Direct` channel rows, message rows and `chat_deletion` rows whose key holds `user_id`. */
function direct_rows(user_id: bigint): unknown[][] {
  const where = 'kind = $1 AND (key_a = $2 OR key_b = $2)';
  return ['chat_channel', 'chat_message', 'chat_deletion'].map((table) => rows(h.core(), `SELECT key_a, key_b FROM ${table} WHERE ${where}`, [K.CHAT_CHANNEL_KIND_DIRECT, user_id]));
}

const NONE = [[], [], []];

/** The `withdrawn_at` of the user row (committed rows only). */
function withdrawn_at(user_id: bigint): unknown {
  return rows(h.core(), 'SELECT withdrawn_at FROM "user" WHERE user_id = $1', [user_id])[0]?.['withdrawn_at'] ?? null;
}

/** Blocks the request thread until `done` is true, for at most `limit_ms`. */
function block_until(done: () => boolean, limit_ms: number): void {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const until = Date.now() + limit_ms;
  while (!done() && Date.now() < until) Atomics.wait(sleeper, 0, 0, 10);
}

async function first_send(sender: TestSession, leaving: TestSession): Promise<number> {
  return (await send_chat(sender, K.CHAT_CHANNEL_KIND_DIRECT, leaving.user_id, 'first')).code;
}

describe('withdrawal', () => {
  it('leaves no message the user sent and no Direct channel of the user after Withdraw', async () => {
    h = await start();
    const [leaving, friend, other] = await users(h.server, 3);
    await make_friends(leaving, friend);
    await sent(send_chat(leaving, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'world from leaving'));
    await sent(send_chat(other, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'world from other'));
    await sent(send_chat(leaving, K.CHAT_CHANNEL_KIND_DIRECT, friend.user_id, 'direct out'));
    await sent(send_chat(friend, K.CHAT_CHANNEL_KIND_DIRECT, leaving.user_id, 'direct in'));
    expect(direct_rows(leaving.user_id)[0]).toHaveLength(1);

    expect(await withdraw(leaving)).toBe(0);
    expect(rows(h.core(), 'SELECT seq FROM chat_message WHERE sender_id = $1', [leaving.user_id])).toEqual([]);
    expect(direct_rows(leaving.user_id)).toEqual(NONE);
    expect((await admin_list(h.server, 'World', 1n, 0n)).map((m) => m.text)).toEqual(['world from other']);
    const [key_a, key_b] = direct_key(leaving.user_id, friend.user_id);
    expect(await admin_list(h.server, 'Direct', key_a, key_b)).toEqual([]);
    expect((await channels(friend)).filter((c) => c.channel_kind === K.CHAT_CHANNEL_KIND_DIRECT)).toEqual([]);
  });

  it('gives no seq of a World message of a withdrawn user in messages or deleted_seqs of a later GetChatMessages with a nonzero after_seq', async () => {
    h = await start();
    const [leaving, reader] = await users(h.server, 2);
    await sent(send_chat(reader, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'first'));
    await sent(send_chat(leaving, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'second'));
    await sent(send_chat(reader, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'third'));
    expect(await withdraw(leaving)).toBe(0);
    const response = await got(reader, K.CHAT_CHANNEL_KIND_WORLD, 1n, { after_seq: 1n });
    expect([seqs(response), response.deleted_seqs, response.last_delete_seq]).toEqual([[3n], [], 0n]);
  });

  it('answers a SendChatMessage to a user whose Withdraw has committed with USER_NOT_FOUND, and one sent while the Withdraw holds the Direct channel lock with USER_NOT_FOUND after that commit, leaving no Direct row of the withdrawn user', async () => {
    h = await start();
    const [sender, leaving, racing_sender, racing_leaving] = await users(h.server, 4);
    await make_friends(sender, leaving);
    await sent(send_chat(sender, K.CHAT_CHANNEL_KIND_DIRECT, leaving.user_id, 'before'));
    expect(await withdraw(leaving)).toBe(0);
    expect((await send_chat(sender, K.CHAT_CHANNEL_KIND_DIRECT, leaving.user_id, 'after')).code).toBe(E.CORE_ERROR_USER_NOT_FOUND);
    expect(direct_rows(leaving.user_id)).toEqual(NONE);

    await make_friends(racing_sender, racing_leaving);
    await sent(send_chat(racing_sender, K.CHAT_CHANNEL_KIND_DIRECT, racing_leaving.user_id, 'before'));
    // Another server instance's Withdraw: it locks the Direct channel row, removes the chat rows as remove_user does
    // and marks the user withdrawn, and commits while the send waits for that lock.
    const key = [K.CHAT_CHANNEL_KIND_DIRECT, ...direct_key(racing_sender.user_id, racing_leaving.user_id)];
    const withdrawal = await other_tx(h, [['chat_channel', key]]);
    for (const table of ['chat_message', 'chat_deletion', 'chat_channel']) await withdrawal.run(`DELETE FROM ${table} WHERE kind = $1 AND key_a = $2 AND key_b = $3`, key);
    await withdrawal.run('UPDATE "user" SET withdrawn_at = $1 WHERE user_id = $2', [START_AT, racing_leaving.user_id]);
    const committed = withdrawal.commit_after(HOLD_MS);
    const started = Date.now();
    const raced = await first_send(racing_sender, racing_leaving);
    expect(Date.now() - started).toBeGreaterThanOrEqual(HOLD_MS - 50);
    expect(await committed).toBe(true);
    expect(raced).toBe(E.CORE_ERROR_USER_NOT_FOUND);
    expect(direct_rows(racing_leaving.user_id)).toEqual(NONE);
  });

  it('leaves no Direct channel row or message row of the withdrawn user when a Withdraw and the first SendChatMessage between two friends come at once', async () => {
    h = await start();
    const pairs: [TestSession, TestSession][] = [];
    for (let i = 0; i < 4; i += 1) {
      const [sender, leaving] = await users(h.server, 2);
      await make_friends(sender, leaving);
      pairs.push([sender, leaving]);
    }
    const results = await Promise.all(
      pairs.map(async ([sender, leaving], i) => {
        if (i % 2 === 0) {
          const [withdrawn, raced] = await Promise.all([withdraw(leaving), first_send(sender, leaving)]);
          return [withdrawn, raced];
        }
        const [raced, withdrawn] = await Promise.all([first_send(sender, leaving), withdraw(leaving)]);
        return [withdrawn, raced];
      }),
    );
    for (const [i, [withdrawn, raced]] of results.entries()) {
      expect(withdrawn).toBe(0);
      expect([0, E.CORE_ERROR_USER_NOT_FOUND]).toContain(raced);
      expect(direct_rows(pairs[i]?.[1].user_id ?? 0n)).toEqual(NONE);
    }
  });

  it('answers USER_NOT_FOUND to a Direct SendChatMessage to a friend whose Withdraw commits after step 1 reads is_active_user and before it reads are_friends (PostgreSQL)', async () => {
    h = await start({ db: 'postgresql' });
    const [sender, leaving] = await users(h.server, 2);
    await make_friends(sender, leaving);
    // Another server instance's Withdraw of the friend: it locks the Direct channel key, removes the friend link rows
    // and marks the user withdrawn. It commits right after the send's first is_active_user of the friend.
    const key = [K.CHAT_CHANNEL_KIND_DIRECT, ...direct_key(sender.user_id, leaving.user_id)];
    const withdrawal = await other_tx(h, [['chat_channel', key]]);
    await withdrawal.run('DELETE FROM friend_link WHERE (user_id = $1 AND other_id = $2) OR (user_id = $2 AND other_id = $1)', [sender.user_id, leaving.user_id]);
    await withdrawal.run('UPDATE "user" SET withdrawn_at = $1 WHERE user_id = $2', [START_AT, leaving.user_id]);
    const profile = h.core()['public-profile'] as unknown as { is_active_user: (ctx: RequestCtx, user_id: bigint) => boolean };
    const is_active_user = profile.is_active_user;
    const first_reads: boolean[] = [];
    const commit: { done: Promise<boolean> | null } = { done: null };
    profile.is_active_user = (ctx, user_id) => {
      const active = is_active_user(ctx, user_id);
      if (user_id === leaving.user_id && commit.done === null) {
        first_reads.push(active);
        commit.done = withdrawal.commit_after(0);
        block_until(() => withdrawn_at(leaving.user_id) !== null, 5_000);
      }
      return active;
    };
    const raced = await first_send(sender, leaving);
    profile.is_active_user = is_active_user;
    expect(first_reads).toEqual([true]);
    expect(await commit.done).toBe(true);
    expect(raced).toBe(E.CORE_ERROR_USER_NOT_FOUND);
    expect(direct_rows(leaving.user_id)).toEqual(NONE);
  });
});
