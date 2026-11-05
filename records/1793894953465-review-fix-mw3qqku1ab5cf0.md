# review fix matchmaker round 3

## done

- module `matchmaker` (server/core/matchmaker/realtime.ts): a user-scoped count of the participants of matches being made (`making`, realtime.ts:197). `create_match` (realtime.ts:953) adds every seat when it starts and removes them in `finally`, so a failed save, a stop and a throw also end it. It is called with no await after the queue removal of `run_tick` and after the member rating resolution of `room_start`, so the window matches matchmaker.md `### match creation` (definition of a participant of a match being made)
- `ROOM_START` and host `MATCH_REQUEST`: `member_in_match` (realtime.ts:579), used by `host_error`, is `true` for a member who is a participant of a match being made, so both are `ROOM_BUSY` (matchmaker.md `ROOM_START` row and host `MATCH_REQUEST` of party handling)
- `MATCH_REJOIN`: new handler `match_rejoin` (realtime.ts:780). A participant of a match being made gets `MATCH_REJOINED`(`match_id` of the request, `ok` `false`, other fields empty, the same frame as the rejoin condition violation of p2p-signaling sessions.ts:198) without `handle_frame`. Otherwise the frame goes to `handle_frame`, and when the change it returns is `REJOINED` (returned only for `ok` `true`), the user leaves its room as with `ROOM_LEAVE` (`leave_room`, which also removes the party entry of a `Matching` room), or leaves its solo queue entry (`remove_entry`)
- tests in server/core/matchmaker/tests/rooms.test.ts, `describe('a match being made')`: :1078 (matchmaker.md `## test`: member who left a room whose `ROOM_START` save waits and joined another room → `ROOM_BUSY` there, one `MATCH_FOUND`), :1105 (rejoin of a party member during the save of its party match → `ok` `false`, `left_at` 0 in the earlier match, `MATCH_FOUND` of the new match), :1128 (rejoin `ok` `true` while the party entry is queued → member out of the room, party entry out of the queue, member stays in the rejoined match), :1153 (the same for a solo queue entry)
- the four tests failed on the code before the fix (main HEAD `realtime.ts`, SQLite and PostgreSQL) and pass after it
- last `ogw core test server matchmaker rating routing testing` (matchmaker and `ogw core dependents matchmaker` server side): pass on SQLite and PostgreSQL. `ogw code check core`: all pass
- no engine-specific implementation rules document and no `## <engine> build` of `tools/ogw.md` written

## spec proposals

- A solo `MATCH_REQUEST` of a user outside a room who is a participant of a match being made (its entry was removed by matching and the match record save still waits) is not refused by matchmaker.md: step 1 to 4 of the `MATCH_REQUEST` processing order put it into the queue again, so a later tick can group that user into a second match while the first is still being made (two `MATCH_FOUND`, `left_at` written in the first). Proposal: in the `MATCH_REQUEST` processing order of a user outside a room, `MATCH_FAILED`(`REJECTED`, `ROOM_BUSY` or a new code) for a participant of a match being made, with a `## test` line. Not implemented, since the spec does not settle it. Reproduction not run; path judged by reading `solo_match_request`

## review

- R3-1: fixed. server/core/matchmaker/realtime.ts:780 (`match_rejoin`), :953 (`making` kept by `create_match`); tests server/core/matchmaker/tests/rooms.test.ts:1105, :1128, :1153
- R3-2: fixed. server/core/matchmaker/realtime.ts:579 (`member_in_match` used by `host_error`), :953; test server/core/matchmaker/tests/rooms.test.ts:1078
- R2-1: not fixed as its own finding, since its `spec change` line in the input is `yes`. The same defect was carried as R3-1 with `spec change` `no` after matchmaker.md settled it, and that fix covers it
- R2-2: not fixed as its own finding, since its `spec change` line in the input is `yes`. The same defect was carried as R3-2 with `spec change` `no`, and that fix covers it

## unverified

- Whether client `RealtimeCore` sends `MATCH_REJOIN` during a match being made in the frame orders of the tests was not checked; the tests send raw frames
- The test of the `ROOM_BUSY` path (:1078) makes the match record save wait with `hold_next_transaction` on `run_game_transaction`; the window after the save (waiting for `prepare_transport`) uses the same mark and is covered by reading only
