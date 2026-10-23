// The operations mission calls on its dependencies.
import type { Logging } from '../logging/index.ts';
import type { Mailbox } from '../mailbox/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { RequestCtx, Storage } from '../storage/index.ts';
import type { Validation } from '../validation/index.ts';

export type { RequestCtx } from '../storage/index.ts';

export type MissionStorage = Pick<Storage, 'get_state' | 'put_core_state' | 'with_hook_change_source' | 'check_hook_output'>;
export type MissionServerTime = Pick<ServerTimeApi, 'now' | 'get_next_reset'>;
export type MissionValidation = Pick<Validation, 'evaluate_requirement'>;
export type MissionMailbox = Pick<Mailbox, 'grant_or_mail'>;
export type MissionLogging = Pick<Logging, 'track_core_event'>;

/** `live-event`: the active window and the round reset of a data row, typed from its spec `## API`. */
export interface MissionLiveEvent {
  is_in_active_window(ctx: RequestCtx, start_at: bigint | null, end_at: bigint | null, live_event: number | null): boolean;
  round_to_write(ctx: RequestCtx, live_event: number | null): number;
  is_round_reset(ctx: RequestCtx, live_event: number | null, event_round: number): boolean;
}
