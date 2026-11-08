# review matchmaker round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `drop` (server/core/matchmaker/realtime.ts:332) takes the `MATCH_LEAVE` frames that arrived before the close out of `client.pending` and, when there are any, runs them on `client.chain` after the frame being handled, each through `forward`, and only then `connection_close` (queue and room removal, `p2p-signaling.connection_closed`, realtime.ts:367). `client.closed` is still set at the close, so the frame being handled sees the close (`live`, realtime.ts:479). `hello` (realtime.ts:440) awaits the close handling of the replaced connection before `HELLO_ACK`, as matchmaker.md:116 requires. Tests: server/core/matchmaker/tests/forfeit.test.ts:604 now checks that, while the `prepare_match_request` transaction is held, there is no `PEER_LEFT` and `left_at` of index 1 is 0, and after `held.open()` that `left_at` is written, `disconnected_at` is 0 and `PEER_LEFT` arrives. forfeit.test.ts:628 checks that `HELLO_ACK` of a new connection waits for that `MATCH_LEAVE`. Checked in a temporary `git worktree add` copy of HEAD: with realtime.ts of 477d25af restored, both tests fail on SQLite and PostgreSQL (`expected [ 12 ] to not include 12`: `PEER_LEFT` during the hold). With only the `HELLO` wait removed (close the previous connection and delete its slot without awaiting the close handling), forfeit.test.ts:628 fails on both (`expected true to be false`: `HELLO_ACK` during the hold). On HEAD, `ogw core test server matchmaker --file server/core/matchmaker/tests/forfeit.test.ts` passes |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Ran only server/core/matchmaker/tests/forfeit.test.ts (on HEAD and on the two restored copies). Did not run the other matchmaker test files or the server core tests of the modules that depend on matchmaker; the core agent report says `ogw core test server matchmaker rating routing testing` passed on 89e01892
- Did not review the changes of the range outside the target (server/core/ranking/tests/withdrawal.test.ts, server/core/routing/tests/process_support.ts, server/core/routing/tests/server-process.test.ts and the records of other reviews)
- When the host's `ROOM_START` or `MATCH_REQUEST` is in member rating resolution and its connection closes with a `MATCH_LEAVE` waiting, the close handling (room removal) now comes after that resolution, so the remaining members get no `ROOM_FAILED`(`ROOM_BUSY`) and only the later `ROOM_STATE`; with no `MATCH_LEAVE` waiting they get `ROOM_FAILED`(`ROOM_BUSY`). matchmaker.md:118 and :122 do not settle which parts of a connection close wait behind the frame being handled, so this is not written as a finding. The core agent report proposes a spec sentence for it
- While a `HELLO` waits for the deferred close of the replaced connection, the new connection is still unauthenticated, so frames it sends during that wait count against `matchmaker.preAuthFramesPerSecond`, and a wait longer than `matchmaker.helloTimeoutMs` closes it with `hello_timeout`. matchmaker.md:249-250 count until authentication, so this matches the text; no test covers a wait of that length
- forfeit.test.ts:628 relies on the `MATCH_LEAVE` frame reaching the server before the `HELLO` of the new connection on another socket (stated in the core agent report). It did not fail in the runs above
