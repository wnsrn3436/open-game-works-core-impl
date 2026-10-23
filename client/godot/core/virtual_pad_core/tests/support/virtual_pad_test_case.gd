class_name VirtualPadTestCase
extends UnitTestCase
## Base of the VirtualPadCore core tests. Before each test: the test settings (dead zone 0, sensitivity 1000), the test
## actions in the input map, the test key list, the modules VirtualPadCore and UICore depend on, UICore with
## `prepare` and VirtualPadCore initialized in module list order on a 1920x1080 `Letterbox` test screen, touch
## support and the input device `Touch`, no saved user settings, a test scope for the layouts and a recorder of the
## gesture events. After each test: the modules released, the input map back to the project settings, the test nodes
## freed.

const TAG: String = "VirtualPadCore"
const RESOURCES: String = "res://core/virtual_pad_core/tests/resources/"
const LAYOUT_FIXED: String = "prefab/virtual_pad_test_fixed"
const LAYOUT_FLOATING: String = "prefab/virtual_pad_test_floating"
const LAYOUT_FOLLOWING: String = "prefab/virtual_pad_test_following"
const LAYOUT_OTHER: String = "prefab/virtual_pad_test_other"
const LAYOUT_OVERLAP: String = "prefab/virtual_pad_test_overlap"
const NOT_LAYOUT: String = "prefab/virtual_pad_test_not_layout"
const BAD_CHILD: String = "prefab/virtual_pad_test_bad_child"
## Layout prefabs that each break one value condition of the layout prefab attributes, by resource path.
const BAD_VALUE_LAYOUTS: Dictionary[String, String] = {
	"prefab/virtual_pad_test_bad_mode": "test_layout_bad_mode.tscn",
	"prefab/virtual_pad_test_bad_name": "test_layout_bad_name.tscn",
	"prefab/virtual_pad_test_bad_action": "test_layout_bad_action.tscn",
	"prefab/virtual_pad_test_bad_direction": "test_layout_bad_direction.tscn",
	"prefab/virtual_pad_test_zero_radius": "test_layout_zero_radius.tscn",
	"prefab/virtual_pad_test_infinite_radius": "test_layout_infinite_radius.tscn",
	"prefab/virtual_pad_test_base_outside": "test_layout_base_outside.tscn",
	"prefab/virtual_pad_test_base_not_below": "test_layout_base_not_below.tscn",
	"prefab/virtual_pad_test_handle_not_below": "test_layout_handle_not_below.tscn",
}
const POPUP: String = "prefab/virtual_pad_test_popup"
## Not in the test key list.
const MISSING: String = "prefab/virtual_pad_test_missing"
## The resource key of `[ui_button_click]` in the core test data.
const CLICK: String = "sfx/ui_button_click"
## Joystick `stick` of the test layouts: area (100, 500)-(500, 900), base default (200, 200) in it, radius 100.
const STICK: String = "stick"
const RADIUS: float = 100.0
const BASE_DEFAULT: Vector2 = Vector2(200.0, 200.0)
## Button `fire` of the test layouts.
const FIRE: String = "fire"
const LEFT: StringName = &"move_left"
const RIGHT: StringName = &"move_right"
const UP: StringName = &"move_up"
const DOWN: StringName = &"move_down"
const FIRE_ACTION: StringName = &"fire"
const JUMP_ACTION: StringName = &"jump"
const NAMES_KEY: String = "VirtualPadCore.element_names"
const OFFSET_X_KEY: String = "VirtualPadCore.offset_x"
const OFFSET_Y_KEY: String = "VirtualPadCore.offset_y"
const SCALE_KEY: String = "VirtualPadCore.scale"
const OPACITY_KEY: String = "VirtualPadCore.opacity"
const DEVICE: LocalDataCore.FileKind = LocalDataCore.FileKind.DEVICE
const EPSILON: float = 0.001

var recorder: VirtualPadTestRecorder = null
## Scope of the layouts the tests open.
var scope: Scope = null
var _nodes: Array[Node] = []


