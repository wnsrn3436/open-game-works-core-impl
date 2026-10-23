/**
 * Server start failures of matchmaker. The `match_mode` row rules of `## data` (including both `allow_queue` and
 * `allow_room` false) are data checks: their tests are the data tool tests `tests/matchmaker-checks.test.ts`.
 * `max_players` over `matchmaker.maxPlayers` and a `rating_rule` without `rating` need the merged core settings and
 * the server module list, so matchmaker checks those two at server start.
 */
import { harness, missing, mode, present_server_modules, stop_all } from './helpers.ts';

const DUEL = mode(7601);
const REPLAY = mode(7602, { result_rule: 'ServerReplay' });

afterEach(async () => {
  await stop_all();
});

describe('server start', () => {
  it('does not start with a ServerReplay match_mode row and no replay_match, and starts with one', async () => {
    await expect(harness({ modes: [REPLAY], hooks: { replay: null } })).rejects.toThrow();
    await harness({ modes: [REPLAY], hooks: { replay: () => 'reject' } });
  });

  it('does not start with a match_mode row over matchmaker.maxPlayers', async () => {
    await expect(harness({ modes: [mode(7603, { max_players: 6 })], settings: { 'matchmaker.maxPlayers': 5 } })).rejects.toThrow();
    await harness({ modes: [mode(7603, { max_players: 6 })], settings: { 'matchmaker.maxPlayers': 6 } });
  });

  it.each([
    ['an empty alphabet', { 'matchmaker.roomCodeAlphabet': '' }],
    ['a lowercase letter', { 'matchmaker.roomCodeAlphabet': 'ABCd' }],
    ['a repeated character', { 'matchmaker.roomCodeAlphabet': 'ABCA' }],
    ['a length of 0', { 'matchmaker.roomCodeLength': 0 }],
  ])('does not start with %s in the room code settings', async (_name, settings) => {
    await expect(harness({ modes: [DUEL], settings })).rejects.toThrow();
  });

  // `rating` is not in this core yet.
  it.skipIf(missing('rating'))('does not start with a match_mode row with a rating_rule when rating is not a server module', async () => {
    const rated = mode(7604, { rating_rule: 7901 });
    const without = present_server_modules().filter((m) => m !== 'rating');
    await expect(harness({ modes: [rated], rating_rules: [{ id: 7901, initial_rating: 1_000n }], server_modules: without })).rejects.toThrow();
    await harness({ modes: [rated], rating_rules: [{ id: 7901, initial_rating: 1_000n }] });
  });
});
