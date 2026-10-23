class_name SystemPopupButton
extends RefCounted
## One button of a `SystemPopupParam`.

## Translation key of the button label.
var label: String = ""
## Called after the system popup closed by this button. `Callable()` is skipped without a log.
var callback: Callable = Callable()
