# review matchmaker round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | server/core/matchmaker/realtime.ts:796 | Input D3, still present, and now a deviation from the defining documents: matchmaker.md was changed after round 2 (open-game-works-core/skills/server-core/modules/matchmaker.md:157, :161 and `## test` :398, :399) to say that a user whose `MATCH_REJOIN` is `ok` `true` leaves the queue and leaves the room as with `ROOM_LEAVE`, and that the `MATCH_REJOIN` of a participant of a match being made is not passed to `p2p-signaling.handle_frame` and is answered with the `MATCH_REJOINED` of a rejoin condition violation (`ok` `false`). The code sends every `MATCH_REJOIN` to `p2p_frame` (realtime.ts:796, :763), which only calls `env.p2p.handle_frame` and writes the participant change: it neither removes the user from its queue entry or room after `ok` `true` nor has any record of participants of a match being made, so nothing refuses a rejoin during creation. Run path (D3 reproduction, rooms test harness, SQLite): room a, b in mode `BOTH`, `ROOM_START` makes match M, a `MATCH_LEAVE`, b's connection closes, b reconnects and `ROOM_JOIN`, host `MATCH_REQUEST` passes, b `MATCH_REJOIN`(M) is `ok` `true` but b stays in the room and the party entry stays in the queue (spec :399 says both are removed), and `tick` after `match_wait` gives b `MATCH_FOUND` of a new match and writes `left_at` of b in M. A solo queue entry follows the same path. No test in server/core/matchmaker/tests/ covers :398 or :399. The code of these lines did not change in this range; path confirmed by reading, reproduction not rerun | In the `MATCH_REJOIN` handler, answer `MATCH_REJOINED`(`ok` `false`) without calling `handle_frame` when the user is a participant of a match being made (matchmaker.md:161: from queue removal by matching or the end of member rating resolution of its `ROOM_START` until its match creation ends, also on a failed save); after a change of kind `REJOINED`, remove the user's queue entry (`remove_entry`) and call `leave_room`; add the tests of matchmaker.md:398 and :399 | no | 85 |
| R3-2 | spec | medium | server/core/matchmaker/realtime.ts:584 | Input D4, still present, and now a deviation from the defining documents: matchmaker.md:147 (`ROOM_START`) and :152 (host `MATCH_REQUEST`) now also give `ROOM_BUSY` when a member is a participant of a match being made (defined at :161), with `## test` :397 ("a member who left that room and joined another room makes the `ROOM_START` of the other room `ROOM_FAILED`(`ROOM_BUSY`), and that member receives one `MATCH_FOUND`"). `host_error` (realtime.ts:584) checks only `making_match` of the sender's own room and `p2p-signaling.is_bound` of the members; the code keeps no user-scoped mark of the seats of a match being made (`room_start` realtime.ts:744-758, `queue_match` :976, `create_match` :913), and a seat's `is_bound` stays `false` until `open_match_session` (:953). Run path (D4 reproduction, SQLite, raw frames): `ROOM4` room R1 of A, B, C and room R2 of D, fake `turn` failure `timeout`, `p2p-signaling.turnTimeoutMs` 1500, A `ROOM_START`, wait for `issue_relays`, B `ROOM_LEAVE`, B `ROOM_JOIN` of R2, D `ROOM_START` passes `host_error`: B gets two `MATCH_FOUND` and `left_at` of B is written in the first match. No test covers :397. Code unchanged in this range; path confirmed by reading, reproduction not rerun | Keep the user ids of the participants of a match being made (added when member rating resolution of a `ROOM_START` ends and when matching removes the entries of a match, removed when `create_match` ends, also after a failed save) and make `host_error` return `ROOM_BUSY` when a member is one of them; add the test of matchmaker.md:397 | no | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | open | Unchanged code: `MATCH_REJOIN` still goes straight to `p2p_frame` (server/core/matchmaker/realtime.ts:796, :763) and `open_match_session` (:953) has no check. matchmaker.md now settles the behavior (:157, :161, :398, :399), so the remaining work is a code fix; carried as R3-1 with `spec change` `no` |
| R2-2 | open | Unchanged code: `host_error` (server/core/matchmaker/realtime.ts:584) still reads only the room-scoped `making_match`. matchmaker.md now settles the user-scoped rule (:147, :152, :161, :397); carried as R3-2 with `spec change` `no` |
| R2-3 | fixed | `Room.generation` (server/core/matchmaker/realtime.ts:103) is raised by every member change: `leave_room` (:291, reached by `ROOM_LEAVE`, `ROOM_KICK` and `drop` on a close or a replacing `HELLO`) and `room_join` (:700); no other code changes `room.members`. `room_unchanged` (:517) compares the room object, `Open` and that generation, so a leave followed by a join of the same user during a member's transaction is `ROOM_BUSY` as matchmaker.md:138 says. `prepare_members` reads the member's `client` after its transaction (:531). The tests at server/core/matchmaker/tests/rooms.test.ts:427 and :447 assert `ROOM_FAILED`(`ROOM_BUSY`) to both members and no `MATCH_FOUND`; with the old `room_unchanged` (member list compare) the list is `[a, b]` again after the rejoin, so neither test can get `ROOM_BUSY` on that code. `ogw core test server matchmaker --file server/core/matchmaker/tests/rooms.test.ts` passed on SQLite and PostgreSQL on dd44034 |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D3 | open | R3-1 | `MATCH_REJOIN` is still handled only by `p2p_frame` (server/core/matchmaker/realtime.ts:796, :763), with no refusal for a participant of a match being made and no leave of queue and room after `ok` `true`, which matchmaker.md:157 now requires |
| D4 | open | R3-2 | `host_error` (server/core/matchmaker/realtime.ts:584) still has no check for members that are participants of a match being made of another room or of the queue, which matchmaker.md:147 and :152 now require |
| D5 | fixed | none | The room generation counter (server/core/matchmaker/realtime.ts:103, :291, :517, :700) detects a leave and join of the same user during resolution, and the member connection is read after its transaction (:531); see R2-3 |

## must fix

none

## unknown

- Input `## spec changes` is `none`, but the harness commits 384ef88, 0335878 and 4fe1051 changed matchmaker.md (`### room`, `### match creation`, `## test`) after round 2 to settle R2-1 and R2-2. R3-1 and R3-2 are judged against the current documents; other code was not compared against those changed lines beyond the D3 and D4 paths.
- The reproductions of D3 and D4 were not rerun; their paths were confirmed by reading the current code, which this range did not change on those paths. Whether client `RealtimeCore` produces those frame orders was not checked.
- The R2-3 tests were not run on the pre-fix `realtime.ts`: `ogw core test` run from a scratch clone resolves to the main checkout, so that run passed without testing the clone. Failure on the old code is judged by reading (R2-3 is a `spec` finding, not a `test evidence` finding).
- `remove` in server/core/matchmaker/matching.ts:120 still splices once per matched entry; not measured, as in earlier rounds.
