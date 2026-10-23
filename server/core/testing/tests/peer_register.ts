/**
 * The content `register` makers of the peer processes of `peer-process.test.ts`: the core test defaults and a
 * `RunCoreTest` handler. The one of `lock_peer` waits at gate `before_lock` with the backend pid of its transaction as
 * the note, then takes the transaction advisory lock of `LOCK_KEY`. The `register` of `failing_peer` throws.
 */
import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import type { PeerRegister } from '../dev/index.ts';
import { core_test_register } from '../dev/runner_input.ts';

export const LOCK_KEY = 4_242n;

export const BEFORE_LOCK = 'before_lock';

interface Routing {
  register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void;
}

export const lock_peer: PeerRegister = (peer) => (core) => {
  core_test_register(core, ['RunCoreTest']);
  (core as unknown as { routing: Routing }).routing.register_handler('RunCoreTest', (ctx) => {
    const db = (peer.modules().get('storage') as unknown as Storage).db(ctx);
    peer.wait(BEFORE_LOCK, String(db.query('SELECT pg_backend_pid() AS pid')[0]?.['pid']));
    db.query('SELECT pg_advisory_xact_lock(CAST($1 AS BIGINT)) AS locked', [LOCK_KEY]);
    return new GameContract.RunCoreTestResponse();
  });
};

export const AT_TIME = 'at_time';

/** A `RunCoreTest` handler that waits at gate `at_time` with the request time of its transaction as the note. */
export const clock_peer: PeerRegister = (peer) => (core) => {
  core_test_register(core, ['RunCoreTest']);
  (core as unknown as { routing: Routing }).routing.register_handler('RunCoreTest', (ctx) => {
    peer.wait(AT_TIME, String(ctx.request_time));
    return new GameContract.RunCoreTestResponse();
  });
};

/** The environment variable that names the file `failing_peer` writes its process ID and peer folder to. */
export const FAILING_PEER_FILE = 'OGW_TESTING_FAILING_PEER_FILE';

/**
 * A `register` that throws, so the server start of the peer fails. Before it throws it writes `{pid, folder}` of the
 * peer process (the folder of its config file) to the file that `FAILING_PEER_FILE` names.
 */
export const failing_peer: PeerRegister = () => () => {
  const file = process.env[FAILING_PEER_FILE] ?? '';
  writeFileSync(file, JSON.stringify({ pid: process.pid, folder: dirname(process.argv[2] ?? '') }));
  throw new Error('register fails on purpose');
};
