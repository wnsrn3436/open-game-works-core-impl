class_name PanelFlowFinishedEvent
extends EventBase
## `UICore` event: a panel transition operation that started a transition ended with success, failure or cancel, and
## the transition is over.

## The panel key the operation opened, or for a close flow the panel key it closes down to.
var panel_key: String = ""
## `true` for `open_root_panel`, `open_panel` and `open_panels`.
var is_open: bool = false
var success: bool = false
