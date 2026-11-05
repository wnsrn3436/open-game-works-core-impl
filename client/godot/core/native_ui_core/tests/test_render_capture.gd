extends "res://core/native_ui_core/tests/support/native_ui_test_case.gd"
## Screen capture of a drawn frame: the window resolution, without the `Debug` layer. A capture that fails is empty
## bytes with an error log. Calls in one frame share that frame, a later call waits for a new frame, and `release` ends
## a waiting capture. A render test: the headless pass draws nothing.

## Most frames a test waits for the captures it started to return.
const MAX_WAIT_FRAMES: int = 10

## Results of the captures started by `_start_capture`, in the order they returned.
var captures: Array[PackedByteArray] = []
## Full-screen rect of the layer below the `Debug` layer. Green until a test changes it.
var _below_rect: ColorRect = null
## Full-screen red rect in the `Debug` layer.
var _debug_rect: ColorRect = null
## Canvas layers `_prepare_screen` hid, shown again after the test.
var _hidden_layers: Array[CanvasLayer] = []
## True to turn `_below_rect` blue when the first capture started by `_start_capture` returns.
var _blue_after_first_capture: bool = false


func before_each() -> void:
	super()
	captures.clear()
	_below_rect = null
	_debug_rect = null
	_hidden_layers = []
	_blue_after_first_capture = false


func after_each() -> void:
	await super()
	for layer: CanvasLayer in _hidden_layers:
		if is_instance_valid(layer):
			layer.visible = true
	if is_instance_valid(_debug_rect):
		_debug_rect.free()


func test_capture_has_the_window_size_and_no_debug_layer() -> void:
	assert_true(await start_modules(null))
	var debug_layer: CanvasLayer = await _prepare_screen()
	var png: PackedByteArray = await NativeUiCore.capture_screen()
	assert_gt(png.size(), 0)
	var image: Image = Image.new()
	assert_eq(image.load_png_from_buffer(png), OK)
	assert_eq(image.get_size(), DisplayServer.window_get_size(), "the window resolution")
	var center: Color = image.get_pixelv(image.get_size() / 2)
	assert_gt(center.g, 0.5, "the layer below the Debug layer")
	assert_lt(center.r, 0.5, "no Debug layer element")
	assert_true(debug_layer.visible, "the Debug layer is shown again")
	assert_eq(errors(), 0)


func test_two_captures_in_one_frame_return_that_frame_and_keep_a_shown_debug_layer() -> void:
	await _check_two_captures_in_one_frame(true)


func test_two_captures_in_one_frame_return_that_frame_and_keep_a_hidden_debug_layer() -> void:
	await _check_two_captures_in_one_frame(false)


func test_capture_after_an_earlier_one_returned_gets_a_frame_drawn_after_it() -> void:
	assert_true(await start_modules(null))
	await _prepare_screen()
	var first: PackedByteArray = await NativeUiCore.capture_screen()
	assert_gt(_center(first).g, 0.5, "the first capture is green")
	_below_rect.color = Color.BLUE
	var second: PackedByteArray = await NativeUiCore.capture_screen()
	var center: Color = _center(second)
	assert_gt(center.b, 0.5, "the second capture is drawn after the change")
	assert_lt(center.g, 0.5, "not the frame of the first capture")
	assert_eq(errors(), 0)


func test_release_ends_a_waiting_capture_with_empty_bytes_and_a_shown_debug_layer() -> void:
	await _check_release_during_a_capture(true)


func test_release_ends_a_waiting_capture_with_empty_bytes_and_a_hidden_debug_layer() -> void:
	await _check_release_during_a_capture(false)


func test_capture_without_the_debug_layer_is_empty_with_an_error_log() -> void:
	assert_true(await start_modules(null))
	UICore.release()
	assert_eq(await NativeUiCore.capture_screen(), PackedByteArray(), "UICore gave no Debug layer")
	assert_eq(errors(), 1)
	assert_eq(UnitTestCore.check_logs(ERROR, "UICore"), 1, "get_layer of a released UICore")
	await UnitTestCore.wait_frames(2)
	assert_true(NativeUiCore._capture_waits.is_empty(), "no capture waits for a frame")
	assert_null(NativeUiCore._hidden_layer, "no layer is hidden")


## Two captures started in one frame with the `Debug` layer visibility `debug_visible`. The first to return turns
## the screen blue, so a capture that read a later frame would differ.
func _check_two_captures_in_one_frame(debug_visible: bool) -> void:
	assert_true(await start_modules(null))
	var debug_layer: CanvasLayer = await _prepare_screen()
	debug_layer.visible = debug_visible
	_blue_after_first_capture = true
	_start_capture()
	_start_capture()
	await _wait_for_captures(2)
	assert_eq(captures.size(), 2)
	if captures.size() != 2:
		return
	assert_gt(captures[0].size(), 0)
	assert_eq(captures[0], captures[1], "the same frame")
	assert_gt(_center(captures[1]).g, 0.5, "the frame drawn before the first capture returned")
	assert_eq(debug_layer.visible, debug_visible, "the Debug layer visibility before the first call")
	assert_eq(errors(), 0)


## A capture started with the `Debug` layer visibility `debug_visible`, then `release` before its frame is drawn.
func _check_release_during_a_capture(debug_visible: bool) -> void:
	assert_true(await start_modules(null))
	var debug_layer: CanvasLayer = await _prepare_screen()
	debug_layer.visible = debug_visible
	_start_capture()
	assert_false(debug_layer.visible, "hidden while the capture waits")
	NativeUiCore.release()
	await UnitTestCore.wait_frames(2)
	assert_eq(captures.size(), 1, "the capture returned once")
	if captures.size() != 1:
		return
	assert_eq(captures[0], PackedByteArray())
	assert_eq(debug_layer.visible, debug_visible, "the Debug layer visibility before the call")
	assert_eq(errors(), 0)
	assert_eq(warns(), 0)


## Puts a green full-screen layer below the `Debug` layer and a red full-screen rect in the `Debug` layer, hides the
## other canvas layers, waits until that is drawn, and returns the `Debug` layer.
func _prepare_screen() -> CanvasLayer:
	var below: CanvasLayer = CanvasLayer.new()
	below.layer = -100
	_below_rect = ColorRect.new()
	_below_rect.color = Color.GREEN
	_below_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	below.add_child(_below_rect)
	add_child(below)
	autofree(below)
	var debug_layer: CanvasLayer = UICore.get_layer(UICore.UILayer.DEBUG)
	_debug_rect = ColorRect.new()
	_debug_rect.color = Color.RED
	_debug_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	debug_layer.add_child(_debug_rect)
	_hidden_layers = _hide_other_layers(below)
	await UnitTestCore.wait_frames(2)
	return debug_layer


## Starts a capture without waiting; its bytes are appended to `captures` when it returns.
func _start_capture() -> void:
	var png: PackedByteArray = await NativeUiCore.capture_screen()
	captures.append(png)
	if _blue_after_first_capture and captures.size() == 1 and is_instance_valid(_below_rect):
		_below_rect.color = Color.BLUE


## Waits until `count` captures returned or `MAX_WAIT_FRAMES` frames passed.
func _wait_for_captures(count: int) -> void:
	for frame: int in MAX_WAIT_FRAMES:
		if captures.size() >= count:
			return
		await UnitTestCore.wait_frames(1)


## Pixel at the center of `png`; black when it is no PNG.
func _center(png: PackedByteArray) -> Color:
	var image: Image = Image.new()
	if image.load_png_from_buffer(png) != OK:
		return Color.BLACK
	return image.get_pixelv(image.get_size() / 2)


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