func before_each() -> void:
	super()
	set_settings(0, 1000)
	add_test_actions()
	get_viewport().gui_release_focus()
	assert_true(await start_modules(), "modules start")
	scope = ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, "virtual_pad_test")
	recorder = VirtualPadTestRecorder.new()
	keep(recorder)
	get_tree().root.add_child(recorder)
	assert_true(recorder.subscribe_all(), "recorder subscribes")


func after_each() -> void:
	super()
	release_modules()
	InputMap.load_from_project_settings()
	for node: Node in _nodes:
		if is_instance_valid(node):
			node.free()
	_nodes.clear()
	recorder = null
	scope = null


## Dead zone and sensitivity (permille) as test settings. Call before `VirtualPadCore.init`.
func set_settings(dead_zone: int, sensitivity: int) -> void:
	assert_true(UnitTestCore.set_test_settings("VirtualPadCore.deadZonePermille", dead_zone))
	assert_true(UnitTestCore.set_test_settings("VirtualPadCore.sensitivityPermille", sensitivity))


## The direction actions of `stick`, `fire` and `jump`. Call before `InputCore.init`.
func add_test_actions() -> void:
	for action: StringName in [LEFT, RIGHT, UP, DOWN, FIRE_ACTION, JUMP_ACTION]:
		if InputMap.has_action(action):
			InputMap.erase_action(action)
		InputMap.add_action(action)


func resource_keys() -> Dictionary[String, String]:
	var keys: Dictionary[String, String] = {
		LAYOUT_FIXED: RESOURCES + "test_layout_fixed.tscn",
		LAYOUT_FLOATING: RESOURCES + "test_layout_floating.tscn",
		LAYOUT_FOLLOWING: RESOURCES + "test_layout_following.tscn",
		LAYOUT_OTHER: RESOURCES + "test_layout_other.tscn",
		LAYOUT_OVERLAP: RESOURCES + "test_layout_overlap.tscn",
		NOT_LAYOUT: RESOURCES + "test_not_layout.tscn",
		BAD_CHILD: RESOURCES + "test_layout_bad_child.tscn",
		POPUP: RESOURCES + "test_popup.tscn",
		CLICK: RESOURCES + "test_click.tres",
	}
	for key: String in BAD_VALUE_LAYOUTS:
		keys[key] = RESOURCES + BAD_VALUE_LAYOUTS[key]
	return keys


## Starts the modules in module list order with the core test data, `UICore.prepare`, then VirtualPadCore with touch
## support and the input device `Touch`. Async.
func start_modules() -> bool:
	ResourceCoreDev.set_test_key_list(resource_keys())
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init()
		and LocalDataCore.load_device_file() and ResourceCore.init() and PoolCore.init() and DataCore.init()
		and InputBlockCore.init() and ResolutionCore.init()
	)
	if not started:
		return false
	ResolutionCoreDev.set_test_screen(Vector2i(1920, 1080), Vector2i(1920, 1080), ResolutionCore.FillMode.LETTERBOX, true)
	started = InputCore.init() and LocalizationCore.init() and SoundCore.init() and SafeAreaCore.init() \
		and TweenCore.init()
	if not started:
		return false
	if not await DataCore.load(null):
		return false
	LocalizationCore.resolve_language()
	if not await LocalizationCore.load_translation([]):
		return false
	if not UICore.init() or not await UICore.prepare():
		return false
	if not VirtualPadCore.init():
		return false
	VirtualPadCoreDev.set_test_touch_support(true)
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	VirtualPadCore.reset_user_settings()
	return true


func release_modules() -> void:
	VirtualPadCore.release()
	UICore.release()
	TweenCore.release()
	SafeAreaCore.release()
	SoundCore.release()
	LocalizationCore.release()
	InputCore.release()
	ResolutionCore.release()
	InputBlockCore.release()
	DataCore.release()
	PoolCore.release()
	ResourceCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()


## `release` and `init` of VirtualPadCore with touch support, as after a settings change.
func restart_virtual_pad() -> bool:
	VirtualPadCore.release()
	if not VirtualPadCore.init():
		return false
	VirtualPadCoreDev.set_test_touch_support(true)
	return true


