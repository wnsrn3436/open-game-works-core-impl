# review BootstrapCore round 1

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

- Scope of this round: the commit range `6786a7f..fa3bba2` changes no file under `client/godot/core/bootstrap_core/` and no file under `core-spec/`. Under `client/` it changes only `client/godot/core/realtime_core/` (`p2p_peer.gd`, `p2p_realtime_transport.gd`, `realtime_core.gd` and four test files). Outside the server and records it also changes `settings/core-settings.schema.json`. Input `## spec changes` is `none`.
- Checked at the boundary between BootstrapCore and the changed code, with no problem found:
  - `P2pRealtimeTransport._init(server_url, app_version, relay_only)` (`client/godot/core/realtime_core/p2p_realtime_transport.gd:61`) did not change in the range, so the call at `client/godot/core/bootstrap_core/bootstrap_core.gd:908` still matches it.
  - The range adds calls from `RealtimeCore` to `close`, `leave_room` and `cancel_matching` on the transport. The wrappers that BootstrapCore puts around the P2P transport in a dev run and a DEV build (`client/godot/core/bootstrap_core/dev/bootstrap_core_dev.gd:146`) forward all three (`client/godot/core/realtime_core/dev/lockstep_realtime_transport.gd:52`, `:85`, `:117`; `client/godot/core/realtime_core/dev/sim_realtime_transport.gd:33`, `:73`, `:100`).
  - `RealtimeCore.set_transport` and `release` did not change in the range, and neither did `_teardown`, which `release` calls, so the transport handling of restart, update reboot and app exit is the same as before the range.
  - None of the settings keys whose `minimum` the range raises is named under `client/godot/core/bootstrap_core/`, and `BootstrapCore.realtimeRelayOnly` is not among them.
- Tests not run: no BootstrapCore test or other core test was run in this round. The range does not change the target and there was no finding to check. `ogw core test` also runs `ogw core spec` when it starts, and this review writes no file other than its output. So this review gives no test result for BootstrapCore on the code at `fa3bba2`.
- The range changes to `RealtimeCore` were read only for what reaches BootstrapCore. Their correctness inside `RealtimeCore` was not judged, because `RealtimeCore` is its own review target.
- Read outside the range, for possible `## out of scope` lines: all of `client/godot/core/bootstrap_core/bootstrap_core.gd`, `bootstrap_core_node.gd`, `bootstrap_dev_hooks.gd`, `build_info.gd`, `content_entry.gd`, `core_module_entry.gd`, `update_set.gd`, `dev/bootstrap_core_dev.gd` and `dev/boot_test_replacements.gd`, compared with `bootstrap-core.md`. This produced no line at severity `medium` or higher with confidence 80 or more. It was a reading only, and no behavior was reproduced by running it.
- Test files only partly read: under `client/godot/core/bootstrap_core/tests/`, this review read the test names of `test_boot_restart.gd` and `test_boot_exit.gd`, and the lines of `test_boot_dev_run.gd` about adapters. The other test files were only searched by keyword. The `test evidence` aspect and the mapping of each `## test` item of the spec to a test were not checked outside the known debt items.
- Defining documents only partly read: `skills/client-core/engines/godot.md` was read for lines 1 to 280 and searched by keyword for the rest. `skills/core/command.md` was searched by keyword. `auth-core.md`, `push-core.md`, `payment-core.md`, `ad-core.md` and `event-core.md` were read only at their adapter selection rules or boot events. `log-core.md`, `time-core.md`, `local-data-core.md`, `data-core.md`, `localization-core.md`, `resource-core.md`, `sound-core.md`, `network-core.md`, `resolution-core.md`, `input-core.md`, `input-block-core.md`, `ui-core.md`, `message-core.md`, `scene-core.md` and `game-update-core.md` were not read, so the calls from BootstrapCore into those modules were not compared with their specs. None of those modules changed in the range.
- Not judged: the four items of `records/review-debt/BootstrapCore.json` (D2, D3, D4, D5). Input `## debt` is `none`, so this review does not have them in scope. Their code did not change in the range, so this review gives no evidence that they are fixed. The code that D2 and D5 point to is still there (`client/godot/core/bootstrap_core/bootstrap_core.gd:161`, `:449`).
