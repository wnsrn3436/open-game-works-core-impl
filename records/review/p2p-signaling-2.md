# review: p2p-signaling round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | `fixed` | open-game-works-core/skills/server-core/modules/p2p-signaling.md:56 now says "the five operations" and names `is_bound` beside `prepare_transport`, `open_match_session`, `handle_frame` and `connection_closed`, the same five as the `## API` table (p2p-signaling.md:28-32). The code uses exactly these: `MatchmakerP2pSignaling` at server/core/matchmaker/deps.ts:60-72 has these five and no other, and the only `env.p2p` calls are server/core/matchmaker/realtime.ts:330, :573, :756, :931, :945, :948. A replacement transport with those five operations no longer throws at realtime.ts:573 |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Tests: `ogw core test server p2p-signaling matchmaker` (job `mw1q0eig7aeb2c`) ended with `p2p-signaling pass` and `matchmaker pass` on this checkout. The job output gives only the per-module result, so the run per DB was not read from it. The whole test suite and the other dependents of `matchmaker` were not run.
- Range: nothing under server/core/p2p-signaling/ changed in it. The code changes are in server/core/matchmaker/realtime.ts (mark `making_match`) and server/core/matchmaker/tests/rooms.test.ts. They were read for how they use the five operations and for what they assume of `open_match_session`: it checks its inputs before it changes any state (server/core/p2p-signaling/sessions.ts:80-84), so a throw for those inputs changes no session. The new test that makes it throw replaces it with a mock, so it does not exercise those checks. Whether `making_match` itself is right against matchmaker.md is the `matchmaker` target and was not judged here.
- Spec change reach: server/core/p2p-signaling/index.ts, sessions.ts and turn.ts were read in full, and so was the `is_bound` test of tests/leave.test.ts; tests/sweep.test.ts was read around its `is_bound` assert. core-spec/p2p-signaling.json was checked only for the operation name `is_bound`. Imports of `p2p-signaling` from `matchmaker`, `routing` and `testing` were searched: no module imports its files, and server/core/testing/dev/server_binding.ts:31 only names it as the owner of adapter key `turn`.
- `D3` of records/review-debt/matchmaker.json, written from round 1 of this target, is not written again in `## out of scope` because it is already in that list and an item would be a duplicate. `host_error` at server/core/matchmaker/realtime.ts:579 still checks `is_bound` only at the host frame; the reproduction of that item was not run again.
- Not read this round, and outside this range and the spec diff: server/core/p2p-signaling/adapters/turn_coturn.ts, dev/, tests/helpers.ts, open.test.ts, signal.test.ts, transport.test.ts, tests/rejoin.test.ts. Whether those tests prove the `## test` items that predate the range was not checked, as in round 1.
- Defining documents read in part: p2p-signaling.md and the spec diff in full; matchmaker.md (not a defining document of this target) by its lines on `p2p-signaling` and `ROOM_BUSY`; core/SKILL.md `## spec`; core/command.md by search and `## test`; server-core/SKILL.md `## module`. server-time.md and logging.md were not read this round. No operation of those two is touched by the spec diff or the range. The `logging` field name rule named in round 1 `## unknown` remains unchecked.
- Client: no client code was read. The spec diff names no client behavior, and no real client ran against a real server.
