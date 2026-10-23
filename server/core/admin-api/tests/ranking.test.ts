// remove_ranking_user.
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { admin, has_module, id_value, login, send, start, stop, type Core, type Server } from './helpers.ts';

const BOARD = '[admin_board]';

/** `ranking` as content code calls it. */
interface RankingContent {
  submit_score(ctx: RequestCtx, board_id: number, score: bigint, display: string): unknown;
}

/** A content admin operation that submits a score for the target user. */
function register(core: Core): void {
  const ranking = (core as unknown as { ranking: RankingContent }).ranking;
  core.routing.register_admin_operation({
    name: 'game_score',
    role: 'ops',
    body: 'json',
    max_body_bytes: null,
    input: { user_id: { type: { kind: 'int64' }, optional: false }, score: { type: { kind: 'int64' }, optional: false } },
    user_target: 'user_id',
    handler: (input, tx) => {
      ranking.submit_score(tx as RequestCtx, id_value(BOARD), input.score as bigint, '');
      return {};
    },
    prepare: null,
    audit_args: null,
  });
}

describe('remove_ranking_user', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  // Needs `ranking`; this core has no ranking module yet, so admin-api does not register remove_ranking_user.
  it.skipIf(!has_module('ranking'))('leaves the user out of ranking query results', async () => {
    server = await start({ register });
    const a = await login(server, 'rank_a');
    const b = await login(server, 'rank_b');
    expect((await admin(server, 'game_score', { user_id: a.user_id, score: '10' })).status).toBe(200);
    expect((await admin(server, 'game_score', { user_id: b.user_id, score: '20' })).status).toBe(200);
    const top = async (): Promise<string[]> => {
      const request = new CoreContract.GetRankingTopRequest();
      request.board_id = id_value(BOARD);
      request.limit = 10;
      const sent = await send(b.session, 'core/GetRankingTop', request);
      expect(sent.code).toBe(0);
      return (sent.response as CoreContract.GetRankingTopResponse).entries.map((entry) => String(entry.user_id));
    };
    expect(await top()).toEqual([b.user_id, a.user_id]);
    expect((await admin(server, 'remove_ranking_user', { user_id: a.user_id })).status).toBe(200);
    expect(await top()).toEqual([b.user_id]);
  });

  it.skipIf(has_module('ranking'))('does not register remove_ranking_user without ranking: 404 at step 3', async () => {
    server = await start();
    const { user_id } = await login(server, 'rank_none');
    const reply = await admin(server, 'remove_ranking_user', { user_id });
    expect(reply.status).toBe(404);
    expect(reply.json).toEqual({ error: 'not_found' });
  });
});
