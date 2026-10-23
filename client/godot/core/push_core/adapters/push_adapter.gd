class_name PushAdapter
extends RefCounted
## Base of the push adapters. A push adapter wraps the OS push service: the device token and the remote pushes.
## `BootstrapCore` passes one with `PushCore.set_push_adapter`. Only PushCore calls it.
##
## An adapter tells PushCore of a device token change, a remote push it got and an opened notification through
## `_notify_token_changed`, `_notify_push_received` and `_notify_push_opened`, between `start` and `stop`. It tells
## them from `poll`, which PushCore calls every frame, or right away.


## Called with the new device token on a device token change. Set by `PushCore`.
var on_token_changed: Callable = Callable()
## Called with the message ID value of a remote push that came while the app runs. Set by `PushCore`.
var on_push_received: Callable = Callable()
## Called with the message ID value of a notification the user pressed to come to the running app. Set by `PushCore`.
var on_push_opened: Callable = Callable()
## Time limit of `get_device_token`, ms: `PushCore.deviceTokenTimeoutMs`. Set by `PushCore.init`.
var token_timeout_ms: int = 0


## PushCore `init` took this adapter.
func start() -> void:
	pass


## PushCore `release` dropped this adapter. A running `get_device_token` ends with no token.
func stop() -> void:
	pass


## Async. The device token, or an empty string when there is none.
func get_device_token() -> String:
	return ""


## Message ID value of the remote push whose notification started the app, the first time the process asks; else 0.
func take_launch_push() -> int:
	return 0


## Frame check: tells PushCore of the notifications that came since the last frame.
func poll() -> void:
	pass


## Tells `PushCore` of a device token change.
func _notify_token_changed(token: String) -> void:
	if on_token_changed.is_valid():
		on_token_changed.call(token)


## Tells `PushCore` of a remote push that came while the app runs.
func _notify_push_received(message_id: int) -> void:
	if on_push_received.is_valid():
		on_push_received.call(message_id)


## Tells `PushCore` that the user pressed a notification and came to the running app.
func _notify_push_opened(message_id: int) -> void:
	if on_push_opened.is_valid():
		on_push_opened.call(message_id)
