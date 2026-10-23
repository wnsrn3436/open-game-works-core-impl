class_name NativeUiPluginAdapter
extends NativeUiAdapter
## Native adapter of `android`, `ios` and `macos` through the `ogw-native-ui` plugin singleton: Google Play In-App
## Review API and Android Sharesheet (`ACTION_SEND`) on `android`, `SKStoreReviewController` and
## `UIActivityViewController` on `ios`, `SKStoreReviewController` and `NSSharingServicePicker` on `macos`.
## `request_review` returns whether the OS took the request. `start_share` returns an operation ID (0 when the window
## cannot open), and `take_share_result` returns an empty array until the window closes, then `[<status>]` once.
## Status 0 is closed, 1 failed. `cancel_share(id)` tells the plugin that the adapter stopped waiting for share `id`:
## the plugin drops its result. The adapter reads the plugin once a frame until the result comes or `stop`.

const _SINGLETON: String = "OgwNativeUi"
const _PLATFORMS: PackedStringArray = ["android", "ios", "macos"]
const _STATUS_CLOSED: int = 0

## New object every `stop`: a share wait that finds another object ends.
var _life: RefCounted = RefCounted.new()


func supports_review() -> bool:
	return _plugin() != null


func request_review() -> bool:
	var plugin: Object = _plugin()
	if plugin == null:
		return false
	@warning_ignore("unsafe_method_access")
	var requested: bool = plugin.request_review()
	return requested


func supports_share(_has_image: bool) -> bool:
	return _plugin() != null


func share(text: String, image: PackedByteArray) -> NativeUiCore.ShareResult:
	var plugin: Object = _plugin()
	if plugin == null:
		return NativeUiCore.ShareResult.UNSUPPORTED
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_share(text, image)
	if id <= 0:
		return NativeUiCore.ShareResult.FAILED
	var life: RefCounted = _life
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null and life == _life and is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		var raw: PackedInt32Array = plugin.take_share_result(id)
		if raw.size() == 1:
			return NativeUiCore.ShareResult.CLOSED if raw[0] == _STATUS_CLOSED else NativeUiCore.ShareResult.FAILED
		if raw.size() != 0:
			return NativeUiCore.ShareResult.FAILED
		await tree.process_frame
	if is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		plugin.cancel_share(id)
	return NativeUiCore.ShareResult.FAILED


func stop() -> void:
	_life = RefCounted.new()


## The plugin singleton on a platform of this adapter; `null` elsewhere and when the plugin is not in the build.
func _plugin() -> Object:
	if not CoreBuildInfo.platform in _PLATFORMS or not Engine.has_singleton(_SINGLETON):
		return null
	return Engine.get_singleton(_SINGLETON)
