# review RealtimeCore round 1

## findings

none. The commit range changes no file under `client/godot/core/realtime_core/` and does not change `core-spec/RealtimeCore.json`, and input `## spec changes` is `none`. The changes of the range that touch what RealtimeCore uses cause or reveal no problem in the target: `matchmaker.roomCodeMaxPicks` (`server/core/matchmaker/realtime.ts:295`) replaces a constant with the same default 100, and `ROOM_BUSY` of `ROOM_CREATE` stays room failed of `Open`; no key of `_SETTING_KEYS` changed in `client/godot/generated/core_settings.json`; the changed lines of `client/godot/core/qa_core/dev/qa_core.gd` and `client/godot/core/bootstrap_core/tests/` do not call RealtimeCore; `proto/` has no change. `ogw core test godot RealtimeCore` passed on this commit

## previous

none

## out of scope

- client/godot/core/realtime_core/realtime_core.gd:1050: high The pending `join_match` of a room host never ends after a member leaves or is kicked while the room is `Matching`. Server `leave_room` removes the party entry and sends `ROOM_STATE`(`Open`) (`server/core/matchmaker/realtime.ts:283`, `open-game-works-core/skills/server-core/modules/matchmaker.md` row `ROOM_LEAVE`, and `ROOM_KICK` is handled the same), so no `MATCH_FOUND` or `MATCH_FAILED` follows. `_on_room_updated` handles `Open` in `Matching` only when `_origin` is `ROOM_MEMBER`, and `Matching` has no time limit, so with `_origin` `ROOM_HOST` the state stays `Matching` until `leave` or the background time limit, and a further `join_match` fails with a warn log. Run path: host `create_room`, a member joins, host `join_match`, the member calls `leave_room`, the host receives room updated with `Open`. `open-game-works-core/skills/client-core/modules/realtime-core.md:183` defines this handling only for a non-host member, so the fix needs a spec change, and no test in `client/godot/core/realtime_core/tests/test_room.gd` pushes `Open` to a host in `Matching`
- client/godot/core/realtime_core/p2p_realtime_transport.gd:485: medium A P2P connection that became lost outside `_PEER.poll` raises no peer lost, which differs from `open-game-works-core/skills/client-core/modules/realtime-core.md:97` (`connect_peer` failed). `_start_peer` (line 441) and `_PEER.apply` (`client/godot/core/realtime_core/p2p_peer.gd:70`, `set_remote_description` not `OK`) set `Status.LOST` before `_poll_peer` reads `before`, so `peer.status != before` is false in every later poll, and the object stays in `_peers`. In `Connecting` there is no retry and the match fails at the connect time limit. When an offer with a larger number whose SDP is refused replaces a connected connection, the participant stays `Connected` with no reconnection or `PeerLeftEvent`, and each `send` to that participant is `false` without log
- client/godot/core/realtime_core/p2p_realtime_transport.gd:569: medium No time limit covers a connection that replaces a connected connection. After `PEER_REJOINED`, the offering side drops the connected connection and starts a new one with `replaces_connected`, and the participant stays `Connected` as `open-game-works-core/skills/client-core/modules/realtime-core.md:126` and `:129` require. `_check_time_limits` (`client/godot/core/realtime_core/realtime_core.gd:524`) measures only `Connecting` and `Disconnected`, and server `PEER_LEFT` does not change participant state. Run path: index 1 rejoins and ends before it answers the new offer; index 0 then has `peer_state`(1) `Connected`, each `send` to it is `false`, and no `PeerDisconnectedEvent` or `PeerLeftEvent` comes unless WebRTC itself reports a failure. The duration is not set by the spec, so the fix needs a spec change

## debt

none

## must fix

none

## unknown

- `ogw core test godot --web RealtimeCore` was not run. Only the native run was
- The three `## out of scope` problems were checked by reading the code paths and the test files, and were not run: a test run needs the test host and run config that `ogw core test` makes, and this review does not add a test to the checkout. The third also assumes that a WebRTC connection with no remote description does not report `STATE_FAILED`, which was not checked on the engine plugin
- `client/godot/core/realtime_core/dev/lockstep_realtime_transport.gd` and `dev/sim_realtime_transport.gd` were read without being compared line by line with `### lockstep transport` and `## DEV`, because the range does not change them
- Each item of `## test` of the spec was not matched to a core test, because the range changes neither the spec nor the tests of the target
- The server matchmaker tests of the range were not run here: `records/review/matchmaker-2.md` is the review of that target
