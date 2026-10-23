extends "res://core/native_ui_core/tests/support/native_ui_test_case.gd"
## Screen capture of a drawn frame: the window resolution, without the `Debug` layer. A render test: the headless pass
## draws nothing.


func test_capture_has_the_window_size_and_no_debug_layer() -> void:
	assert_true(await start_modules(null))
	var below: CanvasLayer = CanvasLayer.new()
	below.layer = -100
	var green: ColorRect = ColorRect.new()
	green.color = Color.GREEN
	green.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	below.add_child(green)
	add_child(below)
	autofree(below)
	var debug_layer: CanvasLayer = UICore.get_layer(UICore.UILayer.DEBUG)
	var red: ColorRect = ColorRect.new()
	red.color = Color.RED
	red.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	debug_layer.add_child(red)
	var hidden: Array[CanvasLayer] = _hide_other_layers(below)
	await UnitTestCore.wait_frames(2)
	var png: PackedByteArray = await NativeUiCore.capture_screen()
	for layer: CanvasLayer in hidden:
		if is_instance_valid(layer):
			layer.visible = true
	assert_gt(png.size(), 0)
	var image: Image = Image.new()
	assert_eq(image.load_png_from_buffer(png), OK)
	assert_eq(image.get_size(), DisplayServer.window_get_size(), "the window resolution")
	var center: Color = image.get_pixelv(image.get_size() / 2)
	assert_gt(center.g, 0.5, "the layer below the Debug layer")
	assert_lt(center.r, 0.5, "no Debug layer element")
	assert_true(debug_layer.visible, "the Debug layer is shown again")
	red.free()
	assert_eq(errors(), 0)


## Hides every visible canvas layer of the tree that is not a UI layer or `kept`, such as the test runner window, and
## returns them.
func _hide_other_layers(kept: CanvasLayer) -> Array[CanvasLayer]:
	var shown: Array[CanvasLayer] = [kept]
	for layer: int in UICore.UILayer.size():
		shown.append(UICore.get_layer(layer as UICore.UILayer))
	var hidden: Array[CanvasLayer] = []
	for node: Node in get_tree().root.find_children("*", "CanvasLayer", true, false):
		var layer: CanvasLayer = node as CanvasLayer
		if layer.visible and not shown.has(layer):
			layer.visible = false
			hidden.append(layer)
	return hidden
