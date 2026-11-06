# review QACore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/qa_core/dev/qa_core.gd:1243 | `_apply_module_states` creates the Array literal `wanted: Array[bool] = [false, false, false, false, false, false]` on every call. It is frame code: `QACoreNode.on_process_frame` (connected to `SceneTree.process_frame`, qa_core_node.gd:19) calls `QACore._on_frame_start` (qa_core.gd:661), which calls `_check_reward_window` (qa_core.gd:1232), which calls `_apply_module_states` on the frame start where a reward window closes. godot `## frame code` forbids creating an `Array` literal in core frame code. The static check of the harness covers only node finding and `await` in frame code (godot `## test`), so nothing else catches it. Run path: `set_reward_presentation_off`(`on`), `mark`(`Goal`), then `QACore.rewardPresentationWindowMs` advanced ms: at the next frame start the literal is created inside `process_frame` | Compute the wanted state per index without a new collection (e.g. a `_wanted_state(state: int) -> bool` function used in the loop), or keep a `static var` buffer sized once in `init` and only write its elements | no | 88 |
| R1-2 | test evidence | medium | client/godot/core/qa_core/tests/test_frame_interval.gd:73 | QACore `## test` says "Putting intervals into a full record allocates no memory", and godot `## test` sets how a core test checks an operation the spec says does not allocate: 100 warm-up runs, then `Performance.OBJECT_COUNT` and `Performance.MEMORY_STATIC` read before and after 1000 more runs (used e.g. by input_core/tests/test_memory.gd, cutscene_core/tests/test_frame_memory.gd). The test only asserts `QACore._frame_intervals.size()` stays `SMALL_MAX_COUNT` (line 81). A `_record_frame_point` that leaves an allocation behind each call while keeping the ring size (e.g. also appending each interval to a growing `static var` Array, or storing a new object per interval) passes it | Add a memory test that, with a full record of `QACore.frameIntervalMaxCount` intervals, calls `QACore._record_frame_point` 100 times as warm-up and 1000 times measured after `LogCore.release`, and asserts that neither `OBJECT_COUNT` nor `MEMORY_STATIC` grew | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The core tests were not run in this review; the findings come from reading the code, the tests and the defining documents
- The changes of the range to `SoundCore`, `CameraCore`, `ScreenEffectCore`, `PoolCore` and `TweenCore` (their DEV skip and mute states) were read only for what QACore calls and what the QACore `## test` items read; they are review targets of their own modules
- The timing of `NOTIFICATION_APPLICATION_RESUMED` against `SceneTree.process_frame` on each real platform (it decides whether the interval left out after `TimeCore.AppForegroundReturnedEvent` is the one holding the background time) was not checked on devices; the test checks it with the test background step of `TimeCore`
- The half-up rounding of `frame_intervals_ms` (qa_core.gd `_take_frame_intervals_json`) was read as correct; no test checks the rounding, and it is not a `## test` item
