# review RealtimeCore round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Checked the RealtimeCore changes of commit 189e4830 in the range: the forfeit flag of transport `close` (`client/godot/core/realtime_core/realtime_transport.gd`, `p2p_realtime_transport.gd`, `realtime_core.gd`, `dev/lockstep_realtime_transport.gd`, `dev/sim_realtime_transport.gd`, `client/godot/core/unit_test_core/dev/unit_test_realtime_transport.gd`), `HELLO` `platform` from `CoreBuildInfo.platform`, and their tests. Every `close` call of `realtime_core.gd` passes `true` only from `_end_match_now` with `Left` or `BackgroundTimeout` (`realtime_core.gd:766`), and the transport's own `MATCH_LEAVE`s pass `false` (`p2p_realtime_transport.gd:328`, `p2p_realtime_transport.gd:331`), matching `### transport` and `### P2P transport` of the spec. `ogw core test godot RealtimeCore UnitTestCore` passed on this checkout
- Server handling of `forfeit` in `matchmaker` and `p2p-signaling` was not checked: those are server modules outside this target
- Whether the server applies a `MATCH_LEAVE` queued behind a `MATCH_REJOIN` on a rejoin connection whose `MATCH_REJOINED` has not arrived yet was not checked against a real server: it depends on the frame order handling of `matchmaker` (server module outside this target), and the fake WebSocket server in the tests does not judge forfeits
- The web export (`--web`) run of the tests was not run
