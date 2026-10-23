class_name EventCoreDev
extends RefCounted
## DEV operations of `EventCore`: the init listeners.

const _TAG: String = "EventCore"


## `EventCore.init` calls `listener` once right before it ends, after subscriptions can be taken, in registration order
## with the other listeners. `EventCore.release` clears the registration. A custom `Callable` (a lambda or a `bind()`)
## is refused: it can stay in a static var at engine exit and be the last reference to its script. Call it before
## `init`: a call after `init`, a call from a listener during `init` included, is refused.
static func register_init_listener(listener: Callable) -> void:
	if EventCore.is_initialized():
		LogCore.log_error(_TAG, "register_init_listener: EventCore is already initialized; ignored")
		return
	if listener.is_custom():
		LogCore.log_error(_TAG, "register_init_listener: the listener is a lambda or a bind(); ignored")
		return
	if not listener.is_valid():
		LogCore.log_error(_TAG, "register_init_listener: the listener is not valid; ignored")
		return
	EventCore._init_listeners.append(listener)
