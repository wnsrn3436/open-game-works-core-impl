extends PushAdapter
## Scripted push adapter of the PushCore core tests: a set device token, a held token request, the calls PushCore
## made, and the notifications a real adapter would tell.

## A held `get_device_token` resumes.
signal token_given

## Device token `get_device_token` returns while `hold` is false.
var token: String = "test-token-1"
## While true, `get_device_token` waits for `give_token`.
var hold: bool = false
var token_calls: int = 0
## Launch push the first `take_launch_push` gives.
var launch_push: int = 0
var _given: String = ""
## Notifications the next `poll` tells, in order.
var _queued: Array[Callable] = []


func get_device_token() -> String:
	token_calls += 1
	if hold:
		await token_given
		return _given
	return token


## Ends the held `get_device_token` calls with `value`.
func give_token(value: String) -> void:
	_given = value
	token_given.emit()


func take_launch_push() -> int:
	var message_id: int = launch_push
	launch_push = 0
	return message_id


## Queues a remote push that came while the app runs; the next `poll` tells PushCore, as a native adapter does.
func queue_receive(message_id: int) -> void:
	_queued.append(_notify_push_received.bind(message_id))


## Queues a notification the user pressed to come to the running app; the next `poll` tells PushCore.
func queue_open(message_id: int) -> void:
	_queued.append(_notify_push_opened.bind(message_id))


func poll() -> void:
	var queued: Array[Callable] = _queued
	_queued = []
	for notify: Callable in queued:
		notify.call()


## Tells PushCore that the OS gave a new device token.
func change_token(value: String) -> void:
	_notify_token_changed(value)


## Tells PushCore of a remote push that came while the app runs.
func receive(message_id: int) -> void:
	_notify_push_received(message_id)


## Tells PushCore that the user pressed a notification and came to the running app.
func open(message_id: int) -> void:
	_notify_push_opened(message_id)
