import type { RequestCtx, StorageContent } from '../core/storage/index.ts';
import * as GameContract from '../generated/contract/game_contract.ts';

/**
 * `RecordBenchTick`: adds 1 to the stored tick count when the request carries the stored count (a request made from
 * an older count is a mismatch) and the stored count is below `[tick_count_max]`.
 */
export function record_bench_tick(storage: StorageContent): GameContract.RecordBenchTickHandler {
  return (ctx: RequestCtx, request: GameContract.RecordBenchTickRequest) => {
    const stored = storage.get_state(ctx, GameContract.BenchUserState, 0n) as GameContract.BenchUserState | null;
    const count = stored?.tick_count ?? 0n;
    if (request.tick_count !== count) return GameContract.GameError.GAME_ERROR_TICK_COUNT_MISMATCH;
    if (count >= ctx.data.GameSetting.tick_count_max()) return GameContract.GameError.GAME_ERROR_TICK_COUNT_LIMIT;
    const next = new GameContract.BenchUserState();
    next.tick_count = count + 1n;
    storage.put_state(ctx, next);
    const response = new GameContract.RecordBenchTickResponse();
    response.tick_count = next.tick_count;
    return response;
  };
}
