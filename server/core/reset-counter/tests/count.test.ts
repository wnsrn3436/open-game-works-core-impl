import { read_logs } from '../../testing/dev/index.ts';
import {
  CORE_ERROR_INTERNAL,
  GAME_ERROR_CORE_TEST,
  MAX,
  add,
  count_of,
  counter,
  data_row,
  delta_rows,
  row_of,
  run,
  start_user,
  stop_all,
} from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

describe('add_count and limit', () => {
  it('adds amount and answers OK; over the row limit it answers LIMIT_REACHED and keeps the count', async () => {
    const { server, session } = await start_user();
    const daily = counter('daily');
    expect(data_row(daily).limit).toBe(3n);
    const first = await run(server, session, (ctx, m) => m.reset_counter.add_count(ctx, daily, 2n));
    expect(first.envelope.error).toBeNull();
    expect(first.outcome).toBe('OK');
    expect(delta_rows(first.envelope).map(([id, count]) => [id, count])).toEqual([[BigInt(daily), 2n]]);
    expect(await count_of(server, session, daily)).toBe(2n);
    expect(await add(server, session, daily, 2n)).toBe('LIMIT_REACHED');
    expect(await count_of(server, session, daily)).toBe(2n);
    // count + amount equal to the limit is not over it.
    expect(await add(server, session, daily, 1)).toBe('OK');
    expect(await count_of(server, session, daily)).toBe(3n);
    const over = await run(server, session, (ctx, m) => m.reset_counter.add_count(ctx, daily, 1n));
    expect(over.outcome).toBe('LIMIT_REACHED');
    expect(delta_rows(over.envelope)).toEqual([]);
    expect((await row_of(server, session.user_id, daily))?.count).toBe(3n);
  });

  it('judges with a limit argument over the row limit, up to that limit', async () => {
    const { server, session } = await start_user();
    const daily = counter('daily');
    expect(await add(server, session, daily, 5n, 5n)).toBe('OK');
    expect(await count_of(server, session, daily)).toBe(5n);
    expect(await add(server, session, daily, 1n, 5n)).toBe('LIMIT_REACHED');
    expect(await add(server, session, daily, 1n, 6)).toBe('OK');
    expect(await count_of(server, session, daily)).toBe(6n);
    // Without the limit argument the row limit judges again.
    expect(await add(server, session, daily, 1n)).toBe('LIMIT_REACHED');
    expect(await count_of(server, session, daily)).toBe(6n);
  });

  it('always answers OK on a row without a limit and no limit argument, the count stopping at 2^53-1', async () => {
    const { server, session } = await start_user();
    const unlimited = counter('unlimited');
    expect(data_row(unlimited).limit).toBe(0n);
    for (let i = 0; i < 3; i += 1) expect(await add(server, session, unlimited, 1000n)).toBe('OK');
    expect(await count_of(server, session, unlimited)).toBe(3000n);
    expect(await add(server, session, unlimited, MAX)).toBe('OK');
    expect(await count_of(server, session, unlimited)).toBe(MAX);
    expect(await add(server, session, unlimited, 1n)).toBe('OK');
    expect(await count_of(server, session, unlimited)).toBe(MAX);
    // A limit argument still judges a row without a limit.
    expect(await add(server, session, unlimited, 1n, MAX)).toBe('LIMIT_REACHED');
  });

  it('reads 0 for a counter without a row and for an unknown reset counter ID value', async () => {
    const { server, session } = await start_user();
    expect(await count_of(server, session, counter('weekly'))).toBe(0n);
    expect(await count_of(server, session, 987_654)).toBe(0n);
    expect(await count_of(server, session, 0)).toBe(0n);
    expect(await row_of(server, session.user_id, counter('weekly'))).toBeNull();
  });
});

describe('failures', () => {
  it('keeps the count when the handler ends with a GameError after add_count', async () => {
    const { server, session } = await start_user();
    const daily = counter('daily');
    expect(await add(server, session, daily, 1n)).toBe('OK');
    const failed = await run(server, session, (ctx, m) => {
      expect(m.reset_counter.add_count(ctx, daily, 1n)).toBe('OK');
      expect(m.reset_counter.get_count(ctx, daily)).toBe(2n);
      return GAME_ERROR_CORE_TEST;
    });
    expect(failed.envelope.error?.code).toBe(GAME_ERROR_CORE_TEST);
    expect(await count_of(server, session, daily)).toBe(1n);
    // A first row written by the failed handler is not left either.
    const weekly = counter('weekly');
    const first = await run(server, session, (ctx, m) => {
      m.reset_counter.add_count(ctx, weekly, 1n);
      return GAME_ERROR_CORE_TEST;
    });
    expect(first.envelope.error?.code).toBe(GAME_ERROR_CORE_TEST);
    expect(await row_of(server, session.user_id, weekly)).toBeNull();
  });

  it('is INTERNAL for an unknown reset counter ID value and an amount or limit out of 1 to 2^53-1, changing nothing', async () => {
    const { server, session } = await start_user();
    const daily = counter('daily');
    expect(await add(server, session, daily, 1n)).toBe('OK');
    const before = await row_of(server, session.user_id, daily);
    const cases: [string, bigint | number, (bigint | number)?][] = [
      ['unknown', 1n],
      ['zero id', 1n],
      ['amount', 0n],
      ['amount', 0],
      ['amount', 2n ** 53n],
      ['amount', 2 ** 53],
      ['amount', -1n],
      ['amount', 1.5],
      ['limit', 1n, 0n],
      ['limit', 1n, 2n ** 53n],
    ];
    for (const [what, amount, limit] of cases) {
      const id = what === 'unknown' ? 987_654 : what === 'zero id' ? 0 : daily;
      const result = await run(server, session, (ctx, m) => {
        // A write before the throw is rolled back with the request.
        m.reset_counter.add_count(ctx, daily, 1n);
        return m.reset_counter.add_count(ctx, id, amount, limit);
      });
      expect(result.envelope.error?.code, `${what} ${String(amount)} ${String(limit)}`).toBe(CORE_ERROR_INTERNAL);
      expect(result.outcome).toBeUndefined();
    }
    expect(await row_of(server, session.user_id, daily)).toEqual(before);
    const errors = read_logs(server, 'error').filter((line) => line.request === 'RunCoreTest');
    expect(errors.length).toBe(cases.length);
  });
});
