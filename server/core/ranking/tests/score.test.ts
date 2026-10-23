import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { as_user, BOARD, scores, start, submit, testing, top, users, type Harness, T0 } from './support.ts';

const MAX = 2n ** 53n - 1n;
let h: Harness;

afterEach(async () => {
  await testing.stop_test_server(h.server);
});

async function my(h: Harness, user_id: bigint, board_id: number): Promise<CoreContract.RankingEntry> {
  return as_user(h, user_id, (ctx, ranking) => ranking.get_my_entry(ctx, board_id));
}

describe('ranking score', () => {
  it('Best keeps only a better score, Sum adds, Set takes a worse score, and Asc and Desc order better scores', async () => {
    h = await start();
    const [a] = await users(h, 1);
    const me = a.user_id;
    expect(await submit(h, me, BOARD.daily(), 50n)).toBe('OK');
    expect(await submit(h, me, BOARD.daily(), 30n)).toBe('OK');
    expect((await my(h, me, BOARD.daily())).score).toBe(50n);
    expect(await submit(h, me, BOARD.daily(), 70n)).toBe('OK');
    expect((await my(h, me, BOARD.daily())).score).toBe(70n);

    await submit(h, me, BOARD.daily_asc(), 50n);
    await submit(h, me, BOARD.daily_asc(), 70n);
    expect((await my(h, me, BOARD.daily_asc())).score).toBe(50n);
    await submit(h, me, BOARD.daily_asc(), 20n);
    expect((await my(h, me, BOARD.daily_asc())).score).toBe(20n);

    await submit(h, me, BOARD.sum(), 5n);
    await submit(h, me, BOARD.sum(), 7n);
    expect((await my(h, me, BOARD.sum())).score).toBe(12n);

    await submit(h, me, BOARD.set(), 100n);
    await submit(h, me, BOARD.set(), 3n);
    expect((await my(h, me, BOARD.set())).score).toBe(3n);
  });

  it('puts the user who reached the same score first ahead', async () => {
    h = await start();
    const [a, b, c] = await users(h, 3);
    await submit(h, b.user_id, BOARD.sum(), 10n);
    testing.advance_time(h.server, 1000n);
    await submit(h, a.user_id, BOARD.sum(), 10n);
    testing.advance_time(h.server, 1000n);
    await submit(h, c.user_id, BOARD.sum(), 20n);
    const res = await top(a, BOARD.sum(), 0, 10);
    expect(scores(res.entries)).toEqual([
      [c.user_id, 20n],
      [b.user_id, 10n],
      [a.user_id, 10n],
    ]);
    expect(res.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it('keeps every score submitted to one board at the same time', async () => {
    h = await start();
    const sessions = await users(h, 8);
    const results = await Promise.all(sessions.map((s, i) => submit(h, s.user_id, BOARD.sum(), BigInt(i + 1))));
    expect(results.every((r) => r === 'OK')).toBe(true);
    const res = await top(sessions[0], BOARD.sum(), 0, 100);
    expect(res.entries.length).toBe(8);
    expect(res.entries.map((e) => e.score)).toEqual([8n, 7n, 6n, 5n, 4n, 3n, 2n, 1n]);
  });

  it('gives rank 0 to a user past size', async () => {
    h = await start();
    const sessions = await users(h, 7);
    for (const [i, s] of sessions.entries()) await submit(h, s.user_id, BOARD.daily(), BigInt(100 - i));
    expect((await my(h, sessions[4].user_id, BOARD.daily())).rank).toBe(5);
    const last = await my(h, sessions[6].user_id, BOARD.daily());
    expect(last.rank).toBe(0);
    expect(last.score).toBe(94n);
  });

  it('answers OK to an empty display, and INVALID_DISPLAY to a long display or a control character', async () => {
    h = await start({ settings: { 'ranking.maxDisplayBytes': 6 } });
    const [a] = await users(h, 1);
    const me = a.user_id;
    expect(await submit(h, me, BOARD.sum(), 1n, '')).toBe('OK');
    expect(await submit(h, me, BOARD.sum(), 1n, 'abcdefg')).toBe('INVALID_DISPLAY');
    expect(await submit(h, me, BOARD.sum(), 1n, 'a\nb')).toBe('INVALID_DISPLAY');
    expect(await as_user(h, me, (ctx, ranking) => ranking.update_display(ctx, 'abcdefg'))).toBe('INVALID_DISPLAY');
    expect((await my(h, me, BOARD.sum())).score).toBe(1n);
    expect(await as_user(h, me, (ctx, ranking) => ranking.update_display(ctx, 'title'))).toBe('OK');
    expect((await my(h, me, BOARD.sum())).display).toBe('title');
  });

  it('answers OUT_OF_RANGE to a score or a Sum total out of the range and keeps the score', async () => {
    h = await start();
    const [a] = await users(h, 1);
    const me = a.user_id;
    expect(await submit(h, me, BOARD.daily(), MAX + 1n)).toBe('OUT_OF_RANGE');
    expect(await submit(h, me, BOARD.daily(), -MAX - 1n)).toBe('OUT_OF_RANGE');
    expect((await my(h, me, BOARD.daily())).score).toBe(0n);
    expect(await submit(h, me, BOARD.sum(), MAX)).toBe('OK');
    expect(await submit(h, me, BOARD.sum(), 1n)).toBe('OUT_OF_RANGE');
    expect((await my(h, me, BOARD.sum())).score).toBe(MAX);
    expect(testing.read_logs(h.server, 'error').some((l) => String(l.message).includes('out of range'))).toBe(true);
  });

  it('answers UNKNOWN_BOARD to a board ID value not in ranking_board, with an error log', async () => {
    h = await start({ start_at: T0 });
    const [a] = await users(h, 1);
    expect(await submit(h, a.user_id, 999_999, 1n)).toBe('UNKNOWN_BOARD');
    expect(testing.read_logs(h.server, 'error').some((l) => String(l.message).includes('unknown board'))).toBe(true);
  });
});
