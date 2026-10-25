extends "res://core/qa_core/tests/support/qa_test_case.gd"
## Screen capture in the render pass: PNGs and JPEGs without the debug layer, `capture_video` frames over the
## automation channel and `capture_video` next to the command queue.

const SERVER := preload("res://core/qa_core/tests/support/qa_loopback_server.gd")
const NATIVE: PackedStringArray = ["android", "ios", "windows", "macos", "linux"]
const TOKEN: String = "qa-render-token"
const PNG_SIGNATURE: PackedByteArray = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
const JPEG_START: PackedByteArray = [0xFF, 0xD8]

var server: SERVER = null
## `TimeCore` real elapsed time of every hide of the debug layer: the start of every screen capture.
var capture_starts: PackedInt64Array = PackedInt64Array()


func before_each() -> void:
	super()
	capture_starts = PackedInt64Array()


func after_each() -> void:
	RenderingServer.render_loop_enabled = true
	if server != null:
		server.stop()
	server = null
	super()


func test_capture_leaves_out_the_debug_layer() -> void:
	assert_true(await start())
	await UnitTestCore.wait_frames(3)
	var plain: PackedByteArray = await capture()
	QACore._set_debug_open(true)
	await run_ok("set_stats_visible", PackedStringArray(["true"]))
	await UnitTestCore.wait_frames(3)
	var with_debug: PackedByteArray = await capture()
	assert_false(plain.is_empty() or with_debug.is_empty(), "two PNGs")
	var first: Image = Image.new()
	var second: Image = Image.new()
	assert_eq(first.load_png_from_buffer(plain), OK)
	assert_eq(second.load_png_from_buffer(with_debug), OK)
	assert_eq(first.get_size(), second.get_size())
	assert_eq(first.get_data(), second.get_data(), "the debug screen and the stats are not in the capture")
	assert_true(UICore.get_layer(UICore.UILayer.DEBUG).visible, "the debug layer is shown again")
	assert_false((await run("capture_video", PackedStringArray(["1000"]))).ok, "no automation channel connection")
	assert_eq(warns(), 1)


func test_capture_formats() -> void:
	assert_true(await start())
	add_button("go")
	await UnitTestCore.wait_frames(3)
	var jpg: RunCommandResult = await run("capture_screen", PackedStringArray(["jpg"]))
	assert_true(jpg.ok, "capture_screen jpg")
	assert_eq(jpg.bytes.slice(0, 2), JPEG_START, "JPEG bytes")
	var image: Image = Image.new()
	assert_eq(image.load_jpg_from_buffer(jpg.bytes), OK, "a JPEG")
	assert_eq(image.get_size(), ResolutionCore.get_window_size(), "the JPEG is the window size")
	for args: PackedStringArray in [PackedStringArray(["png"]), PackedStringArray()]:
		var png: RunCommandResult = await run("capture_screen", args)
		assert_true(png.ok, "capture_screen " + " ".join(args))
		assert_eq(png.bytes.slice(0, 8), PNG_SIGNATURE, "PNG bytes with %d arguments" % args.size())
		assert_eq(image.load_png_from_buffer(png.bytes), OK, "a PNG")
		assert_eq(image.get_size(), ResolutionCore.get_window_size(), "the PNG is the window size")
	var gif: RunCommandResult = await run("capture_screen", PackedStringArray(["gif"]))
	assert_false(gif.ok, "another format fails")
	assert_true(gif.bytes.is_empty())
	assert_eq(warns(), 1)
	# The quality of the JPEG is `QACore.captureJpgQuality`: a low quality gives fewer bytes than the highest. The engine
	# takes the quality in whole percent, so 10 is the lowest value it encodes.
	var sizes: PackedInt64Array = PackedInt64Array()
	for quality: int in [10, 1000]:
		QACore.release()
		set_int("QACore.captureJpgQuality", quality)
		QACore._test_launch_values = {}
		QACore._has_test_launch_values = true
		assert_true(QACore.init())
		await UnitTestCore.wait_frames(3)
		sizes.append((await capture(PackedStringArray(["jpg"]))).size())
	assert_true(sizes[0] < sizes[1], "quality 10 gives fewer bytes than 1000: %s" % sizes)


