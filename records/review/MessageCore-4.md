# review MessageCore round 4

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R4-1 | test evidence | medium | client/godot/core/message_core/message_core.gd:114 | Input debt D2. `open-game-works-core/skills/core/SKILL.md:71` says that `release` stops the async operations in progress and that a stopped operation returns a failure value. No test calls `MessageCore.release` while a `MessageCore.prepare` waits: `MessageCore.release` is called only at `client/godot/core/message_core/tests/test_lifecycle.gd:10`, `test_lifecycle.gd:23`, `test_lifecycle.gd:70`, `test_input.gd:84` and `test_close.gd:254`, each with no `prepare` pending, and `test_prepare.gd` has no `release` call (the one test with a pending `prepare`, `test_prepare.gd:147`, calls `prepare` again, not `release`). Outside `message_core/` only test teardowns (`auth_core/tests/test_plugin_waits.gd:264`, `tutorial_core/tests/support/tutorial_test_case.gd:94`) call it, after `prepare` returned. Run path not exercised: `init`, then `prepare` with a toast prefab key (waits at `ResourceCore.load`, `message_core.gd:386`), then `release` (`_reset_state` sets `_session` and `_toast` to `null`), then the load resumes. Removing the session checks at `message_core.gd:114`, `message_core.gd:387`, `message_core.gd:392`, `message_core.gd:401`, `message_core.gd:432` or `message_core.gd:458` changes this path (without `message_core.gd:387` the resumed `_load_all` reads `_toast.enter_tween` at `message_core.gd:397` on `null`; without `message_core.gd:114` `prepare` writes `_PREPARE_READY` into the released module and returns `true`), and no assert covers it | Add a test in `client/godot/core/message_core/tests/test_prepare.gd` that starts `prepare` with a toast or black box prefab key, calls `MessageCore.release` before it ends, and asserts that `prepare` returns `false`, that no error is logged, that `MessageCore.is_initialized()` stays `false` and `_prepare_state` stays `_PREPARE_NONE`, and that `init` and `prepare` after that succeed | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | The path the item describes is gone. `_load_preset` (`client/godot/core/message_core/message_core.gd:453-467`) now returns the loaded `TweenDefinition` and fails only, each with an error log, when the preset did not load or `repeat_count == 0`; `_length_ms` (`message_core.gd:471-474`) gives cycle time × repeat count, and `_load_all` (`message_core.gd:399-409`) adds the lengths and does not fail on a negative length. A preset with one 100 ms change and `repeat_count = -1` (`client/godot/core/message_core/tests/resources/test_fade_negative_repeat.tres`) makes `prepare` `true` with no log, which `client/godot/core/message_core/tests/test_prepare.gd:72-76` asserts; `ogw core test godot MessageCore` passed. So no `prepare` failure without a log remains on this path |
| D2 | open | R4-1 | No test calls `MessageCore.release` while a `prepare` waits; the session checks of `prepare`, `_load_all`, `_prepare_toast_pool` and `_load_preset` (now at `message_core.gd:114`, `387`, `392`, `401`, `432`, `458`) are covered by no assert. Same severity as before: a `test evidence` finding |
| D3 | fixed | none | `client/godot/core/message_core/tests/test_view.gd:70-81` shows a toast on the code made toast object and asserts that the global rect center of `MessageCore._code_toast_label` equals the center of the toast holder, which equals the visible game area (`test_view.gd:75-79`, tolerance 0.5 px). The label is the child of the band (`message_core.gd:563-564`), so with `band.anchor_top` and `band.anchor_bottom` set to 0 at `message_core.gd:559-560` the band, and the label in it, is centered on the top edge of the holder (vertical grow both) and the assert at `test_view.gd:79` fails. `ogw core test godot MessageCore --file client/godot/core/message_core/tests/test_view.gd` passed on the current code |

## must fix

none

## unknown

- The commit range `1b8ce0f7..1b8ce0f7` is empty, so no change is in scope; findings come only from the input `## debt` items. The review file of round 3 has no `## findings` rows and no `open` rows in `## previous`, so `## previous` has no rows
- I did not restore the D3 defect (band anchors 0) in a temporary copy and run the test; `fixed` for D3 is judged from reading `test_view.gd:70-81` and the layout code of `_make_code_toast`. A core test run needs the test host of `ogw core test`, which runs on a checkout and not on a loose copy
- I ran `ogw core test godot MessageCore` (headless) from this worktree and it passed; the job output did not print which checkout it tested
- I did not run the core tests of the modules that depend on MessageCore
