class_name NativeUiCore
extends RefCounted
## OS store review request window and share window through the native adapter of the platform, the screen capture
## for a share, and text copy to the OS clipboard. The three are OS features, not external services, and have no
## adapter key.

enum ReviewResult { REQUESTED, THROTTLED, UNSUPPORTED, FAILED }
enum ShareResult { CLOSED, BUSY, UNSUPPORTED, FAILED }

const _TAG: String = "NativeUiCore"
const _REVIEW_INTERVAL_KEY: String = "NativeUiCore.reviewMinIntervalMs"
const _TEXT_MAX_KEY: String = "NativeUiCore.shareTextMaxChars"
const _IMAGE_MAX_KEY: String = "NativeUiCore.shareImageMaxBytes"
const _SETTINGS_KEYS: PackedStringArray = [_REVIEW_INTERVAL_KEY, _TEXT_MAX_KEY, _IMAGE_MAX_KEY]
## `device` local data key: device time (Unix ms) of the last store review request.
const _KEY_LAST_REVIEW_AT: String = "NativeUiCore.last_review_at"
## Default of the `_KEY_LAST_REVIEW_AT` read: a missing value. No stored device time is this value.
const _NO_TIME: int = -9223372036854775807 - 1
const _HEADLESS: String = "headless"
## Browser runtime: `"1"` when the page may write the clipboard now. The engine clipboard writes through
## `navigator.clipboard.writeText`, which the browser refuses outside a secure context and without a transient user
## activation; the engine does not report that refusal.
const _WEB_CLIPBOARD_CHECK: String = (
	"(function(){var c=navigator.clipboard;if(!c||!c.writeText||!window.isSecureContext){return \"0\";}"
	+ "var a=navigator.userActivation;return (a&&!a.isActive)?\"0\":\"1\";})()"
)
const _CORE_NODE := preload("res://core/native_ui_core/native_ui_core_node.gd")
const _WAIT := preload("res://core/native_ui_core/native_ui_wait.gd")

static var _is_initialized: bool = false
static var _node: Node = null
## New object every `init`. An async operation that finds another one after an `await` stops with its failure value.
static var _session: RefCounted = null
static var _adapter: NativeUiAdapter = null
static var _review_min_interval_ms: int = 0
static var _share_text_max_chars: int = 0
static var _share_image_max_bytes: int = 0
## True after this boot returned `Requested`.
static var _review_requested: bool = false
## Wait of the `share` in progress. `null` when no `share` is in progress.
static var _share_wait: _WAIT = null
## True between `AppBackgroundEnteredEvent` and `AppForegroundReturnedEvent`.
static var _in_background: bool = false
## Waits of the `capture_screen` calls for the end of the frame they hid the `Debug` layer in.
static var _capture_waits: Array[_WAIT] = []
## `Debug` layer the captures hid, and its visibility before. `null` when no capture hides it.
static var _hidden_layer: CanvasLayer = null
static var _hidden_layer_visible: bool = false
## Result of the fake adapter's `request_review`. Changed only by `NativeUiCoreDev`.
static var _fake_review_result: bool = true
## Result of the fake adapter's `share`. Changed only by `NativeUiCoreDev`.
static var _fake_share_result: ShareResult = ShareResult.CLOSED


## Sets the native adapter of the platform, or none. Called before `init`; after `init` it is ignored.
static func set_native_adapter(adapter: NativeUiAdapter) -> void:
	if _is_initialized:
		LogCore.log_error(_TAG, "set_native_adapter called after init; the adapter stays")
		return
	_adapter = adapter


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	for key: String in _SETTINGS_KEYS:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init: core settings key %s is missing or not an integer" % key)
			return false
	var node: _CORE_NODE = _CORE_NODE.new()
	if (
		not EventCore.subscribe(AppBackgroundEnteredEvent, node._on_background_entered)
		or not EventCore.subscribe(AppForegroundReturnedEvent, node._on_foreground_returned)
	):
		LogCore.log_error(_TAG, "init: could not subscribe to the background events")
		EventCore.unsubscribe_all(node)
		node.free()
		return false
	_review_min_interval_ms = CoreSettings.get_int(_REVIEW_INTERVAL_KEY)
	_share_text_max_chars = CoreSettings.get_int(_TEXT_MAX_KEY)
	_share_image_max_bytes = CoreSettings.get_int(_IMAGE_MAX_KEY)
	_session = RefCounted.new()
	_node = node
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: Node = _node
	if is_instance_valid(node):
		var core_node: _CORE_NODE = node as _CORE_NODE
		core_node.released = true
		core_node.stop_frame_watch()
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()
	_clean_up()


