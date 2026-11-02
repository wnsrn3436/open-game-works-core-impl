# AdCore review round 1

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

- `client/godot/core/ad_core/`: no file changed in the commit range, so the module code was not read in full and was not compared with `skills/client-core/modules/ad-core.md`. Only the reach of the changed code into AdCore was checked. `grep` finds no reference to `is_dimmed`, `is_modal_covered`, `list_ui`, `QACore` or `maxFlatShare` in `client/godot/core/ad_core/`; its only `UICore` use is `UICore.init` and `UICore.prepare` in `tests/support/ad_test_env.gd:62` and `:81`
- `client/godot/core/ui_core/ui_core.gd`: the range added `is_dimmed`, `_is_dimmed` and `_dim_above`. Outside tests, the only caller of `is_dimmed` is `client/godot/core/qa_core/dev/qa_query.gd:271`, and these functions change no UICore state, so the AdCore flow is not reached. The correctness of `is_dimmed` itself and of QACore `list_ui` `dimmed` belongs to the UICore and QACore targets and was not judged here
- `client/godot/generated/core_settings.json`: the range removed only `uiQuality.maxFlatShare`. No code in the checkout reads that key, and `AdCore.fakePresentMs` and `AdCore.sdkCallTimeoutMs` did not change. Whether the harness removed that key correctly was not checked, because the harness is outside this target
- `server/core/ads-reward/`: no file changed in the commit range, and it was not read
- The AdCore core tests were not run, because no finding needed a run. `records/1793645028102-update-core-mvzlxt6u5be5ef.md` reports AdCore among the modules that passed `ogw core test godot` and `--web` at the end of the range. The last native run in its run log has exit code 1, which that report attributes to the skipped `AccessibilityCore`, `NativeUiCore` and `QACore`. This report was not checked against the per-module test logs
