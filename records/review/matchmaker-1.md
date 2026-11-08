# review matchmaker round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/matchmaker/realtime.ts:327 | `drop` (realtime.ts:338) calls `leave_before_close`, which takes every waiting `MATCH_LEAVE` out of `client.pending` and hands it to `p2p-signaling.handle_frame` at once, at the WebSocket close. That is while the earlier frame of the same connection is still being handled. The spec says the handling of a frame starts after the handling of the previous frame of that connection ends (skills/server-core/modules/matchmaker.md:122). Its `## test` item (matchmaker.md:452) says that a `MATCH_LEAVE` with `forfeit` `true`, and the close right after it, arriving while the frame handling waits behind a `MATCH_REQUEST` whose `prepare_match_request` transaction is held, "write `left_at` of that index after the wait". Run path: forfeit.test.ts:600-616 sends `MATCH_REQUEST` (held in `run_rollback_transaction`), then `MATCH_LEAVE`(`forfeit` `true`), then closes. It then waits until `left_at` of index 1 is not 0 at line 612, before `held.open()` at line 613. The test passes (`ogw core test server matchmaker --file server/core/matchmaker/tests/forfeit.test.ts`: pass), so `left_at` is written during the wait, not after it. The order can be seen when the earlier frame changes what the `MATCH_LEAVE` meets. Example: after a `ROOM_START` whose match creation is still waiting, the `MATCH_LEAVE` of the earlier match reaches `handle_frame` before `open_match_session` of the new match binds that connection, not after. The test asserts the spec item's opposite, so it does not check that item | Hand the `MATCH_LEAVE` frames that arrived before the close to the frame chain of the connection, so each starts after the previous frame's handling ends. Handle the connection close (`connection_closed`, queue and room removal) after them. Change forfeit.test.ts:612 to check that `left_at` is still 0 while the hold is in place and is written after `held.open()` | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

| id | result | finding | evidence |
|---|---|---|---|
| M1 | fixed | none | `MatchRecordInput` has `status: CoreContract.MatchJudgeStatus` (server/core/matchmaker/records.ts:69). `record_input` sets it with `status_value(r.status)` (records.ts:401), and the apply hooks and `replay_match` get it from `record_input` (results.ts:136, :216). Tests: server/core/matchmaker/tests/forfeit.test.ts:196 checks `status` `FORFEIT` in the `apply_match_forfeit` input. server/core/matchmaker/tests/rating.test.ts passes the received record to `rating.apply_match_outcome` without a fallback, and checks `status` `FORFEIT` and `CONFIRMED` and the rating changes |
| M2 | fixed | none | `write_change` writes `ENDED` as `ended_at` (server/core/matchmaker/results.ts:503-506) and `LEFT` as `left_at` (results.ts:498-502). `ended_at` is a participant column (records.ts:194), read into the record (records.ts:291), passed in the match record input (records.ts:411) and in `get_match` (admin.ts:110). Tests: server/core/matchmaker/tests/results.test.ts:646 checks `ended_at` not 0, `left_at` 0, `MISMATCH` at `deadline_at` and a `Missing` event. results.test.ts:663 checks that a report after `MATCH_LEAVE` with `forfeit` `false` is saved and judged `CONFIRMED`. Both fail if `ENDED` writes `left_at` |

## unknown

- Did not run the whole server core test suite. Ran only server/core/matchmaker/tests/forfeit.test.ts (pass)
- Did not read the p2p-signaling changes of the range (server/core/p2p-signaling/sessions.ts), which are outside the target. Assumed that `handle_frame` returns `ENDED` for `MATCH_LEAVE` with `forfeit` `false` and `LEFT` for `forfeit` `true`, as the p2p-signaling spec says
- Read the room, party and matching code of server/core/matchmaker/realtime.ts and matching.ts outside the changes of the range only as far as the changed code calls them
