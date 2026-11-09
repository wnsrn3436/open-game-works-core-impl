# review UICore round 1

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

- The commit range 625ae189..edae04df changes no file under `client/godot/core/ui_core/` and no file of the modules UICore depends on (`LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `ResourceCore`, `PoolCore`, `SoundCore`, `LocalizationCore`, `ResolutionCore`, `SafeAreaCore`, `InputCore`, `InputBlockCore`, `TweenCore`), and `## spec changes` is `none`. The client changes of the range are in `AdCore`, `AuthCore`, `BootstrapCore`, `DataCore`, `GameUpdateCore`, `NativeUICore`, `NetworkCore`, `NoticeCore`, `PaymentCore`, `PushCore`, `QACore`, `RealtimeCore` and `UnitTestCore`; the other changes are server core, `core-spec/storage.json`, the `admin-api.maxSearchRows` minimum of the core settings schema and review records
- The one change of the range that reaches UICore: DEV `shutdown` of `BootstrapCore` now calls `release` of every lifecycle module, also of a module that is not initialized (`client/godot/core/bootstrap_core/bootstrap_core.gd` `_release_entry`). `UICore.release` of a module that is not initialized returns at once (`client/godot/core/ui_core/ui_core.gd:221`): it calls no other module and leaves no log. UICore has no operation the spec says is called before `init` and its one DEV operation `UICoreDev.set_test_focus` fails before `init`, so it keeps no value set before `init`; `_licenses_path`, which the core tests set, is set only after `init` (`client/godot/core/ui_core/tests/test_licenses.gd:37`) and reset by `_reset_statics`. This matches `## lifecycle` of `skills/core/SKILL.md`
- `ogw core test godot UICore` passed on this checkout (job mw8lkcgwc6a9f6). No test record was written because the checkout had an uncommitted change (the deleted earlier review file)
- The other UICore code was not reviewed again, because it is outside the changes of the range
