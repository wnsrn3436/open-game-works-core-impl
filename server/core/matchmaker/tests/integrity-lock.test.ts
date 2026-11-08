/**
 * On PostgreSQL, the integrity locks of `### integrity`: two judgements that give the same user an integrity event at
 * the same time, one by `ReportMatchResult` on a peer process and one by job `matchmaker_sweep`, count that user's
 * events one after the other.
 */
import { open_pg_session } from '../../storage/dev/index.ts';
import { login, read_logs, start_peer_process, stop_peer_processes } from '../../testing/dev/index.ts';
import {
  Judge,
  K,
  harness,
  leave_frame,
  match_request,
  match_status,
  mode,
  next,
  online,
  report,
  result_bytes,
  send_and_wait,
  settled,
  stop_all,
  tick,
  until_participants,
  type Conn,
  type Harness,
  type Hooks,
} from './helpers.ts';
import { JUDGED_GATE, WAIT_BLOCKED_FUNCTION } from './peer.ts';

const PEER = { module: new URL('./peer.ts', import.meta.url), name: 'matchmaker_peer' };
const DUEL = mode(7601);
/** A shorter match, so that job `matchmaker_sweep` decides it while the duel is still before its `deadline_at`. */
const TRIO = mode(7602, { min_players: 3, max_players: 3, max_duration: 60_000n });
const TRIO_DEADLINE = TRIO.prepare_time + TRIO.max_duration + 1_000n;
const HOOKS: Hooks = { apply_result: () => 'pass', apply_forfeit: () => 'pass', apply_mismatch: () => 'pass' };
const T = 90_000;

afterEach(async () => {
  await stop_peer_processes();
  await stop_all();
});

/** The connections queue for the mode, a tick, and the `MATCH_FOUND` of each. */
async function match_of(h: Harness, mode_id: number, conns: readonly Conn[]): Promise<{ match_id: string; index: number }[]> {
  for (const conn of conns) await send_and_wait(conn, match_request(mode_id));
  await tick(h);
  const found = await Promise.all(conns.map((conn) => next(conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND)));
  return found.map((f) => ({ match_id: f.match_id, index: f.my_index }));
}

describe('integrity lock', () => {
  it('On PostgreSQL, with matchmaker.flagForfeitCount 2, the sweep judgement of a second forfeit waits for the lock of (user_id, "") until the ReportMatchResult judgement of the first commits, counts 2, and leaves one flag log', async () => {
    const h = await harness({
      modes: [DUEL, TRIO],
      hooks: HOOKS,
      db: 'postgresql',
      settings: { 'matchmaker.flagForfeitCount': 2, 'storage.userLockWaitMs': 20_000, 'matchmaker.reportMarginMs': 1_000, 'matchmaker.sweepIntervalMs': 1 },
    });
    const connection = h.server.shared.database.connection;
    if (connection === null) throw new Error('PostgreSQL');
    const pg = await open_pg_session(connection);
    try {
      await pg.query(WAIT_BLOCKED_FUNCTION);
    } finally {
      pg.close();
    }
    const peer = await start_peer_process(h.server, PEER);
    const [user, p1, p2, p3] = await Promise.all(['ilock_user', 'ilock_p1', 'ilock_p2', 'ilock_p3'].map((name) => login(peer.remote, name)));
    if (user === undefined || p1 === undefined || p2 === undefined || p3 === undefined) throw new Error('sessions');
    const user_conn = await online(h, user);

    // The first forfeit: the duel, judged later by the report of p1 on the peer.
    const duel = await match_of(h, DUEL.id, [user_conn, await online(h, p1)]);
    const duel_id = duel[0]?.match_id ?? '';
    await send_and_wait(user_conn, leave_frame(duel_id, true));
    await until_participants(h, duel_id, (rows) => rows[duel[0]?.index ?? 0]?.left_at !== 0n);
    // The second forfeit: the trio, which p2 reports and p3 does not, so job matchmaker_sweep judges it.
    const trio = await match_of(h, TRIO.id, [user_conn, await online(h, p2), await online(h, p3)]);
    const trio_id = trio[0]?.match_id ?? '';
    await send_and_wait(user_conn, leave_frame(trio_id, true));
    await until_participants(h, trio_id, (rows) => rows[trio[0]?.index ?? 0]?.left_at !== 0n);
    await settled(h);
    expect((await report(p2, trio_id, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);

    // The peer judges the duel and waits with its integrity lock of the user.
    const reported = report(p1, duel_id, result_bytes(1));
    await peer.reached(JUDGED_GATE);
    peer.open(JUDGED_GATE);
    await tick(h, TRIO_DEADLINE);
    expect((await reported).status).toBe(Judge.MATCH_JUDGE_STATUS_FORFEIT);
    expect(match_status(h, trio_id)).toBe('FORFEIT');
    const flags = read_logs(h.server, 'core', 'warn').filter((l) => l['message'] === 'match integrity flag');
    expect(flags.map((l) => [String(l['user_id']), l['integrity_kind'], l['flag_count']])).toEqual([[String(user.user_id), 'Forfeit', 2]]);
  }, T);
});
