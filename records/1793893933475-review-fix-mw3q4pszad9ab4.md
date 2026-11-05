# review fix matchmaker round 2

## done

- `matchmaker` (server): member rating resolution now detects every member change while it waits on a member's transaction, also a leave followed by a join of the same user that leaves the same member list, and reads each member's connection after that member's transaction. Commit 0522ca9.
- No engine-specific implementation rules document was given; `## <engine> build` of `tools/ogw.md` was not written.
- Last `ogw core test server matchmaker rating routing testing` (edited module and `ogw core dependents matchmaker` server side): pass on SQLite and PostgreSQL. `ogw code check core`: type check, lint, dependency, secret all pass.

## spec proposals

- R2-1 (`spec change: yes`, not fixed). matchmaker.md `### room` / `### match creation` does not settle what happens when a seat of a room or a party entry becomes bound to a match session (`p2p-signaling.is_bound`) after the host frame check, e.g. host `MATCH_REQUEST` passes, then a member `MATCH_REJOIN` of its earlier match is `ok` `true`, then the party entry becomes a match and `open_match_session` takes that member out of the running match. Recommendation: add to `### match creation` step 2 "before `open_match_session`, when the connection of a participant is bound to a match session, the match is not made: `MATCH_FAILED`(`CREATE_FAILED`) ... " or, closer to the existing rule, add to party handling "the `MATCH_REJOIN` of a member of a `Matching` room or of a participant of a match being made is answered with the `MATCH_REJOINED` of a rejoin condition violation", which reuses the existing rule for participants of a match being made (matchmaker.md last line of `### room`). The second keeps the running match intact and needs no new failure code. Evidence: review matchmaker-2 R2-1 and its D3 reproduction.
- R2-2 (`spec change: yes`, not fixed). `ROOM_BUSY` for "a participant of a match being made" is written only for the host `ROOM_START`/`MATCH_REQUEST` checks (matchmaker.md:147, party handling); `ROOM_LEAVE`, `ROOM_JOIN`, `ROOM_CREATE` and a solo `MATCH_REQUEST` of a user who is a seat of a match being made are not restricted, so that user can leave, join another room and be seated in a second match. Recommendation: state a user-scoped rule in `### room`: "`ROOM_JOIN`, `ROOM_CREATE` and `MATCH_REQUEST` of a participant of a match being made are `ROOM_BUSY` (a `MATCH_REQUEST` outside a room: `MATCH_FAILED`(`REJECTED`, `ROOM_BUSY`))", and extend "participant of a match being made" in `### match creation` to start at the start of member rating resolution of its room's `ROOM_START` (not when it ends), since the D4 path leaves during `results.create`/`prepare_transport` but the D5-type path leaves during resolution. Evidence: review matchmaker-2 R2-2 and its D4 reproduction.

## review

- R2-1: not fixed, `spec change` `yes` (proposal above).
- R2-2: not fixed, `spec change` `yes` (proposal above).
- R2-3: fixed.
  - server/core/matchmaker/realtime.ts:103 `Room.generation`, raised on every leave (realtime.ts:291, `leave_room`) and join (realtime.ts:700, `room_join`); `room_unchanged` compares the room, `Open` and the generation read when resolution started (realtime.ts:517), so a leave then join of the same user is a member change and gives `ROOM_FAILED`(`ROOM_BUSY`) to all members as matchmaker.md:138 says.
  - server/core/matchmaker/realtime.ts:531 `prepare_members` reads the member's `client` after that member's transaction instead of before it.
  - Tests in server/core/matchmaker/tests/rooms.test.ts: "sends every member ROOM_FAILED ROOM_BUSY when a member leaves and joins again while resolution waits on the first member's transaction, ..." (:427) and "sends every member ROOM_FAILED ROOM_BUSY when a member reconnects and joins again on the new connection while resolution waits on that member's transaction, and a later ROOM_START gives that new connection MATCH_FOUND" (:447). Both fail on the code before the fix (checked: no `ROOM_FAILED` was sent, on SQLite and PostgreSQL) and pass after it.

## unverified

- The re-read of the member connection after the await (realtime.ts:531) is not separately observable: with the generation check, any reconnection of a member during the wait closes the old connection, which leaves the room and raises the generation, so that case is already `ROOM_BUSY`. The second test covers the reconnect order end to end; no test fails on the re-read alone.
- Whether client `RealtimeCore` produces these frame orders was not checked.
