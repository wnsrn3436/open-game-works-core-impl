# review RequirementCore round 1

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

- The commit range 51d323b..4e2b344 changes no file of `client/godot/core/requirement_core/`, `server/core/validation/`, `fixtures/requirement-evaluation.json` or `tools/data-tool/src/requirement.ts`, and no `RequirementCore` settings key. Within the dependencies only `client/godot/core/ui_core/` and `client/godot/core/localization_core/` changed; `event_core`, `time_core`, `user_state_core`, `network_core`, `data_core` and `log_core` did not
- Checked the changes that RequirementCore reaches: `UIOpenedEvent.key` and `UIClosedEvent.key` (read by `client/godot/core/requirement_core/requirement_core_node.gd:37` and `:41`) are unchanged; the field `PanelFlowFinishedEvent.panel_key` that the range removed is not read by RequirementCore; the LocalizationCore changes (`bind_text`, `unbind_text`, test timezone offset) do not touch `FormatArgs`, which `fill_guide_args` uses
- Checked the callers changed in the range: `client/godot/core/tutorial_core/tutorial_core.gd:791` now calls `RequirementCore.unwatch` from a `UserStateChangedEvent` handler; `unwatch` takes the watch out through `_remove_watch_at` without changing a collection size, and the `_mark_list` of `client/godot/core/requirement_core/requirement_core.gd` that runs for the same event calls no outside code, so no RequirementCore defect follows. Whether the EventCore publish loop allows an unsubscribe during a publish belongs to EventCore and was not checked here. The ShortcutCore, BadgeCore and CutsceneCore changes in the range do not change their RequirementCore calls
- Ran `ogw core test godot RequirementCore` on 4e2b344: pass
- The whole target was not reviewed again, because the commit range has no change of RequirementCore; problems that existed before the range were read only in the parts above and none of severity medium or higher was found there. The server `validation.evaluate_requirement` and the `requirement-evaluation` fixture were not read
