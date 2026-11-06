# ShortcutCore review round 1

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

- Commit range 97851fcb..6461424b changes no file under `client/godot/core/shortcut_core/` and no ShortcutCore dependency other than `UICore` (`client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd` and UICore tests). The rest of the range is review and record files.
- The UICore change only touches focus-mode start and system popup scroll input handling (`_on_input`, `_on_unhandled_input`, `_update_focus`, `_start_focus`, `_reset_statics`, `scroll_by`). It does not change `close_all_popups`, `open_panel`, `open_panels`, `close_panel`, `close_panels_to`, `get_panel_stack` or `is_panel_transitioning`, which are the UICore operations `client/godot/core/shortcut_core/shortcut_core.gd` calls (lines 67, 109, 112, 132, 134, 143, 145, 149, 151). No ShortcutCore test uses focus, key input or popup scroll (`client/godot/core/shortcut_core/tests/`). No ShortcutCore finding comes from these changes.
- The ShortcutCore core tests were not run in this review. The update-core record `records/1793932803677-update-core-mw4d9u8t750c0d.md` says that `ogw core test godot` and `--web` passed for UICore and every dependent module.
- ShortcutCore code from before this range that the changes do not reach was not reviewed again.
