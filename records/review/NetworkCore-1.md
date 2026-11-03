# review: NetworkCore round 1

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

- Scope: the commit range changes no file under `client/godot/core/network_core/`, `core-spec/` or `settings/`. Outside `records/` it changes only `client/godot/core/localization_core/localization_core.gd` and `client/godot/core/localization_core/tests/test_font_weight.gd`. NetworkCore is reached only through `UICore`, which depends on `LocalizationCore`.
- Checked along that path: the only implementation change is the private `_restore_heading_types` (`client/godot/core/localization_core/localization_core.gd:714`), called from `_clean_up` (`client/godot/core/localization_core/localization_core.gd:854`) only when `_heading_chain` is not null, so only after `load_fonts` applied fonts. The result is that a heading type stays in the theme as an empty record after `release`. No operation of `LocalizationCore` changed. `client/godot/core/network_core/` and `client/godot/core/ui_core/` have no reference to `load_fonts`, `HeadingLabel`, `HeadingButton` or `HeadingRichTextLabel`, and `client/godot/core/message_core/message_core.gd` calls only `get_text` and `format`. `client/godot/core/network_core/tests/support/network_test_case.gd:74` runs `LocalizationCore.init` and `load_translation` without `load_fonts`, so the NetworkCore tests do not run the changed path.
- Run in this review: `ogw core test godot NetworkCore` and `ogw core test godot NetworkCore --web` pass on the target commit. The output of both jobs holds the lines `NetworkCore pass` and `NetworkCore pass (reused)`, so a result of the same key may have been reused instead of running again.
- Not checked: the implementation and tests of NetworkCore were not compared with `client-core/modules/network-core.md`, because the range does not change them and `## spec changes` is `none`. This round is not a review of the whole target. The specs of the modules NetworkCore depends on, the `session` and `logging` server specs and `client-core/engines/godot.md` were not read for the same reason.
- Not run: a build where `BootstrapCore` calls `load_fonts` and a NetworkCore system popup then opens after a restart. The view of the system popup was read only for theme and heading references (`client/godot/core/ui_core/system_popup_view.gd`), and a project theme loaded from a `.tres` was not run.
