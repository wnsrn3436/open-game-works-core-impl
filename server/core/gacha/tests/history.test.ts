import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { advance_time, send, send_admin, wait_background } from '../../testing/dev/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import { RECORD_TABLE } from '../records.ts';
import { INVALID_REQUEST, MULTI, START_AT, draw, error_code, history, id, login, set_balance, start, stop_all, type TestSession } from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

/** Every page of `ListGachaHistory` with `max_rows` rows per page, followed by its last `draw_seq`. */
async function all_pages(session: TestSession, banner: string | 0, max_rows: number): Promise<bigint[][]> {
  const pages: bigint[][] = [];
  let cursor = 0n;
  for (;;) {
    const page = await history(session, banner, cursor, max_rows);
    expect(page.code).toBe(0);
    if (page.entries.length === 0) return pages;
    pages.push(page.entries.map((e) => e.draw_seq));
    cursor = page.entries[page.entries.length - 1]?.draw_seq ?? 0n;
  }
}

describe('ListGachaHistory', () => {
  it('cursor 0 gives the own rows from the largest draw_seq down; the next page after a cut in a MULTI goes on from the rest; rows of the same request time come once each', async () => {
    const { server } = await start();
    const a = await login(server, 'history_a');
    const b = await login(server, 'history_b');
    for (const s of [a, b]) await set_balance(server, s.user_id, '[gacha_gem]', 1000n);
    // the test clock does not move: every draw below has the same request time
    expect(error_code(await draw(a, '[gacha_banner_main]', MULTI))).toBe(0);
    expect(error_code(await draw(a, '[gacha_banner_main]'))).toBe(0);
    expect(error_code(await draw(b, '[gacha_banner_main]'))).toBe(0);
    const first = await history(a, 0, 0n, 100);
    expect(first.entries.map((e) => e.draw_seq)).toEqual([11n, 10n, 9n, 8n, 7n, 6n, 5n, 4n, 3n, 2n, 1n]);
    expect(first.entries.map((e) => e.draw_index)).toEqual([1, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(first.entries.every((e) => e.drawn_at === START_AT && e.banner_id === id('[gacha_banner_main]'))).toBe(true);
    expect((await history(b, 0, 0n, 100)).entries.map((e) => e.draw_seq)).toEqual([1n]);
    expect(await all_pages(a, '[gacha_banner_main]', 4)).toEqual([
      [11n, 10n, 9n, 8n],
      [7n, 6n, 5n, 4n],
      [3n, 2n, 1n],
    ]);
  });

  it('rows past the retention period are gone', async () => {
    const retention = 60_000;
    const sweep_interval = 1_000;
    const { server } = await start({ settings: { 'gacha.historyRetentionMs': retention, 'routing.storageSweepIntervalMs': sweep_interval } });
    const session = await login(server, 'retention');
    // the stored rows, read past ListGachaHistory, whose query already leaves out expired rows
    const stored = (): bigint[] =>
      storage_module(server).read_db()
        .query(`SELECT draw_seq FROM ${RECORD_TABLE} WHERE user_id = $1 ORDER BY draw_seq`, [session.user_id])
        .map((row) => BigInt(row.draw_seq as bigint | number));
    await set_balance(server, session.user_id, '[gacha_gem]', 100n);
    expect(error_code(await draw(session, '[gacha_banner_main]'))).toBe(0);
    advance_time(server, BigInt(retention) - 1n);
    await wait_background(server);
    expect((await history(session, 0, 0n, 10)).entries).toHaveLength(1);
    expect(stored()).toEqual([1n]);
    expect(error_code(await draw(session, '[gacha_banner_main]'))).toBe(0);
    advance_time(server, 1n);
    await wait_background(server);
    expect((await history(session, 0, 0n, 10)).entries.map((e) => e.draw_seq)).toEqual([2n]);
    // the job storage_sweep last ran one ms ago; the next run after its interval deletes the expired row
    advance_time(server, BigInt(sweep_interval));
    await wait_background(server);
    expect(stored()).toEqual([2n]);
    advance_time(server, BigInt(retention));
    await wait_background(server);
    expect((await history(session, 0, 0n, 10)).entries).toEqual([]);
    expect(stored()).toEqual([]);
  });

  it('banner 0 gives the own rows of every banner; a banner ID value not in gacha_banner is INVALID_REQUEST', async () => {
    const { server } = await start();
    const session = await login(server, 'banners');
    await set_balance(server, session.user_id, '[gacha_gem]', 100n);
    expect(error_code(await draw(session, '[gacha_banner_main]'))).toBe(0);
    expect(error_code(await draw(session, '[gacha_banner_plain]'))).toBe(0);
    const all = await history(session, 0, 0n, 10);
    expect(all.entries.map((e) => [e.draw_seq, e.banner_id])).toEqual([
      [2n, id('[gacha_banner_plain]')],
      [1n, id('[gacha_banner_main]')],
    ]);
    expect((await history(session, '[gacha_banner_plain]', 0n, 10)).entries.map((e) => e.draw_seq)).toEqual([2n]);
    const request = new CoreContract.ListGachaHistoryRequest();
    request.banner_id = 2_147_483_647;
    request.max_rows = 10;
    expect(error_code(await send(session, 'core/ListGachaHistory', request))).toBe(INVALID_REQUEST);
  });

  it('max_rows outside 1 to gacha.maxHistoryRows is INVALID_REQUEST', async () => {
    const { server } = await start({ settings: { 'gacha.maxHistoryRows': 5 } });
    const session = await login(server, 'rows');
    expect((await history(session, 0, 0n, 0)).code).toBe(INVALID_REQUEST);
    expect((await history(session, 0, 0n, 6)).code).toBe(INVALID_REQUEST);
    expect((await history(session, 0, 0n, 5)).code).toBe(0);
  });
});

interface AdminEntry {
  user_id: string;
  draw_seq: string;
  drawn_at: string;
  request_id: string;
  banner_id: number;
  draw_index: number;
  kind: string;
  rate_up: boolean;
  items: { item_id?: number; amount?: string; big_amount?: string }[];
  pity_count_before: number;
  cost: { item_id?: number; amount?: string; big_amount?: string }[];
  data_version: string;
  expires_at: string;
}

describe('list_gacha_history', () => {
  const range = { from_at: String(START_AT), to_at: String(START_AT + 1n) };

  it('follows the admin-api processing order: every column of the rows in range by draw_seq ascending; a withdrawn user is not_found', async () => {
    const { server } = await start();
    const session = await login(server, 'admin');
    await set_balance(server, session.user_id, '[gacha_gem]', 1000n);
    expect(error_code(await draw(session, '[gacha_banner_main]', MULTI))).toBe(0);
    const listed = await send_admin(server, 'list_gacha_history', { user_id: String(session.user_id), ...range, after_seq: '0', limit: 3 });
    expect(listed.status).toBe(200);
    const entries = (listed.json as { entries: AdminEntry[] }).entries;
    expect(entries.map((e) => e.draw_seq)).toEqual(['1', '2', '3']);
    expect(entries[0]).toMatchObject({
      user_id: String(session.user_id),
      drawn_at: String(START_AT),
      banner_id: id('[gacha_banner_main]'),
      draw_index: 1,
      kind: 'GACHA_DRAW_KIND_NORMAL',
      pity_count_before: 0,
      cost: [{ item_id: id('[gacha_gem]'), amount: '100' }],
    });
    // items and cost are the proto3 JSON arrays of the stored text
    expect(entries.every((e) => Array.isArray(e.items) && e.items.length > 0)).toBe(true);
    expect(entries[1]?.cost).toEqual([]);
    expect(entries[2]).toMatchObject({ kind: 'GACHA_DRAW_KIND_PITY', pity_count_before: 2 });
    expect(Object.keys(entries[0] ?? {}).sort()).toEqual(
      ['banner_id', 'cost', 'data_version', 'draw_index', 'draw_seq', 'drawn_at', 'expires_at', 'items', 'kind', 'pity_count_before', 'rate_up', 'request_id', 'user_id'],
    );
    const out_of_range = await send_admin(server, 'list_gacha_history', { user_id: String(session.user_id), from_at: String(START_AT + 1n), to_at: String(START_AT + 2n), after_seq: '0', limit: 3 });
    expect((out_of_range.json as { entries: AdminEntry[] }).entries).toEqual([]);
    expect((await send_admin(server, 'list_gacha_history', { user_id: String(session.user_id), ...range, limit: 3 })).status).toBe(400);
    expect((await send_admin(server, 'list_gacha_history', { user_id: String(session.user_id), ...range, after_seq: '0', limit: 3 }, 'read')).status).toBe(200);

    expect(error_code(await send(session, 'core/Withdraw', new CoreContract.WithdrawRequest()))).toBe(0);
    const withdrawn = await send_admin(server, 'list_gacha_history', { user_id: String(session.user_id), ...range, after_seq: '0', limit: 3 });
    expect(withdrawn.status).toBe(404);
    expect(withdrawn.json).toEqual({ error: 'not_found' });
  });

  it('when the MULTI rows of the same drawn_at are cut by limit, after_seq of the last row gives the rest once each', async () => {
    const { server } = await start();
    const session = await login(server, 'admin_pages');
    await set_balance(server, session.user_id, '[gacha_gem]', 1000n);
    expect(error_code(await draw(session, '[gacha_banner_main]', MULTI))).toBe(0);
    const seen: string[] = [];
    let after = '0';
    for (;;) {
      const page = await send_admin(server, 'list_gacha_history', { user_id: String(session.user_id), ...range, after_seq: after, limit: 4 });
      expect(page.status).toBe(200);
      const entries = (page.json as { entries: AdminEntry[] }).entries;
      if (entries.length === 0) break;
      seen.push(...entries.map((e) => e.draw_seq));
      after = entries[entries.length - 1]?.draw_seq ?? after;
    }
    expect(seen).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  });
});
