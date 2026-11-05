# review matchmaker round 7

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D6 | fixed | none | The spec now settles the case: open-game-works-core/skills/server-core/modules/matchmaker.md:122 drops a `MATCH_REQUEST` of a user outside a room from the connection that a match being made takes for that user, and :162 sets the participant window from the queue removal or the end of member rating resolution until match creation ends. The code equals it: `match_request` (server/core/matchmaker/realtime.ts:626-635) returns before `solo_match_request` when `slot.room === null` and `client.making > 0`, so the queue removal and `enqueue` (:469, :495) are not reached. `create_match` raises `Client.making` for each seat's connection (:957-960) before its first await and lowers it in `finally` (:963-969). The solo path of D6: `run_tick` clears `slot.entry` (:1070-1077) and calls `queue_match` → `create_match` in the same synchronous step (:1078, :1053). The room member path of D6: for a party entry the seats carry the members' connections of `prepare_members` (:535, :1050), and for `ROOM_START` `create_match` is called right after `resolve_members` returns with no await in between (:754-763); after `ROOM_LEAVE` that member has `slot.room === null` and its connection still has `making > 0`, so its `MATCH_REQUEST` is dropped. A `MATCH_REQUEST` from another connection of that user is enqueued, as matchmaker.md:122 requires. Tests server/core/matchmaker/tests/rooms.test.ts:1182, :1200, :1227 cover the solo path; they pass (see `## unknown`) |

## must fix

none

## unknown

- The commit range 75da433..75da433 is empty, so no changed code was reviewed; the review covered only the input `## debt` item D6 against the current code (server/core/matchmaker/realtime.ts `match_request`, `solo_match_request`, `party_match_request`, `prepare_members`, `room_start`, `create_match`, `queue_match`, `run_tick`, `member_in_match`, `match_rejoin`) and open-game-works-core/skills/server-core/modules/matchmaker.md:117-166.
- Tests ran with vitest directly on a temporary copy of this checkout (`server`, `settings`, `core-spec`, `fixtures`, `test-data`, `proto`) on SQLite, using the server build data of the main open-game-works-core-impl checkout (same commit 75da433). All tests of server/core/matchmaker ran: 166 passed, and the 5 that failed are PostgreSQL tests that stop at start because the run gave no `OGW_POSTGRESQL`. PostgreSQL and `ogw core test` were not run.
- No test drives the room member path of D6 (a member that sent `ROOM_LEAVE` while its room's match is being made, then `MATCH_REQUEST` on the same connection); its result was judged by reading the code.
