# TutorialCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/tutorial_core/tutorial_core.gd:173 | D1. `notify_cue` skips a run whose `stage` is `STOPPED`, as `open-game-works-core/skills/client-core/modules/tutorial-core.md:92` requires ("While stopped, it does not receive the condition of `complete`"). No test calls `notify_cue` between `SceneEndedEvent` and `SceneStartedEvent`: `test_scene.gd` never calls it, `test_watch.gd:24` calls it before `_change_later`, and the other calls (`test_order.gd:54-104`, `test_input.gd:101`, `test_lifecycle.gd:56`) run without a scene transition. Removing `or run.stage == _RUN.Stage.STOPPED` fails no test by reading | Add a test: Cue step active, `SceneEndedEvent` held with `TestScene.hold_prepare`, `notify_cue` with that step's `cue` is `false`, and after `SceneStartedEvent` `current` is the same step | no | 90 |
| R1-2 | test evidence | medium | client/godot/core/tutorial_core/tutorial_core.gd:929 | D2. `system_popup` in this condition keeps a `Paused` tutorial from becoming `Shown` while a system popup is visible (`tutorial-core.md:95`, "no `Shown` transition of 2"). The only tests that open a system popup (`test_input.gd:19`, `test_view.gd:149`) do so while the tutorial is already `Shown`, so the `_shown != null` part of the same condition already skips the transition. Removing `or system_popup` fails no test by reading | Add a test that opens a system popup while a `Paused` tutorial's show condition does not hold, makes it hold, and asserts no `Shown` tutorial and no tutorial view until the system popup closes | no | 90 |
| R1-3 | test evidence | medium | client/godot/core/tutorial_core/tutorial_core.gd:975 | D3. `_hide` deletes the `Tutorial` view focus with an empty list (`tutorial-core.md:89`), and `_frame_shown` at line 888 keeps it while a system popup hides the view. No test checks either: `has_focus` is asserted only at `test_input.gd:100` and `:104` on Cue and Requirement steps that never set a focus, and the gamepad tests (`test_input.gd:56`, `:83`, `:130`) end without a focus check after the step ends or the view hides. Removing `_clear_focus()` at line 975 fails no test by reading | Add tests: after an `Advance` or `AnchorTap` step ends with no next step shown, the `Tutorial` view focus is gone; while a system popup hides the view, the focus element list stays | no | 88 |
| R1-4 | test evidence | medium | client/godot/core/tutorial_core/tutorial_core.gd:1140 | D4. A step without `text` hides the speech bubble (`tutorial-core.md:76`), but every row of `test-data/data/tables/tutorial_step.csv` has a non-empty `text`, so the `false` branch of line 1140 and the `not step.text.is_empty()` guard at line 1144 never run in a test. Changing line 1140 to `true` fails no test by reading | Add a `tutorial_step` row with an empty `text` and a test that the speech bubble is hidden and the text element is not bound while it shows | no | 92 |
| R1-5 | test evidence | medium | client/godot/core/tutorial_core/tutorial_core.gd:1147 | D5. A step without `anchor` puts the speech bubble at the position set in the tutorial view resource (`tutorial-core.md:109`). `_bubble_home` appears in the tests only as the reset value at `test_lifecycle.gd:46`, and every bubble assertion (`test_view.gd:64-113`, `:136`, `:209`) uses a step with `anchor`. Removing lines 1146-1147 fails no test by reading, although the bubble keeps the anchored position of the previous step (e.g. `[tutorial_anchor]` step 2 to step 3) | Add a test: after an anchored step, a step without `anchor` shows the speech bubble at its position in `tests/resources/tutorial_view.tscn` | no | 90 |
| R1-6 | test evidence | medium | client/godot/core/tutorial_core/tutorial_core.gd:1194 | D6. "When equal, below" of `tutorial-core.md:109` has no test. The one test with equal room is `test_view.gd:85` (anchor 50 below the top of the safe area and 50 above its bottom), and its assert at `test_view.gd:96` accepts the top edge or the bottom edge of the view root. With `below > above`, `place.y` is `rect.position.y - size.y`, clamped to `area.position.y` (top edge), which still passes that assert by reading | Make `test_view.gd:96` assert the bottom edge only, or add a test with equal room and a bubble that fits, asserting the bubble starts at the anchor bottom | no | 90 |
| R1-7 | test evidence | medium | client/godot/core/tutorial_core/tutorial_core.gd:498 | D7. A `can_start_tutorial` hook that returns a value that is not a `bool` gives an error log and `false` (`open-game-works-core/skills/client-core/engines/godot.md:245`). No test goes through it: `tests/support/tutorial_test_case.gd:233` and `tests/support/tutorial_test_scene.gd:41` are typed `-> bool`, and the other registrations (`test_lifecycle.gd:95-105`, `test_save.gd:122`, `test_step_check.gd:70`) use those. Removing lines 498-500 fails no test by reading | Add a test that registers an untyped static or Node method returning a non-`bool` value and asserts no start, `false` from `check_start` and one TutorialCore error log | no | 90 |
| R1-8 | test evidence | medium | client/godot/core/tutorial_core/tests/test_input.gd:127 | D8. `test_with_gamepad_supported_an_anchor_without_a_ui_button_logs_its_name` asserts only `errors() == 1`, but `tutorial-core.md:145` and `:253` require the anchor name (and anchor key) in the log. `UnitTestCore.check_logs` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1290`) counts by level and tag and does not read the message, so dropping `step.anchor` from the message at `tutorial_core.gd:953` fails no test. The same holds for the step check error (tutorial ID and `step`, `tutorial-core.md:142`; `test_step_check.gd:74`) and the anchor wait warn (anchor name, anchor key, `tutorial-core.md:144`; `test_view.gd:290`) | Assert the message content of these logs (anchor name and key, tutorial ID and `step`), through a log capture that reads the message | no | 88 |
| R1-9 | spec | medium | client/godot/core/tutorial_core/tutorial_core.gd:680 | D9. `_update_start_watch` has this one caller, in `_complete`, so a start watch is taken off only when a tutorial ends in this run. `tutorial-core.md:64` calls `RequirementCore.unwatch` when all tutorials with that `start_requirement` are completed, and `:42` defines completed by the progress step, which a `TutorialProgressUserState` delta also raises. Run path: the first start check after login sets the start watch of a not-active tutorial (`_watch_starts`, line 516); DEV `set_tutorial_step` (`server/core/tutorial/dev/index.ts:12`) writes its last `step`; the delta reaches the client, `_on_user_state_changed` (line 791) only runs `_start_check`, `_is_complete` is now `true`, and the watch stays until `release`, running start checks that cannot start that tutorial. `test_watch.gd:53` covers only the end through `_complete` | In the start check (or on `UserStateChangedEvent`), run `_update_start_watch` for each requirement ID in `_start_watches`, and add a test that raises the progress step of a not-active tutorial with a UserState delta and asserts its start watch is gone | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | Commit range is empty; `tutorial_core.gd:173` and the tests are unchanged (last change to `client/godot/core/tutorial_core` is 301b3dd). No `notify_cue` call during a stopped step progress in `tests/` |
| D2 | open | R1-2 | Unchanged; system popups are opened only at `test_input.gd:19` and `test_view.gd:149`, both with a `Shown` tutorial |
| D3 | open | R1-3 | Unchanged; `has_focus` asserted only at `test_input.gd:100`, `:104` |
| D4 | open | R1-4 | Unchanged; no row of `test-data/data/tables/tutorial_step.csv` has an empty `text` |
| D5 | open | R1-5 | Unchanged; `_bubble_home` only at `test_lifecycle.gd:46` |
| D6 | open | R1-6 | Unchanged; `test_view.gd:96` still accepts either edge |
| D7 | open | R1-7 | Unchanged; every registered test hook is typed `-> bool` |
| D8 | open | R1-8 | Unchanged; `check_logs` counts by level and tag only |
| D9 | open | R1-9 | Unchanged; `_update_start_watch` is still called only from `_complete` (`tutorial_core.gd:680`) |

## must fix

none

## unknown

- The commit range `697121c..697121c` is empty, so no change was reviewed; only the input `## debt` items were checked
- The Godot tests were not run. The "fails no test" statements of R1-1 to R1-8 and the run path of R1-9 come from reading the code and tests; no defect was restored in a temporary copy
- Whether a `TutorialProgressUserState` delta from DEV `set_tutorial_step` reaches the client without another request (R1-9) was not checked. The finding holds once any later response carries that delta
