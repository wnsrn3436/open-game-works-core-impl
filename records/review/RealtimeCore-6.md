# review RealtimeCore round 6

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R5-1 | open | Not fixed: `git diff ed3246b..1043cd2 -- client` is empty, so `client/godot/core/realtime_core/realtime_core.gd:513` still discards every remaining notification of the `poll` after a `leave_room`, whatever the `MatchState` is. `open-game-works-core/skills/client-core/modules/realtime-core.md:107` still says the same, and its last change (`80589eb`) is older than the round 5 review; input `## spec changes` is `none`. `records/1793746126381-review-fix-mw1a4p4c593217.md` left it as a spec proposal for the human. The three orders of round 5 were not run again, because the code and the spec they ran on are unchanged |
| R5-2 | open | Not fixed: the same empty client diff, and `git diff ed3246b..1043cd2 -- server/core/matchmaker/realtime.ts` is empty too. `realtime-core.md:184` still cancels only on a `Matching` that arrives in `None`, `client/godot/core/realtime_core/realtime_core.gd:1100` still handles room failed(`Match`) without calling transport `cancel_matching`, and `server/core/matchmaker/realtime.ts:571` still answers `ROOM_BUSY` while the room is `Matching`. The report left it as a spec proposal for the human. The notice order of round 5 was not run again, for the same reason |
| R5-3 | fixed | `server/core/matchmaker/tests/rooms.test.ts:570` now asserts the exact frame kinds `MATCH_FAILED`, `ROOM_STATE` for each room member, and `:571` that the `ROOM_STATE` is `Open`. The defect was restored in a temporary copy: `reopen()` at `server/core/matchmaker/realtime.ts:911` moved before the `match_failed` loop at `:910`. `ogw core test server matchmaker --file server/core/matchmaker/tests/rooms.test.ts` then failed in the test `match creation failure > sends each participant MATCH_FAILED CREATE_FAILED with an error log when the match record save fails, and a party room goes back to Open`, on both the sqlite and the postgresql run, with `expected [ 19, 6 ] to deeply equal [ 6, 19 ]`. The same command passes on this checkout without that change |

## out of scope

none

## debt

none

## must fix

none

## unknown

- R5-1 and R5-2 were judged from the empty diffs and the unchanged spec, not from a new run. The reproductions and the consequences marked "by reading the code" in `records/review/RealtimeCore-5.md` were not repeated
- `ogw core test godot RealtimeCore` printed `RealtimeCore pass` and `RealtimeCore pass (reused)`, so that result comes at least in part from a kept passing result and not from a new run in this round. The range changes no client file. `--web` was not run
- The core tests of the modules that `ogw core dependents matchmaker` lists were not run, and neither were the other server modules or test files of `matchmaker`, because the range changes one test in one file and no implementation
- No run used the client together with the real matchmaker server. The client effect that round 5 stated for R5-3, `Cancelled` instead of `Failed` when `Open` comes first, was not run
- The range changes only `server/core/matchmaker/tests/rooms.test.ts` and `records/`, so the whole `## test` of the spec was not matched to core tests. Read for this range: that test, its helpers `barrier` and `kinds`, `create_match` in `server/core/matchmaker/realtime.ts`, and the client code of R5-1 and R5-2
- The temporary copy was a detached git worktree in `worktrees/_core/`, because `ogw core test --file` accepts only a checkout under that folder. Its change was never committed, and it was removed afterwards
