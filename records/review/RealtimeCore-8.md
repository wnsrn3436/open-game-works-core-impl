# review RealtimeCore round 8

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R7-1 | fixed | `open-game-works-core/skills/client-core/modules/realtime-core.md:107` now discards the remaining room updated, room failed and room kicked after any `leave_room` inside `poll`. `client/godot/core/realtime_core/realtime_core.gd:519` does that through `_room_leave_count`, raised at `:400` and `:1155` in every state. Orders (a) and (b) of round 7 are `client/godot/core/realtime_core/tests/test_room.gd:546` and `:581`, and `:604` holds room failed and room kicked. They pass in a new `--file` run of `test_room.gd` in a temporary copy of `0fc9d65`. With `realtime_core.gd` of `c1309dc~1` restored in that copy, all three fail: `create_room` done at once for (a) and (b), one warn log for room failed. The fix keeps matchmaker lost as `realtime-core.md:107` states; what that does to a new `create_room` is in `## out of scope` |
| R7-2 | fixed | `realtime-core.md:184` now states the cancel for `Start`, and `realtime_core.gd:1128` calls transport `cancel_matching` before `_fail_match` for both `Start` and `Match`. `test_room.gd:671` holds the notice order of round 7 and the exact calls `cancel_matching()`, `close()`. It passes in the same run and fails with the restored `realtime_core.gd` (`close()` only). `test_room.gd:863` holds that another `Start` failure does not cancel. `ROOM_BUSY` with no entry is harmless: `server/core/matchmaker/realtime.ts:523` also sends it on a member change and `:625` then ignores the cancel. This was read, not run |

## out of scope

- client/godot/core/realtime_core/realtime_core.gd:930: medium A matchmaker lost of the earlier connection ends a `create_room` that already opened a new connection, and nothing closes that connection, so the server keeps a room the client does not know. Reproduced with `RealtimeCore`, `p2p_realtime_transport.gd` and the test matchmaker: a solo `join_match` receives `MATCH_FAILED` and `CLOSE`(`MAINTENANCE`) in one `poll`, and its continuation calls `create_room`. `ROOM_CREATE` goes out on a second connection (accepted 2, closed 1), and `create_room` ends with `ok` `false` and code 3. The next `ROOM_STATE` is discarded and `room_info` stays empty. `leave_room` sends no `ROOM_LEAVE`, and a second `create_room` reuses that connection (`p2p_realtime_transport.gd:183`) and ends `false` on the `ROOM_BUSY` the probe sent. The real server's `ROOM_BUSY` was read at `server/core/matchmaker/realtime.ts:630`, not run. The whole run gives the same values with `realtime_core.gd` of `61bfa19`, so this range did not cause it; `test_room.gd:546` now holds the part in `RealtimeCore`. It answers the question in `## unverified` of `records/1793747414075-update-core-mw1awapne9bcf2.md`. The server stuck state needs a close code that still admits the new connection, such as `RATE_LIMITED` at `realtime.ts:795`, because `MAINTENANCE` and `BANNED` are refused at `HELLO` (`realtime.ts:399`, `:403`). It also needs the `CLOSE` frame read in the same `poll` as the earlier notice and a `create_room` or `join_room` called inside that `poll`

## debt

none

## must fix

none

## unknown

- `ogw core test godot RealtimeCore` on this checkout printed `RealtimeCore pass` twice, and that result may be a kept passing result. `test_room.gd` was also run new with `--file` in the temporary copy and passed. `--web` and the modules that depend on the target were not run. `records/1793747414075-update-core-mw1awapne9bcf2.md` reports `--web` passing for `RealtimeCore`, `BootstrapCore`, `QACore`, `UnitTestCore`, and native passing except `QACore`, whose render pass was skipped on a locked screen
- The probe of `## out of scope` sent the `CLOSE` frame without closing the connection, so that both frames were read in one `poll`. The real server closes right after `CLOSE` (`server/core/matchmaker/realtime.ts:233`). In the run that closed at once, the socket was already closed with 0 packets buffered, and `MATCH_FAILED` and `CLOSE` were not read, so there was no stale notice. How often the frames and the close land in different `poll` calls on a real network was not measured
- The probe ran the solo order only. Order (a) with matchmaker lost was run with the recording transport (`test_room.gd:546`). The P2P result for that order comes from reading `p2p_realtime_transport.gd:122` and `:183`, because it needs a `Playing` match over WebRTC
- The probes reported a `test time limit 30000 ms passed` in the runs where `leave_room` sent `ROOM_LEAVE` and closed the connection. The cause was not looked for: those runs did not reach the state in `## out of scope`, and the later run that did had no such report
- No run used the client together with the real matchmaker server. The server's answer to `MATCH_CANCEL` after `ROOM_BUSY` of `ROOM_START` was read at `server/core/matchmaker/realtime.ts:625`, not run
- A `leave_room` that only leaves a warn log (no room and no wait) discards nothing. `realtime-core.md:107` read word for word says any `leave_room` inside `poll` does, while `realtime-core.md:176` says "only leaves a warn log" and the reason at `:107` is "the room that was left". Run in `Playing` with room failed after it: 2 warn logs, the second for room failed. Not a finding: I read `:176` as deciding it, and the only difference found is that log. No test holds it
- Only the `## test` items changed in the spec diff, `realtime-core.md:392` and `:393`, were matched to core tests. The transports were read only for `close`, `leave_room`, `cancel_matching`, `open_room` and the matchmaker connection frames
- The temporary copy was a detached git worktree in `worktrees/_core/`, because `ogw core test --file` accepts only a checkout under that folder. Its probe test and its restored `realtime_core.gd` were never committed. A first `git worktree add` with a relative path also made a copy inside this checkout. Both copies were removed, and `git status` of this checkout was clean before this file was written
