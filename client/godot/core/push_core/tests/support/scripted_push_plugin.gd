extends Object
## Scripted native push plugin singleton of the PushCore core tests. A test registers it under the singleton name of
## `PushApnsAdapter` or `PushFcmAdapter`, so the real adapter gets its device token, launch push and notifications
## from it as from the `ogw-push-apns` or `ogw-push-fcm` plugin. The test frees it after unregistering it.

const _EVENT_NONE: int = 0
const _EVENT_TOKEN: int = 1
const _EVENT_RECEIVED: int = 2
const _EVENT_OPENED: int = 3

## Device token an ended token request gives.
var token: String = ""
## Frames a token request runs before it ends.
var token_frames: int = 2
## Launch push the first `take_launch_push` gives.
var launch_push: int = 0
var token_requests: int = 0
## `token_state` calls.
var token_polls: int = 0
## Operation IDs `cancel_token_request` got, in order.
var cancelled: PackedInt64Array = PackedInt64Array()
var _next_id: int = 0
## Frames left of each running token request, by operation ID.
var _running: Dictionary[int, int] = {}
var _kinds: PackedInt64Array = PackedInt64Array()
var _tokens: PackedStringArray = PackedStringArray()
var _message_ids: PackedInt64Array = PackedInt64Array()
var _event_token: String = ""
var _event_message_id: int = 0


## Queues a device token change to `value`.
func change_token(value: String) -> void:
	_queue(_EVENT_TOKEN, value, 0)


## Queues a remote push the app got while running.
func receive(message_id: int) -> void:
	_queue(_EVENT_RECEIVED, "", message_id)


## Queues a notification the user opened while the app ran.
func open(message_id: int) -> void:
	_queue(_EVENT_OPENED, "", message_id)


# --- singleton methods ---


func start_token_request() -> int:
	token_requests += 1
	_next_id += 1
	_running[_next_id] = token_frames
	return _next_id


func token_state(id: int) -> int:
	token_polls += 1
	if not _running.has(id):
		return 1
	var left: int = _running[id] - 1
	_running[id] = left
	return 1 if left <= 0 else 0


func take_token(id: int) -> String:
	if not _running.has(id):
		return ""
	_running.erase(id)
	return token


func cancel_token_request(id: int) -> void:
	cancelled.append(id)
	_running.erase(id)


func take_launch_push() -> int:
	var message_id: int = launch_push
	launch_push = 0
	return message_id


func next_event() -> int:
	if _kinds.is_empty():
		return _EVENT_NONE
	var kind: int = _kinds[0]
	_event_token = _tokens[0]
	_event_message_id = _message_ids[0]
	_kinds.remove_at(0)
	_tokens.remove_at(0)
	_message_ids.remove_at(0)
	return kind


func event_token() -> String:
	return _event_token


func event_message_id() -> int:
	return _event_message_id


func _queue(kind: int, value: String, message_id: int) -> void:
	_kinds.append(kind)
	_tokens.append(value)
	_message_ids.append(message_id)
