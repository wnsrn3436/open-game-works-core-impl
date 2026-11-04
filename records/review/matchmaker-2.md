# review: matchmaker round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | `correctness` | medium | server/core/matchmaker/realtime.ts:577 | The check added by this range reads `is_bound`, but a `ROOM_START` match binds its members only at `open_match_session`, after `results.create` and `prepare_transport` are awaited (server/core/matchmaker/realtime.ts:744, `create_match`), and the room stays `Open` for that time. A host connection close is not queued behind the frame chain (`closed` calls `drop`), so the next member becomes host during that wait and its `ROOM_START` passes `host_error`, which creates a second match with the same members. This is the result the range set out to prevent (open-game-works-core/skills/server-core/modules/matchmaker.md:146 "a new match would take that member out of the running one"). Reproduced with a test appended to `rooms.test.ts` in a temporary copy, on SQLite: `ROOM4` room A, B, C, fake `turn` failure `timeout` with `p2p-signaling.turnTimeoutMs` 1500, A `ROOM_START`, wait for the `issue_relays` call, close A's socket, B `ROOM_START`. B received two `MATCH_FOUND` frames; the first match recorded B and C with `left_at` written, and A with `disconnected_at`. With B then sending `MATCH_LEAVE` of the second match, which is what the P2P transport does when it holds a match (client/godot/core/realtime_core/p2p_realtime_transport.gd:323), B had `left_at` in both matches and `MATCH_REJOIN` of the first was `ok` `false`. The client step was sent by the test, not run on a real client. The window lasts as long as the record save and the `turn` call, up to `p2p-signaling.turnTimeoutMs` (default 3000). By reading, the code before this range has the same window | Refuse `ROOM_START` and host `MATCH_REQUEST` with `ROOM_BUSY` from the start of a room's member rating resolution until its `create_match` ends, for example with a mark on the room that a host change does not clear. open-game-works-core/skills/server-core/modules/matchmaker.md:89, :146, :151 name only `Matching` and `is_bound` as the `ROOM_BUSY` conditions, so the rule has to be written there, with a line in `## test` | yes | 90 |
| R2-2 | `spec` | medium | server/core/matchmaker/tests/rooms.test.ts:653 | open-game-works-core/skills/server-core/modules/matchmaker.md:146 and :151 put `ROOM_BUSY` for a bound member before `FEATURE_DISABLED`, and no test has a bound member with the kill switch on. The test at server/core/matchmaker/tests/rooms.test.ts:653 runs with the kill switch off, and the `kill switch` test at server/core/matchmaker/tests/rooms.test.ts:522 runs with no match. Mutation in a temporary copy: at server/core/matchmaker/realtime.ts:577 the `member_in_match` check moved after the kill switch line of `host_error`. `rooms.test.ts` on SQLite then had only the 2 failures it has without the mutation, both PostgreSQL tests that the run could not start because it gave no `OGW_POSTGRESQL`. Removing the check, by contrast, fails server/core/matchmaker/tests/rooms.test.ts:653, so that test does catch the missing check | Add a case to server/core/matchmaker/tests/rooms.test.ts:653: with a member bound and kill switch `MATCH_REQUEST` on, `ROOM_START` and host `MATCH_REQUEST` are `ROOM_FAILED`(`ROOM_BUSY`) | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Tests were run in a temporary copy with vitest directly, on SQLite only, because that run gave no PostgreSQL. `server/core/matchmaker/tests`: 133 pass and 4 fail, and all 4 are PostgreSQL tests that need `OGW_POSTGRESQL`. `server/core/p2p-signaling/tests`: 25 pass. So the PostgreSQL runs and `ogw core test` itself were not checked here. records/1793770762759-update-core-mw1osqo7b92eb8.md reports a pass on both DBs. R2-1 and R2-2 were also run on SQLite only.
- The tests of the modules that depend on `matchmaker` and `p2p-signaling` were not run. A search of `server/core` for `ROOM_START` frames found them only in the tests of `matchmaker`. The core agent's report says those dependent modules were not run either.
- The client was read, not run. The paths that release a binding were checked by reading `RealtimeCore` and the P2P transport: `leave`, `end_match`, `_fail_match`, a match found discarded in `None`, a second `MATCH_FOUND`, `leave_room` in `None`, and `release`. No real client ran against a real server, so the rematch flow where a host calls `start_room` before the members have sent `MATCH_LEAVE` was checked only as far as `ROOM_BUSY` in the server test.
- The `MATCH_REJOIN` case in `## spec proposals` of records/1793770762759-update-core-mw1osqo7b92eb8.md is not a finding. By reading, the P2P transport sends `MATCH_REJOIN` only on a new connection (client/godot/core/realtime_core/p2p_realtime_transport.gd:83), and a new connection of a user closes the previous one, which takes that user out of the room, so `room_unchanged` gives `ROOM_BUSY`. Only a client other than the core client could send `MATCH_REJOIN` on a connection that is in a room, including while its party entry is in the queue, and that was not run. By reading, the result would be that sender's own `LEFT` in the rejoined match, which it can also cause with `MATCH_LEAVE`.
- server/core/matchmaker/results.ts, records.ts, judge.ts, matching.ts and websocket.ts have no change in the range and were not read again.
- `records/review-debt/matchmaker.json` holds D1 and D2 while input `## debt` is `none`. They were not decided here and are not repeated in `## out of scope`.
- The changes of the range to `iap`, to the client tests and to the review records are outside this target and were not reviewed. The change to `client/godot/core/realtime_core/realtime_core.gd` was read only for what the server receives.
