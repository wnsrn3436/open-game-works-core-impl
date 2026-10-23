class_name UtilStateCallbacks
extends RefCounted
## Callbacks of one state of a `UtilStateMachine`. Each one may be left as `Callable()`.

## `on_enter(previous_state: int)`: called after the machine entered this state.
var on_enter: Callable = Callable()
## `on_exit(next_state: int)`: called before the machine leaves this state.
var on_exit: Callable = Callable()
## `on_update(elapsed_ms: int)`: called by `UtilCore.update_state` while this is the current state.
var on_update: Callable = Callable()
