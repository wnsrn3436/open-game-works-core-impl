# review: matchmaker round 6

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R6-1 | `efficiency` | medium | server/core/matchmaker/matching.ts:69 | `collect` has no exit after the collected headcount reaches `max_players`, so it walks the whole queue, and `run_queue` (matching.ts:136) calls it once per match. One `matchmaker_tick` over one queue is quadratic in the entries of that queue and blocks the event loop of that server instance. Run path: `run_tick` (realtime.ts:995) to `run_queue` to `collect`, growing amount: entries of one queue. Measured with `run_queue` directly, `max_players` 2, same ratings, one run per size under vitest: 8000 entries 511 ms, 16000 entries 1077 ms, 32000 entries 3064 ms. With the fix below in a temporary copy: 32 ms, 167 ms, 146 ms, and `matching.test.ts` and `queue-rules.test.ts` pass 31 of 31 on SQLite | Add `if (count === rule.max_players) break;` after the placement in `collect`: no later entry can fit | no | 95 |
| R6-2 | `correctness` | medium | server/core/matchmaker/realtime.ts:851 | `matchmaker.frameReadTimeoutMs` and `matchmaker.helloTimeoutMs` have schema minimum 0 (settings/core-settings.schema.json:689, :697), and `network_time_limit` throws below 1 (server/core/server-time/network_time_limit.ts:9). Reproduced with `frameReadTimeoutMs` 0 on a real test server and a real TCP socket: handshake answered `101`, then one unauthenticated byte `0x82` reached `process` `uncaughtException` with `RangeError: network_time_limit: ms 0 is below 1`, through `WebSocketConnection.#read` and `#time_frame` (server/core/matchmaker/websocket.ts:113, :167, :196). server/core has no `uncaughtException` handler outside tests. Reproduced with `helloTimeoutMs` 0: the throw at realtime.ts:870 closes every `/realtime` connection after its handshake, and the test client got `HELLO got a closed connection`. Defaults are 10000, so this needs a game settings value of 0 | Write `1 or more` on both keys in open-game-works-core/skills/server-core/modules/matchmaker.md:273 and :278 and raise both schema minimums to 1, so that server/core/routing/tests/settings-minimum.test.ts holds them at 1. Same cause as D5 of records/review-debt/spec-matchmaker.json | yes | 95 |
| R6-3 | `correctness` | medium | server/core/matchmaker/realtime.ts:577 | `host_error` checks `is_bound` only when the host frame is handled, and nothing checks again before `open_match_session` (realtime.ts:945), which takes a bound connection out of its previous session (server/core/p2p-signaling/sessions.ts:87). Reproduced with raw frames on SQLite. Room of a and b in mode `BOTH`, `ROOM_START` makes match M, a sends `MATCH_LEAVE`, b's connection closes, b reconnects and sends `ROOM_JOIN`, host `MATCH_REQUEST` passes with no `ROOM_FAILED`, b sends `MATCH_REJOIN`(M) and gets `ok` `true`, then `tick` by `match_wait`. b receives `MATCH_FOUND` of a new match, `left_at` of b in M goes from 0 to 1800000030000, and a second `MATCH_REJOIN`(M) is `ok` `false`. This is the result that matchmaker.md:146 gives as the reason for `ROOM_BUSY`, and the code equals matchmaker.md:151, which sets the check only at the host frame | Set in matchmaker.md what happens when a member binds to a match after the host check: either `MATCH_REJOIN` of a user in a room or queue is refused or takes the user out of it, or the bound seat is checked again before `open_match_session`. Then implement and test that result | yes | 95 |
| R6-4 | `correctness` | medium | server/core/matchmaker/realtime.ts:579 | `making_match` covers only the room of that `ROOM_START`, and `is_bound` of a seat is `false` until `open_match_session`, so a seat of a match being made can enter a second match through another room. Reproduced with raw frames on SQLite. `ROOM4` room R1 of A, B, C and room R2 of D, fake `turn` failure `timeout`, `p2p-signaling.turnTimeoutMs` 1500, A `ROOM_START`, wait for the `issue_relays` call, B `ROOM_LEAVE`, B `ROOM_JOIN` of R2, D `ROOM_START`. B got two `MATCH_FOUND` with different `match_id`. The first record has `left_at` of index 1 written as 1800000000000 while indexes 0 and 2 have 0. The window lasts as long as the record save and the `turn` call. The code equals the room-scoped wording of matchmaker.md:146 | Extend matchmaker.md:146 and :151 from the room to the seat: `ROOM_BUSY` while a member is a seat of a match being made through any room. Then mark seats from member rating resolution until `create_match` ends and test it. It can share one repair with R6-3 | yes | 95 |
| R6-5 | `spec` | medium | server/core/matchmaker/realtime.ts:514 | `room_unchanged` compares only the member ID list, so a member who leaves and joins again during a wait of member rating resolution is not seen as a change, which differs from matchmaker.md:137. `prepare_members` also keeps the `client` it read before the await (realtime.ts:524, :530). Reproduced on SQLite with `run_rollback_transaction` of member B held on a gate, `ROOM4` room of A and B after A `ROOM_START`. B `ROOM_LEAVE` and `ROOM_JOIN` on the same connection: no `ROOM_FAILED`, and A and B both get `MATCH_FOUND`. B's socket closed, a new B connection authenticated and `ROOM_JOIN` sent on it: no `ROOM_FAILED`, A gets `MATCH_FOUND`, the new connection of B gets no `MATCH_FOUND`, and index 1 of the match record has `disconnected_at` 1800000000000, so B is a participant of a match it was never told about | Count every member change of a room (a revision number that `room_join` and `leave_room` raise) and compare it in `room_unchanged` instead of the ID list, so the case ends in `ROOM_FAILED`(`ROOM_BUSY`). Add both runs above as tests | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R6-1 | `collect` is unchanged and reproduced; see R6-1 |
| D2 | open | R6-2 | Both schema minimums are still 0 and both throws reproduced. The positions moved to realtime.ts:851 and :870. The step the item did not run was run: on a real socket the throw reaches `uncaughtException`. See R6-2 |
| D3 | open | R6-3 | Reproduced frame by frame with the result the item states. `open_match_session` is now at realtime.ts:945. See R6-3 |
| D4 | open | R6-4 | Reproduced with the result the item states; see R6-4 |
| D5 | open | R6-5 | Both runs reproduced with the result the item states; see R6-5 |

