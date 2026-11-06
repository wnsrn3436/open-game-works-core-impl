# PaymentCore review round 1

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

- The commit range 97851fcb..1f87f1be changes no file of `client/godot/core/payment_core/`. The only code change is in `UICore` (`client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd`): the key direction input that starts the focus mode now puts the focus in a deferred call after the engine handled the input, and a system popup body scroll consumes the direction input in the unhandled input stage. `SystemPopupView.scroll_by` now returns `bool` and has no caller outside `UICore`.
- PaymentCore reaches that code only through `UICore.open_system_popup` for the guest warning popup (`client/godot/core/payment_core/payment_core.gd:499`). The signature and result of `open_system_popup` and the hidden callback are unchanged, and the payment-core spec defines no behavior for direction or focus input on the guest warning popup (its `## test` covers the button choices, back input and `UICore.close_all_popups`), so the change produces no PaymentCore finding.
- Checked by running `ogw core test godot PaymentCore` at 1f87f1be: all PaymentCore tests pass.
- Not checked: the correctness of the UICore focus start and scroll consumption themselves (that is the UICore review target), the PaymentCore code unchanged in the range, and a store purchase on a real device or store sandbox.