static func is_initialized() -> bool:
	return _is_initialized


## Asks the OS for the store review request window. `Requested` means the OS got the request, not that it showed
## the window.
static func request_review() -> ReviewResult:
	if not _check_initialized("request_review"):
		return ReviewResult.FAILED
	if _adapter == null or not _adapter.supports_review():
		return ReviewResult.UNSUPPORTED
	var now: int = TimeCore.get_device_time()
	var last: int = LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _KEY_LAST_REVIEW_AT, _NO_TIME)
	if last != _NO_TIME and now - last < _review_min_interval_ms:
		return ReviewResult.THROTTLED
	if _review_requested:
		return ReviewResult.THROTTLED
	if not _adapter.request_review():
		LogCore.log_error(_TAG, "request_review: the adapter reported a failure")
		return ReviewResult.FAILED
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, _KEY_LAST_REVIEW_AT, now)
	_review_requested = true
	return ReviewResult.REQUESTED


## Whether the share window can be opened: an adapter that supports a share without an image.
static func can_share() -> bool:
	if not _check_initialized("can_share"):
		return false
	return _adapter != null and _adapter.supports_share(false)


## PNG of the screen at the window resolution, drawn after the frame ends, without the `UICore` `Debug` layer.
## Empty in a headless run. Async.
static func capture_screen() -> PackedByteArray:
	if not _check_initialized("capture_screen"):
		return PackedByteArray()
	if DisplayServer.get_name() == _HEADLESS:
		LogCore.log_warn(_TAG, "capture_screen: no screen in a headless run")
		return PackedByteArray()
	var session: RefCounted = _session
	if _capture_waits.is_empty():
		var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.DEBUG)
		if layer == null:
			LogCore.log_error(_TAG, "capture_screen: UICore gave no Debug layer")
			return PackedByteArray()
		if not (_node as _CORE_NODE).start_frame_watch():
			LogCore.log_error(_TAG, "capture_screen: could not wait for the drawn frame")
			return PackedByteArray()
		_hidden_layer = layer
		_hidden_layer_visible = layer.visible
		layer.visible = false
	var wait: _WAIT = _WAIT.new()
	_capture_waits.append(wait)
	await wait.done
	if session != _session or not wait.ok:
		return PackedByteArray()
	return wait.png


## Opens the share window with `content` and waits until it closes and the app is back in the foreground. `Closed`
## does not tell whether the user shared. Async.
static func share(content: ShareContent) -> ShareResult:
	if not _check_initialized("share"):
		return ShareResult.FAILED
	if _share_wait != null:
		return ShareResult.BUSY
	if content == null:
		LogCore.log_error(_TAG, "share: no share content")
		return ShareResult.FAILED
	var text: String = content.text
	var image: PackedByteArray = content.image
	if text.is_empty() and image.is_empty():
		LogCore.log_error(_TAG, "share: the text and the image are both empty")
		return ShareResult.FAILED
	if _adapter == null or not _adapter.supports_share(not image.is_empty()):
		return ShareResult.UNSUPPORTED
	if text.length() > _share_text_max_chars:
		LogCore.log_error(
			_TAG, "share: the text has %d code points, more than %d" % [text.length(), _share_text_max_chars]
		)
		return ShareResult.FAILED
	if image.size() > _share_image_max_bytes:
		LogCore.log_error(_TAG, "share: the image has %d bytes, more than %d" % [image.size(), _share_image_max_bytes])
		return ShareResult.FAILED
	var session: RefCounted = _session
	var wait: _WAIT = _WAIT.new()
	_share_wait = wait
	_run_adapter_share(wait, _adapter, text, image)
	if not wait.finished:
		await wait.done
	if session != _session:
		return ShareResult.FAILED
	return wait.result as ShareResult


## Copies `text` to the OS clipboard with the engine clipboard. `false` for an empty text, a platform with no
## clipboard and a headless run, and the clipboard stays. In the browser runtime the engine gives no clipboard while
## the page may not write it (see `_WEB_CLIPBOARD_CHECK`).
static func copy_text(text: String) -> bool:
	if not _check_initialized("copy_text"):
		return false
	if text.is_empty():
		LogCore.log_error(_TAG, "copy_text: empty text")
		return false
	if DisplayServer.get_name() == _HEADLESS:
		LogCore.log_warn(_TAG, "copy_text: no clipboard in a headless run")
		return false
	if not DisplayServer.has_feature(DisplayServer.FEATURE_CLIPBOARD):
		LogCore.log_warn(_TAG, "copy_text: the platform gives no clipboard")
		return false
	if not _browser_clipboard_writable():
		LogCore.log_warn(_TAG, "copy_text: the browser refuses a clipboard write now (no user input, or no Clipboard API)")
		return false
	DisplayServer.clipboard_set(text)
	return true


