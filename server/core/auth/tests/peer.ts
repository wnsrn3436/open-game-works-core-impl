/**
 * The content `register` of an auth peer process (`testing` `start_peer_process`), whose log lines go nowhere: the core
 * test defaults, with the `error` log entries of its server instance kept, and `RunCoreTest` that waits at gate
 * `errors` with those entries as the gate note.
 */
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { core_test_register, type PeerRegister } from '../../testing/dev/index.ts';

export const ERRORS_GATE = 'errors';

/** An `error` log entry of the peer: what the test compares. `user_id` is a decimal string, as in a log line. */
export interface PeerError {
  readonly message: string;
  readonly user_id: string | null;
  readonly request: string | null;
}

interface LogEntry {
  readonly kind: string;
  readonly message: string;
  readonly user_id: bigint | null;
  readonly request: string | null;
}

interface Routing {
  register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void;
}

export const auth_peer: PeerRegister = (peer) => (core) => {
  const logging = core['logging'] as { write(entry: LogEntry): null };
  const errors: PeerError[] = [];
  const write = logging.write.bind(logging);
  logging.write = (entry) => {
    if (entry.kind === 'error') errors.push({ message: entry.message, user_id: entry.user_id === null ? null : entry.user_id.toString(), request: entry.request });
    return write(entry);
  };
  (core as unknown as { routing: Routing }).routing.register_handler('RunCoreTest', () => {
    peer.wait(ERRORS_GATE, JSON.stringify(errors));
    return new GameContract.RunCoreTestResponse();
  });
  core_test_register(core, ['RunCoreTest']);
};
