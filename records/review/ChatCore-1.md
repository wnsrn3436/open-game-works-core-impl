# review ChatCore round 1

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

- The commit range 97851fcb..476972c0 changes only UICore (`client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd`, their tests), a record file and review files of other modules. No ChatCore file changed. ChatCore code does not call UICore: `UICore` is not in `## dependency` of the ChatCore spec, and `client/godot/core/chat_core/` references it only in `tests/support/chat_test_case.gd:98` and `:111`, which start it as a test dependency (`UICore.init`, `UICore.prepare`). The `init` change only stores another deferred callable. The changed behavior (deferred focus put on the key direction input that starts the focus mode, consuming an unhandled system popup body scroll input) is reached only through input events, and no ChatCore code or test sends input or uses focus or system popups. So the ChatCore code outside this range was not reviewed, as the range scope sets.
- ChatCore core tests were not run: there was no finding to check, and `ogw review run` runs the tests of modules that depend on the changed module.
