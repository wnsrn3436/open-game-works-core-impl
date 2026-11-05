# review matchmaker round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `MATCH_REJOIN` now goes to `match_rejoin` (server/core/matchmaker/realtime.ts:780, registered at :823). A user in `making` gets `MATCH_REJOINED` with only `match_id` and `ok` `false` set, the same frame as the rejoin condition violation of server/core/p2p-signaling/sessions.ts:197-203, and `handle_frame` is not called (matchmaker.md:157). Otherwise the frame goes to `forward` (:766), and when the change is `REJOINED` the user leaves its room with `leave_room` (:791), which also removes the party entry of a `Matching` room (:290), or its solo queue entry with `remove_entry` (:792) (matchmaker.md:157). `making` (:197) is set when `create_match` starts (:953) and cleared in `finally` (:956-961). `create_match` is called with no await after the queue removal of `run_tick` (:1062-1069 → `queue_match` :1037) and after member rating resolution of `room_start` (:750-759), so the window equals matchmaker.md:161. Tests server/core/matchmaker/tests/rooms.test.ts:1105 (matchmaker.md:398), :1128 (:399) and :1153 (solo entry) check `ok`, room membership, queue removal via a later tick, and `left_at`/`disconnected_at` in the earlier match. `ogw core test server matchmaker --file server/core/matchmaker/tests/rooms.test.ts` passed on 4d2e918 (main checkout at the same commit as this checkout) |
| R3-2 | fixed | `member_in_match` (server/core/matchmaker/realtime.ts:578) returns `true` for a user in `making`, and `host_error` (:587) applies it to every member, so `ROOM_START` (:727) and host `MATCH_REQUEST` (:594) are `ROOM_BUSY` when a member is a participant of a match being made (matchmaker.md:147, :152). Test server/core/matchmaker/tests/rooms.test.ts:1078 (matchmaker.md:397) holds the match record save of R1's `ROOM_START`, moves B to R2, asserts `ROOM_FAILED`(`ROOM_BUSY`, `ROOM_START`) for D with no `MATCH_FOUND`, and one `MATCH_FOUND` for B with players [A, B, C]; it passed in the run above |

## out of scope

- server/core/matchmaker/realtime.ts:491: medium A solo `MATCH_REQUEST` of a participant of a match being made is put into the queue again, so a later tick can put that user into a second match while the first is still being made: the second `open_match_session` binds the connection to the new session and the first match gets the `LEFT` of that index (two `MATCH_FOUND`, `left_at` written in the first match), the result matchmaker.md:147 refuses for rooms. Run path by reading: solo user U is matched by `run_tick` (:1062-1069), `create_match` waits on `results.create` or `prepare_transport` (:982, :991); U sends `MATCH_REQUEST`, `solo_match_request` (:466-495) has no `making` check and `enqueue`s U (:495); the next `matchmaker_tick` collects U with other entries and `create_match` runs again (the `making` count goes to 2, :953). A room member reaches the same path after `ROOM_LEAVE` of a `Matching` room whose party entry became a match or of a room whose `ROOM_START` passed member rating resolution. The `MATCH_REQUEST` processing order of a user outside a room (open-game-works-core/skills/server-core/modules/matchmaker.md:117-121) does not refuse a participant of a match being made, so the code equals the spec and the repair needs a spec change; the core agent report records/1793894953465-review-fix-mw3qqku1ab5cf0.md `## spec proposals` proposes it. The path existed before this range. Not reproduced

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D3 | fixed | none | The member who bound to its earlier match after the host check did so by `MATCH_REJOIN`. Now an `ok` `true` rejoin takes the member out of the room and the party entry out of the queue (server/core/matchmaker/realtime.ts:788-792), and a rejoin during the match creation of its party entry or `ROOM_START` is `ok` `false` without `handle_frame` (:781-786); a rejoin during member rating resolution before `making` is set leaves the room, which raises `generation` (:293) and makes `prepare_members` return `ROOM_BUSY` (:531, :534). Tests server/core/matchmaker/tests/rooms.test.ts:1105, :1128 follow the D3 frame order (`disconnected_member_back` :1057) and passed. The remaining way into a second match through a solo `MATCH_REQUEST` is a spec gap, written in `## out of scope` |
| D4 | fixed | none | `ROOM_START` of R2 with a member who is a seat of R1's match being made is now `ROOM_BUSY` by `making` (server/core/matchmaker/realtime.ts:579, :587), which covers the record save and `prepare_transport` (:953-962 around :982, :991). Test server/core/matchmaker/tests/rooms.test.ts:1078 runs the D4 order with the save held and passed |

## must fix

none

## unknown

- The D4 window during `prepare_transport` (fake `turn` timeout) was not reproduced; it is covered by reading: `making` is set for the whole `make_match` call (server/core/matchmaker/realtime.ts:953-962), and only the save wait is tested (server/core/matchmaker/tests/rooms.test.ts:1078).
- The new tests were not run against the code before the fix; R3-1 and R3-2 are `spec` findings, so step 5 restore was not required. The core agent report states they failed on that code.
- The out-of-scope solo `MATCH_REQUEST` path was not reproduced; it is judged by reading `solo_match_request` and `run_tick`.
- Whether client `RealtimeCore` sends `MATCH_REJOIN` or `MATCH_REQUEST` in these frame orders was not checked; the tests send raw frames.
- Only `server/core/matchmaker/tests/rooms.test.ts` was run (SQLite and PostgreSQL by `ogw core test`); the other matchmaker test files and the dependents were not run in this round.
