/** The ranking tables and their SQL on the `storage` of a test server, on SQLite and PostgreSQL. */
import * as GameData from '../../../generated/data/game_data.ts';
import type { DbHandle, GameTx } from '../../storage/index.ts';
import { previous_season, season_at, type Board } from '../board.ts';
import * as store from '../store.ts';
import { start, T0, testing, type Harness } from './support.ts';

let h: Harness;

afterEach(async () => {
  await testing.stop_test_server(h.server);
});

const DESC = { guild: false, desc: true };
const ASC = { guild: false, desc: false };
const GUILD = { guild: true, desc: true };

/** Board ID values that are not in the core test data, so no job and no query touches their rows. */
const B = 900_000;

/** A test server whose job `ranking_season` does not run while the test writes season rows itself. */
async function ranking_db(): Promise<Harness> {
  h = await start({ settings: { 'ranking.seasonCheckIntervalMs': 1_000_000_000_000 } });
  return h;
}

async function game<T>(i: Harness, fn: (db: DbHandle) => T): Promise<T> {
  const storage = i.core().storage;
  const result = await storage.run_game_transaction((tx: GameTx) => ({ value: fn(storage.db(tx)) }));
  if (result === 'FAILED') throw new Error('the game transaction failed');
  return result.value;
}

function row(entity_id: bigint, score: bigint, reached_at: bigint): store.ScoreRow {
  return { entity_id, score, reached_at, display: `d${String(entity_id)}` };
}

/** Score, then the earlier reach time, then the smaller ID. */
const ROWS = [row(5n, 10n, 3n), row(2n, 30n, 9n), row(4n, 10n, 1n), row(1n, 10n, 3n), row(3n, -7n, 0n), row(6n, 30n, 9n)];
const DESC_ORDER = [2n, 6n, 4n, 1n, 5n, 3n];
const ASC_ORDER = [3n, 4n, 1n, 5n, 2n, 6n];

async function put_rows(i: Harness, source: store.ScoreSource, board_id: number, season: bigint): Promise<void> {
  await game(i, (db) => {
    for (const r of ROWS) store.write_score(db, source, board_id, season, r);
  });
}

/** The season 7 score row of an entity that the test put. */
function scored(db: DbHandle, source: store.ScoreSource, board_id: number, entity: bigint): store.ScoreRow {
  const found = store.read_score(db, source, board_id, 7n, entity);
  if (found === null) throw new Error(`no score row of ${String(entity)}`);
  return found;
}

function first_of<T>(list: readonly T[]): T {
  const first = list[0];
  if (first === undefined) throw new Error('the list is empty');
  return first;
}

function walk(db: DbHandle, source: store.ScoreSource, board_id: number, season: bigint, step: number): bigint[] {
  const out: bigint[] = [];
  let cursor: store.ScoreRow | null = null;
  for (;;) {
    const rows = store.read_after(db, source, board_id, season, cursor, step);
    if (rows.length === 0) return out;
    out.push(...rows.map((r) => r.entity_id));
    cursor = rows[rows.length - 1] ?? null;
  }
}

