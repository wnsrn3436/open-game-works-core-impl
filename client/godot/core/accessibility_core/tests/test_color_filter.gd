extends "res://core/accessibility_core/tests/support/accessibility_test_case.gd"
## Color filter placement: the `LoadingIcon` layer, above its other elements, outside its safe area root, on the
## visible game area, and shown only for a color mode other than `None`. The pixels are in the render test.


func test_color_filter_is_on_the_loading_icon_layer_above_its_elements_and_outside_the_safe_area_root() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	var filter: ColorRect = AccessibilityCore._filter
	assert_not_null(filter)
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.LOADING_ICON)
	assert_eq(filter.get_parent(), layer)
	assert_eq(filter.z_index, RenderingServer.CANVAS_ITEM_Z_MAX)
	assert_eq(filter.mouse_filter, Control.MOUSE_FILTER_IGNORE)
	assert_eq(filter.get_rect(), ResolutionCore.get_visible_game_area())
	for child: Node in layer.get_children():
		if child != filter and child is CanvasItem:
			assert_true((child as CanvasItem).z_index < filter.z_index, "drawn under the filter: " + child.name)


func test_color_filter_shows_the_matrix_of_the_mode_and_hides_for_none() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	var filter: ColorRect = AccessibilityCore._filter
	assert_false(filter.visible, "None")
	assert_true(AccessibilityCore.set_color_mode(DEUTERANOPIA))
	assert_true(filter.visible, "Deuteranopia")
	var material: ShaderMaterial = filter.material as ShaderMaterial
	var row_r: Vector3 = material.get_shader_parameter(&"row_r")
	var row_g: Vector3 = material.get_shader_parameter(&"row_g")
	var row_b: Vector3 = material.get_shader_parameter(&"row_b")
	var m: PackedFloat64Array = DEUTERANOPIA_MATRIX
	assert_almost_eq(row_r, Vector3(m[0], m[1], m[2]), Vector3(0.0001, 0.0001, 0.0001))
	assert_almost_eq(row_g, Vector3(m[3], m[4], m[5]), Vector3(0.0001, 0.0001, 0.0001))
	assert_almost_eq(row_b, Vector3(m[6], m[7], m[8]), Vector3(0.0001, 0.0001, 0.0001))
	assert_true(AccessibilityCore.set_color_mode(NONE))
	assert_false(filter.visible, "None again")


func test_color_filter_follows_the_visible_game_area() -> void:
	assert_true(await start_modules())
	ResolutionCoreDev.set_test_screen(Vector2i(1280, 720), Vector2i(1000, 1000), ResolutionCore.FillMode.LETTERBOX, false)
	await UnitTestCore.wait_frames(1)
	assert_eq(AccessibilityCore._filter.get_rect(), ResolutionCore.get_visible_game_area())


func test_color_filter_covers_the_visible_game_area_with_a_notch() -> void:
	assert_true(await start_modules())
	# The window size is set, so the notch does not depend on the window of the host.
	ResolutionCoreDev.set_test_screen(Vector2i(1280, 720), Vector2i(1280, 720), ResolutionCore.FillMode.LETTERBOX, false)
	await UnitTestCore.wait_frames(1)
	SafeAreaCoreDev.set_virtual_notch(120, 40, 30, 60)
	await UnitTestCore.wait_frames(1)
	var inset_left: float = SafeAreaCore.get_inset(SafeAreaCore.Edge.LEFT)
	var inset_bottom: float = SafeAreaCore.get_inset(SafeAreaCore.Edge.BOTTOM)
	var rect: Rect2 = AccessibilityCore._filter.get_rect()
	var visible_area: Rect2 = ResolutionCore.get_visible_game_area()
	var safe_area: Rect2 = SafeAreaCore.get_safe_area()
	SafeAreaCoreDev.clear_virtual_notch()
	assert_true(inset_left > 0.0 and inset_bottom > 0.0, "the notch moves the safe area in")
	assert_ne(safe_area, visible_area, "the safe area is inside the visible game area")
	assert_eq(rect, visible_area)


func test_with_color_filter_disabled_there_is_no_filter_in_any_mode() -> void:
	set_bool("AccessibilityCore.colorFilterEnabled", false)
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	assert_null(AccessibilityCore._filter)
	for mode: AccessibilityCore.ColorMode in FILTER_MODES:
		assert_true(AccessibilityCore.set_color_mode(mode))
		assert_eq(AccessibilityCore.get_settings().color_mode, mode, "content reads the mode")
	assert_null(AccessibilityCore._filter)
	for child: Node in UICore.get_layer(UICore.UILayer.LOADING_ICON).get_children():
		assert_false(child is ColorRect and (child as ColorRect).material is ShaderMaterial, "no filter on the layer")


func test_set_color_mode_outside_color_mode_is_false_with_an_error() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	assert_false(AccessibilityCore.set_color_mode(4 as AccessibilityCore.ColorMode))
	assert_false(AccessibilityCore.set_color_mode(-1 as AccessibilityCore.ColorMode))
	assert_eq(errors(), 2)
	assert_eq(AccessibilityCore.get_settings().color_mode, NONE)
	assert_false(AccessibilityCore._filter.visible)
