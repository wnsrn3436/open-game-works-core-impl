extends "res://core/accessibility_core/tests/support/accessibility_test_case.gd"
## Color filter pixels on a real window. A render test: the headless pass draws nothing.

## Allowed difference of a color component.
const TOLERANCE: float = 1.0 / 255.0 + 0.0001
const RED: Color = Color(1.0, 0.0, 0.0)


func test_deuteranopia_filter_multiplies_a_pure_red_pixel_by_its_matrix_and_none_keeps_it() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	_add_background(RED)
	var at: Vector2 = _background_point()
	_assert_color(await _pixel(at), RED, "None before")
	assert_true(AccessibilityCore.set_color_mode(DEUTERANOPIA))
	_assert_color(await _pixel(at), _filtered(RED), "Deuteranopia")
	assert_true(AccessibilityCore.set_color_mode(NONE))
	_assert_color(await _pixel(at), RED, "None after")


func test_with_color_filter_disabled_no_mode_changes_the_pixels() -> void:
	set_bool("AccessibilityCore.colorFilterEnabled", false)
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	_add_background(RED)
	var at: Vector2 = _background_point()
	for mode: AccessibilityCore.ColorMode in FILTER_MODES:
		assert_true(AccessibilityCore.set_color_mode(mode))
		_assert_color(await _pixel(at), RED, "mode %d" % mode)


func test_loading_icon_pixels_go_through_the_color_filter() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	assert_true(AccessibilityCore.set_color_mode(DEUTERANOPIA))
	_add_background(RED)
	var token: int = UICore.show_loading_icon()
	assert_ne(token, 0)
	var at: Vector2 = SafeAreaCore.get_safe_area().get_center()
	var filtered: Color = await _pixel(at)
	assert_true(AccessibilityCore.set_color_mode(NONE))
	var plain: Color = await _pixel(at)
	assert_false(plain.is_equal_approx(RED), "the loading icon is on screen")
	_assert_color(filtered, _filtered(plain), "loading icon")
	UICore.hide_loading_icon(token)


## A code-made rectangle of `color` over the whole screen on the `Panel` layer, under the `LoadingIcon` layer.
func _add_background(color: Color) -> void:
	var background: ColorRect = ColorRect.new()
	background.color = color
	background.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UICore.get_layer(UICore.UILayer.PANEL).add_child(background)
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	autofree(background)


## A point of the visible game area away from its center, where the loading icon is.
func _background_point() -> Vector2:
	var area: Rect2 = ResolutionCore.get_visible_game_area()
	return area.position + area.size * 0.25


## The color of the drawn pixel at the game coordinates `at`, after the frame draws. The canvas layers that are not UI
## layers (the test runner window) are hidden for the frame. Async.
func _pixel(at: Vector2) -> Color:
	var hidden: Array[CanvasLayer] = _hide_other_layers()
	await UnitTestCore.wait_frames(2)
	await RenderingServer.frame_post_draw
	var viewport: Viewport = get_viewport()
	var image: Image = viewport.get_texture().get_image()
	for layer: CanvasLayer in hidden:
		if is_instance_valid(layer):
			layer.visible = true
	var scale: Vector2 = Vector2(image.get_size()) / viewport.get_visible_rect().size
	var pixel: Vector2i = Vector2i(at * scale)
	return image.get_pixelv(pixel)


## Hides every visible canvas layer of the tree that is not a UI layer, and returns them.
func _hide_other_layers() -> Array[CanvasLayer]:
	var ui_layers: Array[CanvasLayer] = []
	for layer: int in UICore.UILayer.size():
		ui_layers.append(UICore.get_layer(layer as UICore.UILayer))
	var hidden: Array[CanvasLayer] = []
	for node: Node in get_tree().root.find_children("*", "CanvasLayer", true, false):
		var layer: CanvasLayer = node as CanvasLayer
		if layer.visible and not ui_layers.has(layer):
			layer.visible = false
			hidden.append(layer)
	return hidden


## `color` through the test Deuteranopia matrix, each component clamped to 0 to 1.
func _filtered(color: Color) -> Color:
	var m: PackedFloat64Array = DEUTERANOPIA_MATRIX
	return Color(
		clampf(m[0] * color.r + m[1] * color.g + m[2] * color.b, 0.0, 1.0),
		clampf(m[3] * color.r + m[4] * color.g + m[5] * color.b, 0.0, 1.0),
		clampf(m[6] * color.r + m[7] * color.g + m[8] * color.b, 0.0, 1.0),
	)


func _assert_color(got: Color, expected: Color, text: String) -> void:
	assert_almost_eq(got.r, expected.r, TOLERANCE, "red " + text)
	assert_almost_eq(got.g, expected.g, TOLERANCE, "green " + text)
	assert_almost_eq(got.b, expected.b, TOLERANCE, "blue " + text)
