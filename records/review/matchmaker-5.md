# review matchmaker round 5

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R5-1 | spec | medium | server/core/matchmaker/realtime.ts:466 | The spec change adds open-game-works-core/skills/server-core/modules/matchmaker.md:122 (a solo `MATCH_REQUEST` from the connection that a match being made takes for that user is dropped, and that connection gets that match's `MATCH_FOUND` or `MATCH_FAILED`(`CREATE_FAILED`)) and the `## test` item matchmaker.md:400. `solo_match_request` (server/core/matchmaker/realtime.ts:466-496) has no check for a match being made: `making` (:197) is read only by `member_in_match` (:579) and `match_rejoin` (:781), so the frame goes through the processing order and `enqueue` (:495) puts the user in the queue again. `run_tick` (:1062-1069) cleared `slot.entry` before `create_match`, so the next tick can collect that user into a second match while the first is being made. Reproduced in a temporary copy of this checkout with a test added to server/core/matchmaker/tests/rooms.test.ts (`describe('a match being made')`): 4 users `queued` in `BOTH`, `hold_next_transaction(h, 'run_game_transaction')`, `advance_time(TICK_MS)`, wait for the save call, `send_and_wait(u.conn, match_request(BOTH.id))`, open the save, `wait_background`; then 3 more users `queued` and `tick(h, BOTH.match_wait)`. The same connection got one `MATCH_FOUND` of the first match and then a second `MATCH_FOUND` (4 players) of a new match (`expect(found_count(later)).toBe(0)` failed with 1), so the user was in the queue, against matchmaker.md:400. No test of the matchmaker tests covers matchmaker.md:400 (grep of server/core/matchmaker/tests for a `MATCH_REQUEST` during a held solo match save finds none) | Keep the connections of the seats of each match being made (e.g. a count per `Client` set in `create_match` next to `making`, cleared in its `finally`), and in `solo_match_request` (or `match_request` for a user outside a room) drop the frame before step 1 when the sending connection is one of them, so the queue is not touched; a `MATCH_REQUEST` from another connection of that user keeps the current order. Add the test of matchmaker.md:400: the dropped request on the same connection (one `MATCH_FOUND`, no second match on a later tick) and the same request on a new connection of that user while the save waits (user in the queue) | no | 95 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range 4d2e918..5055e70 changes no file under server/core/matchmaker; the only target change is the spec diff, so the review covered the code and tests that matchmaker.md:122 and :400 reach (`solo_match_request`, `match_request`, `create_match`, `run_tick`, `match_rejoin` and the tests of `describe('a match being made')` in server/core/matchmaker/tests/rooms.test.ts).
- The reproduction ran with vitest directly on a temporary copy, with SQLite only, using the server build data of the main open-game-works-core-impl checkout (at 5d5c1d2, same matchmaker code; the range changes no data); PostgreSQL and `ogw core test` were not run.
- The `MATCH_FAILED`(`CREATE_FAILED`) branch and the `prepare_transport` window of matchmaker.md:122 were not reproduced; judged by reading: `solo_match_request` has no check at any point of `create_match` (server/core/matchmaker/realtime.ts:953-962).
- The second sentence of matchmaker.md:122 (another connection follows the processing order) holds in the current code by reading, since no connection is refused; it was not run.
- Round 4 had no findings and no `open` rows in `## previous`, so `## previous` has no rows.
