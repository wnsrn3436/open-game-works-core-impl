extends PushAdapter
## Push adapter over a native plugin singleton, the shared part of `PushFcmAdapter` and `PushApnsAdapter`.
##
## Singleton methods:
## - `start_token_request() -> int`: starts a device token request and returns its operation ID
## - `token_state(id: int) -> int`: 0 while the request runs, 1 when it ended
## - `take_token(id: int) -> String`: the device token of an ended request, empty when there is none; once
## - `cancel_token_request(id: int)`: the adapter stopped waiting for request `id`; the plugin drops its token
## - `take_launch_push() -> int`: the launch push message ID value the first time the process asks, else 0
## - `next_event() -> int`: takes the oldest notification: 0 none, 1 device token change, 2 remote push received,
##   3 notification opened
## - `event_token() -> String`, `event_message_id() -> int`: the payload of the notification `next_event` took
##
## A token request is read once a frame until it ends, `token_timeout_ms` passes (`TimeCore` real elapsed time) or
## `stop`.

const _EVENT_NONE: int = 0
const _EVENT_TOKEN: int = 1
const _EVENT_RECEIVED: int = 2
const _EVENT_OPENED: int = 3

var _singleton_name: String = ""
var _plugin: Object = null
## New object every `stop`: a token wait that finds another object ends.
var _life: RefCounted = RefCounted.new()


func _init(singleton_name: String) -> void:
	_singleton_name = singleton_name


func stop() -> void:
	_life = RefCounted.new()


func get_device_token() -> String:
	var plugin: Object = _find_plugin()
	if plugin == null:
		return ""
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_token_request()
	var life: RefCounted = _life
	var deadline: int = TimeCore.get_real_time() + token_timeout_ms
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null:
		await tree.process_frame
		if life != _life or not is_instance_valid(plugin) or TimeCore.get_real_time() >= deadline:
			break
		@warning_ignore("unsafe_method_access")
		var state: int = plugin.token_state(id)
		if state != 0:
			@warning_ignore("unsafe_method_access")
			var token: String = plugin.take_token(id)
			return token
	if is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		plugin.cancel_token_request(id)
	return ""


func take_launch_push() -> int:
	var plugin: Object = _find_plugin()
	if plugin == null:
		return 0
	@warning_ignore("unsafe_method_access")
	var message_id: int = plugin.take_launch_push()
	return message_id


func poll() -> void:
	var plugin: Object = _find_plugin()
	if plugin == null:
		return
	@warning_ignore("unsafe_method_access")
	var kind: int = plugin.next_event()
	while kind != _EVENT_NONE:
		if kind == _EVENT_TOKEN:
			@warning_ignore("unsafe_method_access")
			var token: String = plugin.event_token()
			_notify_token_changed(token)
		elif kind == _EVENT_RECEIVED:
			@warning_ignore("unsafe_method_access")
			var received: int = plugin.event_message_id()
			_notify_push_received(received)
		elif kind == _EVENT_OPENED:
			@warning_ignore("unsafe_method_access")
			var opened: int = plugin.event_message_id()
			_notify_push_opened(opened)
		@warning_ignore("unsafe_method_access")
		kind = plugin.next_event()


func _find_plugin() -> Object:
	if not is_instance_valid(_plugin) and Engine.has_singleton(_singleton_name):
		_plugin = Engine.get_singleton(_singleton_name)
	return _plugin if is_instance_valid(_plugin) else null
