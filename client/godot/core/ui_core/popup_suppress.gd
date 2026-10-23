class_name PopupSuppress
extends RefCounted
## Popup suppression of one `UICore.open_popup` call: the suppress key and how long a turned on toggle suppresses it.

## Suppress key `<owner>.<name>`, following the `LocalDataCore` key rule. Example: `shop_panel.loss_warning`.
var key: String = ""
## `FOREVER`: do not show again. `TODAY`: do not show until the next day boundary.
var mode: UICore.PopupSuppressMode = UICore.PopupSuppressMode.FOREVER
