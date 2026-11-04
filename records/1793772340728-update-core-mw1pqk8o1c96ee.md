## done

- Module `matchmaker` (`server/core/matchmaker/realtime.ts`): a `Room` has a mark `making_match`, set by `ROOM_START` before member rating resolution and cleared in a `finally` after `create_match`, so every way out clears it, a throw too. A host change does not clear it. `host_error`, which `ROOM_START` and host `MATCH_REQUEST` share, answers `ROOM_BUSY` while it is set.
- Reproduced before the change, on SQLite and PostgreSQL, in `server/core/matchmaker/tests/rooms.test.ts`, with the input's scenario (`ROOM4` room A, B, C, fake `turn` failure `timeout`, `p2p-signaling.turnTimeoutMs` 1500, A `ROOM_START`, wait for the `issue_relays` call, close A's socket, B `ROOM_START`): member C got two `MATCH_FOUND` (`expected 2 to be 1`). The first version of the test asserted B's `ROOM_FAILED` first and failed on it (`expected [] to deeply equal [ [ 91, 18 ] ]`). The same scenario with a new host `MATCH_REQUEST` in a `BOTH` room got no `ROOM_FAILED` (`expected [] to deeply equal [ [ 91, 4 ] ]`). After the change both pass.
- Tests added in `describe('a match being made')`: new host `ROOM_START` is `ROOM_BUSY` and each member gets one `MATCH_FOUND` (the `## test` item of the spec); new host `MATCH_REQUEST` is `ROOM_BUSY` with no party entry; `ROOM_START` goes on again after the match was made and its members left it, after member rating resolution failed, after the match record save failed, and after `open_match_session` threw. With the clear moved to the normal end of the `try`, the tests for failed resolution and for the throw failed, and four existing member rating resolution tests failed too.
- `ogw core test server matchmaker p2p-signaling`: exit 0, both modules pass on SQLite and PostgreSQL. `ogw code check core`: type check, lint, dependency and secret pass.
- No engine-specific implementation rules document and no `## <engine> build` of `tools/ogw.md` were written.

## spec proposals

none

## review

none

## unverified

- The last `ogw core test` ran `matchmaker` and `p2p-signaling`, the range the input set. The other dependents that `ogw core dependents matchmaker` lists (server `rating`, `routing`, `testing`; client `BootstrapCore`, `QACore`, `RealtimeCore`, `UnitTestCore`) were not run. The change is inside `matchmaker` and adds no public API.
- The exit of `room_start` where `live(client)` is null right after a successful member rating resolution has no test of its own. It goes through the same `finally`.
