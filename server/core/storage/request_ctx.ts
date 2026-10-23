import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';

/** The change source `with_hook_change_source` puts on a ctx while its function runs. */
export interface HookChangeSource {
  readonly source: CoreContract.ItemChangeSource;
  readonly ref: string;
}

/**
 * The scope of one user transaction (`storage` `### ctx`): a request, or one out-of-request change. A ctx is
 * invalid once its transaction ends.
 */
export interface RequestCtx {
  readonly user_id: bigint;
  /** The contract request name. Empty for an out-of-request change. */
  readonly request_name: string;
  /** Empty for an out-of-request change. */
  readonly request_id: string;
  readonly silent: boolean;
  readonly retry: boolean;
  /** Empty for an out-of-request change and a request without a session. */
  readonly session_id: string;
  readonly client_version: string;
  readonly platform: string;
  /** `server-time.user_now` when the transaction opened. */
  readonly request_time: bigint;
  readonly data: GameData.DataSet;
  /** `<protocol hash>-<data hash>` of the server build data. */
  readonly data_version: string;
  /** True once `delete_user` ran in this transaction. */
  readonly user_deleted: boolean;
  /** The innermost `with_hook_change_source` value, or null outside of one. */
  readonly hook_change_source: HookChangeSource | null;
  /** The 64-bit seed of the ctx random. */
  readonly seed: bigint;
}
