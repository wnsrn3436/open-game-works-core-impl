# MessageCore review round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/time_core/dev/time_core_dev.gd:124: medium the DEV operation is named `set_test_frame_step`, while the TimeCore spec names it `set_frame_step` with caller `BootstrapCore` (skills/client-core/modules/time-core.md:169, :174). No non-test code calls it (`grep -rn set_test_frame_step client/godot` outside `tests/` finds only its definition and a comment at time_core.gd:85), so the runner's fps never reaches TimeCore through the path the spec sets
- client/godot/core/time_core/time_core.gd:114: medium `init` in a build with DEV code turns on a frame step on its own from the `--fixed-fps` engine argument or from the Movie Maker fps (`_engine_frame_step_fps`) when `set_test_frame_step` was not called. The TimeCore spec says TimeCore is at a frame step only when `set_frame_step`(f) was called before `init` (time-core.md:174), so a DEV run started with `--fixed-fps` gets stepped real elapsed time that the spec does not allow, and `get_frame_step_fps` is not 0 without a `set_frame_step` call (time-core.md:177, :217)

## debt

none

## must fix

none

## unknown

- MessageCore code and tests (client/godot/core/message_core/) did not change in the commit range. What I checked: the dependency changes in the range. LogCore (log_core.gd) changed only in comments. The TimeCore frame step and `make_random_seed` change real elapsed time only under a DEV frame step. MessageCore's hold (message_core.gd:281, :292) and the TweenCore tween clock (tween_core.gd:645, :1299) both read `TimeCore.get_real_time`, so the display duration and tweens still advance on the same real elapsed time. The generated core settings changed no MessageCore, UICore, InputBlockCore, TweenCore, PoolCore, ResourceCore, LocalizationCore or ResolutionCore key. `ogw core test godot MessageCore` passed (job mw7tto5i07480d)
- I did not run MessageCore at a real frame step (an engine started with `--fixed-fps` or Movie Maker). No MessageCore test covers that mode
- InputCore, QACore, RealtimeCore, AuthCore, SoundCore, CameraCore and AccessibilityCore changes in the range are not dependencies of MessageCore and were not reviewed
