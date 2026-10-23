extends UnitTestCase
## Base of the SafeAreaCore core tests: the module setup and the test screens. The OS safe area is the virtual notch;
## the window size and the fill mode are set by `ResolutionCoreDev.set_test_screen`.

const TAG: String = "SafeAreaCore"
const LANDSCAPE: Vector2i = Vector2i(1920, 1080)
const PORTRAIT: Vector2i = Vector2i(1080, 1920)
## A max resolution that is at least both base resolutions, so that no test screen logs a ResolutionCore error.
const MAX_RESOLUTION: Array[int] = [2400, 2400]
const EventRecorder := preload("res://core/safe_area_core/tests/support/event_recorder.gd")

var _platform: String = ""
var _has_dev_code: bool = false


func before_each() -> void:
	super()
	_platform = CoreBuildInfo.platform
	_has_dev_code = CoreBuildInfo.has_dev_code
	var base: Array[int] = [LANDSCAPE.x, LANDSCAPE.y]
	assert_true(UnitTestCore.set_test_settings("baseResolution", base))
	assert_true(UnitTestCore.set_test_settings("maxResolution", MAX_RESOLUTION))


func after_each() -> void:
	super()
	SafeAreaCore.release()
	ResolutionCore.release()
	ResourceCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()
	CoreBuildInfo.platform = _platform
	CoreBuildInfo.has_dev_code = _has_dev_code


## Inits SafeAreaCore and the modules it depends on, in module list order. A platform other than `android` and `ios`
## keeps the OS safe area and keyboard height off the host display.
func init_modules(platform: String = "linux") -> void:
	CoreBuildInfo.platform = platform
	assert_true(LogCore.init())
	assert_true(EventCore.init())
	assert_true(TimeCore.init())
	assert_true(LocalDataCore.init())
	var keys: Dictionary[String, String] = {}
	ResourceCoreDev.set_test_key_list(keys)
	assert_true(ResourceCore.init())
	assert_true(ResolutionCore.init())
	assert_true(SafeAreaCore.init())


## Sets the test screen: base resolution `base`, window size `window`, `Letterbox` or `Crop`.
func set_screen(base: Vector2i, window: Vector2i, letterbox: bool = true) -> void:
	var fill_mode: ResolutionCore.FillMode = ResolutionCore.FillMode.LETTERBOX if letterbox else ResolutionCore.FillMode.CROP
	ResolutionCoreDev.set_test_screen(base, window, fill_mode, true)


## A screen of `base` scaled by 2 with no fill area.
func set_screen_without_fill(base: Vector2i) -> void:
	set_screen(base, base * 2)


func insets() -> Vector4:
	return Vector4(
		SafeAreaCore.get_inset(SafeAreaCore.Edge.LEFT),
		SafeAreaCore.get_inset(SafeAreaCore.Edge.TOP),
		SafeAreaCore.get_inset(SafeAreaCore.Edge.RIGHT),
		SafeAreaCore.get_inset(SafeAreaCore.Edge.BOTTOM),
	)


## A canvas layer under the test, freed after the test.
func new_layer() -> CanvasLayer:
	var layer: CanvasLayer = CanvasLayer.new()
	add_child_autofree(layer)
	return layer


func new_root(parent: Node) -> SafeAreaRoot:
	var root: SafeAreaRoot = SafeAreaRoot.new()
	parent.add_child(root)
	return root


## A UI element with these anchors and offsets (left, top, right, bottom), optionally with an ignore mark, added to
## `parent`.
func new_element(parent: Node, anchors: Vector4, offsets: Vector4, ignore: bool) -> Control:
	var element: Control = Control.new()
	element.anchor_left = anchors.x
	element.anchor_top = anchors.y
	element.anchor_right = anchors.z
	element.anchor_bottom = anchors.w
	element.offset_left = offsets.x
	element.offset_top = offsets.y
	element.offset_right = offsets.z
	element.offset_bottom = offsets.w
	if ignore:
		element.add_child(SafeAreaIgnore.new())
	parent.add_child(element)
	return element


## A recorder subscribed to both SafeAreaCore events, freed after the test.
func new_recorder() -> EventRecorder:
	var recorder: EventRecorder = EventRecorder.new()
	add_child_autofree(recorder)
	recorder.subscribe()
	return recorder


func assert_rect(actual: Rect2, expected: Rect2, text: String = "") -> void:
	assert_true(actual.is_equal_approx(expected), "%s expected %s, got %s" % [text, expected, actual])


func assert_vector4(actual: Vector4, expected: Vector4, text: String = "") -> void:
	assert_true(actual.is_equal_approx(expected), "%s expected %s, got %s" % [text, expected, actual])
