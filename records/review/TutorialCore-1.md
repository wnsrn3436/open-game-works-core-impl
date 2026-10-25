# review TutorialCore round 1

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

- The commit range d4e2728..9900507 changes no file under `client/godot/core/tutorial_core/` or `server/core/tutorial/` (`git diff --quiet` of those paths over the range is clean), and `## spec changes` is `none`. The only changed code that TutorialCore reaches is `client/godot/core/ui_core/ui_core.gd:653` (new `UICore.is_flow_in_progress`), which TutorialCore does not call: its calls into UICore are `get_anchor_rect`, `get_block_pass_list`, `get_current_panel_key`, `get_layer`, `get_open_popups`, `is_initialized`, `is_system_popup_visible` and `set_view_focus`, none of which changed in the range, and `ui-core.md` names `QACore` as the only caller of `is_flow_in_progress`. Client AuthCore changed only in tests (`check_logs` asserts removed); `AuthCore.is_logged_in` is unchanged. The server `auth` changes (`server/core/auth/login.ts`, `server/core/auth/deletion.ts`) are not in the dependency of TutorialCore (server dependency `tutorial`). The UnitTestCore change (`PUT /started` before the first test, `client/godot/core/unit_test_core/dev/unit_test_core.gd:943`) changes the test run harness, not TutorialCore behavior. So there was nothing in range to judge against TutorialCore's defining documents, and TutorialCore code and tests outside the range were not reviewed
- The correctness of `UICore.is_flow_in_progress` itself against `ui-core.md:418` was not checked: it is in the review scope of UICore, not TutorialCore
- Tests were not run
