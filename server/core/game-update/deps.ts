/**
 * What game-update uses of its dependencies (`storage`, `server-time`, `logging`) and of the module input `server`
 * (`server-core` `## module`). Only these operations and fields are read.
 */
import type { Logging } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { Storage } from '../storage/index.ts';
import type { OutgoingHttp } from './cdn.ts';
import type { Environment } from './deploy_list.ts';

export type { DbHandle, GameTx } from '../storage/index.ts';

/** `storage`'s failure value `FAILED`. */
export const FAILED = 'FAILED';

/** The `storage` operations game-update calls. */
export type GameUpdateStorage = Pick<Storage, 'register_table' | 'run_game_transaction' | 'lock_game_row' | 'after_commit' | 'db' | 'read_db'>;

/** The `server-time` operations game-update calls. */
export type GameUpdateServerTime = Pick<ServerTimeApi, 'clock_now' | 'schedule_job' | 'network_time_limit'>;

/** The `logging` operations game-update calls. */
export type GameUpdateLogging = Pick<Logging, 'write'>;

/** The fields of the module input `server` that game-update reads. */
export interface GameUpdateServer {
  readonly env: Environment;
  /** `--db`: given only to a LOCAL server and a test server, which read secrets from `--secret-file`. */
  readonly db: string | null;
  readonly client_data_version: string;
  readonly compat_client_data_version: string | null;
  /** The secret adapter: a `--secret-file` key on a LOCAL server and a test server, a host secret store name otherwise. */
  read_secret(name: string): string | null;
  readonly fetch: OutgoingHttp;
  /** The fake adapter override by adapter key. */
  readonly fake_adapters: Readonly<Record<string, unknown>>;
}
