# review matchmaker round 6

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R5-1 | fixed | server/core/matchmaker/realtime.ts:56 adds `Client.making`, raised for each seat at :959 synchronously at the start of `create_match` (before its first await, so in the same `run_tick` step that cleared `slot.entry` at :1070-1077) and lowered in its `finally` at :965. `match_request` (:629-630) returns before `solo_match_request` when the user is outside a room and `client.making > 0`, so step 1 (queue removal) and `enqueue` are not reached and the connection keeps getting that match's `MATCH_FOUND` or `MATCH_FAILED`(`CREATE_FAILED`) from `make_match` (:992, :1021); a frame from another connection of that user has `making` 0 and follows the processing order (open-game-works-core/skills/server-core/modules/matchmaker.md:122). Tests added at server/core/matchmaker/tests/rooms.test.ts:1182 (held match record save, one `MATCH_FOUND`, user not in the queue), :1200 (save fails, `MATCH_FAILED`(`CREATE_FAILED`), user not in the queue) and :1227 (new connection puts the user in the queue) cover open-game-works-core/skills/server-core/modules/matchmaker.md:400. In a temporary copy of this checkout, all 15 tests of `describe('a match being made')` pass on SQLite. With the defect restored there (the line `if (client.making > 0) return;` at realtime.ts:630 replaced by a comment), the tests at :1182 and :1200 fail with `expected 1 to be +0` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range changes server/core/matchmaker/realtime.ts (`Client.making`, `match_request`, `create_match`) and server/core/matchmaker/tests/rooms.test.ts. The review covered those changes, their callers and callees (`queue_match`, `run_tick`, `room_start`, `make_match`, `solo_match_request`, `party_match_request`, `member_in_match`, `match_rejoin`, the `MATCH_REQUEST` handler with `admitted`), and the related spec lines open-game-works-core/skills/server-core/modules/matchmaker.md:122 and :400. The other files of the range (mailbox, RealtimeCore client tests, records) are outside the target.
- Tests ran with vitest directly on a temporary copy of HEAD (`server`, `settings`, `core-spec`, `fixtures`, `test-data`, `proto`), on SQLite only, using the server build data of the main open-game-works-core-impl checkout (same commit 0e0765a). Only `describe('a match being made')` of rooms.test.ts ran; PostgreSQL, the other matchmaker test files and `ogw core test` were not run.
- The `prepare_transport` window of match creation was not run separately; by reading, `Client.making` stays raised from the start of `create_match` until its `finally`, which covers that window.
