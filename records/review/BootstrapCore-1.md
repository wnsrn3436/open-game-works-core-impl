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

- The commit range de482eec..9069447b changes no file under `client/godot/core/bootstrap_core/`. The changes it holds are in QACore (frame interval record, `set_feedback_off`, `set_reward_presentation_off`, settings keys `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs`), SoundCore, TweenCore, PoolCore, CameraCore and ScreenEffectCore (DEV skip switches), core settings and records. Checked against BootstrapCore: no BootstrapCore call site of those modules changed signature (BootstrapCore calls only `init`/`release` of QACore and `SoundCore.load_volume_settings`, which is unchanged); the new QACore settings keys have defaults in `client/godot/generated/core_settings.json`, which the QACore `init` of the boot in `client/godot/core/bootstrap_core/tests/test_boot_dev_modules.gd` reads, so adding QACore to the module list still `init`s; every new DEV switch is reset by the `release` of its module (`SoundCore._reset_state`, `TweenCore`, `PoolCore`, `CameraCore`, `ScreenEffectCore` release paths), so the reverse release of a restart, an update reboot and `shutdown` leaves no switch on in the next boot, as `client-core/modules/qa-core.md` asks for after `release`
- The BootstrapCore code and tests that the range does not reach were not reviewed again: with a commit range, only problems that the changes cause or reveal are in scope
- The core tests of BootstrapCore were not run in this review: the worktree has no `addons/` (GUT is put in by the harness tool), and no finding needed a run to check it
