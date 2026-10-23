import * as GameData from '../../../generated/data/game_data.ts';
import { DAY_MS, START_AT, add, count_of, counter, next_reset, row_of, start_user, stop_all, travel } from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

const CYCLES = [
  { name: 'daily', cycle: GameData.ResetCycle.Daily },
  { name: 'weekly', cycle: GameData.ResetCycle.Weekly },
  { name: 'monthly', cycle: GameData.ResetCycle.Monthly },
] as const;

describe('lazy reset', () => {
  for (const { name, cycle } of CYCLES) {
    it(`sets reset_at of the first ${name} add_count to get_next_reset, keeps the count until it and reads 0 from it`, async () => {
      const { server, session: first_session } = await start_user();
    let session = first_session;
      const id = counter(name);
      const request_time = START_AT + 12_345n;
      session = await travel(server, session, request_time);
      expect(await add(server, session, id, 2n)).toBe('OK');
      const next = next_reset(server, cycle, request_time);
      expect(next).toBeGreaterThan(request_time);
      expect(await row_of(server, session.user_id, id)).toEqual({ count: 2n, reset_at: next });
      session = await travel(server, session, next - 1n);
      expect(await count_of(server, session, id)).toBe(2n);
      session = await travel(server, session, next);
      expect(await count_of(server, session, id)).toBe(0n);
    });
  }

  it('leaves reset_at 0 for a row whose reset is null and keeps the count after any time', async () => {
    const { server, session: first_session } = await start_user();
    let session = first_session;
    const never = counter('never');
    expect(await add(server, session, never, 3n)).toBe('OK');
    expect(await row_of(server, session.user_id, never)).toEqual({ count: 3n, reset_at: 0n });
    session = await travel(server, session, START_AT + 400n * DAY_MS);
    expect(await count_of(server, session, never)).toBe(3n);
    expect(await add(server, session, never, 2n)).toBe('LIMIT_REACHED');
    expect(await add(server, session, never, 1n)).toBe('OK');
    expect(await row_of(server, session.user_id, never)).toEqual({ count: 4n, reset_at: 0n });
  });

  it('counts from 0 at an add_count after the reset time and moves reset_at to the next reset time', async () => {
    const { server, session: first_session } = await start_user();
    let session = first_session;
    const daily = counter('daily');
    expect(await add(server, session, daily, 3n)).toBe('OK');
    expect(await add(server, session, daily, 1n)).toBe('LIMIT_REACHED');
    const first = (await row_of(server, session.user_id, daily))?.reset_at ?? 0n;
    // Two days on: the stored row is past its reset_at and the count starts again.
    const now = first + 2n * DAY_MS + 5n;
    session = await travel(server, session, now);
    expect(await add(server, session, daily, 1n)).toBe('OK');
    const after = await row_of(server, session.user_id, daily);
    expect(after).toEqual({ count: 1n, reset_at: next_reset(server, GameData.ResetCycle.Daily, now) });
    expect(after?.reset_at).toBe(first + 3n * DAY_MS);
    // A LIMIT_REACHED after the reset time writes nothing: the lazy reset is saved only with a write.
    session = await travel(server, session, now + DAY_MS);
    expect(await add(server, session, daily, 4n)).toBe('LIMIT_REACHED');
    expect(await row_of(server, session.user_id, daily)).toEqual(after);
    expect(await count_of(server, session, daily)).toBe(0n);
  });
});
