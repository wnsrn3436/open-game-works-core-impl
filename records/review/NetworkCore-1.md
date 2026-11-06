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

- The commit range 97851fcb..6e12ce0a changes no NetworkCore file. It changes `client/godot/core/ui_core/ui_core.gd` and `client/godot/core/ui_core/system_popup_view.gd` (the key direction input that starts the focus mode is no longer marked handled and the focus is put deferred; a direction input that scrolls the top system popup body is consumed in `_on_unhandled_input`), their tests, and records. NetworkCore uses UICore only through `open_system_popup` (`client/godot/core/network_core/network_core.gd:1060`, `:1085`), `get_block_pass_list` (`:736`) and `show_loading_icon` / `hide_loading_icon` (`:710`, `:749`). None of these signatures or behaviors changed in the range; the change affects only how direction keys move focus and scroll inside a shown system popup, which NetworkCore does not set or observe. No problem caused or revealed by the range was found.
- `ogw core test godot NetworkCore` passed on this checkout (the result was reported as reused for the same inputs). The NetworkCore tests press popup buttons by tap (`client/godot/core/network_core/tests/support/network_test_case.gd:350`) and back by `KEY_ESCAPE` (`:374`); no NetworkCore test drives a system popup with key direction input, so the focus start and body scroll paths under the `network` block are covered only by the UICore tests.
- NetworkCore code outside the paths that call UICore was not reviewed in full in this round, because the range does not change it: pre-existing problems there were not searched for.