describe('ranking store', () => {
  it('reads pages, ranks and cursor walks in the rank order of Desc, Asc and guild boards', async () => {
    const i = await ranking_db();
    await put_rows(i, DESC, B + 1, 7n);
    await put_rows(i, ASC, B + 2, 7n);
    await put_rows(i, GUILD, B + 3, 7n);
    await game(i, (db) => {
      expect(store.read_page(db, DESC, B + 1, 7n, 0, 10).map((r) => r.entity_id)).toEqual(DESC_ORDER);
      expect(store.read_page(db, ASC, B + 2, 7n, 0, 10).map((r) => r.entity_id)).toEqual(ASC_ORDER);
      expect(store.read_page(db, GUILD, B + 3, 7n, 0, 10).map((r) => r.entity_id)).toEqual(DESC_ORDER);
      expect(store.read_page(db, DESC, B + 1, 7n, 2, 2).map((r) => r.entity_id)).toEqual(DESC_ORDER.slice(2, 4));
      expect(store.read_page(db, DESC, B + 1, 7n, 0, 0)).toEqual([]);
      for (const [rank, entity] of DESC_ORDER.entries()) {
        expect(store.count_ahead(db, DESC, B + 1, 7n, scored(db, DESC, B + 1, entity), 10)).toBe(BigInt(rank));
      }
      for (const [rank, entity] of ASC_ORDER.entries()) expect(store.count_ahead(db, ASC, B + 2, 7n, scored(db, ASC, B + 2, entity), 10)).toBe(BigInt(rank));
      // The count stops at its limit: the last row has five rows ahead.
      expect(store.count_ahead(db, DESC, B + 1, 7n, scored(db, DESC, B + 1, 3n), 2)).toBe(2n);
      expect(store.count_ahead(db, DESC, B + 1, 7n, scored(db, DESC, B + 1, 3n), 5)).toBe(5n);
      expect(walk(db, DESC, B + 1, 7n, 1)).toEqual(DESC_ORDER);
      expect(walk(db, ASC, B + 2, 7n, 4)).toEqual(ASC_ORDER);
      expect(walk(db, GUILD, B + 3, 7n, 2)).toEqual(DESC_ORDER);
      expect(store.read_score(db, DESC, B + 1, 7n, 2n)?.display).toBe('d2');
      expect(store.read_score(db, GUILD, B + 3, 7n, 2n)?.display).toBe('');
      expect(store.read_page(db, DESC, B + 1, 8n, 0, 10)).toEqual([]);
    });
  });

  it('a cursor stays valid when a row ahead of it is deleted', async () => {
    const i = await ranking_db();
    await put_rows(i, DESC, B + 1, 7n);
    const cursor = await game(i, (db) => store.read_score(db, DESC, B + 1, 7n, 6n));
    await game(i, (db) => {
      store.delete_user_rows(db, 2n);
      expect(store.read_after(db, DESC, B + 1, 7n, cursor, 10).map((r) => r.entity_id)).toEqual(DESC_ORDER.slice(2));
    });
  });

  it('writes, displays and deletes score rows by user and by guild', async () => {
    const i = await ranking_db();
    await game(i, (db) => {
      store.write_score(db, DESC, B + 1, 1n, row(9n, 1n, 1n));
      store.write_score(db, DESC, B + 1, 1n, { ...row(9n, 5n, 2n), display: 'x' });
      store.write_score(db, DESC, B + 2, 1n, row(9n, 1n, 1n));
      store.write_display(db, B + 1, 1n, 9n, 'new');
      store.write_score(db, GUILD, B + 3, 1n, row(4n, 1n, 1n));
      store.write_score(db, GUILD, B + 3, 2n, row(4n, 1n, 1n));
      store.insert_retry(db, B + 1, 1n, 9n, new Uint8Array([1]), 10n);
    });
    await game(i, (db) => {
      expect(store.read_score(db, DESC, B + 1, 1n, 9n)).toEqual({ entity_id: 9n, score: 5n, reached_at: 2n, display: 'new' });
      store.delete_user_rows(db, 9n);
      store.delete_guild_rows(db, 4n);
      expect(store.read_score(db, DESC, B + 1, 1n, 9n)).toBeNull();
      expect(store.read_score(db, DESC, B + 2, 1n, 9n)).toBeNull();
      expect(store.read_page(db, GUILD, B + 3, 1n, 0, 10)).toEqual([]);
      expect(store.read_page(db, GUILD, B + 3, 2n, 0, 10)).toEqual([]);
      expect(store.count_retries(db, B + 1, 1n)).toBe(0n);
    });
  });

  it('keeps the season shift, inserts a season row once, and takes a lease only from the owner and time it read', async () => {
    const i = await ranking_db();
    const seen = await game(i, (db) => {
      expect(store.read_shift(db, B + 4)).toBe(0n);
      store.bump_shift(db, B + 4);
      store.bump_shift(db, B + 4);
      expect(store.read_shift(db, B + 4)).toBe(2n);
      store.insert_open_season(db, B + 4, 10n, 100n);
      store.insert_open_season(db, B + 4, 10n, 999n);
      expect(store.read_season_end(db, B + 4, 10n)).toBe(100n);
      expect(store.read_season_end(db, B + 4, 11n)).toBeNull();
      return store.read_due_seasons(db, 100n);
    });
    expect(seen.map((s) => [s.board_id, s.season, s.status, s.cursor, s.cursor_rank, s.failed_count, s.lease_owner, s.lease_until_at])).toEqual([[B + 4, 10n, 'Open', null, 0, 0n, '', 0n]]);
    expect(await game(i, (db) => store.read_due_seasons(db, 99n))).toEqual([]);
    const taken = await game(i, (db) => store.take_lease(db, first_of(seen), 'a', 500n));
    expect([taken?.status, taken?.lease_owner, taken?.lease_until_at]).toEqual(['Closing', 'a', 500n]);
    expect(await game(i, (db) => store.take_lease(db, first_of(seen), 'b', 500n))).toBeNull();
    await game(i, (db) => {
      expect(store.read_due_seasons(db, 499n)).toEqual([]);
      expect(store.read_due_seasons(db, 500n).map((s) => s.lease_owner)).toEqual(['a']);
      expect(store.extend_lease(db, B + 4, 10n, 'b', 900n)).toBe(false);
      expect(store.extend_lease(db, B + 4, 10n, 'a', 900n)).toBe(true);
      expect(store.advance_cursor(db, B + 4, 10n, 'b', row(3n, 7n, 8n), 1, 1, 950n)).toBe(false);
      expect(store.advance_cursor(db, B + 4, 10n, 'a', row(3n, 7n, 8n), 1, 1, 950n)).toBe(true);
      const now = store.read_season(db, B + 4, 10n);
      expect([now?.cursor, now?.cursor_rank, now?.failed_count, now?.lease_until_at]).toEqual([{ entity_id: 3n, score: 7n, reached_at: 8n, display: '' }, 1, 1n, 950n]);
    });
  });

  it('an owner whose lease another instance took writes nothing to the season row', async () => {
    const i = await ranking_db();
    const seen = await game(i, (db) => {
      store.close_season_row(db, B + 7, 1n, 40n, 'old', 50n);
      store.advance_cursor(db, B + 7, 1n, 'old', row(3n, 7n, 8n), 1, 0, 50n);
      return store.read_season(db, B + 7, 1n);
    });
    if (seen === null) throw new Error('no season row');
    expect((await game(i, (db) => store.take_lease(db, seen, 'new', 600n)))?.lease_owner).toBe('new');
    const kept = await game(i, (db) => {
      store.advance_cursor(db, B + 7, 1n, 'new', row(2n, 5n, 9n), 2, 0, 700n);
      return store.read_season(db, B + 7, 1n);
    });
    await game(i, (db) => {
      expect(store.extend_lease(db, B + 7, 1n, 'old', 900n)).toBe(false);
      expect(store.advance_cursor(db, B + 7, 1n, 'old', row(4n, 6n, 9n), 2, 1, 900n)).toBe(false);
      store.add_failed(db, B + 7, 1n, 'old', 1);
      expect(store.finish_pass(db, B + 7, 1n, 'old')).toBeNull();
      expect(store.close_season(db, B + 7, 1n, 'old')).toBeNull();
      expect(store.read_season(db, B + 7, 1n)).toEqual(kept);
    });
    expect([kept?.status, kept?.cursor_rank, kept?.failed_count, kept?.lease_owner, kept?.lease_until_at]).toEqual(['Closing', 2, 0n, 'new', 700n]);
  });

  it('ends a pass as Retrying with lease_until_at 0 while retry rows are there, and Closed without them; Closed seasons past retention go', async () => {
    const i = await ranking_db();
    await game(i, (db) => {
      store.close_season_row(db, B + 5, 1n, 40n, 'me', 80n);
      store.insert_retry(db, B + 5, 1n, 7n, new Uint8Array([9]), 60n);
      store.insert_retry(db, B + 5, 1n, 7n, new Uint8Array([1]), 99n);
      store.insert_retry(db, B + 5, 1n, 3n, new Uint8Array([2]), 50n);
    });
    await game(i, (db) => {
      expect(store.finish_pass(db, B + 5, 1n, 'other')).toBeNull();
      const retrying = store.finish_pass(db, B + 5, 1n, 'me');
      expect([retrying?.status, retrying?.lease_until_at]).toEqual(['Retrying', 0n]);
      expect(store.read_due_retries(db, B + 5, 1n, 55n).map((r) => r.user_id)).toEqual([3n]);
      expect(store.read_due_retries(db, B + 5, 1n, 60n).map((r) => [r.user_id, r.attempts, [...r.entry]])).toEqual([
        [3n, 0, [2]],
        [7n, 0, [9]],
      ]);
      store.update_retry(db, B + 5, 1n, 7n, 2, 70n);
      expect(store.read_due_retries(db, B + 5, 1n, 69n).map((r) => r.user_id)).toEqual([3n]);
      store.delete_retry(db, B + 5, 1n, 3n);
      store.delete_retry(db, B + 5, 1n, 7n);
      store.add_failed(db, B + 5, 1n, 'me', 2);
      const closed = store.finish_pass(db, B + 5, 1n, 'me');
      expect([closed?.status, closed?.failed_count]).toEqual(['Closed', 2n]);
      store.write_score(db, DESC, B + 5, 1n, row(1n, 1n, 1n));
      expect(store.read_expired_seasons(db, 39n)).toEqual([]);
      expect(store.read_expired_seasons(db, 40n)).toEqual([{ board_id: B + 5, season: 1n }]);
      store.delete_season(db, B + 5, 1n);
      expect(store.read_season(db, B + 5, 1n)).toBeNull();
      expect(store.read_page(db, DESC, B + 5, 1n, 0, 10)).toEqual([]);
    });
  });

  it('season numbers of a cycle board follow get_period_number plus the shift, and the previous season ends at its row end or the period start', async () => {
    const i = await ranking_db();
    const core = i.core().ranking.dev_core;
    const time = i.core()['server-time'];
    const board: Board = { id: B + 6, guild: false, desc: true, update_mode: GameData.RankingUpdateMode.Best, cycle: GameData.ResetCycle.Daily, live_event: 0, size: 10, reward_mail: 0 };
    await game(i, (db) => {
      const s = season_at(core, board, db, T0);
      expect(s).toEqual({ season: time.get_period_number(GameData.ResetCycle.Daily, T0), ends_at: time.get_next_reset(GameData.ResetCycle.Daily, T0) });
      expect(previous_season(core, board, db, T0)).toEqual({ season: s.season - 1n, ends_at: time.get_period_start(GameData.ResetCycle.Daily, T0) });
      store.close_season_row(db, B + 6, s.season, T0, 'x', 0n);
      store.bump_shift(db, B + 6);
      expect(season_at(core, board, db, T0)).toEqual({ season: s.season + 1n, ends_at: s.ends_at });
      expect(previous_season(core, board, db, T0)).toEqual({ season: s.season, ends_at: T0 });
      const endless = { ...board, cycle: null };
      expect(season_at(core, endless, db, T0)).toEqual({ season: 0n, ends_at: 0n });
      expect(previous_season(core, endless, db, T0)).toBeNull();
    });
  });
});