func test_capture_while_the_engine_does_not_draw() -> void:
	assert_true(await start())
	var cover: ColorRect = ColorRect.new()
	cover.color = Color.RED
	cover.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cover.set_anchors_preset(Control.PRESET_FULL_RECT)
	UICore.get_layer(UICore.UILayer.SCENE_UI).add_child(cover)
	await UnitTestCore.wait_frames(3)
	var drawn_capture: Image = Image.new()
	assert_eq(drawn_capture.load_png_from_buffer(await capture()), OK)
	# With the render loop off the engine draws no frame, as for a window other windows cover: the last drawn frame has
	# the red cover. Godot still draws while the rendering device has resources to process, and showing or hiding the
	# debug layer gives it some, so the screen changes by a color only and the first capture has no debug layer change.
	RenderingServer.render_loop_enabled = false
	await UnitTestCore.wait_frames(1)
	cover.color = Color.BLUE
	var drawn: int = Engine.get_frames_drawn()
	await UnitTestCore.wait_frames(3)
	assert_eq(Engine.get_frames_drawn(), drawn, "the engine draws no frame")
	var plain: PackedByteArray = await capture()
	QACore._set_debug_open(true)
	await run_ok("set_stats_visible", PackedStringArray(["true"]))
	await UnitTestCore.wait_frames(3)
	var with_debug: PackedByteArray = await capture()
	RenderingServer.render_loop_enabled = true
	QACore._set_debug_open(false)
	await run_ok("set_stats_visible", PackedStringArray(["false"]))
	await UnitTestCore.wait_frames(3)
	var expected: Image = Image.new()
	assert_eq(expected.load_png_from_buffer(await capture()), OK)
	assert_ne(expected.get_data(), drawn_capture.get_data(), "the blue cover changes the screen")
	var first: Image = Image.new()
	var second: Image = Image.new()
	assert_eq(first.load_png_from_buffer(plain), OK, "a PNG")
	assert_eq(second.load_png_from_buffer(with_debug), OK, "a PNG")
	assert_eq(first.get_size(), drawn_capture.get_size(), "the size of a capture of a drawn frame")
	assert_eq(first.get_data(), expected.get_data(), "a frame drawn for the capture: the blue cover")
	assert_eq(second.get_data(), expected.get_data(), "the debug screen and the stats are not in the capture")


func test_capture_video_over_the_channel() -> void:
	if not await start_channel():
		return
	assert_true(server.send("{\"id\": 9, \"command\": \"capture_video\", \"args\": [\"1000\"]}"))
	var response: String = await wait_response(9)
	assert_true(JSONR.boolean(response, "ok"), response)
	assert_eq(JSONR.keys(response, "result"), PackedStringArray(["frame_count", "fps"]), "a JSON object result")
	assert_eq(JSONR.integer(response, "result.frame_count"), VIDEO_FPS)
	assert_eq(JSONR.integer(response, "result.fps"), VIDEO_FPS)
	var frames: PackedInt32Array = PackedInt32Array()
	var response_index: int = -1
	for i: int in server.messages.size():
		var message: String = server.messages[i]
		if JSONR.has(message, "frame") and JSONR.integer(message, "id") == 9:
			assert_eq(response_index, -1, "every frame comes before the response")
			frames.append(JSONR.integer(message, "frame"))
			var png: Image = Image.new()
			assert_eq(png.load_png_from_buffer(Marshalls.base64_to_raw(JSONR.text(message, "bytes"))), OK, "a PNG frame")
		elif JSONR.has(message, "ok") and JSONR.integer(message, "id") == 9:
			response_index = i
	assert_eq(frames, PackedInt32Array(range(VIDEO_FPS)), "frames 0 to videoFps - 1 in order")


func test_capture_video_of_jpeg_frames() -> void:
	if not await start_channel():
		return
	assert_true(server.send("{\"id\": 5, \"command\": \"capture_video\", \"args\": [\"500\", \"jpg\"]}"))
	var response: String = await wait_response(5)
	assert_true(JSONR.boolean(response, "ok"), response)
	# ⌊500 × videoFps ÷ 1000⌋ with videoFps 4.
	var expected: int = 2
	assert_eq(JSONR.integer(response, "result.frame_count"), expected)
	var frames: int = 0
	for message: String in server.messages:
		if JSONR.has(message, "frame") and JSONR.integer(message, "id") == 5:
			frames += 1
			var bytes: PackedByteArray = Marshalls.base64_to_raw(JSONR.text(message, "bytes"))
			assert_eq(bytes.slice(0, 2), JPEG_START, "a JPEG frame")
			var jpg: Image = Image.new()
			assert_eq(jpg.load_jpg_from_buffer(bytes), OK, "a JPEG frame")
			assert_eq(jpg.get_size(), ResolutionCore.get_window_size(), "the frame is the window size")
	assert_eq(frames, expected, "a frame message per frame")


