import { rmSync } from 'node:fs';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { advance_time, hold_lock_key, start_peer_process, stop_peer_processes, stop_test_server, until_blocked_by } from '../../testing/dev/index.ts';
import { lock_key } from '../../storage/tx.ts';
import { normalizeText } from '../../validation/text.ts';
import { CoreError, GameError, cost_data_folder, gems, id_value, in_user_transaction, nickname_state, set_gems, set_nickname, start, users, withdraw, COST_ITEM } from './helpers.ts';
import { cost_gate } from './peer.ts';

const PEER = { module: new URL('./peer.ts', import.meta.url), name: 'nickname_peer' };

const COOLDOWN = { 'nickname.changeCooldownMs': 1000 };

describe('duplicate', () => {
  it('with nicknameUnique true a nickname another user has after normalization is NICKNAME_TAKEN', async () => {
    const h = await start(true);
    try {
      const [a, b] = await users(h.server, ['a', 'b']);
      expect((await set_nickname(a, 'Mango')).code).toBe(0);
      expect((await set_nickname(b, 'ｍａｎ ｇｏ')).code).toBe(CoreError.CORE_ERROR_NICKNAME_TAKEN);
      expect((await set_nickname(b, 'MANGO')).code).toBe(CoreError.CORE_ERROR_NICKNAME_TAKEN);
      expect(await nickname_state(h.server, b.user_id)).toBeNull();
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('with nicknameUnique false a nickname another user has after normalization passes', async () => {
    const h = await start(false);
    try {
      const [a, b] = await users(h.server, ['a', 'b']);
      expect((await set_nickname(a, 'Mango')).code).toBe(0);
      expect(await set_nickname(b, 'MANGO')).toMatchObject({ code: 0, nickname: 'MANGO' });
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('with nicknameUnique true only one of two users registering the same nickname at once succeeds', async () => {
    const h = await start(true);
    try {
      for (let round = 0; round < 5; round += 1) {
        const [a, b] = await users(h.server, [`a${String(round)}`, `b${String(round)}`]);
        const results = await Promise.all([set_nickname(a, `Same${String(round)}`), set_nickname(b, `same${String(round)}`)]);
        expect(results.map((r) => r.code).sort((x, y) => x - y)).toEqual([0, CoreError.CORE_ERROR_NICKNAME_TAKEN]);
      }
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('with nicknameUnique true, of two registrations of one normalized nickname on two server instances that both passed rule 3 before either registered and then wait for the nickname_claim lock together, one succeeds and the other is NICKNAME_TAKEN and pays nothing (PostgreSQL)', async () => {
    const folder = cost_data_folder(0, 10n);
    const h = await start(true, { 'storage.userLockWaitMs': 20_000 }, folder, 'postgresql');
    try {
      const one = await start_peer_process(h.server, PEER);
      const two = await start_peer_process(h.server, PEER);
      const [a] = await users(one.remote, ['a']);
      const [b] = await users(two.remote, ['b']);
      for (const s of [a, b]) await set_gems(h.server, s.user_id, 10n);
      const claim = await hold_lock_key(h.server, lock_key('nickname_claim', [normalizeText('Same')]));
      const sent = [set_nickname(a, 'Same'), set_nickname(b, 'SAME')];
      // Each request waits at its cost (step 4): it passed rule 3 while neither user had a nickname_name row.
      await one.reached(cost_gate(a.user_id));
      await two.reached(cost_gate(b.user_id));
      one.open(cost_gate(a.user_id));
      two.open(cost_gate(b.user_id));
      // Both name registrations (step 5) wait for the claim lock the test holds, then go one after the other.
      await until_blocked_by(h.server, claim.pid, 2);
      await claim.release();
      const codes = (await Promise.all(sent)).map((r) => r.code);
      expect([...codes].sort((x, y) => x - y)).toEqual([0, CoreError.CORE_ERROR_NICKNAME_TAKEN]);
      const [winner, loser] = codes[0] === 0 ? [a, b] : [b, a];
      expect(await nickname_state(h.server, winner.user_id)).toMatchObject({ change_count: 0, forced: false });
      expect(await nickname_state(h.server, loser.user_id)).toBeNull();
      expect(await gems(h.server, winner.user_id)).toBe(0n);
      expect(await gems(h.server, loser.user_id)).toBe(10n);
      expect(h.core().storage.read_db().query('SELECT user_id FROM nickname_name WHERE normalized = $1', [normalizeText('Same')])).toEqual([{ user_id: winner.user_id }]);
    } finally {
      await stop_peer_processes();
      await stop_test_server(h.server);
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('with nicknameUnique false, two registrations of one normalized nickname on two server instances that both passed rule 3 before either registered both succeed (PostgreSQL)', async () => {
    const folder = cost_data_folder(0, 10n);
    const h = await start(false, {}, folder, 'postgresql');
    try {
      const one = await start_peer_process(h.server, PEER);
      const two = await start_peer_process(h.server, PEER);
      const [a] = await users(one.remote, ['a']);
      const [b] = await users(two.remote, ['b']);
      for (const s of [a, b]) await set_gems(h.server, s.user_id, 10n);
      const sent = [set_nickname(a, 'Same'), set_nickname(b, 'SAME')];
      await one.reached(cost_gate(a.user_id));
      await two.reached(cost_gate(b.user_id));
      one.open(cost_gate(a.user_id));
      two.open(cost_gate(b.user_id));
      expect((await Promise.all(sent)).map((r) => r.code)).toEqual([0, 0]);
      expect(h.core().storage.read_db().query('SELECT user_id FROM nickname_name WHERE normalized = $1 ORDER BY user_id', [normalizeText('Same')])).toEqual([{ user_id: a.user_id }, { user_id: b.user_id }]);
    } finally {
      await stop_peer_processes();
      await stop_test_server(h.server);
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('with nicknameUnique false both users registering the same nickname at once succeed', async () => {
    const h = await start(false);
    try {
      const [a, b] = await users(h.server, ['a', 'b']);
      const results = await Promise.all([set_nickname(a, 'Same'), set_nickname(b, 'same')]);
      expect(results.map((r) => r.code)).toEqual([0, 0]);
    } finally {
      await stop_test_server(h.server);
    }
  });
});

describe('cooldown and cost', () => {
  it('the first registration has no cooldown and is free without a change_number 0 row; a change in the cooldown is NICKNAME_COOLDOWN', async () => {
    const h = await start(false, COOLDOWN);
    try {
      const [a] = await users(h.server, ['a']);
      const first = await set_nickname(a, 'First');
      expect(first.code).toBe(0);
      expect(first.envelope.item_changes).toEqual([]);
      expect(await gems(h.server, a.user_id)).toBe(0n);
      const state = await nickname_state(h.server, a.user_id);
      expect(state).toMatchObject({ nickname: 'First', change_count: 0, forced: false });

      await set_gems(h.server, a.user_id, 100n);
      advance_time(h.server, 999n);
      expect((await set_nickname(a, 'Second')).code).toBe(CoreError.CORE_ERROR_NICKNAME_COOLDOWN);
      expect(await nickname_state(h.server, a.user_id)).toMatchObject({ nickname: 'First' });
      advance_time(h.server, 1n);
      expect((await set_nickname(a, 'Second')).code).toBe(0);
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('the n-th change takes the cost of the matching nickname_cost row with source Nickname; a short balance is ITEM_NOT_ENOUGH and keeps the nickname', async () => {
    const h = await start(false, COOLDOWN);
    try {
      const [a] = await users(h.server, ['a']);
      const gem = id_value(COST_ITEM);
      expect((await set_nickname(a, 'Name0')).code).toBe(0);
      await set_gems(h.server, a.user_id, 100n);
      // change n uses the row with the largest change_number <= n: 1 -> 10, 2 -> 10, 3 -> 30, 4 -> 30
      const expected: [number, bigint, bigint][] = [[1, 10n, 90n], [2, 10n, 80n], [3, 30n, 50n], [4, 30n, 20n]];
      for (const [n, cost, balance] of expected) {
        advance_time(h.server, 1000n);
        const result = await set_nickname(a, `Name${String(n)}`);
        expect(result.code).toBe(0);
        const nickname_changes = result.envelope.item_changes.filter((c) => c.source === CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_NICKNAME);
        expect(nickname_changes.map((c) => ({ item_id: c.item_id, delta: c.delta, source: c.source, ref: c.ref }))).toEqual([
          { item_id: gem, delta: -cost, source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_NICKNAME, ref: String(n) },
        ]);
        expect(await gems(h.server, a.user_id)).toBe(balance);
        expect(await nickname_state(h.server, a.user_id)).toMatchObject({ nickname: `Name${String(n)}`, change_count: n });
      }
      advance_time(h.server, 1000n);
      expect((await set_nickname(a, 'Name5')).code).toBe(CoreError.CORE_ERROR_ITEM_NOT_ENOUGH);
      expect(await nickname_state(h.server, a.user_id)).toMatchObject({ nickname: 'Name4', change_count: 4 });
      expect(await gems(h.server, a.user_id)).toBe(20n);
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('with a change_number 0 row the first registration takes its cost with source Nickname and ref "0"; a short balance is ITEM_NOT_ENOUGH and writes no NicknameUserState', async () => {
    const data = cost_data_folder(0, 5n);
    const h = await start(false, COOLDOWN, data);
    try {
      const [a] = await users(h.server, ['a']);
      await set_gems(h.server, a.user_id, 4n);
      expect((await set_nickname(a, 'First')).code).toBe(CoreError.CORE_ERROR_ITEM_NOT_ENOUGH);
      expect(await nickname_state(h.server, a.user_id)).toBeNull();
      expect(await gems(h.server, a.user_id)).toBe(4n);

      await set_gems(h.server, a.user_id, 5n);
      const first = await set_nickname(a, 'First');
      expect(first.code).toBe(0);
      const nickname_changes = first.envelope.item_changes.filter((c) => c.source === CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_NICKNAME);
      expect(nickname_changes.map((c) => ({ item_id: c.item_id, delta: c.delta, ref: c.ref }))).toEqual([{ item_id: id_value(COST_ITEM), delta: -5n, ref: '0' }]);
      expect(await gems(h.server, a.user_id)).toBe(0n);
      expect(await nickname_state(h.server, a.user_id)).toMatchObject({ nickname: 'First', change_count: 0, forced: false });
    } finally {
      await stop_test_server(h.server);
      rmSync(data, { recursive: true, force: true });
    }
  });

  it('a validate_item_change GameError listed for SetNickname in (ogw.core_errors) fails SetNickname with it and keeps the nickname and the balance', async () => {
    const h = await start(false, COOLDOWN);
    try {
      const [a] = await users(h.server, ['a']);
      expect((await set_nickname(a, 'Before')).code).toBe(0);
      await set_gems(h.server, a.user_id, 100n);
      advance_time(h.server, 1000n);
      h.content.reject_nickname_cost = GameError.GAME_ERROR_CORE_TEST;
      const result = await set_nickname(a, 'After');
      expect(result.code).toBe(GameError.GAME_ERROR_CORE_TEST);
      expect(await nickname_state(h.server, a.user_id)).toMatchObject({ nickname: 'Before', change_count: 0 });
      expect(await gems(h.server, a.user_id)).toBe(100n);
      h.content.reject_nickname_cost = 0;
      expect((await set_nickname(a, 'After')).code).toBe(0);
    } finally {
      await stop_test_server(h.server);
    }
  });
});

describe('name registration', () => {
  it('another user can register the previous nickname after a change', async () => {
    const h = await start(true, COOLDOWN);
    try {
      const [a, b] = await users(h.server, ['a', 'b']);
      expect((await set_nickname(a, 'Alpha')).code).toBe(0);
      expect((await set_nickname(b, 'alpha')).code).toBe(CoreError.CORE_ERROR_NICKNAME_TAKEN);
      await set_gems(h.server, a.user_id, 100n);
      advance_time(h.server, 1000n);
      expect((await set_nickname(a, 'Beta')).code).toBe(0);
      expect((await set_nickname(b, 'alpha')).code).toBe(0);
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('after a case-only change the user has one nickname_name row, get_nicknames gives the new nickname, and with nicknameUnique true another user is NICKNAME_TAKEN', async () => {
    const h = await start(true, COOLDOWN);
    try {
      const [a, b] = await users(h.server, ['a', 'b']);
      expect((await set_nickname(a, 'Alpha')).code).toBe(0);
      await set_gems(h.server, a.user_id, 100n);
      advance_time(h.server, 1000n);
      expect((await set_nickname(a, 'ALPHA')).code).toBe(0);
      const rows = h.core()['storage'].read_db().query('SELECT user_id, normalized, nickname FROM nickname_name WHERE user_id = $1', [a.user_id]);
      expect(rows).toEqual([{ user_id: a.user_id, normalized: 'alpha', nickname: 'ALPHA' }]);
      const names = await in_user_transaction(h.core(), b.user_id, (ctx) => h.nickname().get_nicknames(ctx, [a.user_id]));
      expect(names).toEqual([{ user_id: a.user_id, nickname: 'ALPHA' }]);
      expect((await set_nickname(b, 'Alpha')).code).toBe(CoreError.CORE_ERROR_NICKNAME_TAKEN);
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('another user can register the nickname of a withdrawn user', async () => {
    const h = await start(true);
    try {
      const [a, b] = await users(h.server, ['a', 'b']);
      expect((await set_nickname(a, 'Gamma')).code).toBe(0);
      expect((await set_nickname(b, 'gamma')).code).toBe(CoreError.CORE_ERROR_NICKNAME_TAKEN);
      expect(await withdraw(a)).toBe(0);
      expect((await set_nickname(b, 'gamma')).code).toBe(0);
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('the same string as the current nickname succeeds without a change, in the cooldown and without cost', async () => {
    const h = await start(true, COOLDOWN);
    try {
      const [a] = await users(h.server, ['a']);
      expect((await set_nickname(a, 'Stay')).code).toBe(0);
      const before = await nickname_state(h.server, a.user_id);
      const again = await set_nickname(a, 'Stay');
      expect(again).toMatchObject({ code: 0, nickname: 'Stay' });
      expect(again.envelope.item_changes).toEqual([]);
      expect(await nickname_state(h.server, a.user_id)).toEqual(before);
    } finally {
      await stop_test_server(h.server);
    }
  });
});