## Opens `key` with the test scope and checks that it opened. Async.
func open(key: String) -> bool:
	var ok: bool = await VirtualPadCore.open_layout(key, scope)
	assert_true(ok, "open_layout " + key)
	return ok


# --- virtual pad nodes


## The element `element_name` of the virtual pad.
func element(element_name: String) -> Control:
	var pad: VirtualPadLayout = VirtualPadCore._pad
	if pad == null:
		return null
	return pad.get_node_or_null(NodePath(element_name)) as Control


func stick_base() -> Control:
	return (element(STICK) as VirtualPadJoystick).base


func stick_handle() -> Control:
	return (element(STICK) as VirtualPadJoystick).handle


## Center of `target` in the local coordinates of `control`.
func center_in(control: Control, target: Control) -> Vector2:
	return control.get_global_transform().affine_inverse() * (target.get_global_transform() * (target.size * 0.5))


## Area of `control` in canvas coordinates, its scale included.
func area_of(control: Control) -> Rect2:
	return control.get_global_rect()


## The safe area root of the `VirtualPad` layer.
func safe_root() -> Control:
	return VirtualPadCore._safe_root


## Game coordinates of `local` in `control`.
func game_point(control: Control, local: Vector2) -> Vector2:
	return canvas_to_game(control.get_global_transform_with_canvas() * local)


## Game coordinates of the canvas point `canvas`: its real window pixel position in the test screen's window pixels.
## The headless window is smaller than the test screen.
func canvas_to_game(canvas: Vector2) -> Vector2:
	var real: Vector2 = Vector2(get_tree().root.size)
	var scale: Vector2 = Vector2(ResolutionCore.get_window_size()) / real
	return ResolutionCore.window_to_game(get_viewport().get_screen_transform() * canvas * scale)


## Game coordinates of the point `offset` (game coordinates, `stick` local) from the default base center of `stick`.
func stick_point(offset: Vector2) -> Vector2:
	return game_point(element(STICK), BASE_DEFAULT + offset)


## Game coordinates of the center of `element_name`.
func center_of(element_name: String) -> Vector2:
	var control: Control = element(element_name)
	return game_point(control, control.size * 0.5)


# --- input


func touch(index: int, pressed: bool, position: Vector2) -> void:
	var event: InputEventScreenTouch = InputEventScreenTouch.new()
	event.index = index
	event.pressed = pressed
	event.position = position
	InputCoreDev.inject_device_input(event)


func drag(index: int, position: Vector2) -> void:
	var event: InputEventScreenDrag = InputEventScreenDrag.new()
	event.index = index
	event.position = position
	InputCoreDev.inject_device_input(event)


func vector() -> Vector2:
	return InputCore.get_vector(LEFT, RIGHT, UP, DOWN)


## Whether no direction action is pressed.
func no_direction() -> bool:
	return not InputCore.is_pressed(LEFT) and not InputCore.is_pressed(RIGHT) and not InputCore.is_pressed(UP) \
		and not InputCore.is_pressed(DOWN)


func assert_vector(expected: Vector2, text: String = "") -> void:
	assert_almost_eq(vector(), expected, Vector2(EPSILON, EPSILON), text)


## A control on `rect` (canvas coordinates) under the root, below the UI layers, that counts its GUI input.
func make_control(rect: Rect2) -> VirtualPadTestControl:
	var control: VirtualPadTestControl = VirtualPadTestControl.new()
	control.position = rect.position
	control.size = rect.size
	get_tree().root.add_child(control)
	keep(control)
	return control


func keep(node: Node) -> Node:
	_nodes.append(node)
	return node


# --- logs and frames


## Unconfirmed `error` logs of VirtualPadCore, which this confirms.
func errors() -> int:
	return UnitTestCore.check_logs("error", TAG)


func run_frames(frames: int = 2) -> void:
	await UnitTestCore.wait_frames(frames)


## Opens the test popup and waits until it shows. Async.
func open_popup() -> void:
	var result: UICore.PopupOpenResult = await UICore.open_popup(POPUP, null, Callable())
	assert_eq(result, UICore.PopupOpenResult.OPENED, "the test popup opens")
	await run_frames()
