/** The DEV code of `matchmaker`: the `## DEV` operation `create_test_match`. Not in STG and PROD builds. */
import { randomUUID } from 'node:crypto';
import type { Matchmaker } from '../index.ts';
import { build_record } from '../records.ts';

export interface MatchmakerDev {
  /** A `PENDING` match record of these users without queue, connection or `p2p-signaling`; returns `match_id`. */
  create_test_match(mode_id: number, user_ids: readonly bigint[], seed: bigint): Promise<string>;
}

export function create_matchmaker_dev(matchmaker: Matchmaker): MatchmakerDev {
  const context = matchmaker.test_match_context;
  return {
    async create_test_match(mode_id, user_ids, seed) {
      const table = context.data.MatchModeTable;
      if (!table.has_row(mode_id)) throw new Error(`create_test_match: mode ${String(mode_id)} is not a match_mode row`);
      const mode = table.get_row(mode_id);
      if (user_ids.length < mode.min_players || user_ids.length > mode.max_players) {
        throw new Error(`create_test_match: ${String(user_ids.length)} users are outside min_players and max_players of mode ${String(mode_id)}`);
      }
      const record = build_record({
        match_id: randomUUID(),
        mode_id,
        source: 'Queue',
        lockstep: false,
        seed,
        created_at: context.clock_now(),
        prepare_time: mode.prepare_time,
        duration: context.duration_of(mode, false),
        report_margin_ms: context.report_margin_ms,
        data_version: context.client_data_version,
        client_version: '',
        seats: user_ids.map((user_id) => ({ user_id, rating: 0n, team: 0, party: 0 })),
      });
      if (!(await context.save(record))) throw new Error('create_test_match: the match record save failed');
      return record.match_id;
    },
  };
}
