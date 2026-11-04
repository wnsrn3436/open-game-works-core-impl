# TutorialCore review round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | New test `client/godot/core/tutorial_core/tests/test_scene.gd:43` calls `notify_cue(OPENED)` while the run is `STOPPED` and asserts `false`, the same step and no new step after `SceneStartedEvent`. Restored in a temporary worktree outside the target checkout: `tutorial_core.gd:173` changed to `if not _runs.has(run):`. `ogw core test godot TutorialCore --file .../test_scene.gd` failed: `test_a_cue_while_the_step_progress_is_stopped_does_not_end_the_step` (`["[tutorial_cue]:2"] expected to equal ["[tutorial_cue]:1"]`) |
| R1-2 | fixed | New test `tests/test_view.gd:210` starts a tutorial while a system popup is visible and asserts no `Shown` tutorial and no view until it closes. Restored: `or system_popup` removed from `tutorial_core.gd:933`. `test_view.gd` failed: `test_a_system_popup_keeps_a_paused_tutorial_from_showing_until_it_closes` (`["[tutorial_first]"] expected to equal ["none"]`) |
| R1-3 | fixed | Two restorations. (1) `_clear_focus()` removed from `_hide` (`tutorial_core.gd:979`): `test_input.gd` failed `test_the_tutorial_view_focus_is_cleared_when_an_anchor_tap_step_ends_without_a_next_step` (`no Tutorial view focus is left`). (2) `if system_popup and run.has_focus: _clear_focus()` added to `_frame_shown` after line 892: `test_view.gd` failed `test_a_system_popup_keeps_the_tutorial_view_focus_while_it_hides_the_view` (focus owner `<null>`, expected the advance button, `after the system popup`) |
| R1-4 | fixed | New row `[tutorial_silent]` (empty `text`) in `test-data/data/tables/tutorial_step.csv:27` and test `tests/test_view.gd:132`. Restored: (1) `_view.speech_bubble.visible = true` at `tutorial_core.gd:1144`: `test_view.gd` failed `test_a_step_without_text_hides_the_speech_bubble_and_binds_no_text`. (2) the bind guard at line 1148 made `if true:`: the same test failed (`[""] expected to equal ["unbound label"]`) |
| R1-5 | fixed | New test `tests/test_view.gd:115` asserts the bubble at (40, 40) of `tests/resources/tutorial_view.tscn` on step 3 after the anchored step 2. Restored: `if not anchored: _view.speech_bubble.position = _bubble_home` removed (`tutorial_core.gd:1150-1151`). `test_view.gd` failed `test_a_step_without_anchor_puts_the_speech_bubble_at_its_position_in_the_view_resource` (`(490, 260)` expected `(40, 40)`) |
| R1-6 | fixed | `tests/test_view.gd:99` asserts the bottom edge only, and new test `tests/test_view.gd:102` asserts the bubble starts at the anchor bottom with equal room. Restored: `below >= above` made `below > above` at `tutorial_core.gd:1198`. `test_view.gd` failed both `test_the_speech_bubble_overlaps_a_tall_anchor_and_touches_an_edge_of_the_view_root` (`180` expected `1180`) and `test_the_speech_bubble_goes_right_below_an_anchor_with_equal_room_above_and_below` (`530` expected `670`, `right below`) |
| R1-7 | fixed | New hook `Hooks.can_start_not_bool` typed `-> int` (`tests/support/tutorial_hooks.gd:27`) and test `tests/test_start.gd:135`. Restored: the `not value is bool` check (`tutorial_core.gd:498-500`) removed. `test_start.gd` failed `test_a_hook_that_returns_no_bool_does_not_start_with_an_error_log` (0 errors for 21 calls; `[tutorial_first]` and `[tutorial_second]` started) |
| R1-8 | fixed | `log_messages` (`tests/support/tutorial_test_case.gd:396`) reads the log message. Restored one at a time: gamepad error without the anchor name, and without the anchor key (`tutorial_core.gd:957-958`): `test_input.gd` failed `test_with_gamepad_supported_an_anchor_without_a_ui_button_logs_its_name` both times; step check error without `step` (`tutorial_core.gd:388`): `test_step_check.gd` failed `test_a_tutorial_with_a_step_that_breaks_a_rule_does_not_start_and_logs_an_error` for all 11 cases; anchor wait warn without the anchor name, and without the anchor key (`tutorial_core.gd:928-929`): `test_view.gd` failed `test_a_step_waiting_for_its_anchor_logs_one_warn_after_the_wait_time` both times |
| R1-9 | fixed | `_on_user_state_changed` (`tutorial_core.gd:791-797`) runs `_update_start_watch` for every key of `_start_watches` before the start check, so a UserState delta that raises the progress step of a not-active tutorial takes its start watch off. `RequirementCore.unwatch` there is safe: `RequirementCore._on_user_state_changed` (`client/godot/core/requirement_core/requirement_core.gd:872`) only marks watches pending, and `_remove_watch_at` dequeues the record. New test `tests/test_watch.gd:72`. Reverting the fix in a temporary worktree made `test_watch.gd` fail `test_the_start_watch_is_taken_off_when_a_user_state_delta_finishes_every_tutorial_with_its_start_requirement` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: `tests/test_scene.gd:43` fails with the `STOPPED` guard removed |
| D2 | fixed | none | Same as R1-2: `tests/test_view.gd:210` fails with `or system_popup` removed |
| D3 | fixed | none | Same as R1-3: `tests/test_input.gd:135` and `tests/test_view.gd:225` fail with their defects restored |
| D4 | fixed | none | Same as R1-4: `[tutorial_silent]` row and `tests/test_view.gd:132` fail with the visibility or the bind guard restored |
| D5 | fixed | none | Same as R1-5: `tests/test_view.gd:115` fails with lines 1150-1151 removed |
| D6 | fixed | none | Same as R1-6: `tests/test_view.gd:99` and `:102` fail with `>` |
| D7 | fixed | none | Same as R1-7: `tests/test_start.gd:135` fails with lines 498-500 removed |
| D8 | fixed | none | Same as R1-8: the message contents of the three logs are asserted and fail when the anchor name, anchor key or `step` is dropped |
| D9 | fixed | none | Same as R1-9: the start watch is taken off on a UserState delta; `tests/test_watch.gd:72` fails without the fix |

## must fix

none

## unknown

- Only the test files named above were run, each with `ogw core test godot TutorialCore --file` in a temporary worktree at `1c45dc7` (removed afterwards). An unmodified `test_scene.gd` run passed; in each restoring run only the tests named above failed in that file. The other TutorialCore test files, the browser run (`--web`) and the dependent modules were not run by this review
- Changes in the range to other modules that TutorialCore calls were read: `SceneCore` (`_stop_tree`, `_restore_stopped`, `_check_stopped`) only changes the `process_mode` of nodes under the scene holder and not the order or payload of `SceneEndedEvent` and `SceneStartedEvent`; no change to `RequirementCore`, `UICore`, `UserStateCore`, `LocalizationCore` or the server `tutorial` module is in the range
