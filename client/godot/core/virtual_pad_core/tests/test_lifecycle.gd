extends VirtualPadTestCase
## VirtualPadCore `init`, `release`, the safe area root of the `VirtualPad` layer and the DEV touch support.

## Result of the `open_layout` that `start_open` started: `pending`, `true` or `false`.
var open_result: String = ""


func test_init_puts_one_safe_area_root_in_the_virtual_pad_layer() -> void:
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.VIRTUAL_PAD)
	var roots: int = 0
	for child: Node in layer.get_children():
		if child is SafeAreaRoot:
			roots += 1
	assert_eq(roots, 1)
	assert_eq(safe_root().get_parent(), layer)
	await open(LAYOUT_FIXED)
	assert_eq(VirtualPadCore._pad.get_parent(), safe_root(), "the virtual pad is under it")


func test_release_removes_the_virtual_pad_and_keeps_the_saved_values() -> void:
	await open(LAYOUT_FIXED)
	VirtualPadCore.set_offset(FIRE, Vector2(-10.0, -10.0))
	touch(0, true, center_of(FIRE))
	touch(1, true, stick_point(Vector2(RADIUS, 0.0)))
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.VIRTUAL_PAD)
	var pad: VirtualPadLayout = VirtualPadCore._pad
	var root: Control = safe_root()
	var node: Node = VirtualPadCore._node
	VirtualPadCore.release()
	assert_false(VirtualPadCore.is_initialized())
	assert_false(is_instance_valid(pad) and pad.is_inside_tree(), "no virtual pad")
	assert_false(is_instance_valid(root) and root.get_parent() == layer, "no safe area root in the layer")
	assert_false(is_instance_valid(node) and node.is_inside_tree(), "the core node left the tree")
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	assert_true(no_direction())
	assert_eq(LocalDataCore.get_array_string(DEVICE, NAMES_KEY), PackedStringArray([FIRE]), "saved values stay")
	assert_eq(LocalDataCore.get_array_float(DEVICE, OFFSET_X_KEY), PackedFloat64Array([-10.0]))
	assert_initial_state()
	assert_true(VirtualPadCore.init(), "init again")
	VirtualPadCoreDev.set_test_touch_support(true)
	await open(LAYOUT_FIXED)
	assert_eq(VirtualPadCore.get_offset(FIRE), Vector2(-10.0, -10.0))


## Starts `open_layout` of the fixed layout; `open_result` gets its result. Call without `await`.
func start_open() -> void:
	open_result = "pending"
	var ok: bool = await VirtualPadCore.open_layout(LAYOUT_FIXED, scope)
	open_result = str(ok)


func test_release_abandons_the_load() -> void:
	start_open()
	assert_eq(open_result, "pending")
	VirtualPadCore.release()
	assert_eq(open_result, "false")
	assert_true(VirtualPadCore.init())
	await run_frames(5)
	assert_null(VirtualPadCore._pad, "the abandoned load makes no virtual pad")


func test_second_init_fails() -> void:
	assert_false(VirtualPadCore.init())
	assert_eq(errors(), 1)
	assert_true(VirtualPadCore.is_initialized())


func test_operations_before_init_fail() -> void:
	VirtualPadCore.release()
	assert_false(await VirtualPadCore.open_layout(LAYOUT_FIXED, scope))
	VirtualPadCore.close_layout()
	VirtualPadCore.set_offset(STICK, Vector2.ONE)
	assert_eq(VirtualPadCore.get_offset(STICK), Vector2.ZERO)
	assert_eq(VirtualPadCore.get_scale(STICK), 1.0)
	assert_eq(VirtualPadCore.get_opacity(STICK), 1.0)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	VirtualPadCore.reset_user_settings()
	VirtualPadCoreDev.set_test_touch_support(true)
	assert_eq(errors(), 9)
	assert_false(VirtualPadCore._touch_supported, "set_test_touch_support before init does nothing")
	VirtualPadCore.release()
	assert_eq(errors(), 0, "release without init logs nothing")


func test_release_drops_the_test_touch_support() -> void:
	VirtualPadCoreDev.set_test_touch_support(false)
	VirtualPadCore.release()
	assert_true(VirtualPadCore.init())
	assert_eq(VirtualPadCore._touch_supported, DisplayServer.is_touchscreen_available())


func test_core_node_destroyed_outside_release() -> void:
	await open(LAYOUT_FIXED)
	touch(0, true, center_of(FIRE))
	var node: Node = VirtualPadCore._node
	node.free()
	assert_false(VirtualPadCore.is_initialized())
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	assert_initial_state()
	await run_frames()
	assert_true(VirtualPadCore.init())


## Every static var of VirtualPadCore is its initial value.
func assert_initial_state() -> void:
	assert_false(VirtualPadCore._is_initialized)
	assert_null(VirtualPadCore._node)
	assert_null(VirtualPadCore._session)
	assert_null(VirtualPadCore._safe_root)
	assert_true(VirtualPadCore._scope_listener.is_null())
	assert_eq(VirtualPadCore._dead_zone, 0.0)
	assert_eq(VirtualPadCore._sensitivity, 1.0)
	assert_false(VirtualPadCore._touch_supported)
	assert_eq(VirtualPadCore._state, VirtualPadCore.VirtualPadState.HIDDEN)
	assert_null(VirtualPadCore._waiter)
	assert_null(VirtualPadCore._pad)
	assert_eq(VirtualPadCore._pad_key, "")
	assert_null(VirtualPadCore._pad_scope)
	assert_eq(VirtualPadCore._joystick_mode, VirtualPadCore.JoystickMode.FIXED)
	assert_eq(VirtualPadCore._elements.size(), 0)
	assert_eq(VirtualPadCore._cancel_count, 0)
	assert_false(VirtualPadCore._has_popup)
	assert_eq(VirtualPadCore._saved_names.size(), 0)
	assert_eq(VirtualPadCore._saved_offset_x.size(), 0)
	assert_eq(VirtualPadCore._saved_offset_y.size(), 0)
	assert_eq(VirtualPadCore._saved_scale.size(), 0)
	assert_eq(VirtualPadCore._saved_opacity.size(), 0)
