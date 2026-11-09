# review fix NetworkCore round 1

## done

- NetworkCore (Godot): core tests for the `release` of a NetworkCore that is not `init`, in `client/godot/core/network_core/tests/test_lifecycle.gd`. No implementation change
  - `test_release_before_the_first_init_deletes_the_set_transport`: `NetworkCoreDev.set_transport(t)` before the first `init`, `release`, then `NetworkCore._transport == null`; the following `init` uses the engine transport (`_active_transport` is not `t`, and is the HTTP transport, or the web transport on Web); no NetworkCore error or warn log
  - `test_release_after_release_deletes_the_set_transport_without_a_log`: the same after an `init` and `release` cycle, while LogCore is initialized, so a log from `release` would be collected
- Checked that the tests catch the defect: with `network_core.gd:147` (`_transport = null`) replaced by `pass`, both tests fail (`ogw core test godot NetworkCore --file .../test_lifecycle.gd`); with the line restored, they pass
- Last `ogw core test`: `godot` and `godot --web`, for NetworkCore and every module that `ogw core dependents NetworkCore` lists (AdCore AuthCore BadgeCore BootstrapCore ChatCore CutsceneCore GameUpdateCore NoticeCore PaymentCore PushCore QACore RealtimeCore RemoteConfigCore RequirementCore ShortcutCore TutorialCore UnitTestCore): all pass
- `ogw code check core`: type check, lint, dependency, secret pass
- No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written

## spec proposals

none

## review

- R1-1: fixed. Tests added in `client/godot/core/network_core/tests/test_lifecycle.gd` (`test_release_before_the_first_init_deletes_the_set_transport`, `test_release_after_release_deletes_the_set_transport_without_a_log`); they cover the behavior of `client/godot/core/network_core/network_core.gd:147`, which is not changed

## unverified

- The "no log" assert counts only NetworkCore `warn` and `error` logs: `UnitTestCore.check_logs` accepts only those levels, so an info log from `release` would not be detected
