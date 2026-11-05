# review UnitTestCore round 7

## findings

none

## previous

none (the round 6 review has no findings and no open rows)

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range changes no file under `client/godot/core/unit_test_core/`. The review covered the dependency code the range changed and UnitTestCore calls or extends: `client/godot/core/input_core/input_core.gd` (only a comment of `_on_emulated_mouse` changed; `tap` at `client/godot/core/unit_test_core/dev/unit_test_core.gd:1267` injects `InputEventMouseButton`, not touch, so the new rule on mouse input made from touch does not reach it), `client/godot/core/realtime_core/p2p_peer.gd` and `p2p_realtime_transport.gd` (internal P2P transport changes; the `RealtimeDevTransport` base that `client/godot/core/unit_test_core/dev/unit_test_realtime_transport.gd:2` extends did not change), and `client/godot/core/ui_core/ui_core.gd` (no change to `get_anchor_rect` or `AnchorResult`, which `tap_anchor` uses). `TimeCore`, `LogCore`, `NetworkCore`, `EventCore`, `UtilCore` and `BootstrapCore` have no changes in the range
- The spec changes diff does not change `unit-test-core.md`; its hunks in `godot.md`, `input-core.md`, `realtime-core.md`, `ui-core.md`, `core/SKILL.md` and `core/command.md` were read, and none changes a definition that UnitTestCore code reaches
- `ogw core test godot UnitTestCore` was run on the range head `7e1848a` and gave `UnitTestCore pass`. `--web` was not run separately
- Changes in the range outside UnitTestCore and its dependency code it reaches (other client modules, `server/`, `tools/`, `test-data/`, `records/`) were not reviewed
