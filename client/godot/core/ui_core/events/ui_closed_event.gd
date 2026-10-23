class_name UIClosedEvent
extends EventBase
## `UICore` event: a panel or popup instance was destroyed. A popup's comes after its hidden callback.

## Panel key or popup key.
var key: String = ""
var is_panel: bool = false
## `CLOSED` for a popup.
var reason: UICore.PanelCloseReason = UICore.PanelCloseReason.CLOSED
