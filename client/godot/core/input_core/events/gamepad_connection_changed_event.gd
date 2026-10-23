class_name GamepadConnectionChangedEvent
extends EventBase
## `InputCore` event: the connected gamepad list changed.

## Gamepad ID of the gamepad that connected or disconnected.
var gamepad_id: int = 0
## True when it connected.
var connected: bool = false
