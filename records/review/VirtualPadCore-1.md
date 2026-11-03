# review: VirtualPadCore round 1

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

- The commit range `f3ac5b0..6caa170` changes no file under `client/godot/core/virtual_pad_core/` and not `core-spec/VirtualPadCore.json`, and input `## spec changes` is `none`. It changes only `client/godot/core/localization_core/localization_core.gd` (`_restore_heading_types`), `client/godot/core/localization_core/tests/test_font_weight.gd` and files under `records/`.
- Why the change does not reach the target: `LocalizationCore` is not in `## dependency` of the VirtualPadCore spec or in `dependencies` of `core-spec/VirtualPadCore.json`. A search of `client/godot/core/virtual_pad_core/` finds no use of `load_fonts`, heading types or theme calls. A search of `client/godot/core/ui_core/` finds no `load_fonts` or heading type. `_restore_heading_types` runs only when `_heading_chain` is set (`client/godot/core/localization_core/localization_core.gd:853`), and `start_modules` of `client/godot/core/virtual_pad_core/tests/support/virtual_pad_test_case.gd:120` does not call `load_fonts`.
- Not read: the implementation and tests of VirtualPadCore. The review scope with this commit range does not include them, so this round does not say that they follow the spec. A whole-target review needs `ogw review run core VirtualPadCore --full`.
- Not checked: the specs in `## definition` against the code, for the same reason. Of `client/godot/core/localization_core/localization_core.gd`, only `_restore_heading_types`, its helpers and its call site in `release` were read, and no problem was found in them.
- Run in this review: `ogw core test godot VirtualPadCore` passes on the target commit. The result was reused from a passing result of the same key, not run again. The browser run (`--web`) and the core tests of `ogw core dependents VirtualPadCore` were not run.