## must fix

none

## unknown

- The commit range is empty and input `## spec changes` and `## core agent reports` are `none`, so this round has no changed code to check. It checked only the five debt items. judge.ts, records.ts and results.ts were not read. Of the input definition documents, matchmaker.md was read whole, p2p-signaling.md only by a search for its rejoin and bind lines, and the others not at all.
- The previous review file of round 5 has `## findings` `none` and no `open` row, so `## previous` has nothing to decide. The input names that file under another checkout path; its content is the same as records/review/matchmaker-5.md of this checkout.
- Reproductions ran in a temporary copy with vitest directly on SQLite, with the built data folder of the main checkout, whose HEAD is the same commit (when that folder was built was not checked). `ogw core test` and PostgreSQL were not run, and neither were the whole matchmaker test suite or the tests of the modules that depend on `matchmaker`. The range changes no code.
- R6-1 times are one run per size in a test process and are noisy, as the 16000 and 32000 entry runs with the fix show. The fix was tried only with `matching.test.ts` and `queue-rules.test.ts`.
- R6-2: the end of the server process was not observed. The test registered an `uncaughtException` listener, which kept the process alive, and the search for a handler covered server/core outside tests only, not what a game's server entry adds.
- R6-3 and R6-4 send raw frames and do not show that client `RealtimeCore` produces these orders.
- R6-5: the wait is a gate on a spy of `run_rollback_transaction`, not a real lock wait.
- The repairs named for R6-2 (spec and schema), R6-3, R6-4 and R6-5 were not tried.
