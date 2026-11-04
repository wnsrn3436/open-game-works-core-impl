# review: p2p-signaling round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | `spec` | `medium` | open-game-works-core/skills/server-core/modules/p2p-signaling.md:56 | `### transport` says the transport touches the matching of `matchmaker` only through "the four operations of this module (`prepare_transport`, `open_match_session`, `handle_frame`, `connection_closed`)", so that replacing it with a module of another `TransportKind` does not change `matchmaker`. The range adds a fifth operation with caller `matchmaker` (p2p-signaling.md:32), and matching now calls it: server/core/matchmaker/realtime.ts:571 calls `env.p2p.is_bound` from `host_error` (:577), and server/core/matchmaker/deps.ts:71 adds it to `MatchmakerP2pSignaling`. Run path: a replacement transport that has only the four named operations makes every host `ROOM_START` and party `MATCH_REQUEST` throw at realtime.ts:571 | Name `is_bound` in that sentence and make the count five, so that the replacement contract matches the API table | yes | 95 |

## previous

none

## out of scope

- server/core/matchmaker/realtime.ts:577: medium `host_error` checks `p2p-signaling.is_bound` only when the host frame is handled, and nothing checks again before `open_match_session` (realtime.ts:937), so a member can bind to a match after the check and be taken out of it, which is what matchmaker.md:146 gives as the reason for `ROOM_BUSY`. Reproduced with frames in a temporary copy of the checkout (rooms test harness, SQLite). Room of a and b in mode `BOTH`, `ROOM_START` makes match M, a sends `MATCH_LEAVE`, b's connection closes, b reconnects and sends `ROOM_JOIN`, host `MATCH_REQUEST` passes, b sends `MATCH_REJOIN`(M) and gets `ok` `true`, then `tick` by `match_wait`. b then receives `MATCH_FOUND` of the new match, `left_at` of b in M goes from 0 to 1800000030000, and a second `MATCH_REJOIN`(M) is `ok` `false`. The specs set the check only at the host frame, so the code equals matchmaker.md, and the repair belongs to the `matchmaker` target. The reproduction sends raw frames; it does not show that client `RealtimeCore` produces this order.

## debt

none

## must fix

none

## unknown

- Tests: `ogw core test server p2p-signaling` ended with `p2p-signaling pass` on this checkout. The whole test suite and `ogw core test server matchmaker` were not run.
- The scratch runs of server/core/matchmaker/tests/rooms.test.ts used SQLite only. Two `member rating resolution` tests failed there with and without the mutation, with `DB kind postgresql needs OGW_POSTGRESQL`, because that run gave no PostgreSQL. They say nothing about the code. The reproduction above was not run on PostgreSQL.
- Mutations in a temporary copy: `is_bound` always `true` fails the `is_bound` test in server/core/p2p-signaling/tests/leave.test.ts and the sweep test in tests/sweep.test.ts; always `false` fails the `is_bound` test; removing `member_in_match` from `host_error` fails the `ROOM_BUSY` test in server/core/matchmaker/tests/rooms.test.ts. No test evidence finding came from these.
- Client: of the client changes in the range, only the code that sends `MATCH_LEAVE` was read (`close` and `_on_match_found` in client/godot/core/realtime_core/p2p_realtime_transport.gd, `leave`, `end_match` and `_end_match_now` in realtime_core.gd), to check that `end_match` releases the binding. The rest of the `RealtimeCore` diff was not reviewed; it is not this target. No real client ran against a real server.
- Code before the range: server/core/p2p-signaling/index.ts, sessions.ts, turn.ts, adapters/turn_coturn.ts and dev/ were read in full. tests/leave.test.ts was read to the end of the `is_bound` test. tests/helpers.ts, open.test.ts, signal.test.ts and transport.test.ts were not read, tests/rejoin.test.ts was only searched, and tests/sweep.test.ts was read only in the range diff, so whether those tests prove the `## test` items that predate the range was not checked.
- Defining documents read in part: server-time.md and logging.md to about line 80, plus searches of logging.md; core/SKILL.md to about line 120 and server-core/SKILL.md to about line 120, with long lines cut; core/command.md by search only. The `logging` field name rule was not checked against the `frame` and `reason` fields that p2p-signaling writes.
- matchmaker: only the callers of `is_bound` and the p2p operations in server/core/matchmaker/realtime.ts and deps.ts were read. Other range changes outside p2p-signaling (`iap`, `auth`, `block-report`, `routing`, the settings schema minimums other than `p2p-signaling.*`) were not reviewed; they are not this target.
