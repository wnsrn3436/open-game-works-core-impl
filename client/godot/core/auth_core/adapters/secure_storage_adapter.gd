extends "res://core/auth_core/adapters/token_storage.gd"
## Login token storage in OS secure storage through the `ogw-secure-storage` plugin singleton. The plugin runs an
## operation off the main thread: `start_read`, `start_write` and `start_remove` return an operation ID, and
## `take_result` returns an empty array until the operation ends, then `[<status>, <text>]` once. `cancel(id)` tells
## the plugin that the adapter stopped waiting for operation `id`: the plugin drops it.
##
## The adapter reads the plugin once a frame until the result comes or `call_timeout_ms` passes. AuthCore does not
## cancel a storage operation at `release` (it ends only the caller's wait), so this wait has no `stop` and can outlive
## `release` and `TimeCore`: it counts the `TimeCore` real elapsed time while `TimeCore` runs, also across a new
## `TimeCore.init`.

const _SINGLETON: String = "OgwSecureStorage"


func read_item(name: String) -> Outcome:
	var plugin: Object = _plugin()
	if plugin == null:
		return Outcome.new(Status.UNSUPPORTED)
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_read(name)
	return await _result(plugin, id)


func write_item(name: String, text: String) -> Outcome:
	var plugin: Object = _plugin()
	if plugin == null:
		return Outcome.new(Status.UNSUPPORTED)
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_write(name, text)
	return await _result(plugin, id)


func remove_item(name: String) -> Outcome:
	var plugin: Object = _plugin()
	if plugin == null:
		return Outcome.new(Status.UNSUPPORTED)
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_remove(name)
	return await _result(plugin, id)


## Whether the `ogw-secure-storage` plugin singleton is in this run.
static func is_available() -> bool:
	return Engine.has_singleton(_SINGLETON)


func _plugin() -> Object:
	if not is_available():
		return null
	return Engine.get_singleton(_SINGLETON)


## Waits for the end of plugin operation `id`. `FAILED` when it did not start, ended with a malformed result, did not
## end within `call_timeout_ms` (then the plugin is told with `cancel`), or the plugin went away.
func _result(plugin: Object, id: int) -> Outcome:
	if id <= 0:
		return Outcome.new(Status.FAILED)
	var limit: int = call_timeout_ms
	var elapsed: int = 0
	var last: int = _real_time()
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null and is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		var raw: PackedStringArray = plugin.take_result(id)
		if raw.size() == 2:
			return _outcome(raw)
		if raw.size() != 0:
			return Outcome.new(Status.FAILED)
		var now: int = _real_time()
		# A new `TimeCore.init` starts its real elapsed time again from 0: that step adds nothing.
		if last >= 0 and now >= last:
			elapsed += now - last
		last = now
		if elapsed >= limit:
			@warning_ignore("unsafe_method_access")
			plugin.cancel(id)
			return Outcome.new(Status.FAILED)
		await tree.process_frame
	return Outcome.new(Status.FAILED)


## `TimeCore` real elapsed time, or -1 while `TimeCore` does not run.
static func _real_time() -> int:
	return TimeCore.get_real_time() if TimeCore.is_initialized() else -1


func _outcome(raw: PackedStringArray) -> Outcome:
	if not raw[0].is_valid_int():
		return Outcome.new(Status.FAILED)
	var code: int = raw[0].to_int()
	if code < Status.OK or code > Status.FAILED:
		return Outcome.new(Status.FAILED)
	return Outcome.new(code as Status, raw[1] if code == Status.OK else "")
