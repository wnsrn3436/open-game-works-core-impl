# review BadgeCore round 1

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

- The commit range 97851fcb..37049e4d changes only UICore (`client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd`, their tests) and a record file. No BadgeCore file changed, and BadgeCore code does not call UICore (`UICore` is not in `## dependency` of the BadgeCore spec, and `client/godot/core/badge_core/` references it only in `tests/support/badge_test_case.gd:63`, which starts it as a test dependency). The changed behavior (deferred focus put on the key direction input that starts the focus mode, consuming an unhandled system popup body scroll input) is reached only through input events, and no BadgeCore code or test sends input or uses focus or system popups (`badge_core.gd:360` display takes no pointer input). So the BadgeCore code outside this range was not reviewed, as the range scope sets.
- BadgeCore core tests were not run: there was no finding to check, and `ogw review run` runs the tests of modules that depend on the changed module.
