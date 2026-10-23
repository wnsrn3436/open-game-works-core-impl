class_name UtilStateMachine
extends RefCounted
## General state machine. Make it with `UtilCore.create_state_machine` and drive it with `UtilCore.change_state`,
## `UtilCore.update_state`, `UtilCore.current_state`, `UtilCore.previous_state` and `UtilCore.state_elapsed_ms`.

## Allowed next states of each from state.
var _next_states: Dictionary[int, PackedInt64Array] = {}
## Callbacks of each listed state. `null` when the state has no callbacks.
var _callbacks: Dictionary[int, UtilStateCallbacks] = {}
var _current: int = 0
var _previous: int = 0
var _elapsed_ms: int = 0
## True during steps 2 to 4 of `change_state`.
var _in_transition: bool = false
