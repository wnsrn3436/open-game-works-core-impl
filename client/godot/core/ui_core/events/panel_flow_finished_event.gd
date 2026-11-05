class_name PanelFlowFinishedEvent
extends EventBase
## `UICore` event: a panel transition operation that started a transition ended with success, failure or cancel, and
## the transition is over.

## `true` for `open_root_panel`, `open_panel` and `open_panels`.
var is_open: bool = false
var success: bool = false
