# review RealtimeCore round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | client/godot/core/realtime_core/realtime_core.gd:617 | Input debt D6, still present (the commit range is empty, the code is the same as when D6 was written). In `_on_match_found`, a non-host member of a room in `None` (`member_start`, :605) calls `_begin_match` (:614), which does not change `_state`, then `_publish_room_match_started()` (:617) while `_state` is still `None`; `_enter_connecting` (:628, `_set_state(CONNECTING)` at :824) runs only after. open-game-works-core/skills/client-core/modules/realtime-core.md:272 defines `RoomMatchStartedEvent` as "when a non-host member became `Matching` or `Connecting`". Run path: host `start_room` → `ROOM_START` leaves the room `Open` (realtime-core.md:185), so a non-host member receives match found in `None`; a `RoomMatchStartedEvent` subscriber reads `match_state()` (:313) `None`, its `wait_match` returns `Failed` with the warn `wait_match: the match is not Matching or Connecting` (:441), and its `leave` only logs `leave: no match` (:284), so it can neither wait for nor leave the match it was told about | Publish `RoomMatchStartedEvent` of a match found in `None` after `_enter_connecting` (in `Connecting`), and keep the `_change_count` check after the publish so that a subscriber that left or released stops the rest of the handling | no | 90 |
| R3-2 | correctness | medium | client/godot/core/realtime_core/realtime_core.gd:1190 | Input debt D7, still present. `_leave_room_now` (:1170) and `_on_room_kicked` (:1154) publish `RoomChangedEvent` (:1181, :1165) and then call `_cancel_room_matching` (:1182, :1166), which checks `_state` only after the publish (:1187). Run path: member in a room with `MatchState` `None`; a `RoomChangedEvent` subscriber calls `join_match` on `Left` or `Kicked`. `_room` is already null, so `join_match` takes origin `SOLO`, calls `_begin_match`, `_set_state(MATCHING)` (:226) and awaits `AuthCore.get_access_token` (:227). Back in `_cancel_room_matching`, `_state` is `Matching`, so it calls `_transport.close()` (:1190), `_set_none()` and `_finish(waiter, CANCELLED)`; when the token arrives `waiter.done` is true (:230), so `join_match` returns `Cancelled` and `start_matching` is never called. open-game-works-core/skills/client-core/modules/realtime-core.md:178 and :179 cancel only the `Matching` of the room that was left | Capture before publishing whether `MatchState` was `Matching` (and its waiter or `_change_count`), and cancel only that `Matching`; a `Matching` a subscriber started after the publish is left running | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D6 | open | R3-1 | `_publish_room_match_started()` is still called at client/godot/core/realtime_core/realtime_core.gd:617 before `_enter_connecting` (:628) for a match found in `None`; see R3-1 |
| D7 | open | R3-2 | `_leave_room_now` (:1182) and `_on_room_kicked` (:1166) still call `_cancel_room_matching` after publishing `RoomChangedEvent`, and it checks `_state` at :1187 after the publish; see R3-2 |

## must fix

none

## unknown

- The commit range is empty (d409a23..d409a23), so the review covered only the input debt items and the previous round; the rest of RealtimeCore was not reviewed again in this round.
- Round 2 had no findings and no `open` rows, so `## previous` is `none`.
- R3-1 and R3-2 were decided by reading the unchanged code along the run paths written in D6 and D7; the reproducing runs on the fake and P2P transports described in those debt items were not run again in this round.
