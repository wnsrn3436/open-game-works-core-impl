extends VirtualPadTestCase
## Drawing of the virtual pad by state on a real window. A render test: the headless pass draws nothing.

## Allowed difference of a color component.
const TOLERANCE: float = 1.0 / 255.0 + 0.0001
const BACKGROUND: Color = Color(0.0, 0.0, 0.0)
## The color of the `Picture` of `fire` in the test layouts.
const PICTURE: Color = Color(1.0, 1.0, 1.0)


func test_hidden_draws_nothing_and_active_and_inactive_draw() -> void:
	await open(LAYOUT_FIXED)
	_add_background()
	var fire: Control = element(FIRE)
	var at: Vector2 = fire.get_global_transform_with_canvas() * (fire.size * 0.5)
	_assert_color(await _pixel(at), PICTURE, "Active")
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	_assert_color(await _pixel(at), BACKGROUND, "Hidden")
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	_assert_color(await _pixel(at), PICTURE, "Active again")
	await open_popup()
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.INACTIVE)
	_assert_color(await _pixel(at), PICTURE, "Inactive")
	UICore.close_all_popups()


## A code-made rectangle of `BACKGROUND` over the whole screen on the `SceneUI` layer, under the `VirtualPad` layer.
func _add_background() -> void:
	var background: ColorRect = ColorRect.new()
	background.color = BACKGROUND
	background.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UICore.get_layer(UICore.UILayer.SCENE_UI).add_child(background)
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	keep(background)


## The color of the drawn pixel at the viewport coordinates `at`, after the frame draws. The canvas layers that are not
## UI layers (the test runner window) are hidden for the frame. Async.
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
	return image.get_pixelv(Vector2i(at * scale))


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


func _assert_color(got: Color, expected: Color, text: String) -> void:
	assert_almost_eq(got.r, expected.r, TOLERANCE, "red " + text)
	assert_almost_eq(got.g, expected.g, TOLERANCE, "green " + text)
	assert_almost_eq(got.b, expected.b, TOLERANCE, "blue " + text)
