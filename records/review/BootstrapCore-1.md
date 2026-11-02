# review BootstrapCore round 1

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

- The commit range `d4c3ae7f..a362280a` changes no file under `client/godot/core/bootstrap_core/` and does not change `core-spec/BootstrapCore.json`. On the client side it adds `UICore.is_dimmed` (`client/godot/core/ui_core/ui_core.gd:750`, `client/godot/core/ui_core/ui_core.gd:2374`), adds the `list_ui` field `dimmed` (`client/godot/core/qa_core/dev/qa_query.gd:271`), adds UICore and QACore tests and test prefabs, adds `is_dimmed` to `core-spec/UICore.json`, and removes `uiQuality.maxFlatShare` from `client/godot/generated/core_settings.json`. BootstrapCore code does not call `is_dimmed` and does not read that settings key
- The only BootstrapCore path that reaches the changed code is `list_ui` over a BootstrapCore screen (`client/godot/core/bootstrap_core/tests/test_boot_fatal.gd:146`). It was checked by reading the code. A fatal screen on the `Fatal` layer (`client/godot/core/bootstrap_core/bootstrap_core.gd:1111`) is above both dim layers, so `_dim_above` gives `false`. A fatal screen before `UICore` is initialized is reached with `UICore.is_initialized()` `false`, so `list_ui` does not call `is_dimmed`. The dims are made in `_build_layers` before `_is_initialized` is set, and `release` clears that state in one frame, so `_dim_above` does not receive a null dim in these paths
- The system popups of BootstrapCore (fatal, login failure, deletion code) use the `UICore` dim behavior, which this range does not change. The correctness of `is_dimmed` itself for other UICore elements belongs to the UICore target and was read only as far as the BootstrapCore paths above
- BootstrapCore code and tests that this range does not change were not reviewed again, as the procedure says for a review with a commit range
- No tests were run in this review, because there was no finding to check. The report `records/1793645028102-update-core-mvzlxt6u5be5ef.md` states that `ogw core test godot --web` passed 25 of 25 modules, and that `ogw core test godot` passed 22 and skipped 3 with exit code 1. BootstrapCore is in the tested list and is not one of the 3 skipped modules. That statement was read and not reproduced
