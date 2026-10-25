# review fix RequirementCore round 1

## done

- RequirementCore (Godot): `init` now fills `_logged_types` with `false` for every `GameData.RequirementType` value. `_self_judge` checks the stored value instead of `has`, and only changes a key that is already there. So the first self judgement of a type with no judge hook no longer adds a `Dictionary` key in frame code
- No per-engine rules documents were written

## spec proposals

none

## review

- R1-1: fixed. `client/godot/core/requirement_core/requirement_core.gd:114` fills `_logged_types` in `init`. `requirement_core.gd:386`–`389` tests the value with `get(type, false)` and writes `true` only when the key is there. A type value that is not a `RequirementType` element is never added, so it logs on each judgement. The data tool's enum check keeps such a value out of `type`, so the guard only stops a key add in frame code. The log message is still built only on the path that writes the log.
  - Added test `client/godot/core/requirement_core/tests/test_error.gd:37` `test_a_type_without_a_judge_hook_first_judged_in_frame_code_logs_once_without_adding_a_key` follows the review's run path:
    - `FlagA` has a hook and `FlagB` has none. A `watch` of `ALL_1` (`FlagA & FlagB & FlagC`) stops at the failed `FlagA` item.
    - Then a `TutorialProgressUserState` delta and a content-event trigger make the next frame's batch evaluation judge `FlagB` for the first time.
    - The test asserts one error log, a `_logged_types` size that does not change across the frame, the `FlagB` flag set, and no second log on a later trigger. It also asserts that `init` put every `RequirementType` value with `false`.
  - Reproduced before the fix: the same test file run against the HEAD `requirement_core.gd` failed with `[1] expected to equal [0]: the frame code adds no key` (size 0 → 1 in the frame), plus the init-fill asserts. With the fix it passes.
  - `client/godot/core/requirement_core/tests/test_watch.gd:546` adds `_logged_types.size()` to `_collection_sizes`, which the frame-code collection size tests compare across a frame.
  - `test_lifecycle.gd:70` (`_logged_types.size()` is 0 after `release`) needs no change, because `_reset` still sets `_logged_types = {}`. It passes.
- D4, D5 (debt for R1-1): fixed by the R1-1 fix

## unverified

- `ogw core test godot RequirementCore BadgeCore BootstrapCore ChatCore CutsceneCore NoticeCore QACore ShortcutCore TutorialCore UnitTestCore` (native): every module passed except QACore. QACore showed `skipped` because its render pass did not run ("render pass not run: the macOS screen is locked or the display sleeps"), so the native QACore render tests were not run in this job. The `--web` run of the same modules passed every module, including QACore
- `ogw code check core`: type check, lint, dependency and secret all pass
