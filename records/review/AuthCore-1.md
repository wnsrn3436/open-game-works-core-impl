# AuthCore review round 1

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

- The commit range 97851fcb..37049e4d changes only `client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd`, UICore tests and a record file; no file under `client/godot/core/auth_core/` changed. Checked how the changes reach AuthCore: AuthCore calls only `UICore.open_popup`, `UICore.open_system_popup`, `UICore.close_popup` and popup/layer queries (`auth_core.gd:1690`-`1720`, `terms_popup.gd:52`, `age_popup.gd:46`, `privacy_choices_popup.gd:36`, `push_consent_popup.gd:36`); no AuthCore code or test references `SystemPopupView.scroll_by`, the removed `_update_focus_callable`, the new `_start_focus`, `_focus_start_pending` or `_scroll_event`, and no AuthCore code or test sends key or joypad direction input. The AuthCore spec (`open-game-works-core/skills/client-core/modules/auth-core.md`) sets no focus, scroll or direction-input behavior of its popups, so the changed focus-start and system popup scroll handling changes no AuthCore behavior that the spec defines
- The UICore changes themselves (focus start deferral, system popup body scroll consumption) were not reviewed beyond their reach into AuthCore: they belong to the UICore target
- The AuthCore core tests were not run: this worktree's core project has no `addons/` (GUT) and `ogw core test` runs against `paths.coreImpl`, not this worktree. No finding needed a test run to check it
