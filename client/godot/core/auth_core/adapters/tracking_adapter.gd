extends RefCounted
## Device tracking state and the tracking permission request (iOS App Tracking Transparency) through the
## `ogw-tracking` plugin singleton. `get_status` returns a `CoreContract.TrackingStatus` value; `start_request`
## returns an operation ID, and `take_result` returns an empty array until the user answers, then `[<status>]`.
## `cancel(id)` tells the plugin that the adapter stopped waiting for request `id`: the plugin drops its answer. The
## adapter reads the plugin once a frame until the answer comes or `stop`; the request has no time limit.

const _SINGLETON: String = "OgwTracking"

## New object every `stop`: a request wait that finds another object ends.
var _life: RefCounted = RefCounted.new()


## Device tracking state: the OS value on `ios`, `TRACKING_STATUS_NOT_APPLICABLE` on other platforms.
func get_status() -> CoreContract.TrackingStatus:
	if CoreBuildInfo.platform != "ios":
		return CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE
	var plugin: Object = _plugin()
	if plugin == null:
		return CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED
	@warning_ignore("unsafe_method_access")
	var status: int = plugin.get_status()
	return _to_status(status)


## Shows the OS tracking permission request and waits for the answer.
func request() -> CoreContract.TrackingStatus:
	var plugin: Object = _plugin()
	if plugin == null:
		return get_status()
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_request()
	if id <= 0:
		return get_status()
	var life: RefCounted = _life
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null and life == _life and is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		var raw: PackedInt32Array = plugin.take_result(id)
		if raw.size() == 1:
			return _to_status(raw[0])
		await tree.process_frame
	if not is_instance_valid(plugin):
		return CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED
	@warning_ignore("unsafe_method_access")
	plugin.cancel(id)
	return get_status()


## Ends a running `request` at its next frame. `AuthCore.release` calls it.
func stop() -> void:
	_life = RefCounted.new()


func _plugin() -> Object:
	if not Engine.has_singleton(_SINGLETON):
		return null
	return Engine.get_singleton(_SINGLETON)


func _to_status(value: int) -> CoreContract.TrackingStatus:
	if (
		value < CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE
		or value > CoreContract.TrackingStatus.TRACKING_STATUS_RESTRICTED
	):
		return CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED
	return value as CoreContract.TrackingStatus
