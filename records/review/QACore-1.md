# review QACore round 1

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

- Checked the QACore part of 04fd07a1..c80e3d35 (`client/godot/core/qa_core/dev/qa_builtins.gd`, `dev/qa_core.gd`, `dev/qa_query.gd`, the tests `test_commands.gd`, `test_setup.gd`, `test_memory_stats.gd`, `support/qa_test_case.gd`, the deleted `test_feedback_switch.gd`, `core-spec/QACore.json`, `settings/core-settings.json`, `settings/core-settings.schema.json` and the generated settings files) against `skills/client-core/modules/qa-core.md` after harness commit 182a362. The removed commands, the feedback switch, the reward window, `frame_step_fps` and `QACore.rewardPresentationWindowMs` are the parts that commit removed from the spec; `mark` and `_on_item_changes` still record the telemetry rows that `### telemetry` sets; `_ON`/`_OFF` are still used by `set_step_mode`; a grep of the checkout finds no remaining caller of the removed DEV operations outside `records/`. `ogw core test godot QACore` passed (its result was reused from a run on the same tree)
- The SoundCore, CameraCore, ScreenEffectCore, PoolCore, TweenCore and NetworkCore changes of the range are outside the QACore target and were read only where QACore called them
- Not run: the web (`--web`) run of the QACore tests and the core tests of the modules that depend on QACore
