# review: MessageCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/message_core/message_core.gd:457: medium `prepare` is `false` with no log for a tween preset with a negative repeat count. `_load_preset` returns `_cycle_ms(definition) * definition.repeat_count`, so a preset with one 100 ms change and `repeat_count = -1` gives -100. `client/godot/core/message_core/message_core.gd:393` reads every negative length as "already logged" and returns `false`, but on this path neither `MessageCore` nor `ResourceCore.load` writes a log, because the repeat count check of `TweenCore` (`client/godot/core/tween_core/tween_core.gd:875`) runs only at playback. The `prepare` failure conditions of `open-game-works-core/skills/client-core/modules/message-core.md` (`## error`, first row) are a preset that cannot be loaded or repeats infinitely, and each has a log. A negative change delay or duration reaches the same path. A boot that uses such a preset fails in the `Prepare` stage with no cause in the log.
- client/godot/core/message_core/message_core.gd:114: medium `release` during a `prepare` in progress has no test. `open-game-works-core/skills/core/SKILL.md:90` says that `release` stops the async operations in progress and that a stopped operation returns a failure value. No test under `client/godot/core/message_core/tests/` calls `MessageCore.release` while a `prepare` waits: the calls at `test_lifecycle.gd:10`, `test_lifecycle.gd:23`, `test_lifecycle.gd:70` and `test_input.gd:84` all run with no `prepare` pending. Removing the session checks at `message_core.gd:114`, `message_core.gd:379`, `message_core.gd:384`, `message_core.gd:422` or `message_core.gd:448` is not exercised by any assert, although without them the resumed `_load_all` reads `_toast` after `_reset_state` set it to `null`.
- client/godot/core/message_core/message_core.gd:542: medium "The wording appears in the center of the visible game area" (`open-game-works-core/skills/client-core/modules/message-core.md`, `### resource`) has no test for the toast made by code. `client/godot/core/message_core/tests/test_view.gd:47` checks the center only for the label of the black box, and `test_view.gd:61` reads only the band's style. Changing `band.anchor_top` and `band.anchor_bottom` at this position to 0 is not exercised by any assert, so the toast made by code could leave the center with every test passing.

## debt

none

## must fix

none

## unknown

- The range `f3ac5b0..6d11fa6` changes only `client/godot/core/localization_core/localization_core.gd` (`_restore_heading_types`), `client/godot/core/localization_core/tests/test_font_weight.gd` and records. No file under `client/godot/core/message_core/` is in the range. The reach into this target was checked by reading: `MessageCore` calls only `LocalizationCore.get_text` and `LocalizationCore.format`, and its code made labels use the `Label` type with no type variation, so the heading types that `_restore_heading_types` handles are not on their path.
- A toast or black box prefab of a game whose label uses a style based on a heading type was not run. The test prefabs do not set one. `client/godot/core/localization_core/tests/test_font_weight.gd` tests styles based on heading types on the `LocalizationCore` side.
- `ogw core test godot MessageCore` passes on this checkout (job `mw0uj3qy2df507`). The browser run (`--web`) was not run in this review. The modules that depend on `MessageCore` were not run, because the range does not change `MessageCore`.
- The three `## out of scope` items were found by reading and `grep`. They were not reproduced by a run, and no mutation was run, so the negative repeat count result and the "not exercised" statements come from reading the code and the tests.
- The behavior of code outside this module was read only as far as the specs and call sites of `TweenCore`, `PoolCore`, `InputBlockCore`, `LocalizationCore`, `TimeCore` and `UICore` that `MessageCore` uses. Their tests were not read. `LogCore`, `ResourceCore` and `ResolutionCore` were read only at the operations that `MessageCore` calls, and their spec files were not read in full.
- The order in which `BootstrapCore` calls `MessageCore.close_all`, `release` and `prepare` at restart and update reboot, and the callers in `SceneCore`, `NetworkCore`, `AuthCore` and `ShortcutCore`, were checked only at their call lines.
