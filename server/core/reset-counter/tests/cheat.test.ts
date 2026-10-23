/** `SetResetCounter` through a test server: `routing`'s DEV code, the field validator and the response delta. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import { send_cheat, set_time } from '../../testing/dev/index.ts';
import { MAX, START_AT, add, count_of, counter, delta_rows, next_reset, rows, start_user, stop_all } from './helpers.ts';

const SET = 'core/cheat/SetResetCounter';

afterEach(async () => {
  await stop_all();
});

function set_request(counter_id: number, count: bigint): CoreCheatContract.SetResetCounterRequest {
  const message = new CoreCheatContract.SetResetCounterRequest();
  message.counter_id = counter_id;
  message.count = count;
  return message;
}

describe('SetResetCounter', () => {
  it('sets the count, over the limit too, with reset_at the next reset time, and carries the ResetCounterUserState delta', async () => {
    const { server, session } = await start_user();
    const daily = counter('daily');
    const time = START_AT + 777n;
    set_time(server, time);
    const reset_at = next_reset(server, GameData.ResetCycle.Daily, time);
    const set = await send_cheat(session, SET, set_request(daily, 9n));
    expect(set.envelope.error).toBeNull();
    expect(set.response).toBeInstanceOf(CoreCheatContract.SetResetCounterResponse);
    expect(delta_rows(set.envelope)).toEqual([[BigInt(daily), 9n, reset_at]]);
    expect(await rows(server, session.user_id)).toEqual([[BigInt(daily), 9n, reset_at]]);
    expect(await count_of(server, session, daily)).toBe(9n);
    expect(await add(server, session, daily, 1n)).toBe('LIMIT_REACHED');

    // A lower value and 0 are written as given; the never-reset row keeps reset_at 0.
    expect((await send_cheat(session, SET, set_request(daily, 0n))).envelope.error).toBeNull();
    expect(await count_of(server, session, daily)).toBe(0n);
    const never = counter('never');
    expect((await send_cheat(session, SET, set_request(never, MAX))).envelope.error).toBeNull();
    expect((await rows(server, session.user_id)).find(([id]) => id === BigInt(never))).toEqual([BigInt(never), MAX, 0n]);
  });

  it('is INVALID_REQUEST for an unknown reset counter and a count out of 0 to 2^53-1, changing nothing', async () => {
    const { server, session } = await start_user();
    const daily = counter('daily');
    for (const [id, count] of [
      [987_654, 1n],
      [0, 1n],
      [daily, -1n],
      [daily, MAX + 1n],
    ] as const) {
      const result = await send_cheat(session, SET, set_request(id, count));
      expect(result.envelope.error?.code, `${String(id)} ${String(count)}`).toBe(CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST);
      expect(result.response).toBeNull();
    }
    expect(await rows(server, session.user_id)).toEqual([]);
  });
});
