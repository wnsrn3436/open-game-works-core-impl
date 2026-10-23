// The operations of the dependency modules that offer calls, in the TypeScript form of `server-core` `## module`.
import type { RequestCtx } from '../storage/index.ts';

export type { RequestCtx, Storage } from '../storage/index.ts';
export type { ServerTimeApi } from '../server-time/index.ts';
export type { Logging } from '../logging/index.ts';

/** The `live-event` operations offer calls. Each takes a data row's `live_event`; 0 is none. */
export interface LiveEventApi {
  is_in_active_window(ctx: RequestCtx, start_at: bigint, end_at: bigint, live_event: number): boolean;
  round_to_write(ctx: RequestCtx, live_event: number): number;
  is_round_reset(ctx: RequestCtx, live_event: number, event_round: number): boolean;
}

/** `validation.evaluate_requirement`'s output. */
export interface RequirementEvaluation {
  readonly passed: boolean;
  readonly failed_requirement_id: number;
}

/** The `validation` operation offer calls. */
export interface ValidationApi {
  evaluate_requirement(ctx: RequestCtx, requirement_id: number): RequirementEvaluation;
}
