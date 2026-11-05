# review matchmaker round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | correctness | medium | server/core/matchmaker/realtime.ts:579 | Input D3, still present. `host_error` checks `p2p-signaling.is_bound` of the members (`member_in_match`, realtime.ts:571) only when the host `ROOM_START` or `MATCH_REQUEST` frame is handled. After host `MATCH_REQUEST` the party entry stays in the queue (realtime.ts:609) and `MATCH_REJOIN` of a member goes to `p2p_frame` (realtime.ts:789) with no room or queue check, so the member binds to its earlier match; `queue_match` (realtime.ts:969) and `create_match` then call `open_match_session` (realtime.ts:946) with no check of `is_bound`, which takes that member out of the running match, the result matchmaker.md:147 gives as the reason for `ROOM_BUSY`. Run path (D3 reproduction, rooms test harness, SQLite): room a, b in mode `BOTH`, `ROOM_START` makes match M, a `MATCH_LEAVE`, b's connection closes, b reconnects and sends `ROOM_JOIN`, host `MATCH_REQUEST` passes, b `MATCH_REJOIN`(M) is `ok` `true`, `tick` after `match_wait`: b gets `MATCH_FOUND` of the new match, `left_at` of b in M is written, and a second `MATCH_REJOIN`(M) is `ok` `false`. The commit range is empty, so this code is unchanged since D3 was written; I confirmed the path by reading and did not rerun the reproduction | Settle in matchmaker.md what happens when a seat of a room or party entry becomes bound to a match session after the host frame check (e.g. refuse that `MATCH_REJOIN` while the user is in a `Matching` room or a match being made, or check `is_bound` of every seat before `open_match_session` and fail that room with `ROOM_BUSY`), then implement it with a test of this frame order | yes | 85 |
| R2-2 | correctness | medium | server/core/matchmaker/realtime.ts:738 | Input D4, still present. `making_match` is a flag of the room (realtime.ts:738, :751) and `host_error` reads it only for that room (realtime.ts:579), while `ROOM_LEAVE` (`leave_room`, realtime.ts:281) and `ROOM_JOIN` (`room_to_join`, realtime.ts:674) do not look at whether the user is a seat of a match being made, and that seat's `is_bound` stays `false` until `open_match_session` (realtime.ts:946). So during `results.create` and `prepare_transport` (realtime.ts:923, :932) of a `ROOM_START`, a member can leave, join another room and be put into a second match by that room's `ROOM_START`. Run path (D4 reproduction, SQLite, raw frames): `ROOM4` room R1 of A, B, C and room R2 of D, fake `turn` failure `timeout`, `p2p-signaling.turnTimeoutMs` 1500, A `ROOM_START`, wait for `issue_relays`, B `ROOM_LEAVE`, B `ROOM_JOIN` of R2, D `ROOM_START`: B gets two `MATCH_FOUND` with different `match_id`, and B has `left_at` written in the first match. Code unchanged in this range; path confirmed by reading, reproduction not rerun | Mark the users who are seats of a match being made (from member rating resolution until `create_match` ends) and refuse their `ROOM_JOIN`, `ROOM_CREATE` and `MATCH_REQUEST` with `ROOM_BUSY` (or keep them in the room until then); state this user-scoped rule in matchmaker.md:147 and test this order | yes | 85 |
| R2-3 | spec | medium | server/core/matchmaker/realtime.ts:514 | Input D5, still present. `room_unchanged` compares only the room object, `Open` and the member id list (realtime.ts:514), so a member who does `ROOM_LEAVE` then `ROOM_JOIN` (allowed while `making_match`, `room_to_join` realtime.ts:674 checks only `Matching`) while `prepare` awaits that member's transaction (realtime.ts:526) leaves the same list `[A, B]`, and no `ROOM_FAILED`(`ROOM_BUSY`) is sent, which differs from matchmaker.md:138. `prepare_members` also keeps the `client` it read before the await (realtime.ts:524, :530), so when B reconnects on a new connection and joins again, the seat gets the closed connection: the new connection gets no `MATCH_FOUND` and `create_match` writes `disconnected_at` for that seat (realtime.ts:947). D5 reproduction (SQLite, `run_rollback_transaction` of B held on a gate, `ROOM4` room A, B, A `ROOM_START`) showed both cases. Code unchanged in this range; path confirmed by reading | Detect any membership change during the wait, e.g. a room member generation counter raised by every join and leave and compared in `room_unchanged`, and read each member's `client` again after the await; add tests of both orders | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | `collect` now ends with `if (count === rule.max_players) break;` (server/core/matchmaker/matching.ts:81), so one `collect` stops at a full match; every entry has at least one member, so no later entry could fit and step 2 of `### matching` gives the same result. server/core/matchmaker/tests/queue-rules.test.ts bounds the rating reads to `4 * n` |
| D2 | fixed | none | settings/core-settings.schema.json:689 and :697 now give `matchmaker.frameReadTimeoutMs` and `matchmaker.helloTimeoutMs` `minimum` 1, matching "1 or more" in matchmaker.md `## settings`, so `network_time_limit` (server/core/server-time/network_time_limit.ts:9) is never called with 0 from server/core/matchmaker/realtime.ts:852. server/core/matchmaker/tests/connection.test.ts:59 checks both minimums and runs connections with both limits at 1 |
| D3 | open | R2-1 | `is_bound` is still checked only in `host_error` (server/core/matchmaker/realtime.ts:579) and not before `open_match_session` (realtime.ts:946) |
| D4 | open | R2-2 | `making_match` is still room-scoped (server/core/matchmaker/realtime.ts:738) and `ROOM_JOIN` does not refuse a seat of a match being made |
| D5 | open | R2-3 | `room_unchanged` still compares only the member list (server/core/matchmaker/realtime.ts:514) and `prepare_members` keeps the pre-await `client` (realtime.ts:524, :530) |

## must fix

none

## unknown

- The commit range is empty (e4eeb27..e4eeb27), so there are no changed places; this round checked only the input `## debt` items and the round 1 review, which had no findings.
- The reproductions of D3, D4 and D5 were not rerun in this round. Their run paths were confirmed by reading the current code, which this range did not change. Whether client `RealtimeCore` produces those frame orders was not checked.
- No tests were run. D1 and D2 were judged fixed by reading the code, the schema and the tests that cover them; I did not restore the old code to see those tests fail (they are debt items, not `test evidence` findings).
- `remove` in server/core/matchmaker/matching.ts:120 still splices once per matched entry; not measured, as in round 1.
