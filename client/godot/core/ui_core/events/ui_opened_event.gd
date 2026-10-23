class_name UIOpenedEvent
extends EventBase
## `UICore` event: a panel transition that showed a panel, or the open flow of a popup, ended.

## Panel key or popup key.
var key: String = ""
var is_panel: bool = false
## `NEW` for a popup.
var reason: UICore.PanelOpenReason = UICore.PanelOpenReason.NEW