func test_capture_video_frame_times_and_late_frames() -> void:
	set_int("QACore.videoFps", 30)
	set_int("QACore.videoMaxMs", 2000)
	if not await start_channel():
		return
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.DEBUG)
	layer.visibility_changed.connect(_on_debug_visibility.bind(layer))
	assert_true(server.send("{\"id\": 4, \"command\": \"capture_video\", \"args\": [\"1001\"]}"))
	# 50 ms a frame: a capture takes longer than the frame interval of 33 ms.
	var response: String = await wait_response(4)
	assert_true(JSONR.boolean(response, "ok"), response)
	assert_eq(JSONR.integer(response, "result.frame_count"), 30, "⌊1001 × 30 ÷ 1000⌋")
	var frames: PackedInt32Array = PackedInt32Array()
	for message: String in server.messages:
		if JSONR.has(message, "frame") and JSONR.integer(message, "id") == 4:
			frames.append(JSONR.integer(message, "frame"))
	assert_eq(frames, PackedInt32Array(range(30)), "frames 0 to 29 once each, in order")
	assert_eq(capture_starts.size(), 30, "one capture a frame")
	for n: int in capture_starts.size():
		assert_true(capture_starts[n] - capture_starts[0] >= n * 1000 / 30, "frame %d starts at ⌊n × 1000 ÷ 30⌋ ms or later" % n)
	assert_true(capture_starts[capture_starts.size() - 1] - capture_starts[0] > 29 * 1000 / 30,
		"the frames came late")


func test_capture_and_tap_in_a_test_screen() -> void:
	assert_true(await start())
	await run_ok("set_test_screen", PackedStringArray(["800", "600", "Letterbox"]))
	add_button("go")
	await UnitTestCore.wait_frames(3)
	var png: Image = Image.new()
	assert_eq(png.load_png_from_buffer(await capture()), OK)
	assert_eq(png.get_size(), Vector2i(800, 600), "the PNG is the test window")
	var list: String = await run_ok("list_ui")
	await run_ok("tap", center_args(JSONR.rect(element_field(list, "Go", "rect"), "")))
	await UnitTestCore.wait_frames(2)
	assert_eq(clicks, PackedStringArray(["go"]), "one click at the list_ui center in the test window")


func test_capture_video_runs_next_to_the_queue() -> void:
	if not await start_channel():
		return
	var tap: PackedStringArray = window_args(640, 600)
	assert_true(server.send("{\"id\": 1, \"command\": \"capture_video\", \"args\": [\"1000\"]}"))
	assert_true(server.send("{\"id\": 2, \"command\": \"tap\", \"args\": [%s, %s]}" % [JSON.stringify(tap[0]), JSON.stringify(tap[1])]))
	assert_true(server.send("{\"id\": 3, \"command\": \"capture_video\", \"args\": [\"1000\"]}"))
	var second_video: String = await wait_response(3)
	assert_false(JSONR.boolean(second_video, "ok"), "a capture_video while one runs")
	var tap_response: String = await wait_response(2)
	assert_true(JSONR.boolean(tap_response, "ok"))
	assert_eq(response_position(1), -1, "the tap ended before the capture_video")
	var video: String = await wait_response(1)
	assert_true(JSONR.boolean(video, "ok"))
	assert_true(response_position(2) < response_position(1))
	assert_eq(warns(), 1)


func _on_debug_visibility(layer: CanvasLayer) -> void:
	if not layer.visible:
		capture_starts.append(TimeCore.get_real_time())


func capture(args: PackedStringArray = PackedStringArray()) -> PackedByteArray:
	var result: RunCommandResult = await run("capture_screen", args)
	assert_true(result.ok, "capture_screen")
	return result.bytes


func start_channel() -> bool:
	UnitTestCore.require_platform(NATIVE)
	if not CoreBuildInfo.platform in NATIVE:
		return false
	server = SERVER.new()
	assert_true(server.start())
	assert_true(await start(false))
	QACore._test_launch_values = {"OGW_AUTOMATION_PORT": str(server.port), "OGW_AUTOMATION_TOKEN": TOKEN}
	QACore._has_test_launch_values = true
	assert_true(QACore.init())
	# The hello comes over a real connection: it ends the wait, not a frame count. A release of the modules, as at the
	# test time limit, ends it too.
	server.poll()
	while server.messages.is_empty() and EventCore.is_initialized():
		await UnitTestCore.wait_frames(1)
		server.poll()
	assert_false(server.messages.is_empty(), "the hello came")
	return true


## Moves the test clock and polls the server until the response of request `id` came. Its JSON text. The response
## comes over a real connection, so it ends the wait, not a frame count; a release of the modules, as at the test time
## limit, ends it too.
func wait_response(id: int) -> String:
	server.poll()
	while response_position(id) < 0:
		if not EventCore.is_initialized():
			assert_true(false, "the response of request %d came" % id)
			return ""
		await advance(50, 1)
		server.poll()
	return server.messages[response_position(id)]


func response_position(id: int) -> int:
	for i: int in server.messages.size():
		var message: String = server.messages[i]
		if JSONR.has(message, "ok") and JSONR.integer(message, "id") == id:
			return i
	return -1
