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

- The commit range 97851fcb..37049e4d changes only UICore (`client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd`, their tests) and a record file. No file under `client/godot/core/ad_core/` changed, and AdCore code does not call UICore or MessageCore (AdCore's `## dependency` does not list them). The only contact is `client/godot/core/ad_core/tests/support/ad_test_env.gd:62` and `:81`, which init and prepare UICore for the tests; no AdCore test sends input events, so the changed direction input and system popup scroll paths are not reached. `ogw core test godot AdCore` passed (the tool reported the result as reused). AdCore code and tests outside that contact were not reviewed in this round, because they are outside the range.
