/**
 * The content `register` of a matchmaker peer process (`testing` `start_peer_process`): the core test defaults and an
 * `apply_match_forfeit` that, in the reporter's apply of a `ReportMatchResult` (inside the judging transaction, after
 * its integrity locks), waits at gate `judged` and then until another session waits for a lock of its transaction.
 * The gate note is the backend pid of that transaction.
 */
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { core_test_register, type PeerRegister } from '../../testing/dev/index.ts';

export const JUDGED_GATE = 'judged';

/** Returns once a session waits for a lock that the calling backend holds; false when none waited in 20 s. */
export const WAIT_BLOCKED_FUNCTION = `CREATE OR REPLACE FUNCTION ogw_test_wait_blocked() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  FOR i IN 1..2000 LOOP
    IF EXISTS (SELECT 1 FROM pg_locks l WHERE NOT l.granted AND pg_backend_pid() = ANY(pg_blocking_pids(l.pid))) THEN
      RETURN true;
    END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
  RETURN false;
END $$`;

interface Routing {
  register_hook(module: string, hook: string, fn: unknown): void;
}

export const matchmaker_peer: PeerRegister = (peer) => (core) => {
  core_test_register(core);
  (core as unknown as { routing: Routing }).routing.register_hook('matchmaker', 'apply_match_forfeit', (ctx: RequestCtx) => {
    if (ctx.request_name === '') return 'pass';
    const db = (peer.modules().get('storage') as unknown as Storage).db(ctx);
    peer.wait(JUDGED_GATE, String(db.query('SELECT pg_backend_pid() AS pid')[0]?.['pid']));
    if (db.query('SELECT ogw_test_wait_blocked() AS blocked')[0]?.['blocked'] !== true) throw new Error('matchmaker_peer: no session waited for the judging transaction');
    return 'pass';
  });
};
