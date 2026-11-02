# review VirtualPadCore round 1

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

- The commit range d4c3ae7..f1cb7a8 changes no file of `client/godot/core/virtual_pad_core/` and not `core-spec/VirtualPadCore.json`. Of the modules VirtualPadCore depends on (`LogCore`, `EventCore`, `LocalDataCore`, `ResourceCore`, `SafeAreaCore`, `InputCore`, `UICore`), only `client/godot/core/ui_core/ui_core.gd` changes in the range. `client/godot/core/unit_test_core/`, which the VirtualPadCore tests use, does not change
- The `ui_core.gd` change adds `is_dimmed` (`client/godot/core/ui_core/ui_core.gd:750`) and its internals `_is_dimmed` and `_dim_above` (`client/godot/core/ui_core/ui_core.gd:2374`), and otherwise changes two section comments. These read UICore state and change none. VirtualPadCore code calls only `UICore.get_layer` (`client/godot/core/virtual_pad_core/virtual_pad_core.gd:85`) and `UICore.get_open_popup_count` (`virtual_pad_core.gd:417`, `virtual_pad_core.gd:450`), and its tests also call `UICore.init`, `UICore.prepare`, `UICore.release`, `UICore.open_popup` and `UICore.close_all_popups` (`client/godot/core/virtual_pad_core/tests/support/virtual_pad_test_case.gd:139`, `:151`, `:303`, `tests/test_pointer.gd:94`, `tests/test_state.gd:55`). The range changes none of those operations. A grep of `client/godot/core/virtual_pad_core/` for `is_dimmed` and `dimmed` has no match
- `client/godot/core/qa_core/dev/qa_query.gd:271` now calls `UICore.is_dimmed` for every visible element, which includes the elements of a virtual pad in the `VirtualPad` layer. `_panel_dim` and `_popup_dim` are created before `prepare` (`client/godot/core/ui_core/ui_core.gd:903`, `:907`), so that call was not found to fail for those elements. It was checked by reading only, and it does not change VirtualPadCore behavior. The correctness of `is_dimmed` itself belongs to the UICore and QACore reviews and was not judged here
- The settings change removes only `uiQuality.maxFlatShare` from `client/godot/generated/core_settings.json`. A grep of `client/godot/core/virtual_pad_core/` for `uiQuality` and `maxFlatShare` has no match, and `VirtualPadCore.deadZonePermille` and `VirtualPadCore.sensitivityPermille` are not in that diff
- The checks above were done by reading the diff and the calling code. The VirtualPadCore tests were not run in this review, because there is no finding to check
- The VirtualPadCore code and tests outside the range were not reviewed against the defining documents, because the range does not change them or the behavior of the code they call, input `## spec changes` is `none`, and input `## debt` and `## must fix` are `none`
