import { randomUUID } from 'node:crypto';
import * as Testing from '../core/testing/dev/index.ts';
import * as CoreContract from '../generated/contract/core_contract.ts';
import * as GameContract from '../generated/contract/game_contract.ts';
import type { RequestCtx, StorageContent } from '../core/storage/index.ts';
import { record_bench_tick } from '../handlers/RecordBenchTick.ts';

const RPC = 'RecordBenchTick';
/** `[tick_count_max]` of the data. */
const MAX = Testing.load_data().data.GameSetting.tick_count_max();

function tick(count: bigint): GameContract.RecordBenchTickRequest {
  const request = new GameContract.RecordBenchTickRequest();
  request.tick_count = count;
  return request;
}

function code(result: Testing.SendResult): number | null {
  return result.envelope.error === null ? null : result.envelope.error.code;
}

async function stored(server: Testing.TestServer, user_id: bigint): Promise<bigint | null> {
  const item = (await Testing.read_user_state(server, user_id)).find((entry) => entry.kind === 'BenchUserState');
  return item === undefined ? null : (item.value as GameContract.BenchUserState).tick_count;
}

describe('RecordBenchTick', () => {
  let server: Testing.TestServer;

  beforeEach(async () => {
    server = await Testing.start_test_server();
  });

  afterEach(async () => {
    await Testing.stop_test_server(server);
  });

  it('adds one tick to the stored count and sends the count in the response and the delta', async () => {
    const session = await Testing.login(server, 'bench_1');
    const first = await Testing.send(session, RPC, tick(0n));
    expect(code(first)).toBeNull();
    expect((first.response as GameContract.RecordBenchTickResponse).tick_count).toBe(1n);
    const entry = first.envelope.user_state?.entries.find((e) => e.kind === 'BenchUserState');
    expect(entry && GameContract.BenchUserState.decode(entry.value)?.tick_count).toBe(1n);
    const second = await Testing.send(session, RPC, tick(1n));
    expect((second.response as GameContract.RecordBenchTickResponse).tick_count).toBe(2n);
    expect(await stored(server, session.user_id)).toBe(2n);
  });

  it('refuses a count that is not the stored count and keeps the state', async () => {
    const session = await Testing.login(server, 'bench_2');
    await Testing.send(session, RPC, tick(0n));
    expect(code(await Testing.send(session, RPC, tick(0n)))).toBe(GameContract.GameError.GAME_ERROR_TICK_COUNT_MISMATCH);
    expect(code(await Testing.send(session, RPC, tick(5n)))).toBe(GameContract.GameError.GAME_ERROR_TICK_COUNT_MISMATCH);
    expect(await stored(server, session.user_id)).toBe(1n);
  });

  it('refuses a tick at the tick count limit and keeps the state', () => {
    // A user at the limit needs `[tick_count_max]` recorded ticks; the handler runs here on a stored state at the limit.
    const at_limit = new GameContract.BenchUserState();
    at_limit.tick_count = MAX;
    const puts: unknown[] = [];
    const storage = { get_state: () => at_limit, put_state: (_ctx: RequestCtx, value: unknown) => puts.push(value) } as unknown as StorageContent;
    const ctx = { data: Testing.load_data().data } as unknown as RequestCtx;
    expect(record_bench_tick(storage)(ctx, tick(MAX))).toBe(GameContract.GameError.GAME_ERROR_TICK_COUNT_LIMIT);
    expect(puts).toEqual([]);
  });

  it('answers a resent request ID with the stored response and records one tick', async () => {
    const session = await Testing.login(server, 'bench_4');
    const request_id = randomUUID();
    const first = await Testing.send(session, RPC, tick(0n), request_id);
    const again = await Testing.send(session, RPC, tick(0n), request_id);
    expect(code(first)).toBeNull();
    expect(code(again)).toBeNull();
    expect((again.response as GameContract.RecordBenchTickResponse).tick_count).toBe(1n);
    expect(await stored(server, session.user_id)).toBe(1n);
  });

  it('records one tick of two concurrent requests with one count', async () => {
    const session = await Testing.login(server, 'bench_5');
    const results = await Promise.all([Testing.send(session, RPC, tick(0n)), Testing.send(session, RPC, tick(0n))]);
    expect(results.map(code).sort()).toEqual([null, GameContract.GameError.GAME_ERROR_TICK_COUNT_MISMATCH].sort());
    expect(await stored(server, session.user_id)).toBe(1n);
  });

  it('refuses a count outside the field range without a handler call', async () => {
    const session = await Testing.login(server, 'bench_6');
    expect(code(await Testing.send(session, RPC, tick(-1n)))).toBe(CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST);
    expect(code(await Testing.send(session, RPC, tick(MAX + 1n)))).toBe(CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST);
    expect(await stored(server, session.user_id)).toBeNull();
  });
});
