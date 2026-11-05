# review MessageCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | client/godot/core/message_core/message_core.gd:474 | Since this range, a preset with a negative repeat count passes `prepare` (`_load_preset` returns it, `test_prepare.gd:72`), and `_length_ms` returns `_cycle_ms(definition) * definition.repeat_count` from the raw definition. For `tests/resources/test_fade_negative_repeat.tres` (one 100 ms change, `repeat_count = -1`), this is -100. TweenCore does not play that definition: `_check_failure` (`client/godot/core/tween_core/tween_core.gd:875`) fails a repeat count below 0 or above `TweenCore.maxRepeatCount`, a negative duration or a negative delay at playback, and the tween-core spec (`### definition check`) then plays a definition with no steps that ends with `Completed` in the same frame, so its real length is 0. Reproducing input: `MessageCore.blackBoxEnterTween` = that preset, `MessageCore.blackBoxExitTween` = "", `MessageCore.blackBoxDurationMs` = `InputBlockCore.maxDurationMs`. Then `black_box_ms` at `message_core.gd:406` is `maxDurationMs - 100`, so `prepare` writes no log. But steps 1 to 5 of every black box take `maxDurationMs`, and the forced release of `InputBlockCore` happens. The message-core spec `### prepare` and `## error` require one error log when that sum is `InputBlockCore.maxDurationMs` or more. The opposite case is a repeat count above `TweenCore.maxRepeatCount`: it gives a large computed length and a log, although the black box takes only its display time | Count the length of a preset that fails the TweenCore definition check as 0, the length of what TweenCore plays. MessageCore cannot judge this exactly within its defining documents: `TweenCore.check_definition` lists only `ScreenEffectCore` as caller, and `TweenCore.maxRepeatCount` is not in the MessageCore settings table. So the message-core spec should state the length of such a preset (0) and how MessageCore gets it, e.g. by adding MessageCore as a caller of `check_definition` with the made black box object as target. Add a test with a negative repeat preset and `blackBoxDurationMs` = `InputBlockCore.maxDurationMs` that expects one log | yes | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the core tests. This checkout has no `addons/gut`, and `ogw core test` sets up the project. R1-1 is based on reading the code: `_length_ms` and `_cycle_ms` (`message_core.gd:471-488`) are plain arithmetic on the loaded definition, and the definition check is at `client/godot/core/tween_core/tween_core.gd:875-895`
- Only MessageCore files changed in the range: `client/godot/core/message_core/` (code, the four touched test files, the new preset). CutsceneCore, SceneCore, ShortcutCore, UnitTestCore, GameUpdateCore and the server modules that changed in the same range are other review targets and were not checked
- `MessageCore._on_node_exit` (app exit), which now logs through `_close_kind` → `_drop_destroyed` when it finds a destroyed object: I did not check whether a tree teardown order frees the `Message` layer before the MessageCore core node exits. Godot does not free nodes during exit tree propagation, so I found no reproducing run path
- The `object == null` return after a non-empty borrow handle (`message_core.gd:216`) no longer logs, and it keeps the borrowed object. `_prepare_toast_pool` already checks that the prefab root is a `Control`, so I found no run path that reaches it
- `_record_tween_properties` on a re-made code toast or black box (`message_core.gd:227`, `message_core.gd:243`) records the same values as `prepare` recorded, because the object is made the same way. So no test can tell whether those lines are there, and I wrote no finding