## Whether the page may write the clipboard now. Always true outside the browser runtime.
# ogw:input_boundary
static func _browser_clipboard_writable() -> bool:
	if OS.get_name() != "Web":
		return true
	var reply: Variant = JavaScriptBridge.eval(_WEB_CLIPBOARD_CHECK, true)
	return reply is String and reply == "1"


# --- share ---


## Waits for the adapter's share and hands its result to `wait`, unless `wait` stopped in the meantime.
static func _run_adapter_share(wait: _WAIT, adapter: NativeUiAdapter, text: String, image: PackedByteArray) -> void:
	var result: ShareResult = await adapter.share(text, image)
	if wait != _share_wait:
		return
	if result < ShareResult.CLOSED or result > ShareResult.FAILED:
		LogCore.log_error(_TAG, "share: the adapter returned %d, which is no ShareResult" % result)
		result = ShareResult.FAILED
	elif result == ShareResult.FAILED:
		LogCore.log_error(_TAG, "share: the adapter reported a failure")
	wait.result = result
	wait.ok = true
	if not _in_background:
		_end_share()


## Ends the `share` in progress with the result its wait holds.
static func _end_share() -> void:
	var wait: _WAIT = _share_wait
	_share_wait = null
	if wait != null:
		wait.finish()


# --- core node callbacks ---


static func _on_background_entered() -> void:
	_in_background = true


## The app is back in the foreground: a `share` whose window already closed returns now.
static func _on_foreground_returned() -> void:
	_in_background = false
	if _share_wait != null and _share_wait.ok:
		_end_share()


## The frame of the waiting captures is drawn: reads the screen once, puts the `Debug` layer back, then resumes the
## waits, so that a capture returns with the `Debug` layer shown again.
static func _on_frame_post_draw() -> void:
	var waits: Array[_WAIT] = _capture_waits
	_capture_waits = []
	var png: PackedByteArray = _read_screen()
	_show_hidden_layer()
	for wait: _WAIT in waits:
		wait.ok = true
		wait.png = png
		wait.finish()


## The core node left the tree outside `release`: the same clean-up as `release`, without detaching it.
static func _on_node_exit() -> void:
	if not _is_initialized:
		return
	if is_instance_valid(_node):
		(_node as _CORE_NODE).stop_frame_watch()
	if EventCore.is_initialized() and is_instance_valid(_node):
		EventCore.unsubscribe_all(_node)
	_clean_up()


# --- helpers ---


## Reads the root viewport. Empty bytes with an error log when the engine gives no image.
static func _read_screen() -> PackedByteArray:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	var texture: ViewportTexture = tree.root.get_texture()
	var image: Image = texture.get_image() if texture != null else null
	if image == null or image.is_empty():
		LogCore.log_error(_TAG, "capture_screen: the engine gave no screen image")
		return PackedByteArray()
	var window_size: Vector2i = DisplayServer.window_get_size()
	if window_size.x > 0 and window_size.y > 0 and image.get_size() != window_size:
		image.resize(window_size.x, window_size.y, Image.INTERPOLATE_BILINEAR)
	var png: PackedByteArray = image.save_png_to_buffer()
	if png.is_empty():
		LogCore.log_error(_TAG, "capture_screen: PNG encoding failed")
	return png


static func _show_hidden_layer() -> void:
	if is_instance_valid(_hidden_layer):
		_hidden_layer.visible = _hidden_layer_visible
	_hidden_layer = null
	_hidden_layer_visible = false


## Stops the operations in progress with their failure value and puts every static var back to its initial value.
static func _clean_up() -> void:
	var share_wait: _WAIT = _share_wait
	var capture_waits: Array[_WAIT] = _capture_waits
	if _adapter != null:
		_adapter.stop()
	_show_hidden_layer()
	_is_initialized = false
	_node = null
	_session = null
	_adapter = null
	_review_min_interval_ms = 0
	_share_text_max_chars = 0
	_share_image_max_bytes = 0
	_review_requested = false
	_share_wait = null
	_in_background = false
	_capture_waits = []
	_fake_review_result = true
	_fake_share_result = ShareResult.CLOSED
	if share_wait != null:
		share_wait.finish()
	for wait: _WAIT in capture_waits:
		wait.finish()


static func _check_initialized(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, "%s called before init" % operation)
	return false
